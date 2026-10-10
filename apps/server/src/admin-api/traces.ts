import {
  type CharacterListResponse,
  type CognitionTraceEntriesResponse,
  type CognitionTraceEntryView,
  type WantLifecycleResponse,
  type WorldEventEntryView,
} from '@sims/shared';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { innerState } from '../agents/cognition.js';
import type { DbHandle } from '../db/client.js';
import { cognitionTrace, worldEvents } from '../db/schema/index.js';
import type { Simulation } from '../world/simulation.js';

const listQuerySchema = z.object({
  characterId: z.string().trim().min(1).optional(),
  wantId: z.string().trim().min(1).optional(),
  layer: z.string().trim().min(1).optional(),
  conclusion: z.string().trim().min(1).optional(),
  fromGameMinutes: z.coerce.number().int().optional(),
  toGameMinutes: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 决策追溯 API(观测性): 认知 trace 分页查询 + want 全生命周期聚合 */
export function registerTraceRoutes(app: FastifyInstance, handle: DbHandle, sim: Simulation): void {
  app.get('/api/admin/characters', async (_request, reply) => {
    const body: CharacterListResponse = {
      characters: [...sim.characters.values()].map((c) => ({
        id: c.id,
        name: c.name,
        alive: c.alive,
      })),
    };
    return await reply.send(body);
  });

  app.get('/api/admin/logs/cognition-traces', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '查询参数不合法' });
    }
    const { characterId, wantId, layer, conclusion, fromGameMinutes, toGameMinutes, page, pageSize } =
      parsed.data;
    const where = and(
      characterId ? eq(cognitionTrace.characterId, characterId) : undefined,
      wantId ? eq(cognitionTrace.wantId, wantId) : undefined,
      layer ? sql`${cognitionTrace.decision}->>'layer' = ${layer}` : undefined,
      conclusion ? sql`${cognitionTrace.decision}->>'conclusion' = ${conclusion}` : undefined,
      fromGameMinutes !== undefined ? gte(cognitionTrace.gameMinutes, fromGameMinutes) : undefined,
      toGameMinutes !== undefined ? lte(cognitionTrace.gameMinutes, toGameMinutes) : undefined,
    );
    const [countRow] = await handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(cognitionTrace)
      .where(where);
    const rows = await handle.db
      .select()
      .from(cognitionTrace)
      .where(where)
      .orderBy(desc(cognitionTrace.createdAt), desc(cognitionTrace.gameMinutes))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const entries: CognitionTraceEntryView[] = rows.map((row) => ({
      id: row.id,
      characterId: row.characterId,
      worldId: row.worldId,
      seq: row.seq,
      gameMinutes: row.gameMinutes,
      trigger: row.triggerType,
      perception: (row.perception ?? null) as Record<string, unknown> | null,
      retrieval: (row.retrieval ?? null) as Record<string, unknown> | null,
      decision: row.decision as Record<string, unknown>,
      calls: (row.calls ?? null) as Array<Record<string, unknown>> | null,
      wantId: row.wantId,
      createdAt: row.createdAt.toISOString(),
    }));
    const body: CognitionTraceEntriesResponse = {
      total: countRow!.total,
      page,
      pageSize,
      entries,
    };
    return await reply.send(body);
  });

  /** want 全生命周期: 脑内在途快照 + 按 wantId 的全部 trace + 角色同时段事件流 */
  app.get('/api/admin/traces/wants/:characterId/:wantId', async (request, reply) => {
    const { characterId, wantId } = request.params as { characterId: string; wantId: string };
    const want = innerState.get(characterId)?.intents?.wants.find((w) => w.id === wantId) ?? null;
    const traces = await handle.db
      .select()
      .from(cognitionTrace)
      .where(and(eq(cognitionTrace.characterId, characterId), eq(cognitionTrace.wantId, wantId)))
      .orderBy(asc(cognitionTrace.gameMinutes), asc(cognitionTrace.createdAt));
    const anchorMin = want?.createdAtMin ?? traces[0]?.gameMinutes ?? null;
    // 终态 want 事件窗收口在半衰期;在途 want 一路追到当前时刻
    const endMin =
      want === null || want.status === 'pending' || want.status === 'doing'
        ? sim.clock.gameMinutes
        : (want.expiresAtMin ?? sim.clock.gameMinutes);
    const events =
      anchorMin === null
        ? []
        : await handle.db
            .select()
            .from(worldEvents)
            .where(
              and(
                eq(worldEvents.characterId, characterId),
                gte(worldEvents.tick, anchorMin - 30),
                lte(worldEvents.tick, endMin),
              ),
            )
            .orderBy(asc(worldEvents.tick), asc(worldEvents.id))
            .limit(200);
    const body: WantLifecycleResponse = {
      want:
        want === null
          ? null
          : {
              id: want.id,
              activityId: want.activityId,
              origin: want.origin,
              targetCharacterId: want.targetCharacterId ?? null,
              why: want.why,
              urgency: want.urgency,
              expiresAtMin: want.expiresAtMin ?? null,
              status: want.status,
              createdAtMin: want.createdAtMin,
            },
      traces: traces.map((row) => ({
        id: row.id,
        characterId: row.characterId,
        worldId: row.worldId,
        seq: row.seq,
        gameMinutes: row.gameMinutes,
        trigger: row.triggerType,
        perception: (row.perception ?? null) as Record<string, unknown> | null,
        retrieval: (row.retrieval ?? null) as Record<string, unknown> | null,
        decision: row.decision as Record<string, unknown>,
        calls: (row.calls ?? null) as Array<Record<string, unknown>> | null,
        wantId: row.wantId,
        createdAt: row.createdAt.toISOString(),
      })),
      events: events.map(
        (row): WorldEventEntryView => ({
          id: row.id,
          type: row.type,
          characterId: row.characterId,
          tick: row.tick,
          payload: row.payload as Record<string, unknown>,
          createdAt: row.createdAt.toISOString(),
        }),
      ),
    };
    return await reply.send(body);
  });
}
