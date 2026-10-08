import { integer, jsonb, pgTable, real, text, timestamp, unique, uuid, vector } from 'drizzle-orm/pg-core';
import { characters } from './agent.js';

// pgvector 对 vector 类型的 HNSW/IVFFlat 索引上限 2000 维,embedding-3 为 2048 维,
// 故不做向量索引走精确检索(<=> 顺序扫,万条内亚毫秒);量级上来再迁 halfvec 表达式索引
export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  characterId: uuid('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // event | insight | dream | dialogue
  content: text('content').notNull(),
  importance: integer('importance').notNull().default(5), // 1~10,写入时打分
  // 维度 2048 与 embedding 槽模型(智谱 embedding-3)绑定,换模型需新迁移
  embedding: vector('embedding', { dimensions: 2048 }),
  gameMinutes: integer('game_minutes'), // 写入时游戏内分钟(recency 按游戏时间衰减,真实时间受暂停/倍率失真)
  consolidatedAt: timestamp('consolidated_at', { withTimezone: true }), // 入睡固化窗口写入
  sourceIds: jsonb('source_ids').$type<string[]>(), // 溯源(10-cognition §4.1): insight 引用的情景记忆 id 数组(≤8)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** L3 关系模型(10-cognition §4.2): 对每个熟人的第一人称叙事印象(affinity 数值层的解释层),
 * 夜间固化 relations 与重大交互即时惰性更新定点覆盖;行数=角色×熟人上限(12×12) */
export const characterImpressions = pgTable(
  'character_impressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    aboutId: uuid('about_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    gameMinutes: integer('game_minutes'), // 最近一次更新的游戏内分钟
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('character_impressions_pair_key').on(t.characterId, t.aboutId)],
);

/** L5 情绪(10-cognition §4.4): append-only 冲量流水——每行=一次事件打的情绪冲量,
 * 当前情绪=各行按半衰期衰减后求和(agents/mood.ts aggregateMood 纯函数),
 * 行本身即面板历史,重启零恢复成本 */
export const characterMoods = pgTable('character_moods', {
  id: uuid('id').primaryKey().defaultRandom(),
  characterId: uuid('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  delta: real('delta').notNull(), // 本次事件冲量 -1~1
  labels: jsonb('labels').$type<string[]>().notNull(), // 事件标签(倒下了/获救/做出成品…)
  gameMinutes: integer('game_minutes'), // 事件发生的游戏内分钟(衰减时序基准)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
