import type {
  ActivityFinishedEvent,
  AgentDecisionMessage,
  SocialChatEvent,
  WorldEvent,
} from '@sims/shared';
import { getActivityDefinition, resourceNodeLabel, SHOP_ITEMS, TOWN_MAP } from '@sims/shared';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { characterImpressions, memories } from '../db/schema/memory.js';
import { runIntent } from '../intents/execute.js';
import { relationKey } from '../world/social.js';
import type { Simulation } from '../world/simulation.js';
import type { WorldCharacter } from '../world/character.js';
import { BALANCE } from '../config/balance.js';
import { autonomy, hosting, innerState } from './cognition.js';
import { describeMood } from './mood.js';
import {
  jevDecide,
  wantSelect,
  ruleDecide,
  type Decision,
  type RuleWorldQueries,
  type WantWorldQueries,
} from './fast-layer.js';
import { ResponseRegistry } from './responses.js';
import { persistInnerState } from './inner-state-db.js';
import type { ScoredCandidate } from './social-motive.js';
import {
  biasOf,
  composeIntents,
  loadPersonaContext,
  type AcquaintanceBrief,
} from './slow-layer.js';
import {
  isTriagedEvent,
  triageEvent,
  type ResponseAction,
  type TriageContext,
  type TriageVerdict,
} from './triage.js';
import type { MemoryLlm } from './memory-writer.js';
import { logTech } from '../telemetry.js';
import { SocialLoop } from './social-loop.js';
import { TraceRecorder, type TraceEntry } from './trace.js';

/** 阈值巡检周期(游戏分钟):数值压力(饥饿/房租/困倦)的反应节拍 */
export const AUTONOMY_CHECK_INTERVAL_MINUTES = 15;
/** jev 微决策冷却(游戏分钟/角色):事件风暴下不烧 LLM */
export const JEV_COOLDOWN_MINUTES = 30;
/** 意图被拒/被打断后的退避(游戏分钟):固定短退避,期满重新评分择条 */
export const INTENT_RETRY_BACKOFF_MINUTES = 30;
/** 连续被拒上限:清当日意图,下轮巡检重新生成(agent-design §3.3 矛盾局部重规划) */
export const INTENT_MAX_CONSECUTIVE_REJECTS = 3;
/** rule continue 的 trace 采样周期(每 N 次 continue 记 1 次,防日志洪水;react 全量) */
const RULE_CONTINUE_SAMPLE = 20;
/** triage ignore 的 trace 采样周期(每 N 次记 1 次;门①消化近半事件,防洪水) */
const TRIAGE_IGNORE_SAMPLE = 10;
const CHECK_TICK_MS = 2_000;

export interface AgentSchedulerDeps {
  sim: Simulation;
  handle: DbHandle;
  llm: MemoryLlm;
  /** 决策气泡出流(意图+理由模板);缺省静默(测试) */
  onBubble?: (message: AgentDecisionMessage) => void;
  /** 意图执行入口(默认统一出口 runIntent;测试可注入桩) */
  runIntent?: typeof runIntent;
}

/**
 * Agent 调度泵(agent-design §3.1/§4.6;10-cognition §7.1 事件响应层):
 * 异步认知泵,不进 tick 循环。事件侧走 C3 分级管道——EventBus → isTriagedEvent
 * 过滤(管理面事件零惊动)→ ResponseRegistry 簿记(救援台账)→ 逐自治角色
 * triageEvent 四关分级:ignore(采样 trace)/idle(放行既有 rule→want→jev 管线)/
 * respond(注册表动作直执)/assess(⑤ 中断评估:预算三闸已过,systemOne choice
 * 一词判定)/defer(不可打断,排事后处理,巡检空闲补执行)。move 响应打断当前
 * want 执行后固定短退避,期满重新评分择条=「回意图」。
 * 时间侧=2s 定时器(意图补齐+defer 巡检)+15 游戏分阈值巡检(rule→want);
 * activity.finished 结算 want 生命周期(完成 done/中断 pending/欠费 abandoned)。
 * 输出统一经 runIntent;trace:triage 分级记录(ignore 采样),执行/模型全量。
 */
export class AgentScheduler {
  private lastInspectedBlock = -1;
  private readonly jevLastAt = new Map<string, number>();
  private readonly continueCount = new Map<string, number>();
  private readonly triageIgnoreCount = new Map<string, number>();
  private readonly intentRejects = new Map<string, number>();
  /** 意图退避期(绝对 gameMinutes):被打断/被拒后固定短退避,期内 want 层静默 */
  private readonly intentSkipUntil = new Map<string, number>();
  private readonly planning = new Set<string>();
  private readonly registry = new ResponseRegistry();
  /** ⑤ 预算簿记(scheduler 独占写,triage 只读快照):日/当日次数/最近评估时刻 */
  private readonly assessBudget = new Map<
    string,
    { day: number; assessedToday: number; lastAssessAt: number }
  >();
  private readonly assessedKeys = new Map<string, Set<string>>();
  /** defer 事后处理队列:characterId|eventKey → 事件与入队时刻(保鲜期判定) */
  private readonly deferred = new Map<
    string,
    { characterId: string; event: WorldEvent; atGameMinutes: number }
  >();
  /** C4 空闲社交管线(独立类,簿记随迁;apply/trace 复用 scheduler 通道) */
  private readonly socialLoop: SocialLoop;
  private readonly timer: NodeJS.Timeout;
  private readonly unsubscribe: () => void;
  private readonly runIntentFn: typeof runIntent;
  private readonly trace: TraceRecorder;

  constructor(private readonly deps: AgentSchedulerDeps) {
    this.runIntentFn = deps.runIntent ?? runIntent;
    this.trace = new TraceRecorder(deps.handle);
    this.socialLoop = new SocialLoop({
      sim: deps.sim,
      handle: deps.handle,
      llm: deps.llm,
      trace: this.trace,
      apply: (char, decision, trigger, perception) => this.apply(char, decision, trigger, perception),
    });
    this.timer = setInterval(() => this.inspect(), CHECK_TICK_MS);
    this.unsubscribe = deps.sim.events.subscribe((event) => this.onEvent(event));
  }

  dispose(): void {
    clearInterval(this.timer);
    this.unsubscribe();
  }

  /** 阈值巡检(threshold):补齐当日意图+defer 事后处理,跨 15 游戏分边界即共处破冰+rule→want 判定 */
  private inspect(): void {
    const { sim } = this.deps;
    this.processDeferred();
    for (const id of autonomy.list()) {
      const char = sim.characters.get(id);
      if (char !== undefined) this.ensureIntents(char);
    }
    const block = Math.floor(sim.clock.gameMinutes / AUTONOMY_CHECK_INTERVAL_MINUTES);
    if (block === this.lastInspectedBlock) return;
    this.lastInspectedBlock = block;
    this.socialLoop.acquaintanceStep();
    for (const id of autonomy.list()) {
      const char = sim.characters.get(id);
      if (char === undefined) continue;
      const rule = ruleDecide(
        char,
        sim.clock.day,
        sim.clock.minuteOfDay,
        sim.map.definition,
        this.anchorsAt(),
        this.ruleWorld(char),
      );
      if (rule.action === 'react') {
        this.apply(char, rule, 'threshold', {
          block: `${block}(${AUTONOMY_CHECK_INTERVAL_MINUTES}min)`,
        });
        continue;
      }
      const want = this.wantDecision(char);
      if (want !== null) {
        this.apply(char, want, 'threshold', {
          block: `${block}(${AUTONOMY_CHECK_INTERVAL_MINUTES}min)`,
          want: true,
        });
        continue;
      }
      this.socialLoop.idleSocialStep(char, 'threshold');
      this.apply(char, rule, 'threshold', {
        block: `${block}(${AUTONOMY_CHECK_INTERVAL_MINUTES}min)`,
      });
    }
  }

  /** 锚点解析(快层用):活动使用格,可按场所过滤 */
  private anchorsAt(): (activityId: string, placeId: string | null) => Array<{ x: number; y: number }> {
    return (activityId, placeId) =>
      this.deps.sim.map
        .activityAnchors(activityId)
        .filter((a) => placeId === null || a.placeId === placeId)
        .map((a) => ({ x: a.x, y: a.y }));
  }

  /** rule 层世界查询(E1 依赖注入):货架余量/最近可食节点/活动倾向分(贫困选岗保人设) */
  private ruleWorld(char: WorldCharacter): RuleWorldQueries {
    const { sim } = this.deps;
    return {
      shopStock: (itemId) => sim.shopStock.get(itemId) ?? 0,
      nearestEdibleNode: (from) => this.nearestNodeOf(['berry_bush', 'apple_tree'], from),
      bias: biasOf(hosting.get(char.id)?.compiled ?? null),
    };
  }

  /** want 层世界查询(E1 依赖注入):按 kind 寻节点+每世界配方就绪(存在+启用+背包含料)
   * +存活角色位置(E2 人指向寻人) */
  private wantWorld(char: WorldCharacter): WantWorldQueries {
    const { sim } = this.deps;
    return {
      nearestNode: (kind, from) => this.nearestNodeOf([kind], from),
      recipeReady: (recipeId) => {
        const recipe = sim.recipe(recipeId);
        if (recipe === null || recipe.enabled === false) return false;
        return recipe.inputs.every((input) => (char.backpack[input.itemId] ?? 0) >= input.count);
      },
      positionOf: (id) => {
        const target = sim.characters.get(id);
        return target === undefined || !target.alive
          ? null
          : { x: target.x, y: target.y, name: target.name };
      },
    };
  }

  /** 最近有存量资源节点(曼哈顿距离;charges null=无限) */
  private nearestNodeOf(
    kinds: readonly string[],
    from: { x: number; y: number },
  ): { id: string; x: number; y: number } | null {
    let best: { id: string; x: number; y: number } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const node of this.deps.sim.resourceNodes.values()) {
      if (!kinds.includes(node.kind)) continue;
      if (node.charges !== null && node.charges <= 0) continue;
      const dist = Math.abs(node.x - from.x) + Math.abs(node.y - from.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { id: node.id, x: node.x, y: node.y };
      }
    }
    return best;
  }

  /** 小镇需求信号(E1):货架缺货/可采节点存量/待维护点/岗位概要,注入当日意图
   * 生成——LLM 按人设×需求自发选岗,实现需求驱动的分工分化 */
  private townNeeds(): string {
    const { sim } = this.deps;
    const parts: string[] = [];
    const outOfStock = SHOP_ITEMS.filter((item) => (sim.shopStock.get(item.id) ?? 0) <= 0).map(
      (item) => item.name,
    );
    if (outOfStock.length > 0) parts.push(`商店缺货:${outOfStock.join('/')}`);
    const stocked = new Map<string, number>();
    for (const node of sim.resourceNodes.values()) {
      if (node.charges !== null && node.charges <= 0) continue;
      stocked.set(node.kind, (stocked.get(node.kind) ?? 0) + 1);
    }
    const nodes = [...stocked].map(([kind, count]) => `${resourceNodeLabel(kind)}×${count}`);
    if (nodes.length > 0) parts.push(`可采:${nodes.join('/')}`);
    let litter = 0;
    let fence = 0;
    for (const spot of sim.maintenanceSpots.values()) {
      if (spot.kind === 'litter') litter += 1;
      else fence += 1;
    }
    const upkeep: string[] = [];
    if (litter > 0) upkeep.push(`杂物×${litter}`);
    if (fence > 0) upkeep.push(`围栏破损×${fence}`);
    if (upkeep.length > 0) parts.push(`待维护:${upkeep.join('/')}`);
    parts.push('上岗:服务员/售货员/馆员(时薪1.0,知识≥3),杂工(0.8);采集/制作所得可卖入商店');
    return parts.join(';');
  }

  /** 熟人简报(E2 人指向社交):关系表(familiarity>0)按好感取前 5,拼印象
   * (character_impressions)+多久没聊(社交簿记/聊天日);resolve 人名→id。
   * 无熟人返回 null(不渲染行)。 */
  private async socialBrief(char: WorldCharacter): Promise<AcquaintanceBrief | null> {
    const { sim, handle } = this.deps;
    const relations = [...sim.socials.values()]
      .filter((r) => r.fromId === char.id && r.familiarity > 0)
      .sort((a, b) => b.affinity - a.affinity || b.familiarity - a.familiarity)
      .slice(0, 5);
    if (relations.length === 0) return null;
    let impressionOf = new Map<string, string>();
    try {
      const rows = await handle.db
        .select({ aboutId: characterImpressions.aboutId, content: characterImpressions.content })
        .from(characterImpressions)
        .where(
          and(
            eq(characterImpressions.characterId, char.id),
            inArray(
              characterImpressions.aboutId,
              relations.map((r) => r.toId),
            ),
          ),
        );
      impressionOf = new Map(rows.map((row) => [row.aboutId, row.content]));
    } catch {
      // 印象读不到就只拼关系行
    }
    const nameOf = (id: string): string => sim.characters.get(id)?.name ?? '某居民';
    const lines = relations.map((r) => {
      const seen = this.socialLoop.lastChatAtBetween(char.id, r.toId);
      let since: string;
      if (seen !== Number.NEGATIVE_INFINITY) {
        const mins = Math.max(0, sim.clock.gameMinutes - seen);
        since =
          mins < 60
            ? `${mins}分钟前聊过`
            : mins < 1440
              ? `${Math.floor(mins / 60)}小时前聊过`
              : `${Math.floor(mins / 1440)}天前聊过`;
      } else if (r.chatDay === sim.clock.day) {
        since = '今天聊过';
      } else if (r.chatDay > 0) {
        since = `上次聊天在第${r.chatDay}天`;
      } else {
        since = '还没聊过天';
      }
      const impression = impressionOf.get(r.toId);
      return `- ${nameOf(r.toId)}(好感${r.affinity}${impression !== undefined ? `,你对TA的印象:${impression}` : ''},${since})`;
    });
    return {
      line: `你认识的居民(想专程找谁聊天,可在该条 want 的 target 里写 TA 的名字):\n${lines.join('\n')}`,
      resolve: (name) =>
        relations.find((r) => nameOf(r.toId) === name)?.toId,
    };
  }

  /**
   * 事件触发(C3 分级主管道):非叙事事件零惊动;叙事事件先喂救援台账,
   * 再逐角色分级分发。预算簿记在 assessInterrupt 首个 await 前同步提交,
   * 同一事件循环内多事件不会双耗预算。活动结束先行结算 want 生命周期。
   */
  private onEvent(event: WorldEvent): void {
    if (event.type === 'activity.finished') this.settleWant(event);
    if (event.type === 'social.chat') this.settleSocialChat(event);
    if (!isTriagedEvent(event)) return;
    this.registry.observe(event);
    const { sim } = this.deps;
    for (const id of autonomy.list()) {
      const char = sim.characters.get(id);
      if (char === undefined) continue;
      const verdict = triageEvent(event, this.triageContextOf(char), this.registry.resolve);
      this.recordTriage(char, event, verdict);
      switch (verdict.disposition) {
        case 'ignore':
          break;
        case 'idle':
          this.runIdlePipeline(char, event);
          break;
        case 'respond':
          this.executeResponse(char, event, verdict);
          break;
        case 'assess':
          this.bookAssess(id, verdict.eventKey);
          void this.assessInterrupt(char, event, verdict);
          break;
        case 'defer':
          this.deferred.set(`${id}|${verdict.eventKey}`, {
            characterId: id,
            event,
            atGameMinutes: sim.clock.gameMinutes,
          });
          break;
      }
    }
  }

  /** triage 分级记录:ignore 采样(门①消化过半事件),其余处置全量可审计 */
  private recordTriage(char: WorldCharacter, event: WorldEvent, verdict: TriageVerdict): void {
    if (verdict.disposition === 'ignore') {
      const count = (this.triageIgnoreCount.get(char.id) ?? 0) + 1;
      this.triageIgnoreCount.set(char.id, count);
      if (count % TRIAGE_IGNORE_SAMPLE !== 0) return;
    }
    this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
      trigger: 'eventbus',
      perception: {
        event: event.type,
        gate: verdict.gate,
        importance: verdict.importance,
        relevance: verdict.relevance,
      },
      decision: { layer: 'triage', conclusion: 'continue' },
    });
  }

  /** 空闲放行的既有管线(rule→want→社交→jev,冷却护栏原样保留) */
  private runIdlePipeline(char: WorldCharacter, event: WorldEvent): void {
    const { sim } = this.deps;
    const rule = ruleDecide(
      char,
      sim.clock.day,
      sim.clock.minuteOfDay,
      sim.map.definition,
      this.anchorsAt(),
      this.ruleWorld(char),
    );
    if (rule.action === 'react') {
      this.apply(char, rule, 'eventbus', { event: event.type });
      return;
    }
    const want = this.wantDecision(char);
    if (want !== null) {
      this.apply(char, want, 'eventbus', { event: event.type, want: true });
      return;
    }
    const socialCandidates = this.socialLoop.idleSocialStep(char, 'eventbus');
    const last = this.jevLastAt.get(char.id) ?? Number.NEGATIVE_INFINITY;
    if (sim.clock.gameMinutes - last < JEV_COOLDOWN_MINUTES) return;
    this.jevLastAt.set(char.id, sim.clock.gameMinutes);
    void this.jevReact(char, event, socialCandidates);
  }

  /** respond 直执:move 响应若打断了忙碌角色,固定短退避后期望回意图 */
  private executeResponse(char: WorldCharacter, event: WorldEvent, verdict: TriageVerdict): void {
    const action = verdict.action;
    if (action === undefined) return;
    const wasBusy = char.activity !== null || char.path.length > 0;
    this.apply(
      char,
      { layer: 'triage', action: 'react', intent: action.intent, bubble: action.label },
      'eventbus',
      { event: event.type, gate: verdict.gate },
    );
    if (wasBusy && action.kind === 'move') this.intentBackoff(char.id);
  }

  /**
   * ⑤ 中断评估(歧义案,预算内 systemOne 一词判定):题面=当前块+事件语义+
   * 证据(对 TA 的印象/相关洞察/此刻情绪);respond 走 apply 全量 trace 并回计划,
   * continue 只记一行 triage trace。
   */
  private async assessInterrupt(
    char: WorldCharacter,
    event: WorldEvent,
    verdict: TriageVerdict,
  ): Promise<void> {
    const action = verdict.action;
    if (action === undefined) return;
    let evidence = '';
    try {
      evidence = await this.gatherEvidence(char, action);
    } catch (err) {
      logTech('warn', 'agent', '响应证据检索失败', {
        characterId: char.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    const prompt = `${char.name}${this.currentBlockText(char)}。${action.semantic}。${evidence}`;
    try {
      const result = await this.deps.llm.systemOne(
        'jev',
        prompt,
        {
          next: {
            type: 'choice',
            instructions: '判断是否值得放下手头的事去响应',
            criteria: { continue: '继续手头的事', respond: action.label },
          },
        },
        { taskType: 'agent.event_respond', characterId: char.id },
      );
      const answer = result.answers.next;
      const choice = answer?.type === 'choice' ? answer.choice : null;
      if (choice !== 'respond') {
        this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
          trigger: 'eventbus',
          perception: {
            event: event.type,
            gate: verdict.gate,
            assess: choice ?? 'no_answer',
            importance: verdict.importance,
          },
          decision: { layer: 'triage', conclusion: 'continue' },
        });
        return;
      }
      this.apply(
        char,
        { layer: 'triage', action: 'react', intent: action.intent, bubble: action.label },
        'eventbus',
        { event: event.type, gate: verdict.gate, assess: 'respond' },
      );
      if (action.kind === 'move') this.intentBackoff(char.id);
    } catch (err) {
      logTech('warn', 'agent', '中断评估失败', {
        characterId: char.id,
        err: err instanceof Error ? err.message : String(err),
      });
      this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
        trigger: 'eventbus',
        perception: {
          event: event.type,
          gate: 'assess_error',
          err: err instanceof Error ? err.message : String(err),
        },
        decision: { layer: 'triage', conclusion: 'continue' },
      });
    }
  }

  /** 证据检索(尽力而为):定点印象一条+按主体名匹配的洞察两条+当前情绪措辞 */
  private async gatherEvidence(char: WorldCharacter, action: ResponseAction): Promise<string> {
    const lines: string[] = [];
    const subjectId = action.subjectId;
    if (subjectId !== undefined) {
      const rows = await this.deps.handle.db
        .select({ content: characterImpressions.content })
        .from(characterImpressions)
        .where(
          and(
            eq(characterImpressions.characterId, char.id),
            eq(characterImpressions.aboutId, subjectId),
          ),
        )
        .limit(1);
      if (rows[0] !== undefined) lines.push(`你对TA的印象:${rows[0].content}`);
      const name = this.deps.sim.characters.get(subjectId)?.name;
      if (name !== undefined && name !== '') {
        const insights = await this.deps.handle.db
          .select({ content: memories.content })
          .from(memories)
          .where(
            and(
              eq(memories.characterId, char.id),
              eq(memories.type, 'insight'),
              ilike(memories.content, `%${name}%`),
            ),
          )
          .orderBy(desc(memories.importance))
          .limit(2);
        for (const row of insights) lines.push(`相关记忆:${row.content}`);
      }
    }
    const state = innerState.moodOf(char.id);
    if (state !== undefined) {
      const moodLine = describeMood(state);
      if (moodLine !== null) lines.push(`你此刻${moodLine}`);
    }
    return lines.length === 0 ? '' : `背景:${lines.join(';')}。`;
  }

  /** 当前块措辞(⑤ 题面):活动名/赶路/闲着 */
  private currentBlockText(char: WorldCharacter): string {
    if (char.activity !== null) {
      const name = getActivityDefinition(char.activity.activityId)?.name ?? char.activity.activityId;
      return `正在「${name}」`;
    }
    if (char.path.length > 0) return '正在赶路';
    return '正闲着';
  }

  /** 回意图:被中断的 want 执行进入固定短退避(绝对 gameMinutes),期满重新评分择条 */
  private intentBackoff(characterId: string): void {
    this.intentSkipUntil.set(
      characterId,
      this.deps.sim.clock.gameMinutes + INTENT_RETRY_BACKOFF_MINUTES,
    );
  }

  /** want 结算(activity.finished):完成 done/欠费 abandoned/其余(中断·停止·倒下)
   * 回 pending 由评分重新裁决;进行中的 doing 找不到匹配则忽略(rule 层触发的睡眠等) */
  private settleWant(event: ActivityFinishedEvent): void {
    const id = event.characterId;
    if (!autonomy.has(id)) return;
    const intents = innerState.get(id)?.intents;
    if (intents === undefined || intents === null) return;
    const want = intents.wants.find((w) => w.status === 'doing' && w.activityId === event.activityId);
    if (want === undefined) return;
    want.status =
      event.reason === 'completed'
        ? 'done'
        : event.reason === 'insufficient_coins'
          ? 'abandoned'
          : 'pending';
    persistInnerState(this.deps.handle, id);
    this.trace.record(id, this.deps.sim.clock.gameMinutes, {
      trigger: 'eventbus',
      perception: {
        event: event.type,
        want: want.id,
        reason: event.reason,
        elapsedMinutes: event.elapsedMinutes,
      },
      decision: { layer: 'plan', conclusion: 'continue' },
    });
  }

  /** 人指向社交 want 结算(E2):动机引擎直执的聊天不走 activity.finished,
   * 这里按 social.chat 事件收口——发起方(聊到了 target)与被指名方(被找)
   * 双向各结算一条 doing 的带 target socialize want 为 done。 */
  private settleSocialChat(event: SocialChatEvent): void {
    for (const characterId of [event.fromId, event.toId]) {
      if (!autonomy.has(characterId)) continue;
      const intents = innerState.get(characterId)?.intents;
      if (intents === undefined || intents === null) continue;
      const partner = characterId === event.fromId ? event.toId : event.fromId;
      const want = intents.wants.find(
        (w) =>
          w.status === 'doing' &&
          w.activityId === 'socialize' &&
          w.targetCharacterId === partner,
      );
      if (want === undefined) continue;
      want.status = 'done';
      persistInnerState(this.deps.handle, characterId);
      this.trace.record(characterId, this.deps.sim.clock.gameMinutes, {
        trigger: 'eventbus',
        perception: { event: event.type, want: want.id, with: partner },
        decision: { layer: 'plan', conclusion: 'continue' },
      });
    }
  }

  /** defer 队列巡检(2s):空闲且保鲜期内补执行响应;过期记一行 trace 出队 */
  private processDeferred(): void {
    const { sim } = this.deps;
    const now = sim.clock.gameMinutes;
    for (const [key, entry] of [...this.deferred]) {
      const char = sim.characters.get(entry.characterId);
      if (char === undefined) {
        this.deferred.delete(key);
        continue;
      }
      const stale =
        now - entry.atGameMinutes > BALANCE.EVENT_RESPONSE_DEFER_FRESH_MINUTES;
      const idle =
        char.alive && !char.collapsed && char.activity === null && char.path.length === 0;
      if (!idle) {
        if (stale) {
          this.deferred.delete(key);
          this.trace.record(char.id, now, {
            trigger: 'eventbus',
            perception: { event: entry.event.type, gate: 'defer_expired', waitedGameMinutes: now - entry.atGameMinutes },
            decision: { layer: 'triage', conclusion: 'continue' },
          });
        }
        continue;
      }
      this.deferred.delete(key);
      if (stale) {
        this.trace.record(char.id, now, {
          trigger: 'eventbus',
          perception: { event: entry.event.type, gate: 'defer_expired', waitedGameMinutes: now - entry.atGameMinutes },
          decision: { layer: 'triage', conclusion: 'continue' },
        });
        continue;
      }
      const action = this.registry.resolve(entry.event, this.triageContextOf(char));
      if (action === null) {
        this.trace.record(char.id, now, {
          trigger: 'eventbus',
          perception: { event: entry.event.type, gate: 'defer_no_action' },
          decision: { layer: 'triage', conclusion: 'continue' },
        });
        continue;
      }
      this.apply(
        char,
        { layer: 'triage', action: 'react', intent: action.intent, bubble: action.label },
        'eventbus',
        { event: entry.event.type, gate: 'deferred_execute' },
      );
    }
  }

  /** ⑤ 预算簿记(同步,先于任何 await):当日次数+冷却时刻+事件去重键 */
  private bookAssess(characterId: string, eventKey: string): void {
    const { sim } = this.deps;
    const day = sim.clock.day;
    const budget =
      this.assessBudget.get(characterId) ?? {
        day,
        assessedToday: 0,
        lastAssessAt: Number.NEGATIVE_INFINITY,
      };
    if (budget.day !== day) {
      budget.day = day;
      budget.assessedToday = 0;
    }
    budget.assessedToday += 1;
    budget.lastAssessAt = sim.clock.gameMinutes;
    this.assessBudget.set(characterId, budget);
    const keys = this.assessedKeys.get(characterId) ?? new Set<string>();
    keys.add(eventKey);
    this.assessedKeys.set(characterId, keys);
  }

  /** 分级上下文拼装(sim/char 现场;budget 为 scheduler 簿记的只读视图) */
  private triageContextOf(char: WorldCharacter): TriageContext {
    const { sim } = this.deps;
    const budget = this.assessBudget.get(char.id);
    return {
      characterId: char.id,
      x: char.x,
      y: char.y,
      alive: char.alive,
      collapsed: char.collapsed,
      activityId: char.activity?.activityId ?? null,
      onPath: char.path.length > 0,
      positionOf: (id) => {
        const c = sim.characters.get(id);
        return c === undefined ? null : { x: c.x, y: c.y };
      },
      isAcquaintance: (id) => {
        const relation = sim.socials.get(relationKey(char.id, id));
        return relation !== undefined && relation.familiarity > 0;
      },
      nameOf: (id) => sim.characters.get(id)?.name ?? '某居民',
      budget: {
        day: budget?.day ?? -1,
        assessedToday: budget?.assessedToday ?? 0,
        lastAssessAt: budget?.lastAssessAt ?? Number.NEGATIVE_INFINITY,
        assessedKeys: this.assessedKeys.get(char.id) ?? new Set<string>(),
      },
      nowGameMinutes: sim.clock.gameMinutes,
      gameDay: sim.clock.day,
    };
  }

  /** 无当日意图即异步生成(slow 槽,2s 检查每次兜底;自治开启当轮即有意图) */
  private ensureIntents(char: WorldCharacter): void {
    if (this.planning.has(char.id)) return;
    const existing = innerState.get(char.id)?.intents;
    if (existing?.day === this.deps.sim.clock.day) return;
    this.planning.add(char.id);
    const previous = existing?.day === this.deps.sim.clock.day - 1 ? existing : null;
    // 昨天的约定(E3 聚会邀约):次晨兑现一次——prompt 注入+确定性前置赴约 want
    const pending = innerState.get(char.id)?.pendingInvitation ?? null;
    const due = pending !== null && pending.day < this.deps.sim.clock.day ? pending : null;
    const invitationLine =
      due === null
        ? undefined
        : `${this.deps.sim.characters.get(due.withId)?.name ?? '朋友'}和你约好今天一起去${
            TOWN_MAP.places.find((p) => p.id === due.placeId)?.name ?? due.placeId
          }(${due.note})`;
    void Promise.all([
      loadPersonaContext(this.deps.handle, char.id),
      this.socialBrief(char),
    ])
      .then(([persona, acquaintances]) =>
        composeIntents(this.deps.llm, this.deps.handle, char, this.deps.sim.clock, {
          policyText: hosting.get(char.id)?.policyText ?? undefined,
          compiled: hosting.get(char.id)?.compiled ?? null,
          persona,
          previous,
          focus: innerState.get(char.id)?.focus?.text ?? null,
          townNeeds: this.townNeeds(),
          acquaintances,
          invitation: invitationLine,
        }),
      )
      .then(({ intents, compiled }) => {
        // full 托管无方针缓存:人设现编译回填 hosting,快层 wantSelect 评分同一口径
        const hosted = hosting.get(char.id);
        if (hosted !== undefined && hosted.compiled === null && compiled !== null) {
          hosting.set(char.id, { ...hosted, compiled });
        }
        if (due !== null) {
          intents.wants.unshift({
            id: `w${intents.day}-inv`,
            activityId: 'socialize',
            why: `赴约:${due.note}`,
            urgency: 0.9,
            status: 'pending',
            createdAtMin: this.deps.sim.clock.gameMinutes,
            targetCharacterId: due.withId,
          });
          innerState.ensure(char.id).pendingInvitation = null; // 兑现一次
        }
        innerState.setIntents(char.id, intents);
        persistInnerState(this.deps.handle, char.id);
        this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
          trigger: 'day_rollover',
          perception: { day: intents.day, source: intents.source, wants: intents.wants.length },
          decision: { layer: 'slow', conclusion: 'continue' },
        });
      })
      .catch((err: unknown) => {
        logTech('warn', 'agent', '当日意图生成失败', {
          characterId: char.id,
          err: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.planning.delete(char.id);
      });
  }

  /** 意图执行判定:退避期内静默;无意图/意图耗尽返回 null 交还后续层级;
   * 不可执行 want 当场废弃落库 */
  private wantDecision(char: WorldCharacter): Decision | null {
    const { sim } = this.deps;
    // intentSkipUntil 存绝对 gameMinutes:跨日不会被同一 minuteOfDay 误读成"仍在退避"
    const skipUntil = this.intentSkipUntil.get(char.id) ?? Number.NEGATIVE_INFINITY;
    if (sim.clock.gameMinutes < skipUntil) return null;
    const decision = wantSelect(
      char,
      innerState.get(char.id)?.intents,
      sim.clock.day,
      sim.map.definition,
      this.anchorsAt(),
      biasOf(hosting.get(char.id)?.compiled ?? null),
      this.wantWorld(char),
    );
    if (decision === null) return null;
    if (decision.abandonedWantIds !== undefined && decision.abandonedWantIds.length > 0) {
      this.abandonWants(char.id, decision.abandonedWantIds);
    }
    return decision;
  }

  /** want 当场废弃落库(fast 层判不可执行:无居所 rest/无锚点无场所) */
  private abandonWants(characterId: string, wantIds: readonly string[]): void {
    const intents = innerState.get(characterId)?.intents;
    if (intents === undefined || intents === null) return;
    let changed = false;
    for (const w of intents.wants) {
      if (wantIds.includes(w.id) && w.status === 'pending') {
        w.status = 'abandoned';
        changed = true;
      }
    }
    if (changed) persistInnerState(this.deps.handle, characterId);
  }

  /** 意图出执行口即标 doing 并落库(activity.finished 再按原因终裁);
   * focus 同步为该 want 的第一人称理由(访谈/叙事/次日意图检索共用) */
  private markWantDoing(characterId: string, wantId: string): void {
    const intents = innerState.get(characterId)?.intents;
    if (intents === undefined || intents === null) return;
    const want = intents.wants.find((w) => w.id === wantId);
    if (want === undefined || want.status !== 'pending') return;
    want.status = 'doing';
    innerState.ensure(characterId).focus = {
      text: want.why,
      sinceMin: this.deps.sim.clock.gameMinutes,
    };
    persistInnerState(this.deps.handle, characterId);
  }

  private async jevReact(
    char: WorldCharacter,
    event: WorldEvent,
    socialCandidates: ScoredCandidate[] = [],
  ): Promise<void> {
    const { sim } = this.deps;
    // 异地熟人进 jev 池(E2 口径:贴身已直执、同场未近已走近,只余真异地;
    // 位置此刻快照,到达后仍走校验链)
    const feed = socialCandidates
      .filter((c) => !c.chatReady && !c.samePlace)
      .map((c) => {
        const target = sim.characters.get(c.targetId);
        return target === undefined
          ? null
          : {
              characterId: c.targetId,
              name: c.name,
              affinity: c.affinity,
              x: target.x,
              y: target.y,
            };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const persona = await loadPersonaContext(this.deps.handle, char.id);
    const decision = await jevDecide(this.deps.llm, char, sim.map.definition, feed, persona);
    if (decision === null) {
      // jev 槽不可用/无有效候选:观测层面记一次 continue,快层静默回落
      this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
        trigger: 'eventbus',
        perception: { event: event.type, jev: 'unavailable' },
        decision: { layer: 'jev', conclusion: 'continue' },
      });
      return;
    }
    this.apply(char, decision, 'eventbus', { event: event.type, jev: true });
  }

  /** 判定落地:continue 走采样 trace;react 执行意图+气泡+全量 trace */
  private apply(
    char: WorldCharacterLike,
    decision: Decision,
    trigger: TraceEntry['trigger'],
    perception: Record<string, unknown>,
  ): void {
    if (decision.action === 'continue') {
      const count = (this.continueCount.get(char.id) ?? 0) + 1;
      this.continueCount.set(char.id, count);
      if (count % RULE_CONTINUE_SAMPLE === 0) {
        this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
          trigger,
          perception,
          decision: { layer: decision.layer, conclusion: 'continue' },
        });
      }
      return;
    }
    const result = this.runIntentFn(this.deps.sim, decision.intent);
    if (result.ok) {
      this.intentRejects.delete(char.id);
      if (decision.wantId !== undefined) this.markWantDoing(char.id, decision.wantId);
      this.deps.onBubble?.({
        characterId: char.id,
        name: char.name,
        text: decision.bubble ?? '',
        gameMinutes: this.deps.sim.clock.gameMinutes,
      });
    } else if (decision.layer === 'plan') {
      // 意图被校验链拒绝:短退避,连续达上限清当日意图重生成(局部重规划)
      const rejects = (this.intentRejects.get(char.id) ?? 0) + 1;
      this.intentRejects.set(char.id, rejects);
      this.intentBackoff(char.id);
      if (rejects >= INTENT_MAX_CONSECUTIVE_REJECTS) {
        innerState.clearIntents(char.id);
        persistInnerState(this.deps.handle, char.id);
        this.intentRejects.delete(char.id);
        this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
          trigger: 'day_rollover',
          perception: { replan: true, rejects, rejectReason: result.message },
          decision: { layer: 'slow', conclusion: 'continue' },
        });
      }
    }
    this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
      trigger,
      perception,
      decision: {
        layer: decision.layer,
        conclusion: 'react',
        intent: intentSummary(decision.intent),
        bubble: decision.bubble,
        ...(result.ok ? {} : { rejectReason: result.message }),
      },
    });
  }
}

interface WorldCharacterLike {
  id: string;
  name: string;
}

function intentSummary(intent: unknown): string {
  if (typeof intent !== 'object' || intent === null) return String(intent);
  const record = intent as Record<string, unknown>;
  const type = String(record.type ?? '?');
  if (type === 'move_to') return `move_to ${record.x},${record.y}`;
  const target = record.itemId ?? record.propertyId ?? record.activityId ?? '';
  return target === '' ? type : `${type} ${String(target)}`;
}
