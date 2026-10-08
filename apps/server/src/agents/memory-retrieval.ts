import { eq, sql } from 'drizzle-orm';
import { memories } from '../db/schema/memory.js';
import type { DbHandle } from '../db/client.js';

/** recency 衰减:0.995^(距现在的游戏小时数)(design/01 §5.3) */
export const RECENCY_DECAY_PER_HOUR = 0.995;

export interface MemoryFactors {
  recency: number;
  importance: number;
  /** 无向量条目为 null(embedding 槽失能时全体 null=双因子退化) */
  relevance: number | null;
}

export interface ScoredMemory {
  id: string;
  type: string;
  content: string;
  importance: number;
  gameMinutes: number | null;
  createdAt: Date;
  /** 三因子归一化之和(排序唯一依据,分高者胜) */
  score: number;
  factors: MemoryFactors;
}

interface CandidateRow {
  id: string;
  type: string;
  content: string;
  importance: number;
  gameMinutes: number | null;
  createdAt: Date;
  /** pgvector 余弦相似度(1-距离),queryVector 缺省或条目无向量时 null */
  relevance: number | null;
}

/** min-max 归一化到 [0,1];全体同值为退化(区分度 0)→ 恒 0.5 中性;null(因子缺失)→ 0 沉底 */
function normalize(values: Array<number | null>): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value === null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Infinity) return values.map(() => 0);
  if (min === max) return values.map((value) => (value === null ? 0 : 0.5));
  return values.map((value) => (value === null ? 0 : (value - min) / (max - min)));
}

/**
 * 三因子等权打分(design/01 §5.3):recency 0.995^游戏小时龄 + importance 存储分 +
 * relevance 余弦相似度,各自 min-max 归一化后求和。纯函数,排序与明细(面板/trace)都靠它。
 */
export function scoreMemories(
  rows: CandidateRow[],
  currentGameMinutes: number,
): ScoredMemory[] {
  const recencyRaw = rows.map((row) =>
    RECENCY_DECAY_PER_HOUR **
    (Math.max(0, currentGameMinutes - (row.gameMinutes ?? 0)) / 60),
  );
  const recencyN = normalize(recencyRaw);
  const importanceN = normalize(rows.map((row) => row.importance));
  const relevanceN = normalize(rows.map((row) => row.relevance));
  return rows
    .map((row, i) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      importance: row.importance,
      gameMinutes: row.gameMinutes,
      createdAt: row.createdAt,
      score: recencyN[i]! + importanceN[i]! + relevanceN[i]!,
      factors: {
        recency: recencyN[i]!,
        importance: importanceN[i]!,
        relevance: row.relevance === null ? null : relevanceN[i]!,
      },
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
}

/** pgvector 文本入参:'[1,2,3]'(2048 维 ~40KB/查询,精确顺序扫,万条内亚毫秒) */
function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * 三因子检索:拉全量候选(SQL 内算余弦,不回传 2048 维向量)→ 归一化打分排序截断。
 * queryVector 缺省(或条目无向量)时 relevance 因子退化为 0,等价双因子排序。
 */
export async function retrieveMemories(
  handle: DbHandle,
  opts: {
    characterId: string;
    currentGameMinutes: number;
    queryVector?: number[];
    limit?: number;
  },
): Promise<ScoredMemory[]> {
  const relevance = opts.queryVector
    ? sql<number | null>`1 - (${memories.embedding} <=> ${vectorLiteral(opts.queryVector)}::vector)`
    : sql<number | null>`null`;
  const rows = await handle.db
    .select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      importance: memories.importance,
      gameMinutes: memories.gameMinutes,
      createdAt: memories.createdAt,
      relevance,
    })
    .from(memories)
    .where(eq(memories.characterId, opts.characterId));
  const scored = scoreMemories(
    rows.map((row) => ({ ...row, relevance: row.relevance === null ? null : Number(row.relevance) })),
    opts.currentGameMinutes,
  );
  return opts.limit !== undefined ? scored.slice(0, opts.limit) : scored;
}
