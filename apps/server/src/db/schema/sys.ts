import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ModelProtocol, ModelSlot } from '@sims/shared';
import { characters } from './agent.js';

/** 全局应用设置(kv): UI 开关等轻量运行配置(后台写,公开端点按白名单键只读),
 * 首个消费键 ui.showModels——后续同类开关沿用本表,不再各开一列 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modelConfigs = pgTable('model_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  slot: text('slot').$type<ModelSlot>().notNull().unique(),
  protocol: text('protocol').$type<ModelProtocol>().notNull().default('openai'),
  baseUrl: text('base_url').notNull().default(''),
  model: text('model').notNull().default(''),
  apiKeyEncrypted: text('api_key_encrypted'), // AES-256-GCM 密文,null=未配置
  /** 最大输出 tokens 上限,null=用各任务内置默认(设置后覆盖该槽全部 chat 调用) */
  maxTokens: integer('max_tokens'),
  enabled: boolean('enabled').notNull().default(false),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  lastTestStatus: text('last_test_status').$type<'success' | 'failed'>(),
  lastTestError: text('last_test_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tokenUsage = pgTable('token_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  slot: text('slot').$type<ModelSlot>().notNull(),
  characterId: uuid('character_id').references(() => characters.id, {
    onDelete: 'set null',
  }),
  /** 归属世界(观测性: 跨世界数据隔离检索;无 FK,slot 级行可空) */
  worldId: uuid('world_id'),
  taskType: text('task_type').notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  cost: numeric('cost', { precision: 12, scale: 6 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(), // scrypt:salt:hash
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
