import type { HostingStateView } from '@sims/shared';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { hosting, schedule, type HostingState } from '../agents/cognition.js';
import { compilePolicy } from '../agents/slow-layer.js';
import type { DbHandle } from '../db/client.js';
import { characters } from '../db/schema/index.js';
import type { Simulation } from '../world/simulation.js';

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

/** 托管状态写穿(M10):路由变更后落 characters.hosting,重启经启动恢复灌回;
 * compiled 是可重建缓存不落库。fire-and-forget:失败仅记日志,下一笔变更会重写 */
export function persistHosting(
  app: FastifyInstance,
  handle: DbHandle,
  id: string,
  state: HostingState | null,
): void {
  void handle.db
    .update(characters)
    .set({ hosting: state === null ? null : { mode: state.mode, policyText: state.policyText } })
    .where(eq(characters.id, id))
    .catch((err: unknown) => {
      app.log.warn({ msg: 'hosting persist failed', characterId: id, err });
    });
}

/** 启动恢复(M10):characters.hosting 灌回脑注册表(只灌 sim 里实际存在的角色),
 * 须在存档恢复(角色就位)之后调用;policy 异步补编译,完成前按方针原文兜底,
 * 防竞态校验与路由层一致(policyText 变过即弃用) */
export async function restoreHostingFromDb(
  app: FastifyInstance,
  handle: DbHandle,
  worldId: string,
): Promise<void> {
  const rows = await handle.db
    .select({ id: characters.id, hosting: characters.hosting })
    .from(characters)
    .where(and(eq(characters.worldId, worldId), isNotNull(characters.hosting)));
  for (const row of rows) {
    if (!app.simulation.characters.has(row.id)) continue;
    const saved = row.hosting as { mode?: unknown; policyText?: unknown } | null;
    if (saved === null || (saved.mode !== 'full' && saved.mode !== 'policy')) continue;
    const state: HostingState = {
      mode: saved.mode,
      policyText: typeof saved.policyText === 'string' ? saved.policyText : null,
      compiled: null,
    };
    hosting.set(row.id, state);
    if (state.mode === 'policy' && state.policyText !== null) {
      const policyText = state.policyText;
      void compilePolicy(app.llm, policyText)
        .then((compiled) => {
          const cur = hosting.get(row.id);
          if (cur !== undefined && cur.mode === 'policy' && cur.policyText === policyText) {
            hosting.set(row.id, { ...cur, compiled });
          }
        })
        .catch(() => {});
    }
  }
}

/**
 * 托管切换(M4e):指令来源玩家⇄Agent 原子切换,世界状态零触碰。
 * policy 模式先落状态(编译完成前 compiled=null 只用原文兜底),异步编译完成后
 * 校验 policyText 未变才写缓存(防竞态);计划清空交泵按方针重规划。
 */
export function registerHostingRoutes(app: FastifyInstance, handle: DbHandle, sim: Simulation): void {
  app.get('/api/admin/characters/:id/hosting', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    return await reply.send(view(id));
  });

  app.post('/api/admin/characters/:id/hosting', async (request, reply) => {
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
        persistHosting(app, handle, id, null);
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
      persistHosting(app, handle, id, hosting.get(id) ?? null);
      return await reply.send(view(id));
    }
    if (!hosting.has(id) || hosting.get(id)?.mode !== 'full') {
      hosting.set(id, { mode: 'full', policyText: null, compiled: null });
      emitChanged(sim, id);
    }
    persistHosting(app, handle, id, hosting.get(id) ?? null);
    return await reply.send(view(id));
  });
}
