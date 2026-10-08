import { integer, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
