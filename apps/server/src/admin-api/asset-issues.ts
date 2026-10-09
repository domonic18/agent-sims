import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ASSET_ISSUE_SCOPES, ASSET_ISSUE_STATUSES, type AssetIssueView } from '@sims/shared';
import { z } from 'zod';
import type { DbHandle } from '../db/client.js';
import { assetIssues } from '../db/schema/index.js';

/**
 * 素材问题单 CRUD(UI-2 报错闭环):游戏内信息卡/动画演示器/后台审查页三处上报,
 * open 态按 dedupe_key 幂等收敛(同对象重复上报返回同一单),resolve/reopen 流转。
 */

const issueCreateSchema = z.object({
  scope: z.enum(ASSET_ISSUE_SCOPES),
  refSlug: z.string().trim().min(1, 'refSlug 不能为空').max(80),
  refId: z.number().int().positive().nullable().optional(),
  context: z.record(z.string(), z.unknown()).nullable().optional(),
  note: z.string().trim().min(1).max(300).nullable().optional(),
});

const issuePatchSchema = z.object({
  status: z.enum(ASSET_ISSUE_STATUSES),
});

function toView(row: typeof assetIssues.$inferSelect): AssetIssueView {
  return {
    id: row.id,
    scope: row.scope,
    refSlug: row.refSlug,
    refId: row.refId,
    context: row.context ?? null,
    note: row.note ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt !== null ? row.resolvedAt.toISOString() : null,
  };
}

function parseError(reply: FastifyReply, message: string): null {
  void reply.code(400).send({ error: message });
  return null;
}

export function registerAssetIssueRoutes(app: FastifyInstance, handle: DbHandle): void {
  const { db } = handle;

  app.post('/api/admin/asset-issues', async (request, reply) => {
    const parsed = issueCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return parseError(reply, parsed.error.issues[0]?.message ?? '请求体不合法');
    }
    const { scope, refSlug, refId, context, note } = parsed.data;
    // 幂等键:context.key 由上报方给出粒度(动画=组/向,素材=kind),缺省收敛到对象级
    const contextKey = typeof context?.key === 'string' && context.key !== '' ? context.key : '';
    const dedupeKey = `${scope}:${refSlug}${contextKey !== '' ? `:${contextKey}` : ''}`;
    const inserted = await db
      .insert(assetIssues)
      .values({ scope, refSlug, refId: refId ?? null, context: context ?? null, note: note ?? null, dedupeKey })
      .onConflictDoNothing({ target: assetIssues.dedupeKey, where: sql`status = 'open'` })
      .returning();
    if (inserted.length > 0) return reply.code(201).send(toView(inserted[0]!));
    const existing = await db
      .select()
      .from(assetIssues)
      .where(and(eq(assetIssues.dedupeKey, dedupeKey), eq(assetIssues.status, 'open')))
      .limit(1);
    if (existing.length === 0) return parseError(reply, '问题单状态异常,请重试');
    return reply.send(toView(existing[0]!));
  });

  app.get('/api/admin/asset-issues', async (request) => {
    const query = request.query as { status?: string; scope?: string; refSlug?: string };
    const conditions = [];
    if (query.status !== undefined && query.status !== '') {
      conditions.push(eq(assetIssues.status, query.status as 'open' | 'resolved'));
    }
    if (query.scope !== undefined && query.scope !== '') {
      conditions.push(eq(assetIssues.scope, query.scope as 'asset' | 'anim'));
    }
    if (query.refSlug !== undefined && query.refSlug !== '') {
      conditions.push(eq(assetIssues.refSlug, query.refSlug));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(assetIssues)
      .where(where)
      .orderBy(desc(assetIssues.id))
      .limit(500);
    return { total: rows.length, items: rows.map(toView) };
  });

  app.patch('/api/admin/asset-issues/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = issuePatchSchema.safeParse(request.body);
    if (!parsed.success) return parseError(reply, parsed.error.issues[0]?.message ?? '请求体不合法');
    // open 槽位按 dedupe 唯一(partial unique index):重开旧单前先确认没有更新的 open 单
    if (parsed.data.status === 'open') {
      const target = await db
        .select({ dedupeKey: assetIssues.dedupeKey })
        .from(assetIssues)
        .where(eq(assetIssues.id, id))
        .limit(1);
      if (target.length === 0) return parseError(reply, '问题单不存在');
      const clash = await db
        .select({ id: assetIssues.id })
        .from(assetIssues)
        .where(
          and(
            eq(assetIssues.dedupeKey, target[0]!.dedupeKey),
            eq(assetIssues.status, 'open'),
          ),
        );
      if (clash.some((row) => row.id !== id)) {
        return parseError(reply, `该对象已有 open 单(#${clash.find((row) => row.id !== id)!.id}),先处理它或保持本单已解决`);
      }
    }
    const updated = await db
      .update(assetIssues)
      .set({
        status: parsed.data.status,
        resolvedAt: parsed.data.status === 'resolved' ? new Date() : null,
      })
      .where(eq(assetIssues.id, id))
      .returning();
    if (updated.length === 0) return parseError(reply, '问题单不存在');
    return reply.send(toView(updated[0]!));
  });
}
