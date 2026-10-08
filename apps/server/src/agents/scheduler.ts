import type { AgentDecisionMessage, WorldEvent } from '@sims/shared';
import { getActivityDefinition } from '@sims/shared';
import { and, desc, eq, ilike } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { characterImpressions, memories } from '../db/schema/memory.js';
import { runIntent } from '../intents/execute.js';
import { relationKey } from '../world/social.js';
import type { Simulation } from '../world/simulation.js';
import type { WorldCharacter } from '../world/character.js';
import { BALANCE } from '../config/balance.js';
import { autonomy, hosting, mood, schedule } from './cognition.js';
import { describeMood } from './mood.js';
import { jevDecide, planDecide, ruleDecide, type Decision } from './fast-layer.js';
import { ResponseRegistry } from './responses.js';
import { loadPersonaContext, planBlockAt, planDay, describePlan } from './slow-layer.js';
import {
  isTriagedEvent,
  triageEvent,
  type ResponseAction,
  type TriageContext,
  type TriageVerdict,
} from './triage.js';
import type { MemoryLlm, MemoryWriter } from './memory-writer.js';
import { logTech } from '../telemetry.js';
import { TraceRecorder, type TraceEntry } from './trace.js';

/** 阈值巡检周期(游戏分钟):数值压力(饥饿/房租)的反应节拍 */
export const AUTONOMY_CHECK_INTERVAL_MINUTES = 15;
/** jev 微决策冷却(游戏分钟/角色):事件风暴下不烧 LLM */
export const JEV_COOLDOWN_MINUTES = 30;
/** 计划意图被拒后的退避(游戏分钟):跳过当前压力,等下个窗口再试 */
export const PLAN_RETRY_BACKOFF_MINUTES = 30;
/** 连续被拒上限:清当日计划,下轮巡检重新规划(agent-design §3.3 矛盾局部重规划) */
export const PLAN_MAX_CONSECUTIVE_REJECTS = 3;
/** 计划写回记忆流的重要性(中等影响:影响近期选择) */
const PLAN_MEMORY_IMPORTANCE = 6;
/** rule continue 的 trace 采样周期(每 N 次 continue 记 1 次,防日志洪水;react 全量) */
const RULE_CONTINUE_SAMPLE = 20;
/** triage ignore 的 trace 采样周期(每 N 次记 1 次;门①消化近半事件,防洪水) */
const TRIAGE_IGNORE_SAMPLE = 10;
const CHECK_TICK_MS = 2_000;

export interface AgentSchedulerDeps {
  sim: Simulation;
  handle: DbHandle;
  llm: MemoryLlm;
  /** 直写记忆(计划生成后写回记忆流);缺省跳过(测试) */
  memoryWriter?: Pick<MemoryWriter, 'writeManual'>;
  /** 决策气泡出流(意图+理由模板);缺省静默(测试) */
  onBubble?: (message: AgentDecisionMessage) => void;
  /** 意图执行入口(默认统一出口 runIntent;测试可注入桩) */
  runIntent?: typeof runIntent;
}

/**
 * Agent 调度泵(agent-design §3.1/§4.6;10-cognition §7.1 事件响应层):
 * 异步认知泵,不进 tick 循环。事件侧走 C3 分级管道——EventBus → isTriagedEvent
 * 过滤(管理面事件零惊动)→ ResponseRegistry 簿记(救援台账)→ 逐自治角色
 * triageEvent 四关分级:ignore(采样 trace)/idle(放行既有 rule→plan→jev 管线)/
 * respond(注册表动作直执)/assess(⑤ 中断评估:预算三闸已过,systemOne choice
 * 一词判定)/defer(不可打断,排事后处理,巡检空闲补执行)。move 响应打断当前块后
 * skipCurrentBlock(退避至块末),下个块边界自然衔接=「回计划」。
 * 时间侧=2s 定时器(计划补齐+defer 巡检)+15 游戏分阈值巡检(rule→plan)。
 * 输出统一经 runIntent;trace:triage 分级记录(ignore 采样),执行/模型全量。
 */
export class AgentScheduler {
  private lastInspectedBlock = -1;
  private readonly jevLastAt = new Map<string, number>();
  private readonly continueCount = new Map<string, number>();
  private readonly triageIgnoreCount = new Map<string, number>();
  private readonly planRejects = new Map<string, number>();
  private readonly planSkipUntil = new Map<string, number>();
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
  private readonly timer: NodeJS.Timeout;
  private readonly unsubscribe: () => void;
  private readonly runIntentFn: typeof runIntent;
  private readonly trace: TraceRecorder;

  constructor(private readonly deps: AgentSchedulerDeps) {
    this.runIntentFn = deps.runIntent ?? runIntent;
    this.trace = new TraceRecorder(deps.handle);
    this.timer = setInterval(() => this.inspect(), CHECK_TICK_MS);
    this.unsubscribe = deps.sim.events.subscribe((event) => this.onEvent(event));
  }

  dispose(): void {
    clearInterval(this.timer);
    this.unsubscribe();
  }

  /** 阈值巡检(threshold):补齐当日计划+defer 事后处理,跨 15 游戏分边界即 rule→plan 判定 */
  private inspect(): void {
    const { sim } = this.deps;
    this.processDeferred();
    for (const id of autonomy.list()) {
      const char = sim.characters.get(id);
      if (char !== undefined) this.ensurePlan(char);
    }
    const block = Math.floor(sim.clock.gameMinutes / AUTONOMY_CHECK_INTERVAL_MINUTES);
    if (block === this.lastInspectedBlock) return;
    this.lastInspectedBlock = block;
    for (const id of autonomy.list()) {
      const char = sim.characters.get(id);
      if (char === undefined) continue;
      const rule = ruleDecide(char, sim.clock.day, sim.map.definition);
      if (rule.action === 'react') {
        this.apply(char, rule, 'threshold', {
          block: `${block}(${AUTONOMY_CHECK_INTERVAL_MINUTES}min)`,
        });
        continue;
      }
      const plan = this.planDecision(char);
      if (plan !== null) {
        this.apply(char, plan, 'threshold', {
          block: `${block}(${AUTONOMY_CHECK_INTERVAL_MINUTES}min)`,
          plan: true,
        });
        continue;
      }
      this.apply(char, rule, 'threshold', {
        block: `${block}(${AUTONOMY_CHECK_INTERVAL_MINUTES}min)`,
      });
    }
  }

  /**
   * 事件触发(C3 分级主管道):非叙事事件零惊动;叙事事件先喂救援台账,
   * 再逐角色分级分发。预算簿记在 assessInterrupt 首个 await 前同步提交,
   * 同一事件循环内多事件不会双耗预算。
   */
  private onEvent(event: WorldEvent): void {
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

  /** 空闲放行的既有管线(rule→plan→jev,冷却护栏原样保留) */
  private runIdlePipeline(char: WorldCharacter, event: WorldEvent): void {
    const { sim } = this.deps;
    const rule = ruleDecide(char, sim.clock.day, sim.map.definition);
    if (rule.action === 'react') {
      this.apply(char, rule, 'eventbus', { event: event.type });
      return;
    }
    const plan = this.planDecision(char);
    if (plan !== null) {
      this.apply(char, plan, 'eventbus', { event: event.type, plan: true });
      return;
    }
    const last = this.jevLastAt.get(char.id) ?? Number.NEGATIVE_INFINITY;
    if (sim.clock.gameMinutes - last < JEV_COOLDOWN_MINUTES) return;
    this.jevLastAt.set(char.id, sim.clock.gameMinutes);
    void this.jevReact(char, event);
  }

  /** respond 直执:move 响应若打断了忙碌角色,退避当前块至块末(回计划) */
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
    if (wasBusy && action.kind === 'move') this.skipCurrentBlock(char);
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
      if (action.kind === 'move') this.skipCurrentBlock(char);
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
    const state = mood.get(char.id);
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

  /** 回计划:被中断块标记跳过至块末,下个块边界由既有日程执行自然衔接 */
  private skipCurrentBlock(char: WorldCharacter): void {
    const { sim } = this.deps;
    const plan = schedule.get(char.id);
    if (plan === undefined || plan.day !== sim.clock.day) return;
    const block = planBlockAt(plan, sim.clock.minuteOfDay);
    if (block === null) return;
    this.planSkipUntil.set(char.id, block.endMin);
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

  /** 无当日计划即异步生成(slow 槽,2s 检查每次兜底;自治开启当轮即有计划) */
  private ensurePlan(char: WorldCharacter): void {
    if (this.planning.has(char.id)) return;
    if (schedule.get(char.id)?.day === this.deps.sim.clock.day) return;
    this.planning.add(char.id);
    const state = hosting.get(char.id);
    void loadPersonaContext(this.deps.handle, char.id)
      .then((persona) =>
        planDay(this.deps.llm, this.deps.handle, char, this.deps.sim.clock, {
          policyText: state?.policyText ?? undefined,
          compiled: state?.compiled ?? null,
          persona,
        }),
      )
      .then((plan) => {
        schedule.set(char.id, plan);
        this.trace.record(char.id, this.deps.sim.clock.gameMinutes, {
          trigger: 'day_rollover',
          perception: { day: plan.day, source: plan.source, blocks: plan.blocks.length },
          decision: { layer: 'slow', conclusion: 'continue' },
        });
        void this.deps.memoryWriter?.writeManual(
          char.id,
          `我制定了今天的计划:${describePlan(plan)}`,
          PLAN_MEMORY_IMPORTANCE,
        );
      })
      .catch((err: unknown) => {
        logTech('warn', 'agent', '日计划生成失败', {
          characterId: char.id,
          err: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.planning.delete(char.id);
      });
  }

  /** 日程执行判定:退避期内静默;无计划/空档返回 null 交还后续层级 */
  private planDecision(char: WorldCharacter): Decision | null {
    const { sim } = this.deps;
    const skipUntil = this.planSkipUntil.get(char.id) ?? Number.NEGATIVE_INFINITY;
    if (sim.clock.minuteOfDay < skipUntil) return null;
    return planDecide(
      char,
      schedule.get(char.id),
      sim.clock.day,
      sim.clock.minuteOfDay,
      sim.map.definition,
      (activityId, placeId) =>
        sim.map
          .activityAnchors(activityId)
          .filter((a) => placeId === null || a.placeId === placeId)
          .map((a) => ({ x: a.x, y: a.y })),
    );
  }

  private async jevReact(char: WorldCharacter, event: WorldEvent): Promise<void> {
    const decision = await jevDecide(this.deps.llm, char, this.deps.sim.map.definition);
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
      this.planRejects.delete(char.id);
      this.deps.onBubble?.({
        characterId: char.id,
        name: char.name,
        text: decision.bubble ?? '',
        gameMinutes: this.deps.sim.clock.gameMinutes,
      });
    } else if (decision.layer === 'plan') {
      // 计划意图被校验链拒绝:退避跳过当前压力,连续达上限清计划重生成(局部重规划)
      const rejects = (this.planRejects.get(char.id) ?? 0) + 1;
      this.planRejects.set(char.id, rejects);
      this.planSkipUntil.set(
        char.id,
        this.deps.sim.clock.minuteOfDay + PLAN_RETRY_BACKOFF_MINUTES,
      );
      if (rejects >= PLAN_MAX_CONSECUTIVE_REJECTS) {
        schedule.clear(char.id);
        this.planRejects.delete(char.id);
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
