import {
  type AuditLogEntriesResponse,
  type TechLogEntriesResponse,
  type WorldEventEntriesResponse,
} from '@sims/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DbHandle } from '../db/client.js';
import { adminAuditLogs, techLogs, worldEvents } from '../db/schema/index.js';

const listQuerySchema = z.object({
  characterId: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  level: z.enum(['info', 'warn', 'error']).optional(),
  source: z.string().trim().min(1).optional(),
  username: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** M-G.1 三日志查询 API: 世界事件/技术运行/操作审计,统一分页协议 */
export function registerLogRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/logs/world-events', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const { characterId, type, page, pageSize } = parsed.data;
    const where = and(
      characterId ? eq(worldEvents.characterId, characterId) : undefined,
      type ? eq(worldEvents.type, type) : undefined,
    );
    const [countRow] = await handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(worldEvents)
      .where(where);
    const rows = await handle.db
      .select()
      .from(worldEvents)
      .where(where)
      .orderBy(desc(worldEvents.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const body: WorldEventEntriesResponse = {
      total: countRow!.total,
      page,
      pageSize,
      entries: rows.map((row) => ({
        id: row.id,
        type: row.type,
        characterId: row.characterId,
        tick: row.tick,
        payload: row.payload as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      })),
    };
    return await reply.send(body);
  });

  app.get('/api/admin/logs/tech-logs', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const { level, source, page, pageSize } = parsed.data;
    const where = and(
      level ? eq(techLogs.level, level) : undefined,
      source ? eq(techLogs.source, source) : undefined,
    );
    const [countRow] = await handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(techLogs)
      .where(where);
    const rows = await handle.db
      .select()
      .from(techLogs)
      .where(where)
      .orderBy(desc(techLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const body: TechLogEntriesResponse = {
      total: countRow!.total,
      page,
      pageSize,
      entries: rows.map((row) => ({
        id: row.id,
        level: row.level,
        source: row.source,
        message: row.message,
        detail: (row.detail ?? null) as Record<string, unknown> | null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
    return await reply.send(body);
  });

  app.get('/api/admin/logs/audit-logs', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const { username, page, pageSize } = parsed.data;
    const where = username ? eq(adminAuditLogs.username, username) : undefined;
    const [countRow] = await handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(adminAuditLogs)
      .where(where);
    const rows = await handle.db
      .select()
      .from(adminAuditLogs)
      .where(where)
      .orderBy(desc(adminAuditLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const body: AuditLogEntriesResponse = {
      total: countRow!.total,
      page,
      pageSize,
      entries: rows.map((row) => ({
        id: row.id,
        username: row.username,
        method: row.method,
        path: row.path,
        statusCode: row.statusCode,
        createdAt: row.createdAt.toISOString(),
      })),
    };
    return await reply.send(body);
  });
}
