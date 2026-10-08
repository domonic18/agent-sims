import type { AgentDecisionMessage, WorldEvent } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { runIntent } from '../intents/execute.js';
import type { Simulation } from '../world/simulation.js';
import type { WorldCharacter } from '../world/character.js';
import { autonomy, hosting, schedule } from './cognition.js';
import { jevDecide, planDecide, ruleDecide, type Decision } from './fast-layer.js';
import { loadPersonaContext, planDay, describePlan } from './slow-layer.js';
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
 * Agent 调度泵(agent-design §3.1/§4.6):异步认知泵,**不进 tick 循环**——
 * 输入侧=真实时间定时器(2s 检查:日计划补齐+15 游戏分阈值巡检)+ EventBus 订阅(事件触发);
 * 输出侧=react 意图经 runIntent 统一出口(stale 重验+全量校验链),快层判定
 * rule 先行零模型,rule 未命中时日程执行(planDecide),事件驱动末位 jev 微决策(冷却护栏)。
 * 慢层日计划:无当日计划即异步生成(slow 槽 chat,失败回落模板),写回记忆流;
 * 计划意图连续被拒达上限→清计划下轮重生成(矛盾局部重规划)。
 * 全程产 trace(§7):react/模型调用全量,rule continue 采样。
 */
export class AgentScheduler {
  private lastInspectedBlock = -1;
  private readonly jevLastAt = new Map<string, number>();
  private readonly continueCount = new Map<string, number>();
  private readonly planRejects = new Map<string, number>();
  private readonly planSkipUntil = new Map<string, number>();
  private readonly planning = new Set<string>();
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

  /** 阈值巡检(threshold):自治角色先补齐当日计划,跨 15 游戏分边界即 rule→plan 判定 */
  private inspect(): void {
    const { sim } = this.deps;
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

  /** 事件触发(eventbus):rule 先行→日程执行→冷却已过才 jev 微决策 */
  private onEvent(event: WorldEvent): void {
    const { sim } = this.deps;
    for (const id of autonomy.list()) {
      const char = sim.characters.get(id);
      if (char === undefined) continue;
      const rule = ruleDecide(char, sim.clock.day, sim.map.definition);
      if (rule.action === 'react') {
        this.apply(char, rule, 'eventbus', { event: event.type });
        continue;
      }
      const plan = this.planDecision(char);
      if (plan !== null) {
        this.apply(char, plan, 'eventbus', { event: event.type, plan: true });
        continue;
      }
      const last = this.jevLastAt.get(id) ?? Number.NEGATIVE_INFINITY;
      if (sim.clock.gameMinutes - last < JEV_COOLDOWN_MINUTES) continue;
      this.jevLastAt.set(id, sim.clock.gameMinutes);
      void this.jevReact(char, event);
    }
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
