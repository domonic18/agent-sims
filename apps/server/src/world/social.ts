import {
  compatibility,
  pickChatLine,
  relationTitle,
  type FriendshipFormedEvent,
  type SocialChatEvent,
  type TraitVector,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { clampVital, ensureAlive, type WorldCharacter } from './character.js';
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
 * (曼哈顿 ≤ SOCIAL_PRESENCE_DISTANCE);收益=基础×当日递减×相性系数,
 * 同对角色每游戏日限 CHAT_DAILY_LIMIT 次。返回聊天语(回执展示用)。
 */
export function chat(sim: Simulation, fromId: string, toId: string): string {
  const from = sim.character(fromId);
  const to = sim.character(toId);
  if (fromId === toId) {
    throw new Error('不能和自己聊天');
  }
  ensureAlive(from);
  ensureAlive(to);
  const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  if (distance > BALANCE.SOCIAL_PRESENCE_DISTANCE) {
    throw new Error(`${from.name} 与 ${to.name} 距离太远(曼哈顿 ${distance}),走近点再聊`);
  }
  const [forward] = ensureRelations(sim, fromId, toId);
  if (forward.chatDay === sim.clock.day && forward.chatCount >= BALANCE.CHAT_DAILY_LIMIT) {
    throw new Error(
      `${from.name} 和 ${to.name} 今天已经聊过 ${BALANCE.CHAT_DAILY_LIMIT} 次,明天再聊吧`,
    );
  }
  if (forward.chatDay !== sim.clock.day) {
    forward.chatDay = sim.clock.day;
    forward.chatCount = 0;
  }
  const decay = BALANCE.CHAT_DECAY_STEPS[forward.chatCount] ?? 0;
  const compat = compatibility(from.traits, to.traits);
  const affinityDelta = BALANCE.CHAT_AFFINITY_BASE * compat * decay;
  forward.chatCount += 1;

  const [, backward] = ensureRelations(sim, fromId, toId);
  applyRelationChange(forward, BALANCE.CHAT_FAMILIARITY_GAIN * decay, affinityDelta);
  applyRelationChange(backward, 0, affinityDelta);
  from.happiness = clampVital(from.happiness + BALANCE.CHAT_HAPPINESS);
  to.happiness = clampVital(to.happiness + BALANCE.CHAT_HAPPINESS);

  const content = pickChatLine(forward.familiarity);
  const event: SocialChatEvent = {
    type: 'social.chat',
    fromId,
    toId,
    tick: sim.tick,
    content,
    affinityDelta: Math.round(affinityDelta * 10) / 10,
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
 * 同场增益(social-design §3.2):活动中角色按「附近(曼哈顿 ≤ 距离)
 * 同在活动的其他角色数」获得幸福/分;人数封顶。结算在活动净速率之后。
 */
export function applySocialPresenceBonus(
  sim: Simulation,
  character: WorldCharacter,
): void {
  if (character.activity === null) return;
  let nearby = 0;
  for (const other of sim.characters.values()) {
    if (other.id === character.id || other.activity === null) continue;
    if (Math.abs(other.x - character.x) + Math.abs(other.y - character.y) <= BALANCE.SOCIAL_PRESENCE_DISTANCE) {
      nearby += 1;
      if (nearby >= BALANCE.SOCIAL_PRESENCE_CAP) break;
    }
  }
  if (nearby > 0) {
    character.happiness = clampVital(
      character.happiness + nearby * BALANCE.SOCIAL_PRESENCE_BONUS,
    );
  }
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
