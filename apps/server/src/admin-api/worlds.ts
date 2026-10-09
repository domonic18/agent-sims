import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  cloneRecipes,
  defaultRecipes,
  validateRecipes,
  type CreateWorldRequest,
  type TileMapDefinition,
  type WorldCharacterConfig,
} from '@sims/shared';
import { restoreHostingFromDb } from './hosting.js';
import { restoreLatestArchive } from './world-archives.js';
import { TileMap } from '../world/map.js';
import { applyWorldParams } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characters, worlds } from '../db/schema/index.js';
import {
  normalizeRules,
  registerWorldCreateRoutes,
  toView,
} from './worlds-create.js';
import { registerWorldOpsRoutes } from './worlds-ops.js';

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

/** 域路由表:列表查询留本文件,建世界/动态加居民与关闭/删除分域挂载 */
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

  registerWorldCreateRoutes(app, handle);
  registerWorldOpsRoutes(app, handle);
}
