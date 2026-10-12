import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { runIntent } from '../intents/execute.js';
import type { ClientRegistry } from '../socket/clients.js';
import {
  debugBuildFence,
  debugBuildPlace,
  debugRemoveBuiltFence,
  debugRemoveBuiltPlace,
} from '../world/construction.js';
import type { Simulation } from '../world/simulation.js';
import { generateTownMap } from '../world/worldgen/generate.js';

/** 单次手动推进上限,防止误操作打爆 tick */
const MAX_MANUAL_TICKS = 10_000;

const tickQuerySchema = z.object({
  n: z.coerce.number().int().min(1).max(MAX_MANUAL_TICKS).default(1),
});

const spawnBodySchema = z.object({
  id: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  name: z.string().min(1).optional(),
});

const reviveBodySchema = z.object({ characterId: z.string().min(1) });

// 建造层(S2批1):place 按图纸尺寸落建筑,fence/remove 显式矩形
const rectFields = {
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
} as const;

const builtBodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('place'),
    blueprintId: z.string().min(1),
    x: z.number().int(),
    y: z.number().int(),
  }),
  z.object({ op: z.literal('fence'), ...rectFields }),
  z.object({ op: z.literal('removePlace'), id: z.string().min(1) }),
  z.object({ op: z.literal('removeFence'), ...rectFields }),
]);

const storageBodySchema = z.object({
  itemId: z.string().min(1),
  count: z.number().int().min(1),
});

function parseError(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

/**
 * /debug/* 端点族:仅在 NODE_ENV=development 注册(app.ts 控制),生产自动关闭。
 * 全部直接读写 Simulation,供联调与 headless 对照;暂停/倍率/参数等运行时
 * 控制已迁移 /api/world/settings 常开通道,本族仅留开发工具。
 */
export function registerDebugRoutes(
  app: FastifyInstance,
  sim: Simulation,
  clients: ClientRegistry,
): void {
  app.get('/debug/state', async () => sim.snapshot());

  app.get('/debug/clients', async () => {
    const list = clients.list();
    return { total: list.length, clients: list };
  });

  app.get('/debug/worldgen', async (request) => {
    const q = request.query as { seed?: string; size?: string; density?: string; gameType?: string; manifestVersion?: string };
    const result = generateTownMap({
      seed: q.seed ?? 'demo',
      gameType: (q.gameType === 'survival' ? 'survival' : 'growth'),
      params: {
        size: q.size === 'medium' || q.size === 'large' ? q.size : 'small',
        density: q.density === 'sparse' || q.density === 'dense' ? q.density : 'normal',
      },
      manifestVersion: q.manifestVersion ?? 'debug',
    });
    return { report: result.report, map: result.map };
  });

  app.get('/debug/map', async () => ({
    width: sim.map.width,
    height: sim.map.height,
    ascii: sim.map.toAscii(),
    places: sim.map.places,
  }));

  app.post('/debug/tick', async (request, reply) => {
    const parsed = tickQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `n: ${issue.message}` : '查询参数不合法');
    }
    sim.advanceTicks(parsed.data.n);
    return await reply.send(sim.snapshot());
  });

  // 调试辅助:生成运行时角色(出生点须可行走);正式角色创建走 DB 层,后置
  app.post('/debug/spawn', async (request, reply) => {
    const parsed = spawnBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `${issue.path.join('.')}: ${issue.message}` : '请求体不合法');
    }
    try {
      sim.spawnCharacter(parsed.data.id, parsed.data.x, parsed.data.y, parsed.data.name);
    } catch (err) {
      return parseError(reply, err instanceof Error ? err.message : '生成角色失败');
    }
    return await reply.send(sim.snapshot());
  });

  // 复活(M3.6f):幽灵态角色满状态回归,供 Lab 页按钮调用
  app.post('/debug/revive', async (request, reply) => {
    const parsed = reviveBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `characterId: ${issue.message}` : '请求体不合法');
    }
    try {
      const character = sim.debugRevive(parsed.data.characterId);
      return await reply.send({
        ok: true,
        message: `${character.name} 已复活`,
        state: sim.snapshot(),
      });
    } catch (err) {
      return parseError(reply, err instanceof Error ? err.message : '复活失败');
    }
  });

  // intents 层雏形:与 socket 网关同一 runIntent 入口(校验/执行/错误归一一致)
  app.post('/debug/intent', async (request, reply) => {
    const result = runIntent(sim, request.body);
    if (!result.ok) {
      return parseError(reply, result.message);
    }
    return await reply.send({ ...result, state: sim.snapshot() });
  });

  // 建造层(S2批1):走完整评估链(选区/结构/连通),与批2 requestBuild 同门禁
  app.post('/debug/built', async (request, reply) => {
    const parsed = builtBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `${issue.path.join('.')}: ${issue.message}` : '请求体不合法');
    }
    const body = parsed.data;
    const result =
      body.op === 'place'
        ? debugBuildPlace(sim, body.blueprintId, body.x, body.y)
        : body.op === 'fence'
          ? debugBuildFence(sim, body)
          : body.op === 'removePlace'
            ? debugRemoveBuiltPlace(sim, body.id)
            : debugRemoveBuiltFence(sim, body);
    if (!result.ok) {
      return reply
        .code(400)
        .send({ error: result.issues[0]?.message ?? '建造被拒绝', issues: result.issues });
    }
    return await reply.send({ ok: true, built: sim.built });
  });

  // 单仓注料(S2批1 走查用;批2 接 store_item/take_item 分流)
  app.post('/debug/storage', async (request, reply) => {
    const parsed = storageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `${issue.path.join('.')}: ${issue.message}` : '请求体不合法');
    }
    const { itemId, count } = parsed.data;
    sim.storage[itemId] = (sim.storage[itemId] ?? 0) + count;
    return await reply.send({ ok: true, storage: sim.storage });
  });
}
