import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  MODEL_SLOTS,
  TOKEN_USAGE_WINDOWS,
  type TokenUsageSummary,
  type TokenUsageTotals,
  type TokenUsageWindow,
} from '@sims/shared';
import { z } from 'zod';
import type { DbHandle } from '../db/client.js';
import { characters, tokenUsage } from '../db/schema/index.js';
import { requireAdmin } from './auth.js';

// 统计时区钉住管理员本地时区:UTC 容器里 date_trunc('day', now()) 会把「今日」算成北京时间 08:00 起
const STATS_TZ = 'Asia/Shanghai';
const TZ_MS = 8 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** 时区以 SQL 字面量内联(服务端常量,无注入面):参数绑定在 select/groupBy 重复内联时 PG 推断不出类型 */
const atStatsTz = (expr: SQL): SQL => sql`(${expr} AT TIME ZONE '${sql.raw(STATS_TZ)}')`;

const windowSchema = z.object({ window: z.enum(TOKEN_USAGE_WINDOWS).default('7d') });

const entriesQuerySchema = z.object({
  window: z.enum(TOKEN_USAGE_WINDOWS).default('7d'),
  slot: z.enum(MODEL_SLOTS).optional(),
  characterId: z.string().uuid().optional(),
  taskType: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function windowCond(window: TokenUsageWindow): SQL | undefined {
  switch (window) {
    case 'today':
      // 北京零点的绝对时刻:now→北京墙钟→截断到日→转回 timestamptz(date_trunc 直接吃 timestamptz 会按会话时区截断)
      return gte(
        tokenUsage.createdAt,
        sql`(date_trunc('day', now() AT TIME ZONE '${sql.raw(STATS_TZ)}') AT TIME ZONE '${sql.raw(STATS_TZ)}')`,
      );
    case '7d':
      return gte(tokenUsage.createdAt, sql`now() - interval '7 days'`);
    case '30d':
      return gte(tokenUsage.createdAt, sql`now() - interval '30 days'`);
    case 'all':
      return undefined;
  }
}

const totalsSelect = {
  promptTokens: sql<number>`coalesce(sum(${tokenUsage.promptTokens}), 0)::int`,
  completionTokens: sql<number>`coalesce(sum(${tokenUsage.completionTokens}), 0)::int`,
  calls: sql<number>`count(*)::int`,
};

function withTotal(row: {
  promptTokens: number;
  completionTokens: number;
  calls: number;
}): TokenUsageTotals {
  return { ...row, totalTokens: row.promptTokens + row.completionTokens };
}

/** 北京墙钟标签(桶 label 与补零循环共用同一坐标系:epoch+TZ_MS 渲染为 UTC 即墙钟) */
function beijingLabel(epochMs: number, hourly: boolean): string {
  const iso = new Date(epochMs + TZ_MS).toISOString();
  return hourly ? `${iso.slice(0, 13)}:00` : iso.slice(0, 10);
}

/** 补零出连续趋势桶(今日=北京时区近 24 小时,其余按北京日;all 自最早记录起,封顶 180 天) */
async function buildTrend(
  handle: DbHandle,
  window: TokenUsageWindow,
): Promise<TokenUsageSummary['trend']> {
  const hourly = window === 'today';
  const bucket = hourly
    ? atStatsTz(sql`date_trunc('hour', ${tokenUsage.createdAt})`)
    : atStatsTz(sql`date_trunc('day', ${tokenUsage.createdAt})`);
  // to_char 格式与 beijingLabel 输出严格一致(日桶无时间部分,键才能对上)
  const fmt = hourly ? sql`'YYYY-MM-DD"T"HH24:MI'` : sql`'YYYY-MM-DD'`;
  const rows = await handle.db
    .select({
      bucket: sql<string>`to_char(${bucket}, ${fmt})`,
      totalTokens: sql<number>`coalesce(sum(${tokenUsage.promptTokens} + ${tokenUsage.completionTokens}), 0)::int`,
      calls: sql<number>`count(*)::int`,
    })
    .from(tokenUsage)
    .where(windowCond(window))
    .groupBy(bucket)
    .orderBy(bucket);
  const byKey = new Map(rows.map((row) => [row.bucket, row]));

  const nowBeijing = Date.now() + TZ_MS;
  let startWall: number;
  if (hourly) {
    startWall = Math.floor(nowBeijing / HOUR_MS) * HOUR_MS - 23 * HOUR_MS;
  } else {
    const todayStart = Math.floor(nowBeijing / DAY_MS) * DAY_MS;
    if (window === 'all') {
      const first = rows[0]?.bucket.slice(0, 10);
      startWall = first ? Date.parse(`${first}T00:00:00+08:00`) : todayStart;
      startWall = Math.max(startWall, todayStart - 179 * DAY_MS);
    } else {
      startWall = todayStart - (window === '7d' ? 6 : 29) * DAY_MS;
    }
  }
  const step = hourly ? HOUR_MS : DAY_MS;
  const points: TokenUsageSummary['trend'] = [];
  for (let wall = startWall; wall <= nowBeijing; wall += step) {
    const key = beijingLabel(wall - TZ_MS, hourly);
    const hit = byKey.get(key);
    points.push({ bucket: key, totalTokens: hit?.totalTokens ?? 0, calls: hit?.calls ?? 0 });
  }
  return points;
}

export function registerTokenUsageRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/token-usage/summary', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = windowSchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: 'window 取值不合法' });
    }
    const query = parsed.data;
    const where = windowCond(query.window);

    const [kpiRow] = await handle.db
      .select({
        ...totalsSelect,
        activeCharacters: sql<number>`count(distinct ${tokenUsage.characterId})::int`,
      })
      .from(tokenUsage)
      .where(where);
    const totals = withTotal(kpiRow!);
    const kpi = {
      ...totals,
      avgTokensPerCall: totals.calls > 0 ? Math.round((totals.totalTokens / totals.calls) * 10) / 10 : 0,
      completionShare:
        totals.totalTokens > 0
          ? Math.round((totals.completionTokens / totals.totalTokens) * 1000) / 1000
          : 0,
      activeCharacters: kpiRow!.activeCharacters,
    };

    const bySlot = (
      await handle.db
        .select({ slot: tokenUsage.slot, ...totalsSelect })
        .from(tokenUsage)
        .where(where)
        .groupBy(tokenUsage.slot)
    )
      .map((row) => ({ ...withTotal(row), slot: row.slot }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    const byTaskType = (
      await handle.db
        .select({ taskType: tokenUsage.taskType, ...totalsSelect })
        .from(tokenUsage)
        .where(where)
        .groupBy(tokenUsage.taskType)
    )
      .map((row) => ({ ...withTotal(row), taskType: row.taskType }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    const byCharacter = (
      await handle.db
        .select({ characterId: tokenUsage.characterId, name: characters.name, ...totalsSelect })
        .from(tokenUsage)
        .leftJoin(characters, eq(characters.id, tokenUsage.characterId))
        .where(where)
        .groupBy(tokenUsage.characterId, characters.name)
    )
      .map((row) => ({ ...withTotal(row), characterId: row.characterId, name: row.name }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    const topCallRows = await handle.db
      .select({
        id: tokenUsage.id,
        slot: tokenUsage.slot,
        taskType: tokenUsage.taskType,
        characterId: tokenUsage.characterId,
        characterName: characters.name,
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        createdAt: tokenUsage.createdAt,
      })
      .from(tokenUsage)
      .leftJoin(characters, eq(characters.id, tokenUsage.characterId))
      .where(where)
      .orderBy(desc(sql`${tokenUsage.promptTokens} + ${tokenUsage.completionTokens}`))
      .limit(5);

    const summary: TokenUsageSummary = {
      window: query.window,
      trend: await buildTrend(handle, query.window),
      kpi,
      bySlot,
      byTaskType,
      byCharacter,
      topCalls: topCallRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
    return await reply.send(summary);
  });

  app.get('/api/admin/token-usage/entries', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = entriesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const query = parsed.data;
    const where = and(
      windowCond(query.window),
      query.slot ? eq(tokenUsage.slot, query.slot) : undefined,
      query.characterId ? eq(tokenUsage.characterId, query.characterId) : undefined,
      query.taskType ? eq(tokenUsage.taskType, query.taskType) : undefined,
    );
    const join = () =>
      handle.db
        .select({
          id: tokenUsage.id,
          slot: tokenUsage.slot,
          taskType: tokenUsage.taskType,
          characterId: tokenUsage.characterId,
          characterName: characters.name,
          promptTokens: tokenUsage.promptTokens,
          completionTokens: tokenUsage.completionTokens,
          createdAt: tokenUsage.createdAt,
        })
        .from(tokenUsage)
        .leftJoin(characters, eq(characters.id, tokenUsage.characterId));

    const [countRow] = await handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(tokenUsage)
      .leftJoin(characters, eq(characters.id, tokenUsage.characterId))
      .where(where);
    const rows = await join()
      .where(where)
      .orderBy(desc(tokenUsage.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return await reply.send({
      total: countRow!.total,
      page: query.page,
      pageSize: query.pageSize,
      entries: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
  });
}
