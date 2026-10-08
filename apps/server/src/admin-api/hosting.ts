import type { HostingStateView } from '@sims/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hosting, schedule } from '../agents/cognition.js';
import { compilePolicy } from '../agents/slow-layer.js';
import type { Simulation } from '../world/simulation.js';
import { requireAdmin } from './auth.js';

const bodySchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['full', 'policy']).optional(),
  policyText: z.string().trim().max(2000).optional(),
});

function view(id: string): HostingStateView {
  const state = hosting.get(id);
  return {
    characterId: id,
    hosted: state !== undefined,
    mode: state?.mode ?? null,
    policyText: state?.policyText ?? null,
  };
}

function emitChanged(sim: Simulation, id: string): void {
  const state = hosting.get(id);
  sim.events.emit({
    type: 'character.hosting_changed',
    characterId: id,
    hosted: state !== undefined,
    mode: state?.mode ?? null,
    tick: sim.tick,
  });
}

/**
 * 托管切换(M4e):指令来源玩家⇄Agent 原子切换,世界状态零触碰。
 * policy 模式先落状态(编译完成前 compiled=null 只用原文兜底),异步编译完成后
 * 校验 policyText 未变才写缓存(防竞态);计划清空交泵按方针重规划。
 */
export function registerHostingRoutes(app: FastifyInstance, sim: Simulation): void {
  app.get('/api/admin/characters/:id/hosting', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    return await reply.send(view(id));
  });

  app.post('/api/admin/characters/:id/hosting', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: 'body 须为 { enabled, mode?, policyText? }' });
    }
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    const { enabled } = parsed.data;
    if (!enabled) {
      if (hosting.has(id)) {
        hosting.delete(id);
        emitChanged(sim, id);
      }
      return await reply.send(view(id));
    }
    const mode = parsed.data.mode ?? 'full';
    if (mode === 'policy') {
      const policyText = parsed.data.policyText ?? '';
      if (policyText === '') {
        return await reply.code(400).send({ error: '方针模式必须提供 policyText' });
      }
      const prev = hosting.get(id);
      const changed = prev?.mode !== 'policy' || prev.policyText !== policyText;
      hosting.set(id, {
        mode: 'policy',
        policyText,
        compiled: changed ? null : (prev?.compiled ?? null),
      });
      if (changed) {
        schedule.clear(id);
        void compilePolicy(app.llm, policyText).then((compiled) => {
          const cur = hosting.get(id);
          if (cur !== undefined && cur.mode === 'policy' && cur.policyText === policyText) {
            hosting.set(id, { ...cur, compiled });
          }
        });
      }
      emitChanged(sim, id);
      return await reply.send(view(id));
    }
    if (!hosting.has(id) || hosting.get(id)?.mode !== 'full') {
      hosting.set(id, { mode: 'full', policyText: null, compiled: null });
      emitChanged(sim, id);
    }
    return await reply.send(view(id));
  });
}
