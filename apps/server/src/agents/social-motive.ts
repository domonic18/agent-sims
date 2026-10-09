import { BALANCE } from '../config/balance.js';

/**
 * 社交动机引擎(10-cognition §7.2 C4,零模型):「想不想找 TA 聊天」由规则回答,
 * 不问模型——基础欲望=好感≥50,调节项=久未聊(熟悉度衰减的动机化)、初识面熟
 * (familiarity<20 好奇加成,D1 共处破冰的可达线保障)、同处一地(同桌工作/同场
 * 活动的情境加成)、情绪加成(valence>0 更想说话)。
 * 风险护栏(§9): 同对冷却+每日主动上限+收益封顶(chatCount 归零档)三闸先于打分。
 * 纯函数:候选原始资料由调度泵从世界状态拼装,测试直接喂表。
 */

/** 社交候选原始资料(调度泵从 sim.socials/位置/簿记拼装) */
export interface SocialMotiveInput {
  targetId: string;
  name: string;
  /** 我→TA 关系(候选必须已有关系记录:共处破冰或聊过天) */
  affinity: number;
  /** 我→TA 熟悉度(0~100;初识低值享面熟加成) */
  familiarity: number;
  /** 当日我→TA 已聊天次数(收益封顶判定) */
  chatCountToday: number;
  /** 我最近一次主动找 TA 的时刻(簿记;Number.NEGATIVE_INFINITY=从未) */
  lastChatAt: number;
  /** 我今日已主动发起次数(簿记,全对象合计) */
  initiatedToday: number;
  /** 同处一地(同场所或进行同一活动) */
  colocated: boolean;
}

/** 动机上下文(自己的状态切片) */
export interface SocialMotiveSelf {
  valence: number;
  nowGameMinutes: number;
}

/** 打分后候选(过闸+点火线之上,按欲望降序) */
export interface ScoredCandidate extends SocialMotiveInput {
  desire: number;
}

/** 久未聊加成上限与斜率:每天 +0.1,封顶 0.3(三天没聊=很想聊) */
const UNSEEN_DAILY_BONUS = 0.1;
const UNSEEN_MAX_BONUS = 0.3;
/** 初识面熟加成:刚认识(familiarity<20)还想多聊几句摸清底细,破冰后对话可自然续上 */
const NOVICE_FAMILIARITY_LINE = 20;
const NOVICE_BONUS = 0.15;
/** 同处一地情境加成(同桌工作/同场活动) */
const COLOCATED_BONUS = 0.2;
/** 正情绪加成斜率:valence 1.0 → +0.1 */
const MOOD_BONUS_RATE = 0.1;
const DAY_MINUTES = 1440;

export function socialMotive(
  inputs: readonly SocialMotiveInput[],
  self: SocialMotiveSelf,
): ScoredCandidate[] {
  const cap = BALANCE.SOCIAL_DAILY_INITIATE_CAP;
  const scored: ScoredCandidate[] = [];
  for (const input of inputs) {
    // 护栏三闸(§9):负面关系剔除/同对冷却/每日主动上限/收益封顶
    if (input.affinity <= -30) continue;
    if (cap > 0 && input.initiatedToday >= cap) continue;
    if (
      self.nowGameMinutes - input.lastChatAt <
      BALANCE.SOCIAL_PAIR_COOLDOWN_MINUTES
    ) {
      continue;
    }
    if (input.chatCountToday >= BALANCE.CHAT_DAILY_GAINED) continue;
    // 基础欲望:好感≥50 即 0.5,否则线性(负好感趋 0)
    let desire = input.affinity >= 50 ? 0.5 : input.affinity / 100;
    // 久未聊:按整游戏日计,从未聊过直接给满
    const days =
      input.lastChatAt === Number.NEGATIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.floor((self.nowGameMinutes - input.lastChatAt) / DAY_MINUTES);
    desire += Math.min(UNSEEN_MAX_BONUS, UNSEEN_DAILY_BONUS * days);
    // 面熟加成:初识(familiarity<20)好奇驱动,让共处破冰后的第一场对话可达点火线
    if (input.familiarity < NOVICE_FAMILIARITY_LINE) {
      desire += NOVICE_BONUS;
    }
    // 情境:同处一地才有的搭话契机
    if (input.colocated) desire += COLOCATED_BONUS;
    // 情绪:心情好更想说话(负值不加)
    desire += MOOD_BONUS_RATE * Math.max(0, Math.min(1, self.valence));
    if (desire < BALANCE.SOCIAL_DESIRE_FIRE) continue;
    scored.push({ ...input, desire });
  }
  return scored.sort((a, b) => b.desire - a.desire);
}
