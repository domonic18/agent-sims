import { findPlaceAt, pickChatLine } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import type { WorldCharacter } from '../world/character.js';
import type { Simulation } from '../world/simulation.js';
import { relationKey } from '../world/social.js';
import { mood } from './cognition.js';
import { generateExchange } from './dialogue.js';
import type { Decision } from './fast-layer.js';
import type { MemoryLlm } from './memory-writer.js';
import { socialMotive, type ScoredCandidate, type SocialMotiveInput } from './social-motive.js';
import type { TraceEntry, TraceRecorder } from './trace.js';

/** 空闲社交管线依赖:意图执行经 scheduler.apply 统一出口(气泡/trace/拒绝退避同源) */
export interface SocialLoopDeps {
  sim: Simulation;
  handle: DbHandle;
  llm: MemoryLlm;
  trace: TraceRecorder;
  apply: (
    char: WorldCharacter,
    decision: Decision,
    trigger: TraceEntry['trigger'],
    perception: Record<string, unknown>,
  ) => void;
}

/**
 * 自治社交管线(10-cognition §7.2 C4,自 AgentScheduler 抽出):
 * 空闲角色跑动机引擎(零模型)——同处一地的候选过点火线即经 light 槽生成双句对话
 * 直执(簿记先于 await);异地候选返回给 jev 池(LLM 决定要不要专程去找 TA)。
 * 一次至多点火一人。簿记:同对最近聊天时刻(双角色排序 key)+每角色每日主动计数。
 */
export class SocialLoop {
  private readonly socialPairLastAt = new Map<string, number>();
  private readonly socialDaily = new Map<string, { day: number; count: number }>();

  constructor(private readonly deps: SocialLoopDeps) {}

  idleSocialStep(
    char: WorldCharacter,
    trigger: 'threshold' | 'eventbus',
  ): ScoredCandidate[] {
    const { sim } = this.deps;
    if (!char.alive || char.collapsed) return [];
    const inputs = this.socialInputs(char);
    if (inputs.length === 0) return [];
    const candidates = socialMotive(inputs, {
      valence: mood.get(char.id)?.valence ?? 0,
      nowGameMinutes: sim.clock.gameMinutes,
    });
    const hit = candidates.find((c) => c.colocated);
    if (hit !== undefined) {
      this.bookSocial(char.id, hit.targetId);
      void this.socialReact(char, hit, trigger);
    }
    return candidates;
  }

  /** 动机候选原始资料:已认识(familiarity>0)且对方存活的关系,拼同地/收益/簿记切片 */
  private socialInputs(char: WorldCharacter): SocialMotiveInput[] {
    const { sim } = this.deps;
    const inputs: SocialMotiveInput[] = [];
    const selfPlace = findPlaceAt(sim.map.definition, char.x, char.y)?.id ?? null;
    const selfActivity = char.activity?.activityId ?? null;
    for (const relation of sim.socials.values()) {
      if (relation.fromId !== char.id || relation.familiarity <= 0) continue;
      const target = sim.characters.get(relation.toId);
      if (target === undefined || !target.alive || target.collapsed) continue;
      const targetPlace = findPlaceAt(sim.map.definition, target.x, target.y)?.id ?? null;
      // 同处一地: 贴身可达(荒野无地点时按距离)或同场所或进行同一活动
      const near =
        Math.abs(char.x - target.x) + Math.abs(char.y - target.y) <=
        BALANCE.SOCIAL_CHAT_DISTANCE;
      const colocated =
        near ||
        (selfPlace !== null && selfPlace === targetPlace) ||
        (selfActivity !== null && selfActivity === (target.activity?.activityId ?? null));
      inputs.push({
        targetId: relation.toId,
        name: target.name,
        affinity: relation.affinity,
        chatCountToday: relation.chatDay === sim.clock.day ? relation.chatCount : 0,
        lastChatAt: this.pairLastAt(char.id, relation.toId),
        initiatedToday: this.initiatedToday(char.id),
        colocated,
      });
    }
    return inputs;
  }

  private pairLastAt(aId: string, bId: string): number {
    return this.socialPairLastAt.get([aId, bId].sort().join('|')) ?? Number.NEGATIVE_INFINITY;
  }

  private initiatedToday(characterId: string): number {
    const entry = this.socialDaily.get(characterId);
    if (entry === undefined || entry.day !== this.deps.sim.clock.day) return 0;
    return entry.count;
  }

  /** 社交簿记(同步,先于任何 await):同对冷却时刻+当日主动计数 */
  private bookSocial(characterId: string, targetId: string): void {
    const { sim } = this.deps;
    this.socialPairLastAt.set(
      [characterId, targetId].sort().join('|'),
      sim.clock.gameMinutes,
    );
    const day = sim.clock.day;
    const entry = this.socialDaily.get(characterId) ?? { day, count: 0 };
    if (entry.day !== day) {
      entry.day = day;
      entry.count = 0;
    }
    entry.count += 1;
    this.socialDaily.set(characterId, entry);
  }

  /** 点火执行:light 槽双句生成→chat 意图直执;生成失败回落模板双句(不丢点火) */
  private async socialReact(
    char: WorldCharacter,
    candidate: ScoredCandidate,
    trigger: 'threshold' | 'eventbus',
  ): Promise<void> {
    const { sim } = this.deps;
    const target = sim.characters.get(candidate.targetId);
    if (target === undefined) return;
    const relation = sim.socials.get(relationKey(char.id, target.id));
    if (relation === undefined) return;
    const exchange = await generateExchange(
      this.deps.llm,
      this.deps.handle,
      char,
      target,
      relation,
    );
    const distance = Math.abs(char.x - target.x) + Math.abs(char.y - target.y);
    if (distance > BALANCE.SOCIAL_CHAT_DISTANCE) {
      // 生成期间走散(对方被意图拽走等):本轮放弃,冷却已簿记不重试
      this.deps.trace.record(char.id, sim.clock.gameMinutes, {
        trigger,
        perception: { motive: 'social', walkedAway: true, target: target.id },
        decision: { layer: 'rule', conclusion: 'continue' },
      });
      return;
    }
    const line = exchange?.line ?? pickChatLine(relation.familiarity);
    const reply = exchange?.reply ?? pickChatLine(relation.familiarity);
    this.deps.apply(
      char,
      {
        layer: 'rule',
        action: 'react',
        intent: { type: 'chat', characterId: char.id, targetId: target.id, line, reply },
        bubble: `想找${target.name}聊聊天`,
      },
      trigger,
      {
        motive: 'social',
        target: target.id,
        desire: Math.round(candidate.desire * 100) / 100,
        llm: exchange !== null,
      },
    );
  }
}
