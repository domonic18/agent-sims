import { and, desc, eq, like, notInArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  SOCKET_EVENTS,
  type WorldArchiveView,
  type WorldSnapshotMessage,
} from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { worldArchives, worldState, worlds } from '../db/schema/index.js';
import type { SimulationArchive } from '../world/simulation.js';
import { requireAdmin } from './auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 自动档标签前缀(关闭时自动存档);同名前缀的手动档会被保留策略清理,起名请避开 */
export const AUTO_LABEL_PREFIX = '自动 · ';
/** 自动档保留条数(每世界),防退出存档膨胀 */
const AUTO_KEEP = 3;

/** 存档载荷最低完整性校验(时钟数字+角色数组),损坏档拒绝恢复 */
function isValidArchive(payload: unknown): payload is SimulationArchive {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as SimulationArchive).clockGameMinutes === 'number' &&
    Array.isArray((payload as SimulationArchive).characters)
  );
}

/** 存档行 → 列表视图(payload 不外透;characterCount 由载荷长度派生) */
function toView(
  row: typeof worldArchives.$inferSelect,
  worldName: string,
): WorldArchiveView {
  const payload = row.payload as SimulationArchive;
  return {
    id: row.id,
    worldId: row.worldId,
    worldName,
    label: row.label,
    characterCount: Array.isArray(payload.characters) ? payload.characters.length : 0,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 世界存档多档(C6):管理员手动保存/读取/删除模拟现场。
 * save=serialize 当前活跃世界;load=restoreArchive 灌回并立即广播全量快照
 * (暂停态没有 tick 流,现场要马上可见);load 校验存档归属当前活跃世界。
 */
export function registerWorldArchiveRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/world-archives', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const rows = await handle.db
      .select({ archive: worldArchives, worldName: worlds.name })
      .from(worldArchives)
      .innerJoin(worlds, eq(worldArchives.worldId, worlds.id))
      .orderBy(desc(worldArchives.createdAt));
    return await reply.send(rows.map(({ archive, worldName }) => toView(archive, worldName)));
  });

  app.post('/api/admin/world-archives', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = (request.body ?? {}) as { label?: unknown };
    const [world] = await handle.db
      .select()
      .from(worlds)
      .where(eq(worlds.status, 'active'))
      .orderBy(desc(worlds.createdAt))
      .limit(1);
    if (!world) {
      return await reply.code(400).send({ error: '当前没有运行中的世界' });
    }
    if (app.simulation.characters.size === 0) {
      return await reply.code(400).send({ error: '世界暂无居民,无可保存的现场' });
    }
    const label =
      typeof body.label === 'string' && body.label.trim() !== ''
        ? body.label.trim().slice(0, 40)
        : `存档 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    const [row] = await handle.db
      .insert(worldArchives)
      .values({ worldId: world.id, label, payload: app.simulation.serialize() })
      .returning();
    if (!row) {
      return await reply.code(500).send({ error: '存档写入失败' });
    }
    return await reply.code(201).send(toView(row, world.name));
  });

  app.post('/api/admin/world-archives/:id/load', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = request.params as { id: string };
    if (!UUID_RE.test(params.id)) {
      return await reply.code(404).send({ error: '存档不存在' });
    }
    const [row] = await handle.db
      .select()
      .from(worldArchives)
      .where(eq(worldArchives.id, params.id))
      .limit(1);
    if (!row) {
      return await reply.code(404).send({ error: '存档不存在' });
    }
    const [world] = await handle.db
      .select()
      .from(worlds)
      .where(eq(worlds.status, 'active'))
      .orderBy(desc(worlds.createdAt))
      .limit(1);
    if (!world || world.id !== row.worldId) {
      return await reply.code(400).send({ error: '存档属于其他世界,与当前活跃世界不符' });
    }
    const archive = row.payload as SimulationArchive;
    if (!isValidArchive(archive)) {
      return await reply.code(400).send({ error: '存档载荷损坏,无法恢复' });
    }
    app.simulation.restoreArchive(archive);
    // worldState 单行表回写,与模拟现场保持一致
    await handle.db
      .update(worldState)
      .set({
        tick: archive.tick,
        paused: archive.paused,
        timeScale: archive.timeScale,
        updatedAt: new Date(),
      })
      .where(eq(worldState.id, 1));
    // 暂停态没有 tick 快照流,load 后立即广播全量现场
    app.io.emit(SOCKET_EVENTS.snapshot, app.simulation.snapshot() satisfies WorldSnapshotMessage);
    return await reply.send({ ok: true, tick: archive.tick });
  });

  app.delete('/api/admin/world-archives/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = request.params as { id: string };
    if (!UUID_RE.test(params.id)) {
      return await reply.code(404).send({ error: '存档不存在' });
    }
    const rows = await handle.db
      .delete(worldArchives)
      .where(eq(worldArchives.id, params.id))
      .returning();
    if (rows.length === 0) {
      return await reply.code(404).send({ error: '存档不存在' });
    }
    return await reply.send({ ok: true });
  });
}

/**
 * 关闭自动存档(C8):进程退出前把活跃世界现场存为「自动 ·」档。
 * 无活跃世界/空 sim(无居民)静默跳过;写入后清理该世界更旧的自动档只留最近 AUTO_KEEP 条。
 * 返回是否落档(供退出日志);存档失败向上抛由调用方决定退出路径。
 */
export async function persistAutoArchive(app: FastifyInstance, handle: DbHandle): Promise<boolean> {
  const [world] = await handle.db
    .select()
    .from(worlds)
    .where(eq(worlds.status, 'active'))
    .orderBy(desc(worlds.createdAt))
    .limit(1);
  if (!world || app.simulation.characters.size === 0) return false;
  const label = `${AUTO_LABEL_PREFIX}${new Date().toLocaleString('zh-CN', { hour12: false })}`;
  const [row] = await handle.db
    .insert(worldArchives)
    .values({ worldId: world.id, label, payload: app.simulation.serialize() })
    .returning();
  if (!row) return false;
  const kept = await handle.db
    .select({ id: worldArchives.id })
    .from(worldArchives)
    .where(eq(worldArchives.worldId, world.id))
    .orderBy(desc(worldArchives.createdAt))
    .limit(AUTO_KEEP);
  const stale = and(
    eq(worldArchives.worldId, world.id),
    like(worldArchives.label, `${AUTO_LABEL_PREFIX}%`),
    notInArray(
      worldArchives.id,
      kept.map((k) => k.id),
    ),
  );
  await handle.db.delete(worldArchives).where(stale);
  return true;
}

/**
 * 启动自动恢复(C8):灌回活跃世界最近一档(角色/数值/时钟现场)。
 * 无档/载荷损坏静默返回 false(调用方维持冻结空场);成功回写 worldState 单行表。
 */
export async function restoreLatestArchive(
  app: FastifyInstance,
  handle: DbHandle,
  worldId: string,
): Promise<boolean> {
  const [row] = await handle.db
    .select()
    .from(worldArchives)
    .where(eq(worldArchives.worldId, worldId))
    .orderBy(desc(worldArchives.createdAt))
    .limit(1);
  if (!row || !isValidArchive(row.payload)) return false;
  const archive = row.payload;
  app.simulation.restoreArchive(archive);
  await handle.db
    .update(worldState)
    .set({
      tick: archive.tick,
      paused: archive.paused,
      timeScale: archive.timeScale,
      updatedAt: new Date(),
    })
    .where(eq(worldState.id, 1));
  return true;
}
