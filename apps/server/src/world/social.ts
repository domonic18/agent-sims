import {
  compatibility,
  pickChatLine,
  relationTitle,
  type FirstMetEvent,
  type FriendshipFormedEvent,
  type SocialChatEvent,
  type TraitVector,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { ensureAlive, ensureNotCollapsed } from './character.js';
import type { Simulation } from './simulation.js';

/** 有向关系(A→B):二轴+防刷计数;B→A 是另一条独立记录(social-design §2) */
export interface SocialRelation {
  fromId: string;
  toId: string;
  /** 0~100,缓涨缓衰 */
  familiarity: number;
  /** −100~+100,可负 */
  affinity: number;
  /** 防刷:最近聊天游戏日与当日次数 */
  chatDay: number;
  chatCount: number;
  /** 首次结成 朋友/挚友 已发事件(避免重复) */
  formedNotified: boolean;
  /** 首识事件已发过(避免旧识熟络衰减归零后被误当首识重发);旧存档缺省=未发 */
  metNotified?: boolean;
}

export const relationKey = (fromId: string, toId: string): string => `${fromId}|${toId}`;

/** 取双向关系(懒创建,顺序固定保证 key 稳定) */
export function ensureRelations(
  sim: Simulation,
  aId: string,
  bId: string,
): [SocialRelation, SocialRelation] {
  const make = (fromId: string, toId: string): SocialRelation => ({
    fromId,
    toId,
    familiarity: 0,
    affinity: 0,
    chatDay: sim.clock.day,
    chatCount: 0,
    formedNotified: false,
  });
  const forward = sim.socials.get(relationKey(aId, bId)) ?? make(aId, bId);
  const backward = sim.socials.get(relationKey(bId, aId)) ?? make(bId, aId);
  sim.socials.set(relationKey(aId, bId), forward);
  sim.socials.set(relationKey(bId, aId), backward);
  return [forward, backward];
}

/** 出生随机特质向量(两位小数;M4 前不驱动决策,仅相性输入) */
export function randomTraits(): TraitVector {
  const round2 = (value: number): number => Math.round(value * 100) / 100;
  return {
    ambition: round2(Math.random()),
    hedonism: round2(Math.random()),
    homebody: round2(Math.random()),
    sociability: round2(Math.random()),
    frugality: round2(Math.random()),
  };
}

/**
 * 闲聊(social-design §3.1):双方须存活、非同一人、同处一地
 * (曼哈顿 ≤ SOCIAL_CHAT_DISTANCE);收益=基础×当日递减×相性系数,
 * 每游戏日超过 CHAT_DAILY_GAINED 次后不拒绝但收益为 0(对话照常)。
 * line 缺省走模板池;调用方可指定具体台词(事件响应道谢等)。
 * lines(E3 自然终止多轮)=一场对话的交替台词(发起者先说),事件 content
 * 合并全句并随事件携带 lines 原句;收益只结算一次,不按句数放大。
 * 返回聊天语(回执展示用)。
 */
export function chat(
  sim: Simulation,
  fromId: string,
  toId: string,
  line?: string,
  lines?: readonly string[],
): string {
  const from = sim.character(fromId);
  const to = sim.character(toId);
  if (fromId === toId) {
    throw new Error('不能和自己聊天');
  }
  ensureAlive(from);
  ensureAlive(to);
  ensureNotCollapsed(from);
  const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  if (distance > BALANCE.SOCIAL_CHAT_DISTANCE) {
    throw new Error(`${from.name} 与 ${to.name} 距离太远(曼哈顿 ${distance}),走近点再聊`);
  }
  const [forward] = ensureRelations(sim, fromId, toId);
  if (forward.chatDay !== sim.clock.day) {
    forward.chatDay = sim.clock.day;
    forward.chatCount = 0;
  }
  // 收益封顶不设硬上限(M4 Agent 高频社交): 超出有收益档位后对话照常,增益全 ×0
  const decay = BALANCE.CHAT_DECAY_STEPS[forward.chatCount] ?? 0;
  const compat = compatibility(from.traits, to.traits);
  const affinityDelta = BALANCE.CHAT_AFFINITY_BASE * compat * decay;
  forward.chatCount += 1;

  const [, backward] = ensureRelations(sim, fromId, toId);
  applyRelationChange(forward, BALANCE.CHAT_FAMILIARITY_GAIN * decay, affinityDelta);
  applyRelationChange(backward, 0, affinityDelta);
  // 聊天得分(numerical §2.5/§6.2): 相性为负不扣分(单调递增),直接累加、快照取整
  const scoreGain = Math.max(0, BALANCE.CHAT_SCORE * decay * compat);
  from.score += scoreGain;
  to.score += scoreGain;

  const multi = lines !== undefined && lines.length > 0;
  const content = multi
    ? lines.map((l) => `「${l}」`).join('')
    : (line ?? pickChatLine(forward.familiarity));
  const event: SocialChatEvent = {
    type: 'social.chat',
    fromId,
    toId,
    tick: sim.tick,
    content,
    affinityDelta: Math.round(affinityDelta * 10) / 10,
    ...(multi ? { lines: [...lines] } : {}),
  };
  sim.events.emit(event);
  notifyFriendship(sim, forward);
  notifyFriendship(sim, backward);
  return content;
}

function applyRelationChange(
  relation: SocialRelation,
  familiarityDelta: number,
  affinityDelta: number,
): void {
  relation.familiarity = Math.max(0, Math.min(100, relation.familiarity + familiarityDelta));
  relation.affinity = Math.max(-100, Math.min(100, relation.affinity + affinityDelta));
}

/** 首次达到 朋友/挚友 发一次结成事件(嫌弃不庆祝) */
function notifyFriendship(sim: Simulation, relation: SocialRelation): void {
  if (relation.formedNotified) return;
  const title = relationTitle(relation.familiarity, relation.affinity);
  if (title !== '朋友' && title !== '挚友') return;
  relation.formedNotified = true;
  const event: FriendshipFormedEvent = {
    type: 'friendship.formed',
    aId: relation.fromId,
    bId: relation.toId,
    tick: sim.tick,
    title,
  };
  sim.events.emit(event);
}

/**
 * 共处破冰(social-design §2 补,D1):同场所共处攒够面熟度的陌生对双向建交,
 * 熟悉度抬到 ACQUAINTANCE_FAMILIARITY;首次相识发 first.met 事件,旧识重逢
 * (熟悉度衰减归零)静默刷新不重发。返回是否首次相识(供调用方写记忆)。
 */
export function meetByProximity(sim: Simulation, aId: string, bId: string): boolean {
  const [forward, backward] = ensureRelations(sim, aId, bId);
  const initial = BALANCE.ACQUAINTANCE_FAMILIARITY;
  // 首识事件一对只发一次(metNotified 随存档持久化):熟络衰减归零的旧识重逢
  // 只静默刷新熟络度不重发。曾缺此标记——isNew 按 familiarity<=0 判定,衰减
  // 归零会被当首识;且若共处破冰永久排除已建交对,初值 5 经每日衰减 1 归零后
  // 无任何恢复路径(聊天加成要求先点火,点火要求 familiarity>0,鸡生蛋死锁),
  // 60 日存档实证全镇 12 条关系 familiarity 全 0、零对话
  const isNew =
    forward.familiarity <= 0 &&
    backward.familiarity <= 0 &&
    forward.metNotified !== true;
  forward.familiarity = Math.max(forward.familiarity, initial);
  backward.familiarity = Math.max(backward.familiarity, initial);
  forward.metNotified = true;
  backward.metNotified = true;
  if (!isNew) {
    return false;
  }
  const event: FirstMetEvent = {
    type: 'first.met',
    aId,
    bId,
    tick: sim.tick,
  };
  sim.events.emit(event);
  return true;
}

/** 世界日翻转(00:00)结算:熟悉度衰减+防刷计数自然跨日重置 */
export function applySocialDailyRollover(sim: Simulation): void {
  for (const relation of sim.socials.values()) {
    relation.familiarity = Math.max(
      0,
      relation.familiarity - BALANCE.FAMILIARITY_DECAY_PER_DAY,
    );
  }
}
