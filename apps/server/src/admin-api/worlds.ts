import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_WORLD_RULES,
  GAME_TYPES,
  GENDERS,
  TRAIT_KEYS,
  WORLD_CHARACTER_LIMITS,
  WORLD_TIME_SCALES,
  WORLDGEN_DENSITIES,
  WORLDGEN_SIZES,
  cloneRecipes,
  defaultRecipes,
  validateRecipes,
  type CreateWorldRequest,
  type TileMapDefinition,
  type WorldCharacterConfig,
  type WorldRules,
  type WorldTimeScale,
  type WorldView,
  type WorldgenReport,
} from '@sims/shared';
import { publishTarget, readManifestVersion } from '../assets/paths.js';
import { restoreHostingFromDb } from './hosting.js';
import { restoreLatestArchive } from './world-archives.js';
import { TileMap } from '../world/map.js';
import { generateTownMap } from '../world/worldgen/generate.js';
import { DECOR_POOLS } from '../world/worldgen/blueprint.js';
import { z } from 'zod';
import { applyWorldParams, BALANCE, validateBalanceOverrides } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characters, worldState, worlds } from '../db/schema/index.js';

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
  params: z.record(z.string(), z.number()).optional(),
});

const worldgenSchema = z.object({
  seed: z
    .string()
    .regex(/^[0-9]{1,10}$/, '种子须为 1~10 位数字(同数字复现同图)')
    .optional(),
  gameType: z.enum(GAME_TYPES),
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

/** 旧世界无 rules 或部分缺省时逐项兜底默认值;params 缺省=全默认 */
function normalizeRules(partial: Partial<WorldRules> | undefined): WorldRules {
  return {
    allowDeath: partial?.allowDeath ?? DEFAULT_WORLD_RULES.allowDeath,
    allowChat: partial?.allowChat ?? DEFAULT_WORLD_RULES.allowChat,
    initialTimeScale: partial?.initialTimeScale ?? DEFAULT_WORLD_RULES.initialTimeScale,
    ...(partial?.params !== undefined ? { params: partial.params } : {}),
    ...(partial?.recipes !== undefined ? { recipes: partial.recipes } : {}),
  };
}

function toView(row: typeof worlds.$inferSelect): WorldView {
  const config = row.config as CreateWorldRequest & {
    worldgenReport?: WorldgenReport;
    map?: TileMapDefinition;
  };
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

/**
 * 发布产物 manifest → worldgen 素材池(素材库随机选材):
 * - {domain}/{kind}:域分键家具池(室内家具与户外道具互不混)
 * - theme/{slug}@{maxTiles}:主题道具池(户外开放场所与室内主题角装饰,按占地上限预过滤)
 * - decor/{slot}:户外装饰池(DECOR_POOLS 同名;立式限宽 ≤2 格,贴地限 1×1,wreck 宽件 ≤4)
 * sizes:装饰 slug → sprite 占地格数(solid 装饰转 blockedRect 用)
 */
function loadAssetsByKind(): {
  pool: Record<string, string[]>;
  sizes: Record<string, readonly [number, number]>;
} | undefined {
  try {
    const raw = JSON.parse(readFileSync(path.join(publishTarget(), 'manifest.json'), 'utf8')) as {
      assets?: Array<{
        domain: string;
        categorySlug: string;
        themeSlug?: string;
        slug: string;
        gridW: number;
        gridH: number;
      }>;
    };
    const THEME_TILE_CAPS = [1, 2, 4] as const;
    // 拼接件(modular/场地线 line)是地形拼图,单独摆放观感差,不入主题/装饰池
    const DECOR_KINDS: Record<string, readonly string[]> = {
      [DECOR_POOLS.tree]: ['tree'],
      [DECOR_POOLS.bush]: ['bush', 'flower-bush', 'bush-potted'],
      [DECOR_POOLS.bench]: ['bench'],
      [DECOR_POOLS.street]: ['hydrant', 'sign', 'mailbox', 'trashbin', 'barrel'],
      [DECOR_POOLS.lamp]: ['street-lamp'],
      [DECOR_POOLS.flat]: ['flowers', 'grass-tufts', 'stone'],
      [DECOR_POOLS.wreck]: ['car-wreck', 'electric-pole', 'barrier', 'sidewalk-obstacle'],
    };
    const decorMembers: Record<string, Array<{ slug: string; gridW: number; gridH: number }>> = {};
    const pool: Record<string, string[]> = {};
    const sizes: Record<string, readonly [number, number]> = {};
    for (const asset of raw.assets ?? []) {
      (pool[`${asset.domain}/${asset.categorySlug}`] ??= []).push(asset.slug);
      const modular = asset.slug.includes('modular') || asset.slug.includes('-line-');
      if (
        (asset.domain === 'outdoor' || asset.domain === 'indoor') &&
        asset.themeSlug !== undefined &&
        !modular
      ) {
        const tiles = asset.gridW * asset.gridH;
        for (const cap of THEME_TILE_CAPS) {
          if (tiles <= cap) (pool[`theme/${asset.themeSlug}@${cap}`] ??= []).push(asset.slug);
        }
      }
      if (asset.domain === 'outdoor' && !modular) {
        for (const [poolKey, kinds] of Object.entries(DECOR_KINDS)) {
          if (kinds.includes(asset.categorySlug)) (decorMembers[poolKey] ??= []).push(asset);
        }
      }
    }
    for (const [poolKey, members] of Object.entries(decorMembers)) {
      const flat = poolKey === DECOR_POOLS.flat;
      const wide = poolKey === DECOR_POOLS.wreck; // 残骸/电线杆等宽件(solid 占地)
      const ok = members.filter((a) =>
        flat ? a.gridW === 1 && a.gridH === 1 : a.gridW <= (wide ? 4 : 2)
      );
      if (ok.length > 0) {
        (pool[poolKey] ??= []).push(...ok.map((a) => a.slug));
        for (const a of ok) sizes[a.slug] = [a.gridW, a.gridH];
      }
    }
    return { pool, sizes };
  } catch {
    return undefined;
  }
}

/** worldgen 输入的素材参数包(池 + solid 占地尺寸;manifest 缺省时全缺省,同参同图) */
function loadAssetInput(): {
  assetsByKind?: Record<string, string[]>;
  assetSizes?: Record<string, readonly [number, number]>;
} {
  const pools = loadAssetsByKind();
  return pools === undefined ? {} : { assetsByKind: pools.pool, assetSizes: pools.sizes };
}

/** 生成地图出生点:自地图中心环形扩散找最近可行走格作 BFS 起点(随机撒放后中心可能被场所占据),
 * 再从该点 BFS 收集前 N 个可行走格(静态 SPAWN_SPOTS 仅内置地图用) */
function generateSpawnSpots(map: TileMapDefinition, count: number): Array<{ x: number; y: number }> {
  const tm = TileMap.fromDefinition(map);
  const start = nearestWalkable(tm, Math.floor(map.width / 2), Math.floor(map.height / 2));
  if (start === null) return [];
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

/** 曼哈顿环扩散:距 (cx,cy) 切比雪夫半径从小到大,首个界内可行走格 */
function nearestWalkable(
  tm: TileMap,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  for (let r = 0; r <= Math.max(tm.width, tm.height); r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= tm.width || y >= tm.height) continue;
        if (tm.isWalkable(x, y)) return { x, y };
      }
    }
  }
  return null;
}


/**
 * 启动恢复(C4):进程重启后按 active 世界的 config.map 复原地图现场
 * (同种子可重生成,但落库直读免重算且与创建时严格一致);
 * 无 active/旧世界无 map(内置固定地图)/定义非法 → 保持内置地图,世界可用性优先。
 * C8 起任意地图形态下有档即灌最近一档(角色/数值/时钟现场,paused/timeScale 按存档),
 * 无档维持冻结空场待角色创建。
 */
export async function restoreActiveWorld(app: FastifyInstance, handle: DbHandle): Promise<void> {
  const [row] = await handle.db
    .select()
    .from(worlds)
    .where(eq(worlds.status, 'active'))
    .orderBy(desc(worlds.createdAt))
    .limit(1);
  if (!row) return;
  const config = row.config as CreateWorldRequest & { map?: TileMapDefinition };
  if (config.map !== undefined) {
    try {
      TileMap.fromDefinition(config.map); // 先验定义合法性(非法即走兜底)
      const rules = normalizeRules(config.rules);
      app.simulation.reset();
      app.simulation.setMap(config.map);
      app.simulation.gameType = config.worldgen?.gameType ?? 'growth';
      app.simulation.rules = rules;
      applyWorldParams(rules.params);
      // 每世界配方恢复(旧世界无存档或校验不过→出厂默认,可用性优先)
      app.simulation.recipes =
        rules.recipes !== undefined && validateRecipes(rules.recipes).length === 0
          ? cloneRecipes(rules.recipes)
          : defaultRecipes();
      app.simulation.timeScale = rules.initialTimeScale;
    } catch {
      // 地图定义非法(协议变更/损坏):静默回内置地图
      return;
    }
  }
  // 有档灌最近一档(restoreArchive 连带 rules/params/recipes/gameType/时钟),
  // 角色就位后再恢复托管状态(M10);无档冻结空场(内置地图世界出厂态+冻结,与 C4 行为一致)
  if (await restoreLatestArchive(app, handle, row.id)) {
    await restoreHostingFromDb(app, handle, row.id);
  } else {
    app.simulation.setPaused(true);
  }
}

export function registerWorldRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/worlds', async (request, reply) => {
    const rows = await handle.db
      .select()
      .from(worlds)
      .orderBy(desc(worlds.createdAt));
    // 活跃世界名单以 characters 表为准:动态加人只落库不改 config,运行态须实时可见
    const active = rows.find((row) => row.status === 'active');
    const roster = active
      ? await handle.db.select().from(characters).where(eq(characters.worldId, active.id))
      : [];
    return await reply.send(
      rows.map((row) => {
        if (row.id !== active?.id) return toView(row);
        return {
          ...toView(row),
          characters: roster.map((c) => {
            const persona = c.persona as {
              traits?: WorldCharacterConfig['traits'];
              bio?: string;
              modelSlot?: string;
            };
            return {
              name: c.name,
              gender: c.gender as WorldCharacterConfig['gender'],
              ...(persona.traits !== undefined ? { traits: persona.traits } : {}),
              ...(persona.bio !== undefined ? { persona: persona.bio } : {}),
              ...(persona.modelSlot !== undefined ? { modelSlot: persona.modelSlot } : {}),
            };
          }),
        };
      }),
    );
  });

  app.post('/api/admin/worlds/preview', async (request, reply) => {
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
      // 与创建路径同参:themePick 槽位影响 rng 消耗流,缺池会致同种子预览/成图分叉
      ...loadAssetInput(),
    });
    const samples = generateSpawnSpots(result.map, 3).map((spot) => [spot.x, spot.y] as const);
    return await reply.send({
      report: { ...result.report, seed },
      spawnSamples: samples,
    });
  });

  app.post('/api/admin/worlds', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue) {
        return await reply.code(400).send({ error: `${issue.path.join('.')}: ${issue.message}` });
      }
      return await reply.code(400).send({ error: '请求参数不合法' });
    }
    // 居民名世界内唯一:表单内两两查重(zod 已 trim)
    const names = parsed.data.characters.map((c) => c.name);
    const dupeName = names.find((name, index) => names.indexOf(name) !== index);
    if (dupeName !== undefined) {
      return await reply.code(400).send({ error: `居民名重复: ${dupeName}` });
    }
    const rules = normalizeRules(parsed.data.rules);
    // 每世界配方冻结(v1 不收客户端配方,出厂默认深拷贝入档;admin 配方页后续可编辑)
    rules.recipes = defaultRecipes();
    // 世界参数目录校验(zod 只保证数字 record;越界/非整数/未知 key 在此拒绝)
    const paramErrors = validateBalanceOverrides(rules.params ?? {});
    if (paramErrors.length > 0) {
      return await reply.code(400).send({
        error: paramErrors.map((e) => `${e.key}: ${e.reason}`).join('; '),
      });
    }
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
        ...loadAssetInput(),
      });
      mapDefinition = result.map;
      worldgenReport = result.report;
      parsed.data.worldgen = { ...parsed.data.worldgen, seed };
    }
    const config: CreateWorldRequest & {
      worldgenReport?: WorldgenReport;
      map?: TileMapDefinition;
    } = {
      ...parsed.data,
      rules,
      ...(worldgenReport !== undefined ? { worldgenReport } : {}),
      // 地图定义落库(C4):server 重启后按 active 世界恢复现场(角色恢复见 follow-up)
      ...(mapDefinition !== null ? { map: mapDefinition } : {}),
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
    app.simulation.gameType = parsed.data.worldgen?.gameType ?? 'growth';
    app.simulation.rules = rules;
    applyWorldParams(rules.params); // 先复位出厂默认再应用本世界覆盖,消除上一世界残留
    app.simulation.setRecipes(rules.recipes!); // 建世界冻结的配方快照灌入运行时
    app.simulation.timeScale = rules.initialTimeScale;
    const simIds: string[] = [];
    for (const [index, character] of config.characters.entries()) {
      const spot = spots[index]!;
      // 单一 id 贯穿:sim 内存世界与 characters 表共用同一 uuid,事件流 id 即表主键
      const simId = randomUUID();
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
          id: simId,
          tier: 'core',
          name: character.name,
          worldId: row.id,
          gender: character.gender,
          persona: {
            ...(character.traits ? { traits: character.traits } : {}),
            ...(character.persona ? { bio: character.persona } : {}),
            ...(character.modelSlot ? { modelSlot: character.modelSlot } : {}),
          },
          position: { x: created.x, y: created.y },
          stats: {
            energy: created.energy,
            score: created.score,
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

  // 运行中世界动态加居民(C5):body 复用创建时的 character 段;下一 tick 快照自动同步(web 零改动)
  app.post('/api/admin/characters', async (request, reply) => {
    const parsed = characterSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
    }
    const [row] = await handle.db
      .select()
      .from(worlds)
      .where(eq(worlds.status, 'active'))
      .orderBy(desc(worlds.createdAt))
      .limit(1);
    if (!row) {
      return await reply.code(400).send({ error: '当前没有运行中的世界' });
    }
    // 居民名世界内唯一:DB 与内存模拟层双侧查重(落库失败被吞时 sim 仍为权威)
    const [dupe] = await handle.db
      .select({ id: characters.id })
      .from(characters)
      .where(and(eq(characters.worldId, row.id), eq(characters.name, parsed.data.name)))
      .limit(1);
    if (
      dupe !== undefined ||
      [...app.simulation.characters.values()].some((c) => c.name === parsed.data.name)
    ) {
      return await reply.code(400).send({ error: '居民名与现有居民重复' });
    }
    if (app.simulation.characters.size + 1 > WORLD_CHARACTER_LIMITS.max) {
      return await reply.code(400).send({
        error: `居民数已达上限 (${WORLD_CHARACTER_LIMITS.max}),无法再添加`,
      });
    }
    // 出生点:生成地图 BFS 收集可行走格,内置地图静态点表;避开已占用格
    const config = row.config as CreateWorldRequest & { map?: TileMapDefinition };
    const occupied = new Set(
      [...app.simulation.characters.values()].map((c) => `${c.x},${c.y}`),
    );
    const candidates =
      config.map !== undefined
        ? generateSpawnSpots(config.map, app.simulation.characters.size + 1)
        : BALANCE.SPAWN_SPOTS;
    const spot = candidates.find((s) => !occupied.has(`${s.x},${s.y}`));
    if (spot === undefined) {
      return await reply.code(500).send({ error: '无可用的出生点' });
    }
    const simId = randomUUID(); // 与表行同 id(单一 id 贯穿)
    const created = app.simulation.spawnCharacter(
      simId,
      spot.x,
      spot.y,
      parsed.data.name,
      parsed.data.traits,
    );
    try {
      await handle.db.insert(characters).values({
        id: simId,
        tier: 'core',
        name: parsed.data.name,
        worldId: row.id,
        gender: parsed.data.gender,
        persona: {
          ...(parsed.data.traits ? { traits: parsed.data.traits } : {}),
          ...(parsed.data.persona ? { bio: parsed.data.persona } : {}),
          ...(parsed.data.modelSlot ? { modelSlot: parsed.data.modelSlot } : {}),
        },
        position: { x: created.x, y: created.y },
        stats: {
          energy: created.energy,
          score: created.score,
          coins: created.coins,
        },
      });
    } catch {
      // 人物档案落库失败不阻断入场(模拟层为权威状态)
    }
    return await reply.code(201).send({ id: simId, name: created.name, x: created.x, y: created.y });
  });

  app.post('/api/admin/worlds/:id/close', async (request, reply) => {
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
