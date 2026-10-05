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

export const modelConfigs = pgTable('model_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  slot: text('slot').$type<ModelSlot>().notNull().unique(),
  protocol: text('protocol').$type<ModelProtocol>().notNull().default('openai'),
  baseUrl: text('base_url').notNull().default(''),
  model: text('model').notNull().default(''),
  apiKeyEncrypted: text('api_key_encrypted'), // AES-256-GCM 密文,null=未配置
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

/** 系统参数覆盖(单行表 id 恒为 1):overrides 仅存开放字段的非默认值,BALANCE 热调真源 */
export const sysConfigs = pgTable('sys_configs', {
  id: integer('id').primaryKey(),
  overrides: jsonb('overrides').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
