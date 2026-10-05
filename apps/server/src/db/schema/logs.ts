import { index, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

/** 世界事件日志(M-G.1①):EventBus 事件异步落库,后台按角色/类型筛选 */
export const worldEvents = pgTable(
  'world_events',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    characterId: text('character_id'),
    tick: integer('tick').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('world_events_type_idx').on(table.type),
    index('world_events_character_idx').on(table.characterId),
    index('world_events_created_idx').on(table.createdAt),
  ],
);

/** 技术运行日志(M-G.1②):LLM 调用/异常/慢 tick 等服务端运行留痕 */
export const techLogs = pgTable(
  'tech_logs',
  {
    id: serial('id').primaryKey(),
    level: text('level').notNull(), // info | warn | error
    source: text('source').notNull(), // llm | http | tick ...
    message: text('message').notNull(),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tech_logs_level_idx').on(table.level),
    index('tech_logs_created_idx').on(table.createdAt),
  ],
);

/** 后台操作审计(M-G.1③):admin 写操作与登录留痕(操作者/方法/路径/状态码) */
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: serial('id').primaryKey(),
    username: text('username'),
    method: text('method').notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_username_idx').on(table.username),
    index('admin_audit_created_idx').on(table.createdAt),
  ],
);
