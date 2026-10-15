import {
  findPlaceAt,
  pickChatLine,
  type SocialEncounterEvent,
} from '@sims/shared';
import { and, eq } from 'drizzle-orm';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characterImpressions } from '../db/schema/memory.js';
import type { WorldCharacter } from '../world/character.js';
import type { Simulation } from '../world/simulation.js';
import { meetByProximity, relationKey } from '../world/social.js';
import { autonomy, innerState, type Want } from './cognition.js';
import { generateConversation, type DialogueRelation } from './dialogue.js';
import type { Decision } from './fast-layer.js';
import { persistInnerState } from './inner-state-db.js';
import type { MemoryLlm } from './memory-writer.js';
import type { TraceEntry, TraceRecorder } from './trace.js';

/** summon_wait trace 采样周期(每 N 次记 1 次;会合挂起是常态等待,防洪水) */
const SOCIAL_WAIT_TRACE_SAMPLE = 10;

/** 闲适集活动(S2-C 生产保护,03-social §14):在契活动只有这些可被搭话打断;
 * 岗位/采集/建造/医疗/学习在契一律不打扰 */
const SOCIAL_IDLE_ACTIVITY_IDS = ['rest', 'stroll', 'explore', 'workout'];

/** 过闸社交候选(E6.4 布尔门槛产物;desire 打分已废,异地候选供 jev 直觉提示) */
export interface SocialCandidate {
  targetId: string;
  name: string;
  affinity: number;
  familiarity: number;
  /** 贴身可达(曼哈顿≤SOCIAL_CHAT_DISTANCE,可立即搭话) */
  chatReady: boolean;
  /** 同处一地(同场所/同活动)但未贴身,须走近才能聊 */
  samePlace: boolean;
}

/** 空闲社交管线依赖:意图执行经 scheduler.apply 统一出口(气泡/trace/拒绝退避同源);
 * executeWants=驱力 want 写入意图存储后的即时择条回调(E6,调度泵提供) */
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
  ) => boolean;
  executeWants: (char: WorldCharacter, trigger: 'threshold' | 'eventbus') => void;
}

/**
 * 自治社交管线(10-cognition §7.2 C4,自 AgentScheduler 抽出):
 * 共处破冰(acquaintanceStep,零模型)——同场所陌生对攒面熟度自动相识,解
 * 「关系只能由聊天创建」的冷启动死锁;共处分流(onEncounter,零模型)——
 * 计划沟通(在途 want 相遇即聊)与偶遇冲动(S2-C:无意愿纯共处,同对冷却外
 * 即召唤)两路进会合协议;空闲点火发生器已退役(S2-C,03-social §14——社交
 * 只从计划/偶遇/共事间隙自然发生,不再凭空生欲),socialCandidates 仅作查询
 * 供 JEV 事件驱动冲动喂池。聊天/寻人执行全归 wantSelect 唯一执行器(两段式:
 * 远处 move_to 寻人、贴身 chatWith 路回本管线)。
 * 聊后即时印象 upsert(character_impressions)。
 * 簿记:同对最近聊天时刻(双角色排序 key)——同对冷却 SOCIAL_PAIR_COOLDOWN
 * 的计时源(E6.4 起日预算/收益封顶闸废除,聊天频率由对冷却+物理共处自限)。
 * E6.2 两阶段会合协议(E6.2-S1):贴身 chatWith 不再直接烧模型——阶段一**召唤**
 * (零模型):写对方 event want(origin=event「回应X的搭话」,带半衰期)并建会合
 * 台账,对方在自己的 wantSelect 里自行决定应答(该 want 赢得评分,经其执行链直接
 * commit)或婉拒(评分输了/半衰过期);阶段二**生成**(唯一烧模型口):双方就位
 * (贴身+彼此静置)才进 runChatGeneration——共在校验从生成后前移到生成前,
 * 走散空烧通道随之闭合;召唤无回应由 rendezvousSweep 超时回收(零 token)。
 */
export class SocialLoop {
  private readonly socialPairLastAt = new Map<string, number>();
  /** 共处破冰累计(pairKey→{day,分钟}):纯内存,重启重新累计可接受(面熟慢慢攒) */
  private readonly coPresence = new Map<string, { day: number; minutes: number }>();
  /** 对话生成在途标记(pairKey):同一对话同一时刻只烧一次模型 */
  private readonly generating = new Set<string>();
  /** 生成在途的角色(双向):一人同时只进一场对话生成,三方对撞不双烧 */
  private readonly generatingChars = new Set<string>();
  /** 会合台账(E6.2 两阶段聊天,pairKey→发起方/应答方/召唤时刻):召唤已发、
   * 对方尚未应答落座的窗口;生成 commit 或放弃超时时回收 */
  private readonly rendezvous = new Map<
    string,
    { initiatorId: string; targetId: string; atGameMinutes: number }
  >();
  /** summon_wait trace 采样计数(会合挂起是常态等待,防洪水) */
  private summonWaitCount = 0;
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
      const known = sim.socials.get(relationKey(a.id, b.id));
      // 熟络未衰减归零的在途对不重刷;归零旧识放行走 meetByProximity 重逢
      // 刷新——破冰是熟络度唯一非聊天来源,若永久排除已建交对,初值 5 经每
      // 日衰减 1 归零后无恢复路径(聊天加成要求先点火,点火要求 familiarity>0,
      // 鸡生蛋死锁),60 日存档实证全镇 12 条关系 familiarity 全 0、零对话
      if (known !== undefined && known.familiarity > 0) continue;
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

  /** 同目标 socialize want 在途(pending/doing)判定:动机重复点火去重 */
  private hasSocialWant(characterId: string, targetId: string): boolean {
    const intents = innerState.get(characterId)?.intents;
    return (
      intents?.wants.some(
        (w) =>
          (w.status === 'pending' || w.status === 'doing') &&
          w.activityId === 'socialize' &&
          w.targetCharacterId === targetId,
      ) ?? false
    );
  }

  /** 在途 event 源 socialize want(任意对象,E9 搭话节流):存在即视为「正在回应
   * 一场搭话」,相遇分流不再新增第二场——并发上限 1 */
  private hasEventChatWant(characterId: string): boolean {
    const intents = innerState.get(characterId)?.intents;
    return (
      intents?.wants.some(
        (w) =>
          (w.status === 'pending' || w.status === 'doing') &&
          w.origin === 'event' &&
          w.activityId === 'socialize',
      ) ?? false
    );
  }

  /** 社交候选(E6.4 布尔门槛遗产,S2-C 后仅作查询):已认识(familiarity>0)且
   * 对方存活、关系不嫌弃(affinity>-30)、同对冷却外;拼两档同地(chatReady 贴身/
   * samePlace 同场未近)。原「空闲即点火」已退役(无情境欲望发生器,03-social
   * §14)——现仅供 JEV 事件驱动冲动喂池,不再自行写 want */
  socialCandidates(char: WorldCharacter): SocialCandidate[] {
    const { sim } = this.deps;
    if (!sim.chatAllowed()) return []; // 世界规则禁聊:产生入口静音(E6.4/JEV/E8 共用)
    const now = sim.clock.gameMinutes;
    const candidates: SocialCandidate[] = [];
    const selfPlace = findPlaceAt(sim.map.definition, char.x, char.y)?.id ?? null;
    const selfActivity = char.activity?.activityId ?? null;
    for (const relation of sim.socials.values()) {
      if (relation.fromId !== char.id || relation.familiarity <= 0) continue;
      if (relation.affinity <= -30) continue;
      if (now - this.pairLastAt(char.id, relation.toId) < BALANCE.SOCIAL_PAIR_COOLDOWN_MINUTES) {
        continue;
      }
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
      candidates.push({
        targetId: relation.toId,
        name: target.name,
        affinity: relation.affinity,
        familiarity: relation.familiarity,
        chatReady,
        samePlace,
      });
    }
    return candidates;
  }

  private pairLastAt(aId: string, bId: string): number {
    return this.socialPairLastAt.get([aId, bId].sort().join('|')) ?? Number.NEGATIVE_INFINITY;
  }

  /** 社交簿记(同步,先于任何 await):同对冷却时刻——唯一防刷闸的计时源 */
  private bookSocial(characterId: string, targetId: string): void {
    const { sim } = this.deps;
    this.socialPairLastAt.set(
      [characterId, targetId].sort().join('|'),
      sim.clock.gameMinutes,
    );
  }

  /** 走散降级(E2 走散不罚):冷却改写为短窗(RETRY 分钟后可重试)——
   * 生成期间被拽走不按整场冷却罚 */
  private downgradeWalkedAway(characterId: string, targetId: string): void {
    const { sim } = this.deps;
    this.socialPairLastAt.set(
      [characterId, targetId].sort().join('|'),
      sim.clock.gameMinutes -
        (BALANCE.SOCIAL_PAIR_COOLDOWN_MINUTES - BALANCE.SOCIAL_RETRY_COOLDOWN_MINUTES),
    );
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

  /**
   * 执行 socialize want 的聊天(E6 统一意图架构+E6.2 两阶段会合协议):
   * 阶段一**召唤**(零模型)——未建会合时写对方 event want(origin=event「回应X
   * 的搭话」,带半衰期)并建会合台账即返回;对方在自己的 wantSelect 里自行决定
   * 应答(该 want 赢得评分,经其执行链回到此处直接 commit)或婉拒(评分输了/
   * 半衰过期)。阶段二**生成**(唯一烧模型口)——双方就位(贴身+对方静置)才进
   * runChatGeneration:共在校验从「生成后」前移到「生成前」,走散空烧通道闭合。
   * 生成在途护栏(对级+角色级)防双烧;生成期间走散(rule 层把人拽走等罕见路径)
   * →冷却降级短窗+发起方计数返还+双向 want 回 pending;对方不在/无关系→want 废弃。
   */
  async executeChatWant(
    char: WorldCharacter,
    targetId: string,
    wantId: string | null,
    trigger: 'threshold' | 'eventbus',
  ): Promise<void> {
    const { sim } = this.deps;
    if (!sim.chatAllowed()) {
      // 规则中途关闭:在途聊天 want 直接废弃不悬挂(走位/会合台账随愿消亡)
      this.releaseWant(char.id, wantId, 'abandoned');
      return;
    }
    const target = sim.characters.get(targetId);
    if (target === undefined || !target.alive || target.collapsed) {
      this.releaseWant(char.id, wantId, 'abandoned');
      return;
    }
    const relation = sim.socials.get(relationKey(char.id, target.id));
    if (relation === undefined) {
      this.releaseWant(char.id, wantId, 'abandoned');
      return;
    }
    const key = [char.id, target.id].sort().join('|');
    // 生成在途护栏:对级(同对只烧一次)+角色级(一人只进一场,三方对撞不双烧)
    if (
      this.generating.has(key) ||
      this.generatingChars.has(char.id) ||
      this.generatingChars.has(target.id)
    ) {
      this.deps.trace.record(char.id, sim.clock.gameMinutes, {
        trigger,
        perception: { motive: 'social', chatBusy: true, target: target.id, want: wantId ?? undefined },
        decision: { layer: 'rule', conclusion: 'continue' },
        ...(wantId !== null ? { wantId } : {}),
      });
      return;
    }
    // 阶段一:未建会合→召唤(零模型),want 留 doing 静候对方应答
    if (!this.rendezvous.has(key)) {
      this.summon(char, target, trigger);
      return;
    }
    // 阶段二闸门:双方就位(贴身+对方静置)才生成——共在校验前置,走散不进生成
    const distance = Math.abs(char.x - target.x) + Math.abs(char.y - target.y);
    const otherBusy = target.activity !== null || target.path.length > 0;
    if (distance > BALANCE.SOCIAL_CHAT_DISTANCE || otherBusy) {
      this.summonWaitCount += 1;
      if (this.summonWaitCount % SOCIAL_WAIT_TRACE_SAMPLE === 1) {
        this.deps.trace.record(char.id, sim.clock.gameMinutes, {
          trigger,
          perception: { motive: 'social', summonWait: true, target: target.id, want: wantId ?? undefined },
          decision: { layer: 'rule', conclusion: 'continue' },
          ...(wantId !== null ? { wantId } : {}),
        });
      }
      return;
    }
    this.generating.add(key);
    this.generatingChars.add(char.id);
    this.generatingChars.add(target.id);
    try {
      await this.runChatGeneration(char, target, relation, wantId, trigger, this.rendezvous.get(key)!.initiatorId);
    } finally {
      this.generating.delete(key);
      this.generatingChars.delete(char.id);
      this.generatingChars.delete(target.id);
      // 会合收口:落地/走散均散场,下次聊天新一轮召唤
      this.rendezvous.delete(key);
    }
  }

  /**
   * 共处消化(E8→S2-C 偶遇冲动):世界层 tick 级 social.encounter 的认知侧分流。
   * 相遇是快于决策采样(15 游戏分/块)的瞬时事实——采样式贴身判定对相向而行两人
   * 命中率仅 ~7%,「路上碰见却各自走到目的地」的追逐循环由此而来。按社交来源
   * 分流(03-social §14),零模型:
   * ① 计划沟通:任一方有指向对方的在途 socialize want=想聊,进既有会合协议
   *   (双向都想聊时 id 字典序小者为发起方,谁发起只决定协议角色);
   * ② 临时冲动:双方都无意愿的纯共处=偶遇即冲动,同对冷却外即召唤(聊不聊的
   *   另一半归应答方 wantSelect 评分自裁);
   * 生产保护:任一方在契生产活动(岗位/采集/建造/学习)一律不打扰,可搭话仅限
   * 空闲或闲适集活动;停步是「见面停下来说话」的物理表达(协议机械动作,双方
   * want 真实存在于意图存储,执行仍归 wantSelect)。
   */
  onEncounter(event: SocialEncounterEvent): void {
    const { sim } = this.deps;
    const a = sim.characters.get(event.aId);
    const b = sim.characters.get(event.bId);
    if (a === undefined || b === undefined) return;
    if (!a.alive || !b.alive || a.collapsed || b.collapsed) return;
    if (!autonomy.has(a.id) || !autonomy.has(b.id)) return;
    if (!SocialLoop.isChatReceptive(a) || !SocialLoop.isChatReceptive(b)) return;
    const aSeeks = this.hasSocialWant(a.id, b.id);
    const bSeeks = this.hasSocialWant(b.id, a.id);
    let initiator: WorldCharacter;
    if (aSeeks || bSeeks) {
      initiator = aSeeks && bSeeks ? (a.id < b.id ? a : b) : aSeeks ? a : b;
    } else {
      // 偶遇冲动(S2-C §14):无情境欲望发生器已退役,冲动只从物理共处发生——
      // 世界规则允许(产生入口闸,架构强制项 8)+同对冷却外(节奏自限)
      if (!sim.chatAllowed()) return;
      if (
        sim.clock.gameMinutes - this.pairLastAt(a.id, b.id) <
        BALANCE.SOCIAL_PAIR_COOLDOWN_MINUTES
      ) {
        return;
      }
      initiator = a.id < b.id ? a : b;
    }
    const target = initiator === a ? b : a;
    const key = [a.id, b.id].sort().join('|');
    if (this.rendezvous.has(key) || this.generating.has(key)) return;
    // 搭话节流(E9):应答方已在回应别人的搭话(在途 event 源 socialize want 并发
    // 上限 1)且并未主动找发起方时,本次相遇只擦肩——不停步不召唤不写 want。高人流
    // 枢纽的相遇流曾以每 30-65 游戏分一个 0.9 档搭话 want 逐拍插队,把在契 want 的
    // 执行窗口全部占满(2026-10-11 观察镇小林 meal want 空转 18 游戏时根因之一);
    // 须在 requestStopMove 之前判定,否则擦肩会变成凭空定身
    const targetSeeksInitiator = initiator === a ? bSeeks : aSeeks;
    if (!targetSeeksInitiator && this.hasEventChatWant(target.id)) {
      this.deps.trace.record(initiator.id, sim.clock.gameMinutes, {
        trigger: 'eventbus',
        perception: {
          motive: 'social',
          encounterDropped: true,
          reason: 'event_chat_busy',
          target: target.id,
        },
        decision: { layer: 'rule', conclusion: 'continue' },
      });
      return;
    }
    sim.requestStopMove(a.id);
    sim.requestStopMove(b.id);
    this.deps.trace.record(initiator.id, sim.clock.gameMinutes, {
      trigger: 'eventbus',
      perception: {
        motive: 'social',
        encounter: target.id,
        bidirectional: aSeeks && bSeeks,
      },
      decision: { layer: 'rule', conclusion: 'react', intent: 'want:socialize' },
    });
    this.summon(initiator, target, 'eventbus');
  }

  /** 可搭话判定(S2-C 生产保护):无活动,或闲适集活动(rest/stroll/explore/
   * workout)在契——睡觉/进餐(interruptibility='none' 旧闸)与岗位/采集/建造/
   * 学习(生产活动)一并不接待:别人干活凑上去聊不合常理 */
  private static isChatReceptive(c: WorldCharacter): boolean {
    return c.activity === null || SOCIAL_IDLE_ACTIVITY_IDS.includes(c.activity.activityId);
  }

  /**
   * 阶段一·召唤(零模型,E6.2 event→want 通道首个消费者):写对方 event want
   * (origin=event,「回应X的搭话」,紧迫度 0.9 带半衰期)并建会合台账,即时重评
   * 对方(贴身空闲即应答,应答即生成)。应答与否归对方 wantSelect 评分自裁——
   * 让位给更要紧的事=婉拒,零成本;非自治角色/无当日意图容器不写(下轮可重呼);
   * 对方已有指向我的在途社交 want 则只建会合借道执行(不重复写念头)。
   */
  private summon(
    char: WorldCharacter,
    target: WorldCharacter,
    trigger: 'threshold' | 'eventbus',
  ): void {
    const { sim } = this.deps;
    if (!sim.chatAllowed()) return; // 禁聊世界:召唤链(E8/道谢直呼)入口静默
    const key = [char.id, target.id].sort().join('|');
    if (!autonomy.has(target.id)) {
      this.deps.trace.record(char.id, sim.clock.gameMinutes, {
        trigger,
        perception: { motive: 'social', summonDropped: true, reason: 'not_autonomous', target: target.id },
        decision: { layer: 'rule', conclusion: 'continue' },
      });
      return;
    }
    const intents = innerState.get(target.id)?.intents ?? null;
    if (intents === null || intents.day !== sim.clock.day) {
      this.deps.trace.record(char.id, sim.clock.gameMinutes, {
        trigger,
        perception: { motive: 'social', summonDropped: true, reason: 'no_intents', target: target.id },
        decision: { layer: 'rule', conclusion: 'continue' },
      });
      return;
    }
    this.rendezvous.set(key, {
      initiatorId: char.id,
      targetId: target.id,
      atGameMinutes: sim.clock.gameMinutes,
    });
    if (!this.hasSocialWant(target.id, char.id)) {
      const want: Want = {
        id: `w${sim.clock.day}-s${sim.clock.gameMinutes}`,
        activityId: 'socialize',
        origin: 'event',
        targetCharacterId: char.id,
        why: `${char.name}过来搭话,回应一下`,
        urgency: BALANCE.SOCIAL_SUMMON_URGENCY,
        expiresAtMin: sim.clock.gameMinutes + BALANCE.SOCIAL_SUMMON_TTL_MINUTES,
        status: 'pending',
        createdAtMin: sim.clock.gameMinutes,
      };
      intents.wants.push(want);
      persistInnerState(this.deps.handle, target.id);
      this.deps.trace.record(target.id, sim.clock.gameMinutes, {
        trigger,
        perception: { motive: 'social', summon: char.id, want: want.id },
        decision: { layer: 'rule', conclusion: 'react', intent: 'want:socialize', bubble: want.why },
        wantId: want.id,
      });
    }
    this.deps.executeWants(target, trigger); // 即时重评:贴身空闲即应答,应答即生成
  }

  /**
   * 会合超时回收(15 游戏分一拍,调度泵阈值块驱动):发起方等满放弃窗口仍无应答
   * =被放鸽子——会合散场,发起方在途 want 废弃(驱力日后可再点火,同对冷却照常
   * 把门)。零模型零 token,替代旧「生成后走散丢弃」的空烧路径。
   */
  rendezvousSweep(): void {
    const { sim } = this.deps;
    const now = sim.clock.gameMinutes;
    for (const [key, entry] of [...this.rendezvous]) {
      if (now - entry.atGameMinutes < BALANCE.SOCIAL_SUMMON_GIVE_UP_MINUTES) continue;
      this.rendezvous.delete(key);
      const want = innerState
        .get(entry.initiatorId)
        ?.intents?.wants.find(
          (w) =>
            w.status === 'doing' &&
            w.activityId === 'socialize' &&
            w.targetCharacterId === entry.targetId,
        );
      if (want !== undefined) {
        want.status = 'abandoned';
        persistInnerState(this.deps.handle, entry.initiatorId);
      }
      this.deps.trace.record(entry.initiatorId, now, {
        trigger: 'threshold',
        perception: { motive: 'social', summonTimeout: true, target: entry.targetId },
        decision: { layer: 'rule', conclusion: 'continue' },
        ...(want !== undefined ? { wantId: want.id } : {}),
      });
    }
  }

  /** 该对是否正在生成对话(wantSelect 让行闸:生成窗口双方原地静候结算) */
  isGeneratingBetween(aId: string, bId: string): boolean {
    return this.generating.has([aId, bId].sort().join('|'));
  }

  /** 我召唤 TA 且会合未收口(E6.2 发起方让行闸:候召期不重复点火/寻人) */
  summonAwaiting(initiatorId: string, targetId: string): boolean {
    const entry = this.rendezvous.get([initiatorId, targetId].sort().join('|'));
    return entry !== undefined && entry.initiatorId === initiatorId;
  }

  /** 生成→走散判定→落地聊天(want 生命周期收口);簿记先于 await 防双发,
   * 主动社交记发起方(召唤者)——应答方执行生成不算主动。簿记/降级的 pair
   * 以发起方视角取同伴(执行方可能是应答者,其 partner 才是发起方本人) */
  private async runChatGeneration(
    char: WorldCharacter,
    target: WorldCharacter,
    relation: DialogueRelation,
    wantId: string | null,
    trigger: 'threshold' | 'eventbus',
    initiatorId: string,
  ): Promise<void> {
    const { sim } = this.deps;
    const partnerId = initiatorId === char.id ? target.id : char.id;
    this.bookSocial(initiatorId, partnerId);
    const conversation = await generateConversation(
      this.deps.llm,
      this.deps.handle,
      char,
      target,
      relation,
    );
    const distance = Math.abs(char.x - target.x) + Math.abs(char.y - target.y);
    if (distance > BALANCE.SOCIAL_CHAT_DISTANCE) {
      // 生成期间走散(对方被 rule 层拽走等罕见路径;常规路径已被就位闸门挡在生成前):
      // 本轮放弃,冷却降级为短窗可重试(E2 走散不罚),双向 want 回 pending
      this.downgradeWalkedAway(initiatorId, partnerId);
      this.releaseSocialWant(char.id, target.id, 'pending');
      this.releaseSocialWant(target.id, char.id, 'pending');
      this.deps.trace.record(char.id, sim.clock.gameMinutes, {
        trigger,
        perception: { motive: 'social', walkedAway: true, target: target.id, want: wantId ?? undefined },
        decision: { layer: 'rule', conclusion: 'continue' },
        ...(wantId !== null ? { wantId } : {}),
      });
      return;
    }
    const lines = conversation !== null ? [...conversation.lines] : [];
    while (lines.length < 2) lines.push(pickChatLine(relation.familiarity));
    const accepted = this.deps.apply(
      char,
      {
        layer: 'rule',
        action: 'react',
        intent: { type: 'chat', characterId: char.id, targetId: target.id, lines },
        bubble: `和${target.name}聊聊天`,
        ...(wantId !== null ? { wantId } : {}),
      },
      trigger,
      {
        motive: 'social',
        target: target.id,
        want: wantId ?? undefined,
        llm: conversation !== null,
      },
    );
    if (!accepted) {
      // R3 反馈一致性:chat 意图被权威校验链拒绝(禁聊世界兜底/距离翻转等)——
      // 冷却降级短窗+双向 want 废弃,不再悬挂 doing 干等过期(镇A 35 个 socialize
      // 悬挂实证);会合/生成台账由 executeChatWant 的 finally 统一收口
      this.downgradeWalkedAway(initiatorId, partnerId);
      this.releaseSocialWant(char.id, target.id, 'abandoned');
      this.releaseSocialWant(target.id, char.id, 'abandoned');
      this.deps.trace.record(char.id, sim.clock.gameMinutes, {
        trigger,
        perception: { motive: 'social', chatRejected: true, target: target.id, want: wantId ?? undefined },
        decision: { layer: 'rule', conclusion: 'continue' },
        ...(wantId !== null ? { wantId } : {}),
      });
      return;
    }
    if (conversation?.invitation !== null && conversation?.invitation !== undefined) {
      this.bookInvitation(char.id, target.id, conversation.invitation);
    }
    void this.touchImpression(char, target, lines[0]!);
  }

  /** want 回收:聊天未落地时把 doing 的 socialize want 置回 pending(评分可再裁决)
   * 或废弃(对象不存在);wantId 为 null(无 want 直呼)静默 */
  private releaseWant(
    characterId: string,
    wantId: string | null,
    status: 'pending' | 'abandoned',
  ): void {
    if (wantId === null) return;
    const want = innerState.get(characterId)?.intents?.wants.find((w) => w.id === wantId);
    if (want === undefined || want.status !== 'doing') return;
    want.status = status;
    persistInnerState(this.deps.handle, characterId);
  }

  /** 按同伴回收在途社交 want(E6.2 会合两侧生命周期对齐:走散时双方 want 一并
   * 回 pending;找不到(无 want 直呼)静默) */
  private releaseSocialWant(
    characterId: string,
    partnerId: string,
    status: 'pending' | 'abandoned',
  ): void {
    const want = innerState
      .get(characterId)
      ?.intents?.wants.find(
        (w) =>
          w.status === 'doing' && w.activityId === 'socialize' && w.targetCharacterId === partnerId,
      );
    if (want === undefined) return;
    want.status = status;
    persistInnerState(this.deps.handle, characterId);
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
