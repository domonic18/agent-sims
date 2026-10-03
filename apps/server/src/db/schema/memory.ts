import { integer, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';
import { characters } from './agent.js';

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  characterId: uuid('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // event | insight | dream | dialogue
  content: text('content').notNull(),
  importance: integer('importance').notNull().default(5), // 1~10,写入时打分
  // 维度 1536 与 embedding 模型绑定,Spike① 选型定稿后如变更需新迁移
  embedding: vector('embedding', { dimensions: 1536 }),
  consolidatedAt: timestamp('consolidated_at', { withTimezone: true }), // 入睡固化窗口写入
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
