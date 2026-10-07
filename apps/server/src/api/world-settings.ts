import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { WorldRecipesView, WorldSettingsView } from '@sims/shared';
import { currentWorldParams, TIME_SCALES, validateBalanceOverrides } from '../config/balance.js';
import { env } from '../config/env.js';
import { verifyAdminToken } from '../utils/token.js';
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
 * 参数覆盖校验+应用(世界设置 POST 与后台 sys-config PUT 共用):
 * 校验(未知 key/越界均拒)→ sim.setParams → world.params 事件 → param-persist
 * 回写活跃世界 config.rules.params(存档真源)。返回错误文案,null=已应用。
 */
export function applySettingParams(
  sim: Simulation,
  params: Record<string, number>,
  reset: boolean,
): string | null {
  const errors = validateBalanceOverrides(params);
  if (errors.length > 0) {
    return errors.map((e) => `${e.key}: ${e.reason}`).join('; ');
  }
  sim.setParams(params, { reset });
  return null;
}

/**
 * 写操作准入(游览/操控分层):生产环境须 admin Bearer token(与后台登录同一
 * 凭证),防止公布页面后游客直调接口暂停世界;开发/测试环境豁免(本地走查与
 * 集成测试不便造 token)。读操作公开(游客 HUD/浏览需要)。
 */
export function canControlWorld(request: FastifyRequest): boolean {
  if (env.NODE_ENV !== 'production') return true;
  const header = request.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  return verifyAdminToken(token, env.MASTER_KEY).valid;
}

/**
 * /api/world/settings 常开控制通道(游戏内设置菜单,与 Lab 共用):
 * 暂停/倍率/世界参数/世界规则的生产可用读写口(不同于 /debug 仅 development 注册)。
 */
export function registerWorldSettingsRoutes(app: FastifyInstance, sim: Simulation): void {
  app.get('/api/world/settings', async () => settingsView(sim));

  /** 每世界配方公开读口(游客页配方文案/材料清单展示需要) */
  app.get('/api/world/recipes', async (): Promise<WorldRecipesView> => ({ recipes: sim.recipes }));

  app.post('/api/world/settings', async (request, reply) => {
    if (!canControlWorld(request)) {
      return await reply.code(401).send({ error: '浏览模式只读,登录管理员后可操作' });
    }
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return parseError(reply, issue ? `${issue.path.join('.')}: ${issue.message}` : '请求体不合法');
    }
    const { paused, timeScale, params, resetParams, rules } = parsed.data;
    // 参数先行(校验失败即 400 不动世界),其余 setter 无失败路径
    if (params !== undefined) {
      const error = applySettingParams(sim, params, resetParams === true);
      if (error !== null) {
        return parseError(reply, error);
      }
    }
    if (paused !== undefined) sim.setPaused(paused);
    if (timeScale !== undefined) sim.setTimeScale(timeScale);
    if (rules !== undefined && (rules.allowDeath !== undefined || rules.allowChat !== undefined)) {
      sim.setRules(rules);
    }
    return await reply.send(settingsView(sim));
  });
}
