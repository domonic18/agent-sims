import type { TraitKey } from './world-admin.js';

/**
 * 社交 v1(social-design):二轴有向关系 + chat 意图 + 特质相性。
 * 称号纯派生不存储;数值(server 结算参数)在 apps/server config/balance.ts,
 * 阈值/公式唯一权威 docs/design/04-numerical-design.md §社交。
 */

/** 关系快照(A→B 有向一条;B→A 独立另一条) */
export interface SocialRelationView {
  fromId: string;
  toId: string;
  /** 熟悉度 0~100 */
  familiarity: number;
  /** 好感度 −100~+100,可负 */
  affinity: number;
}

/** 关系称号阈值(派生函数唯一依据,双端同源;数值文档 §6.4) */
export const RELATION_THRESHOLDS = {
  /** affinity ≤ 该值 → 嫌弃(优先判定) */
  dislike: -30,
  /** familiarity < 该值 → 陌生人 */
  stranger: 10,
  /** familiarity < 该值(且非陌生) → 点头之交 */
  acquaintance: 30,
  /** affinity ≥ 该值且 familiarity ≥ 点头之交线 → 挚友 */
  closeFriend: 65,
} as const;

/** 关系称号(纯派生,不存储):嫌弃 > 挚友 > 朋友 > 点头之交 > 陌生人 */
export function relationTitle(familiarity: number, affinity: number): string {
  if (affinity <= RELATION_THRESHOLDS.dislike) return '嫌弃';
  if (familiarity < RELATION_THRESHOLDS.stranger) return '陌生人';
  if (familiarity < RELATION_THRESHOLDS.acquaintance) return '点头之交';
  if (affinity >= RELATION_THRESHOLDS.closeFriend) return '挚友';
  return '朋友';
}

/** v1 闲聊模板池(M4 LLM 接入后替换来源);按熟悉度分档,同档随机 */
const CHAT_LINES = {
  cold: [
    '你好,第一次见面?',
    '今天天气不错啊。',
    '这附近有什么好去处吗?',
    '你好呀,住这片区吗?',
    '嗨,巧了,又碰上了。',
  ],
  warm: [
    '最近过得怎么样?',
    '周末一起去公园走走?',
    '昨晚睡得挺好的,你呢?',
    '咖啡馆新出了甜点,回头一起?',
    '工作别太累了,注意休息。',
  ],
  close: [
    '跟你说个有意思的事!',
    '有你这个朋友真好。',
    '改天来我家吃饭吧。',
    '烦心事跟我说说,我帮你参谋。',
    '下次一起去健身房呀!',
  ],
} as const;

function pickFrom(pool: readonly string[]): string {
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** 按熟悉度选闲聊语(冷启动寒暄 → 熟络闲话 → 挚友知心) */
export function pickChatLine(familiarity: number): string {
  if (familiarity < RELATION_THRESHOLDS.acquaintance) return pickFrom(CHAT_LINES.cold);
  if (familiarity >= 70) return pickFrom(CHAT_LINES.close);
  return pickFrom(CHAT_LINES.warm);
}

/** 特质向量(0~1 五维;M3.6k WorldCharacterConfig.traits 同型) */
export type TraitVector = Record<TraitKey, number>;

const TRAIT_EPSILON = 1e-9;

/**
 * 性格兼容系数(social-design §4):五维平均绝对差 diff(0~1) 映射到
 * [1.4, -0.4]——完全同型 ×1.4 增益,完全互补 ×-0.4 反感跌。
 */
export function compatibility(a: TraitVector, b: TraitVector): number {
  let sum = 0;
  for (const key of Object.keys(a) as TraitKey[]) {
    sum += Math.abs((a[key] ?? 0) - (b[key] ?? 0));
  }
  const diff = sum / (Object.keys(a).length || TRAIT_EPSILON);
  return 1.4 - 1.8 * diff;
}
