import { findPlaceAt, pickChatLine } from '@sims/shared';
import { and, eq } from 'drizzle-orm';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characterImpressions } from '../db/schema/memory.js';
import type { WorldCharacter } from '../world/character.js';
import type { Simulation } from '../world/simulation.js';
import { meetByProximity, relationKey } from '../world/social.js';
import { innerState } from './cognition.js';
import { generateConversation } from './dialogue.js';
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
 * 共处破冰(acquaintanceStep,零模型)——同场所陌生对攒面熟度自动相识,解
 * 「关系只能由聊天创建」的冷启动死锁;空闲角色跑动机引擎(零模型,E2 口径拆分)——
 * 贴身可达候选过点火线即经 light 槽生成双句对话直执(簿记先于 await,走散降级
 * 短冷却);同场未贴身则零 LLM 直接 move_to 走近,到场由 arrived 事件重燃引擎;
 * 异地候选返回给 jev 池(LLM 决定要不要专程去找 TA)。一次至多点火一人。
 * 聊后即时印象 upsert(character_impressions),下次对话 prompt 立即可见。
 * 簿记:同对最近聊天时刻(双角色排序 key)+每角色每日主动计数。
 */
export class SocialLoop {
  private readonly socialPairLastAt = new Map<string, number>();
  private readonly socialDaily = new Map<string, { day: number; count: number }>();
  /** 共处破冰累计(pairKey→{day,分钟}):纯内存,重启重新累计可接受(面熟慢慢攒) */
  private readonly coPresence = new Map<string, { day: number; minutes: number }>();
  /** 当日全世界建交数(防速熟) */
  private metToday = { day: -1, count: 0 };

  constructor(private readonly deps: SocialLoopDeps) {}

  /**
   * 共处破冰步进(D1,15 游戏分一次,由调度泵阈值拍驱动):同场所(荒野则贴身可达)
   * 的陌生对累计共处分钟,满 ACQUAINTANCE_THRESHOLD_MINUTES 且当日建交数未超上限
   * 则双向建交+发 first.met。累计只在采样时刻共处才+15(采样偏差可接受:同场
   * 活动以小时计)。仅感知/数值通道,不触发任何行为,符合铁律。
   */
  acquaintanceStep(): void {
    const { sim } = this.deps;
    const day = sim.clock.day;
    if (this.metToday.day !== day) {
      this.metToday = { day, count: 0 };
    }
    const alive = [...sim.characters.values()].filter((c) => c.alive && !c.collapsed);
    const byPlace = new Map<string, WorldCharacter[]>();
    const loners: WorldCharacter[] = [];
    for (const char of alive) {
      const placeId = findPlaceAt(sim.map.definition, char.x, char.y)?.id;
      if (placeId === undefined) {
        loners.push(char);
        continue;
      }
      const group = byPlace.get(placeId);
      if (group !== undefined) {
        group.push(char);
      } else {
        byPlace.set(placeId, [char]);
      }
    }
    const pairs: Array<[WorldCharacter, WorldCharacter]> = [];
    for (const group of byPlace.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          pairs.push([group[i]!, group[j]!]);
        }
      }
    }
    for (let i = 0; i < loners.length; i += 1) {
      for (let j = i + 1; j < loners.length; j += 1) {
        const a = loners[i]!;
        const b = loners[j]!;
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= BALANCE.SOCIAL_CHAT_DISTANCE) {
          pairs.push([a, b]);
        }
      }
    }
    for (const [a, b] of pairs) {
      if (sim.socials.get(relationKey(a.id, b.id)) !== undefined) continue;
      const key = [a.id, b.id].sort().join('|');
      const entry = this.coPresence.get(key) ?? { day, minutes: 0 };
      if (entry.day !== day) {
        entry.day = day;
        entry.minutes = 0;
      }
      entry.minutes += 15;
      this.coPresence.set(key, entry);
      if (
        entry.minutes < BALANCE.ACQUAINTANCE_THRESHOLD_MINUTES ||
        this.metToday.count >= BALANCE.ACQUAINTANCE_DAILY_CAP
      ) {
        continue;
      }
      this.coPresence.delete(key);
      if (meetByProximity(sim, a.id, b.id)) {
        this.metToday.count += 1;
      }
    }
  }

  idleSocialStep(
    char: WorldCharacter,
    trigger: 'threshold' | 'eventbus',
  ): ScoredCandidate[] {
    const { sim } = this.deps;
    if (!char.alive || char.collapsed) return [];
    const inputs = this.socialInputs(char);
    if (inputs.length === 0) return [];
    const candidates = socialMotive(inputs, {
      valence: innerState.moodOf(char.id)?.valence ?? 0,
      nowGameMinutes: sim.clock.gameMinutes,
    });
    // 贴身可达:light 槽生成双句直执(簿记先于 await 防双发;走散降级短冷却)
    const hit = candidates.find((c) => c.chatReady);
    if (hit !== undefined) {
      this.bookSocial(char.id, hit.targetId);
      void this.socialReact(char, hit, trigger);
      return candidates;
    }
    // 走近再聊(E2):同场未贴身→零 LLM 直接 move_to 对方位置,不簿记不计数
    // (走到才算主动);到场经 character.arrived(triage self=3)重燃动机引擎
    const approach = candidates.find((c) => c.samePlace);
    if (approach !== undefined && char.activity === null && char.path.length === 0) {
      const target = sim.characters.get(approach.targetId);
      if (target !== undefined) {
        this.deps.apply(
          char,
          {
            layer: 'rule',
            action: 'react',
            intent: { type: 'move_to', characterId: char.id, x: target.x, y: target.y },
            bubble: `想找${target.name}聊聊,走过去`,
          },
          trigger,
          {
            motive: 'social',
            approach: target.id,
            desire: Math.round(approach.desire * 100) / 100,
          },
        );
      }
    }
    return candidates;
  }

  /** 动机候选原始资料:已认识(familiarity>0)且对方存活的关系,拼两档同地
   * (chatReady 贴身/samePlace 同场未近)+收益/簿记切片 */
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
      // chatReady=贴身可达(与 chat 校验同一曼哈顿口径);samePlace=同场所/同活动
      const chatReady =
        Math.abs(char.x - target.x) + Math.abs(char.y - target.y) <=
        BALANCE.SOCIAL_CHAT_DISTANCE;
      const samePlace =
        (selfPlace !== null && selfPlace === targetPlace) ||
        (selfActivity !== null && selfActivity === (target.activity?.activityId ?? null));
      inputs.push({
        targetId: relation.toId,
        name: target.name,
        affinity: relation.affinity,
        familiarity: relation.familiarity,
        chatCountToday: relation.chatDay === sim.clock.day ? relation.chatCount : 0,
        lastChatAt: this.pairLastAt(char.id, relation.toId),
        initiatedToday: this.initiatedToday(char.id),
        chatReady,
        samePlace,
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

  /** 走散降级(E2 走散不罚):冷却改写为短窗(RETRY 分钟后可重试),
   * 当日主动计数返还——生成期间被拽走不算一次主动社交 */
  private downgradeWalkedAway(characterId: string, targetId: string): void {
    const { sim } = this.deps;
    this.socialPairLastAt.set(
      [characterId, targetId].sort().join('|'),
      sim.clock.gameMinutes -
        (BALANCE.SOCIAL_PAIR_COOLDOWN_MINUTES - BALANCE.SOCIAL_RETRY_COOLDOWN_MINUTES),
    );
    const entry = this.socialDaily.get(characterId);
    if (entry !== undefined && entry.day === sim.clock.day && entry.count > 0) {
      entry.count -= 1;
    }
  }

  /** 同对最近一次社交簿记时刻(熟人行「多久没聊」用;NEGATIVE_INFINITY=从未) */
  lastChatAtBetween(aId: string, bId: string): number {
    return this.pairLastAt(aId, bId);
  }

  /** 聊后即时印象(E2):无印象建浅印象(规则拼接零 LLM),已有只刷新时刻不动文案——
   * 下次对话/意图 prompt 立即可见「刚聊过」;失败静默(印象属锦上添花) */
  private async touchImpression(
    char: WorldCharacter,
    target: WorldCharacter,
    line: string,
  ): Promise<void> {
    const { handle, sim } = this.deps;
    try {
      const existing = await handle.db
        .select({ content: characterImpressions.content })
        .from(characterImpressions)
        .where(
          and(
            eq(characterImpressions.characterId, char.id),
            eq(characterImpressions.aboutId, target.id),
          ),
        )
        .limit(1);
      const content =
        existing[0]?.content ?? `今天和${target.name}聊了几句:「${line}」`;
      await handle.db
        .insert(characterImpressions)
        .values({
          characterId: char.id,
          aboutId: target.id,
          content,
          gameMinutes: sim.clock.gameMinutes,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [characterImpressions.characterId, characterImpressions.aboutId],
          set: {
            content,
            gameMinutes: sim.clock.gameMinutes,
            updatedAt: new Date(),
          },
        });
    } catch {
      // 印象刷新失败不影响聊天本身
    }
  }

  /** 点火执行:light 槽多轮生成(E3 自然终止)→chat 意图一次结算;败句回落
   * 模板补齐(不丢点火),发起方邀约顺带写入双方脑内(次晨转赴约 want) */
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
    const conversation = await generateConversation(
      this.deps.llm,
      this.deps.handle,
      char,
      target,
      relation,
    );
    const distance = Math.abs(char.x - target.x) + Math.abs(char.y - target.y);
    if (distance > BALANCE.SOCIAL_CHAT_DISTANCE) {
      // 生成期间走散(对方被意图拽走等):本轮放弃,冷却降级为短窗可重试(E2 走散不罚)
      this.downgradeWalkedAway(char.id, target.id);
      this.deps.trace.record(char.id, sim.clock.gameMinutes, {
        trigger,
        perception: { motive: 'social', walkedAway: true, target: target.id },
        decision: { layer: 'rule', conclusion: 'continue' },
      });
      return;
    }
    const lines = conversation !== null ? [...conversation.lines] : [];
    while (lines.length < 2) lines.push(pickChatLine(relation.familiarity));
    this.deps.apply(
      char,
      {
        layer: 'rule',
        action: 'react',
        intent: { type: 'chat', characterId: char.id, targetId: target.id, lines },
        bubble: `想找${target.name}聊聊天`,
      },
      trigger,
      {
        motive: 'social',
        target: target.id,
        desire: Math.round(candidate.desire * 100) / 100,
        llm: conversation !== null,
      },
    );
    if (conversation?.invitation !== null && conversation?.invitation !== undefined) {
      this.bookInvitation(char.id, target.id, conversation.invitation);
    }
    void this.touchImpression(char, target, lines[0]!);
  }

  /** 聚会邀约(E3 最小版):双方脑内各记一条约定,次晨意图生成兑现为赴约 want */
  private bookInvitation(
    fromId: string,
    toId: string,
    invitation: { placeId: string; note: string },
  ): void {
    const day = this.deps.sim.clock.day;
    innerState.ensure(fromId).pendingInvitation = { ...invitation, withId: toId, day };
    innerState.ensure(toId).pendingInvitation = { ...invitation, withId: fromId, day };
  }
}
