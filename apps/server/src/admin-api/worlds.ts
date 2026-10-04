import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  GENDERS,
  TRAIT_KEYS,
  WORLD_CHARACTER_LIMITS,
  type CreateWorldRequest,
  type WorldView,
} from '@sims/shared';
import { z } from 'zod';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characters, worldState, worlds } from '../db/schema/index.js';
import { requireAdmin } from './auth.js';

const characterSchema = z.object({
  name: z.string().trim().min(1, '人物名不能为空').max(20),
  gender: z.enum(GENDERS),
  traits: z.record(z.enum(TRAIT_KEYS), z.number().min(0).max(100)).optional(),
  persona: z.string().max(2000).optional(),
  modelSlot: z.string().max(40).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1, '世界名不能为空').max(40),
  characters: z
    .array(characterSchema)
    .min(WORLD_CHARACTER_LIMITS.min, `至少 ${WORLD_CHARACTER_LIMITS.min} 个人物`)
    .max(WORLD_CHARACTER_LIMITS.max, `至多 ${WORLD_CHARACTER_LIMITS.max} 个人物`),
});

function toView(row: typeof worlds.$inferSelect): WorldView {
  const config = row.config as CreateWorldRequest;
  return {
    id: row.id,
    name: row.name,
    status: row.status as WorldView['status'],
    characters: config.characters ?? [],
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

/** 简短角色 id(模拟层 Map key/前端配色哈希种子):8 位随机十六进制 */
function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

export function registerWorldRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/worlds', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const rows = await handle.db
      .select()
      .from(worlds)
      .orderBy(desc(worlds.createdAt));
    return await reply.send(rows.map(toView));
  });

  app.post('/api/admin/worlds', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue) {
        return await reply.code(400).send({ error: `${issue.path.join('.')}: ${issue.message}` });
      }
      return await reply.code(400).send({ error: '请求参数不合法' });
    }
    const config: CreateWorldRequest = parsed.data;
    // 出生点预检(防御):SPAWN_SPOTS 按序分配,不足或不可行走即拒绝,避免半开世界
    const spots = BALANCE.SPAWN_SPOTS.slice(0, config.characters.length);
    if (spots.length < config.characters.length) {
      return await reply.code(400).send({ error: '出生点不足,人物数量超出世界容量' });
    }
    for (const spot of spots) {
      if (!app.simulation.map.isWalkable(spot.x, spot.y)) {
        return await reply.code(500).send({ error: `出生点不可行走: (${spot.x},${spot.y})` });
      }
    }

    const [row] = await handle.db.transaction(async (tx) => {
      // 单活跃世界:旧 active 归档
      await tx
        .update(worlds)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(worlds.status, 'active'));
      return await tx.insert(worlds).values({ name: config.name, config }).returning();
    });
    if (!row) {
      return await reply.code(500).send({ error: '世界记录写入失败' });
    }

    // 重置模拟现场并按配置批量出生(DB 已落世界记录,sim 侧纯内存操作不再失败)
    app.simulation.reset();
    const simIds: string[] = [];
    for (const [index, character] of config.characters.entries()) {
      const spot = spots[index]!;
      const simId = shortId();
      simIds.push(simId);
      const created = app.simulation.spawnCharacter(simId, spot.x, spot.y, character.name);
      try {
        await handle.db.insert(characters).values({
          tier: 'core',
          name: character.name,
          worldId: row.id,
          gender: character.gender,
          persona: {
            simId,
            ...(character.traits ? { traits: character.traits } : {}),
            ...(character.persona ? { bio: character.persona } : {}),
            ...(character.modelSlot ? { modelSlot: character.modelSlot } : {}),
          },
          position: { x: created.x, y: created.y },
          stats: {
            energy: created.energy,
            happiness: created.happiness,
            coins: created.coins,
          },
        });
      } catch {
        // 人物档案落库失败不阻断世界创建(模拟层为权威状态);审计靠 worlds.config
      }
    }

    await handle.db
      .update(worldState)
      .set({ tick: 0, paused: false, timeScale: BALANCE.DEFAULT_TIME_SCALE, updatedAt: new Date() })
      .where(eq(worldState.id, 1));

    return await reply.code(201).send({ ...toView(row), simIds });
  });

  app.post('/api/admin/worlds/:id/close', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = request.params as { id: string };
    const [row] = await handle.db.select().from(worlds).where(eq(worlds.id, params.id)).limit(1);
    if (!row) {
      return await reply.code(404).send({ error: '世界不存在' });
    }
    if (row.status === 'active') {
      await handle.db
        .update(worlds)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(worlds.id, params.id));
      app.simulation.setPaused(true); // 保留现场冻结,便于观察归档前状态
    }
    const [fresh] = await handle.db.select().from(worlds).where(eq(worlds.id, params.id)).limit(1);
    return await reply.send(toView(fresh ?? row));
  });

  app.delete('/api/admin/worlds/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = request.params as { id: string };
    const [row] = await handle.db.select().from(worlds).where(eq(worlds.id, params.id)).limit(1);
    if (!row) {
      return await reply.code(404).send({ error: '世界不存在' });
    }
    await handle.db.delete(worlds).where(eq(worlds.id, params.id)); // characters 级联清理
    if (row.status === 'active') {
      app.simulation.reset(); // 删除活跃世界即清场,等待创建下一个
    }
    return await reply.send({ ok: true });
  });
}
