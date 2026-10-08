import type { AgentDecisionMessage, WorldEvent } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { runIntent } from '../intents/execute.js';
import type { Simulation } from '../world/simulation.js';
import type { WorldCharacter } from '../world/character.js';
import { autonomy } from './cognition.js';
import { jevDecide, ruleDecide, type Decision } from './fast-layer.js';
import type { MemoryLlm } from './memory-writer.js';
import { TraceRecorder, type TraceEntry } from './trace.js';

/** 阈值巡检周期(游戏分钟):数值压力(饥饿/房租)的反应节拍 */
export const AUTONOMY_CHECK_INTERVAL_MINUTES = 15;
/** jev 微决策冷却(游戏分钟/角色):事件风暴下不烧 LLM */
export const JEV_COOLDOWN_MINUTES = 30;
/** rule continue 的 trace 采样周期(每 N 次 continue 记 1 次,防日志洪水;react 全量) */
const RULE_CONTINUE_SAMPLE = 20;
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
 * Agent 调度泵(agent-design §3.1/§4.6):异步认知泵,**不进 tick 循环**——
 * 输入侧=真实时间定时器(15 游戏分阈值巡检)+ EventBus 订阅(事件触发);
 * 输出侧=react 意图经 runIntent 统一出口(stale 重验+全量校验链),快层判定
 * rule 先行零模型,rule 未命中且事件驱动时 jev 微决策(冷却护栏)。
 * 全程产 trace(§7):react/模型调用全量,rule continue 采样。
 */
export class AgentScheduler {
  private lastInspectedBlock = -1;
  private readonly jevLastAt = new Map<string, number>();
  private readonly continueCount = new Map<string, number>();
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

  /** 阈值巡检(threshold):跨过 15 游戏分边界即对全体自治角色 rule 判定 */
  private inspect(): void {
    const { sim } = this.deps;
    const block = Math.floor(sim.clock.gameMinutes / AUTONOMY_CHECK_INTERVAL_MINUTES);
    if (block === this.lastInspectedBlock) return;
    this.lastInspectedBlock = block;
    for (const id of autonomy.list()) {
      const char = sim.characters.get(id);
      if (char === undefined) continue;
      this.apply(
        char,
        ruleDecide(char, sim.clock.day, sim.map.definition),
        'threshold',
        { block: `${block}(${AUTONOMY_CHECK_INTERVAL_MINUTES}min)` },
      );
    }
  }

  /** 事件触发(eventbus):自治角色 rule 先行,未命中且冷却已过则 jev 微决策 */
  private onEvent(event: WorldEvent): void {
    const { sim } = this.deps;
    for (const id of autonomy.list()) {
      const char = sim.characters.get(id);
      if (char === undefined) continue;
      const last = this.jevLastAt.get(id) ?? Number.NEGATIVE_INFINITY;
      if (sim.clock.gameMinutes - last < JEV_COOLDOWN_MINUTES) continue;
      const rule = ruleDecide(char, sim.clock.day, sim.map.definition);
      if (rule.action === 'react') {
        this.apply(char, rule, 'eventbus', { event: event.type });
        continue;
      }
      this.jevLastAt.set(id, sim.clock.gameMinutes);
      void this.jevReact(char, event);
    }
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
      this.deps.onBubble?.({
        characterId: char.id,
        name: char.name,
        text: decision.bubble ?? '',
        gameMinutes: this.deps.sim.clock.gameMinutes,
      });
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
