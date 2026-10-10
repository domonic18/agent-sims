import type { DbHandle } from '../db/client.js';
import { cognitionTrace } from '../db/schema/agent.js';
import { logTech } from '../telemetry.js';
import { getWorldId } from '../world/world-id.js';

/** 认知周期触发源(agent-design §4.6) */
export type TraceTrigger =
  | 'eventbus'
  | 'threshold'
  | 'schedule_block'
  | 'day_rollover'
  | 'reflection';

export interface TraceCall {
  slot: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  outputPreview: string;
}

export interface TraceDecision {
  /** 判定层级: rule=数值压力 | plan=日程执行 | jev=微决策 | triage=事件分级门 | select=want 仲裁 | light/slow=慢思考 */
  layer: 'rule' | 'plan' | 'jev' | 'triage' | 'select' | 'light' | 'slow';
  /** continue | react */
  conclusion: 'continue' | 'react';
  /** react 时的意图摘要(如 "move_to 23,25") */
  intent?: string;
  /** react 时的气泡文案(意图+理由模板) */
  bubble?: string;
  /** jev 层选中候选标签(E5 观测口径:decision->>'choice' 聚合选择分布) */
  choice?: string;
  /** react 意图被意图层拒绝时的原因(执行回执) */
  rejectReason?: string;
  /** select 层仲裁快照:候选集评分与胜负(观测性,wantSelect 命中后落一份) */
  candidates?: Array<{
    id: string;
    activityId: string;
    origin: string;
    urgency: number;
    score: number;
    /** 落选原因(如 seize=挑战者分差不足) */
    reject?: string;
  }>;
}

export interface TraceEntry {
  trigger: TraceTrigger;
  perception?: Record<string, unknown>;
  retrieval?: Record<string, unknown>;
  decision: TraceDecision;
  calls?: TraceCall[];
  /** 关联 want(观测性: 一张 want 从产欲到结算的追踪键) */
  wantId?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 认知 trace 写入器(agent-design §7):每个认知周期一行,seq 角色内自增。
 * 落库 fire-and-forget——trace 是观测面,任何失败只落技术日志,绝不阻塞认知泵。
 */
export class TraceRecorder {
  private readonly seqByCharacter = new Map<string, number>();

  constructor(private readonly handle: DbHandle) {}

  record(characterId: string, gameMinutes: number, entry: TraceEntry): void {
    const seq = (this.seqByCharacter.get(characterId) ?? 0) + 1;
    this.seqByCharacter.set(characterId, seq);
    void this.handle.db
      .insert(cognitionTrace)
      .values({
        characterId,
        worldId: getWorldId(),
        seq,
        gameMinutes,
        triggerType: entry.trigger,
        perception: entry.perception ?? null,
        retrieval: entry.retrieval ?? null,
        decision: entry.decision,
        calls: entry.calls ?? null,
        wantId: entry.wantId ?? null,
      })
      .catch((err: unknown) => {
        logTech('warn', 'agent', '认知 trace 落库失败', {
          characterId,
          err: errMsg(err),
        });
      });
  }
}
