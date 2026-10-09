import { date, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  /** 托管状态(M10): { mode, policyText } | null=未托管;运行态真源在脑注册表,
   * 此列为路由变更写穿的恢复源(compiled 是可重建缓存,不落库) */
  hosting: jsonb('hosting'),
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

/** 认知 trace(agent-design §7.2):每个认知周期一行,明细 JSONB。
 * 采样: rule 层 continue 高频周期按采样记录,react 与模型调用周期全量。 */
export const cognitionTrace = pgTable('cognition_trace', {
  id: uuid('id').primaryKey().defaultRandom(),
  characterId: uuid('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  /** 角色内自增周期号 */
  seq: integer('seq').notNull(),
  /** 游戏时刻(纪元起分钟);真实时间=created_at */
  gameMinutes: integer('game_minutes').notNull(),
  /** 触发源: eventbus | threshold | schedule_block | day_rollover | reflection */
  triggerType: text('trigger_type').notNull(),
  /** 触发摘要+感知内容 */
  perception: jsonb('perception'),
  /** 检索命中(记忆 id+三因子得分) */
  retrieval: jsonb('retrieval'),
  /** 判定: { layer, conclusion, intent?, bubble? } */
  decision: jsonb('decision').notNull(),
  /** 模型调用明细数组: { slot, taskType, promptTokens, completionTokens, latencyMs, outputPreview } */
  calls: jsonb('calls'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
