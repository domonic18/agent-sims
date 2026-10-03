import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BALANCE } from '../config/balance.js';
import type { Simulation } from '../world/simulation.js';

/** 单次手动推进上限,防止误操作打爆 tick */
const MAX_MANUAL_TICKS = 10_000;

const tickQuerySchema = z.object({
  n: z.coerce.number().int().min(1).max(MAX_MANUAL_TICKS).default(1),
});

const pauseBodySchema = z.object({ paused: z.boolean() });

const scaleBodySchema = z.object({
  scale: z
    .number()
    .int()
    .refine((value): value is (typeof BALANCE.TIME_SCALES)[number] =>
      (BALANCE.TIME_SCALES as readonly number[]).includes(value), {
      message: `可用档位: ${BALANCE.TIME_SCALES.join('/')}`,
    }),
});

function parseError(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

/**
 * /debug/* 端点族:仅在 NODE_ENV=development 注册(app.ts 控制),生产自动关闭。
 * 全部直接读写 Simulation,供联调与 headless 对照。
 */
export function registerDebugRoutes(app: FastifyInstance, sim: Simulation): void {
  app.get('/debug/state', async () => sim.snapshot());

  app.post('/debug/tick', async (request, reply) => {
    const parsed = tickQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `n: ${issue.message}` : '查询参数不合法');
    }
    sim.advanceTicks(parsed.data.n);
    return await reply.send(sim.snapshot());
  });

  app.post('/debug/pause', async (request, reply) => {
    const parsed = pauseBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `paused: ${issue.message}` : '请求体不合法');
    }
    sim.setPaused(parsed.data.paused);
    return await reply.send(sim.snapshot());
  });

  app.post('/debug/time/scale', async (request, reply) => {
    const parsed = scaleBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `scale: ${issue.message}` : '请求体不合法');
    }
    sim.setTimeScale(parsed.data.scale);
    return await reply.send(sim.snapshot());
  });
}
