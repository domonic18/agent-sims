import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { WorldSettingsView } from '@sims/shared';
import { currentWorldParams, TIME_SCALES, validateBalanceOverrides } from '../config/balance.js';
import type { Simulation } from '../world/simulation.js';

const updateBodySchema = z.object({
  paused: z.boolean().optional(),
  timeScale: z
    .number()
    .int()
    .refine((value): value is (typeof TIME_SCALES)[number] =>
      (TIME_SCALES as readonly number[]).includes(value), {
      message: `可用档位: ${TIME_SCALES.join('/')}`,
    })
    .optional(),
  /** 参数覆盖项(缺省键不变);resetParams=true 时先复位出厂默认再应用 */
  params: z.record(z.string(), z.number()).optional(),
  resetParams: z.boolean().optional(),
  rules: z
    .object({ allowDeath: z.boolean().optional(), allowChat: z.boolean().optional() })
    .optional(),
});

function parseError(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

function settingsView(sim: Simulation): WorldSettingsView {
  return {
    paused: sim.paused,
    timeScale: sim.timeScale,
    params: currentWorldParams(),
    rules: {
      allowDeath: sim.rules.allowDeath,
      allowChat: sim.rules.allowChat,
      initialTimeScale: sim.rules.initialTimeScale,
    },
  };
}

/**
 * /api/world/settings 常开控制通道(游戏内设置菜单,与 Lab 共用):
 * 暂停/倍率/世界参数/世界规则的生产可用读写口(不同于 /debug 仅 development 注册)。
 * 无鉴权与 socket intent 通道暴露面一致(单用户沙盒);多用户化时在此加 token 收口。
 */
export function registerWorldSettingsRoutes(app: FastifyInstance, sim: Simulation): void {
  app.get('/api/world/settings', async () => settingsView(sim));

  app.post('/api/world/settings', async (request, reply) => {
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `${issue.path.join('.')}: ${issue.message}` : '请求体不合法');
    }
    const { paused, timeScale, params, resetParams, rules } = parsed.data;
    if (params !== undefined) {
      const errors = validateBalanceOverrides(params);
      if (errors.length > 0) {
        return parseError(reply, errors.map((e) => `${e.key}: ${e.reason}`).join('; '));
      }
    }
    if (paused !== undefined) sim.setPaused(paused);
    if (timeScale !== undefined) sim.setTimeScale(timeScale);
    if (params !== undefined) sim.setParams(params, { reset: resetParams === true });
    if (rules !== undefined && (rules.allowDeath !== undefined || rules.allowChat !== undefined)) {
      sim.setRules(rules);
    }
    return await reply.send(settingsView(sim));
  });
}
