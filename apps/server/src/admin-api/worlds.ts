import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import {
  DEFAULT_WORLD_RULES,
  GENDERS,
  TRAIT_KEYS,
  WORLD_CHARACTER_LIMITS,
  WORLD_TIME_SCALES,
  WORLDGEN_DENSITIES,
  WORLDGEN_SIZES,
  type CreateWorldRequest,
  type TileMapDefinition,
  type WorldRules,
  type WorldTimeScale,
  type WorldView,
  type WorldgenReport,
} from '@sims/shared';
import { readManifestVersion } from '../assets/paths.js';
import { TileMap } from '../world/map.js';
import { generateTownMap } from '../world/worldgen/generate.js';
import { z } from 'zod';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characters, worldState, worlds } from '../db/schema/index.js';
import { requireAdmin } from './auth.js';

const characterSchema = z.object({
  name: z.string().trim().min(1, '人物名不能为空').max(20),
  gender: z.enum(GENDERS),
  traits: z.record(z.enum(TRAIT_KEYS), z.number().min(0).max(1)).optional(),
  persona: z.string().max(2000).optional(),
  modelSlot: z.string().max(40).optional(),
});

const rulesSchema = z.object({
  allowDeath: z.boolean(),
  allowChat: z.boolean(),
  initialTimeScale: z
    .number()
    .int()
    .refine((value): value is WorldTimeScale =>
      (WORLD_TIME_SCALES as readonly number[]).includes(value), {
      message: `可用档位: ${WORLD_TIME_SCALES.join('/')}`,
    }),
});

const worldgenSchema = z.object({
  seed: z
    .string()
    .regex(/^[0-9]{1,10}$/, '种子须为 1~10 位数字(同数字复现同图)')
    .optional(),
  gameType: z.literal('growth'),
  params: z.object({
    size: z.enum(WORLDGEN_SIZES),
    density: z.enum(WORLDGEN_DENSITIES),
  }),
});

const createSchema = z.object({
  name: z.string().trim().min(1, '世界名不能为空').max(40),
  characters: z
    .array(characterSchema)
    .min(WORLD_CHARACTER_LIMITS.min, `至少 ${WORLD_CHARACTER_LIMITS.min} 个人物`)
    .max(WORLD_CHARACTER_LIMITS.max, `至多 ${WORLD_CHARACTER_LIMITS.max} 个人物`),
  rules: rulesSchema.partial().optional(),
  worldgen: worldgenSchema.optional(),
});

/** 旧世界无 rules 或部分缺省时逐项兜底默认值 */
function normalizeRules(partial: Partial<WorldRules> | undefined): WorldRules {
  return {
    allowDeath: partial?.allowDeath ?? DEFAULT_WORLD_RULES.allowDeath,
    allowChat: partial?.allowChat ?? DEFAULT_WORLD_RULES.allowChat,
    initialTimeScale: partial?.initialTimeScale ?? DEFAULT_WORLD_RULES.initialTimeScale,
  };
}

function toView(row: typeof worlds.$inferSelect): WorldView {
  const config = row.config as CreateWorldRequest & { worldgenReport?: WorldgenReport };
  return {
    id: row.id,
    name: row.name,
    status: row.status as WorldView['status'],
    characters: config.characters ?? [],
    rules: normalizeRules(config.rules),
    ...(config.worldgen !== undefined
      ? {
          worldgen: {
            seed: config.worldgen.seed ?? '',
            gameType: config.worldgen.gameType,
            params: config.worldgen.params,
          },
          worldgenReport: config.worldgenReport,
        }
      : {}),
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

/** 生成地图出生点:自主街中心 BFS 收集前 N 个可行走格(静态 SPAWN_SPOTS 仅内置地图用) */
function generateSpawnSpots(map: TileMapDefinition, count: number): Array<{ x: number; y: number }> {
  const tm = TileMap.fromDefinition(map);
  const start = { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  if (!tm.isWalkable(start.x, start.y)) return [];
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const queue = [start];
  const spots: Array<{ x: number; y: number }> = [start];
  while (queue.length > 0 && spots.length < count) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !tm.isWalkable(nx, ny)) continue;
      seen.add(key);
      spots.push({ x: nx, y: ny });
      queue.push({ x: nx, y: ny });
      if (spots.length >= count) break;
    }
  }
  return spots.slice(0, count);
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

  app.post('/api/admin/worlds/preview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = worldgenSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
    }
    const seed = parsed.data.seed ?? String(randomInt(1, 2 ** 31));
    const result = generateTownMap({
      seed,
      gameType: parsed.data.gameType,
      params: parsed.data.params,
      manifestVersion: readManifestVersion(),
    });
    const samples = generateSpawnSpots(result.map, 3).map((spot) => [spot.x, spot.y] as const);
    return await reply.send({
      report: { ...result.report, seed },
      spawnSamples: samples,
    });
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
    const rules = normalizeRules(parsed.data.rules);
    // 随机世界:seed 缺省自动生成随机数;地图按 (seed,gameType,params,manifestVersion) 生成
    let mapDefinition: TileMapDefinition | null = null;
    let worldgenReport: WorldgenReport | undefined;
    if (parsed.data.worldgen !== undefined) {
      const seed = parsed.data.worldgen.seed ?? String(randomInt(1, 2 ** 31));
      const result = generateTownMap({
        seed,
        gameType: parsed.data.worldgen.gameType,
        params: parsed.data.worldgen.params,
        manifestVersion: readManifestVersion(),
      });
      mapDefinition = result.map;
      worldgenReport = result.report;
      parsed.data.worldgen = { ...parsed.data.worldgen, seed };
    }
    const config: CreateWorldRequest & { worldgenReport?: WorldgenReport } = {
      ...parsed.data,
      rules,
      ...(worldgenReport !== undefined ? { worldgenReport } : {}),
    };
    // 出生点:生成地图 BFS 动态收集;内置固定地图沿用静态 SPAWN_SPOTS
    const spots =
      mapDefinition !== null
        ? generateSpawnSpots(mapDefinition, config.characters.length)
        : BALANCE.SPAWN_SPOTS.slice(0, config.characters.length);
    if (spots.length < config.characters.length) {
      return await reply.code(400).send({ error: '出生点不足,人物数量超出世界容量' });
    }
    if (mapDefinition === null) {
      for (const spot of spots) {
        if (!app.simulation.map.isWalkable(spot.x, spot.y)) {
          return await reply.code(500).send({ error: `出生点不可行走: (${spot.x},${spot.y})` });
        }
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
    if (mapDefinition !== null) app.simulation.setMap(mapDefinition);
    app.simulation.rules = rules;
    app.simulation.timeScale = rules.initialTimeScale;
    const simIds: string[] = [];
    for (const [index, character] of config.characters.entries()) {
      const spot = spots[index]!;
      const simId = shortId();
      simIds.push(simId);
      const created = app.simulation.spawnCharacter(
        simId,
        spot.x,
        spot.y,
        character.name,
        character.traits,
      );
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
      .set({ tick: 0, paused: false, timeScale: rules.initialTimeScale, updatedAt: new Date() })
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
