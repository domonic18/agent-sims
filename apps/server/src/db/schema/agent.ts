import { date, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { worlds } from './world.js';

export const characters = pgTable('characters', {
  id: uuid('id').primaryKey().defaultRandom(),
  tier: text('tier').notNull(), // player | core | background
  name: text('name').notNull(),
  /** 所属世界(M3.6k);删除世界级联清理人物 */
  worldId: uuid('world_id').references(() => worlds.id, { onDelete: 'cascade' }),
  gender: text('gender').notNull().default('unspecified'), // male | female | unspecified
  persona: jsonb('persona').notNull().default({}), // 人设卡(traits/persona/modelSlot 预留)
  position: jsonb('position'), // { x, y } 当前世界坐标
  stats: jsonb('stats'), // { energy, score, coins }
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  characterId: uuid('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  gameDate: date('game_date').notNull(),
  plan: jsonb('plan').notNull(), // 日/小时/15 分钟三层计划
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dialogues = pgTable('dialogues', {
  id: uuid('id').primaryKey().defaultRandom(),
  speakerId: uuid('speaker_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  listenerId: uuid('listener_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
