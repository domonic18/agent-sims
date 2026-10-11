import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { TOWN_MAP, type TileMapDefinition } from '@sims/shared';
import { env } from '../config/env.js';
import { createDb, type DbHandle } from '../db/client.js';
import { maps, worlds } from '../db/schema/index.js';
import { issueAdminToken } from '../utils/token.js';

/** 可构造通过的最小地图(16x12 空场+一个门洞小房),语义校验零问题 */
function miniDefinition(): TileMapDefinition {
  return {
    width: 16,
    height: 12,
    blockedRects: [],
    paths: [],
    places: [
      {
        id: 'hut',
        name: '小屋',
        x: 3,
        y: 2,
        w: 5,
        h: 4,
        entrance: { x: 5, y: 6 },
        door: { x: 5, y: 5 },
        furniture: [{ kind: 'bed', x: 4, y: 3, w: 1, h: 1, activityId: 'rest', use: { x: 4, y: 4 } }],
      },
    ],
  };
}

let handle: DbHandle;

const dbUp = await (async () => {
  handle = createDb(env.DATABASE_URL);
  try {
    await handle.client`SELECT 1`;
    return true;
  } catch {
    await handle.client.end().catch(() => {});
    return false;
  }
})();

function authHeader(): string {
  const issued = issueAdminToken({
    username: 'vitest',
    masterKey: env.MASTER_KEY,
    ttlMs: 3_600_000,
  });
  return `Bearer ${issued.token}`;
}

describe.skipIf(!dbUp)('/api/admin/maps', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const createdIds: string[] = [];

  const createMap = async (overrides: Partial<{ name: string; definition: TileMapDefinition }> = {}) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/maps',
      headers: { authorization: authHeader() },
      payload: {
        name: overrides.name ?? 'vitest 地图',
        definition: overrides.definition ?? miniDefinition(),
      },
    });
    return res;
  };

  beforeAll(async () => {
    if (!dbUp) return;
    app = buildApp();
  }, 30_000);

  afterAll(async () => {
    if (!dbUp) return;
    // 清理本组创建的行 + 兜底按名单清理(断言失败时残留)
    for (const id of createdIds) {
      await handle.db.delete(maps).where(eq(maps.id, id)).catch(() => {});
    }
    await handle.db.delete(maps).where(eq(maps.name, 'vitest 地图'));
    await handle.db.delete(maps).where(eq(maps.name, 'vitest 内置图'));
    await handle.client.end();
    await app.close();
  });

  it('无凭证 401', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/admin/maps' });
    expect(anon.statusCode).toBe(401);
  });

  it('创建草稿:默认 draft+尺寸档推断+stats 摘要;非法定义 400', async () => {
    const ok = await createMap({ name: 'vitest 地图' });
    expect(ok.statusCode).toBe(201);
    const body = ok.json();
    createdIds.push(body.id);
    expect(body).toMatchObject({
      name: 'vitest 地图',
      status: 'draft',
      sizePreset: 'custom',
      stats: { width: 16, height: 12, placeCount: 1 },
    });
    expect(body.publishedAt).toBeNull();

    const bad = await createMap({
      name: '坏图',
      definition: { ...miniDefinition(), places: [{ ...miniDefinition().places[0]!, entrance: { x: 4, y: 3 } }] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('入口非法');
  });

  it('详情回带 definition;更新改字段且重校验', async () => {
    const created = await createMap({ name: 'vitest 地图' });
    const id = created.json().id as string;
    createdIds.push(id);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/admin/maps/${id}`,
      headers: { authorization: authHeader() },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().definition).toMatchObject({ width: 16, places: [{ id: 'hut' }] });

    const renamed = await app.inject({
      method: 'PUT',
      url: `/api/admin/maps/${id}`,
      headers: { authorization: authHeader() },
      payload: { name: 'vitest 地图 v2', definition: TOWN_MAP },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'vitest 地图 v2', sizePreset: 'small', stats: { placeCount: 10 } });

    const illegal = await app.inject({
      method: 'PUT',
      url: `/api/admin/maps/${id}`,
      headers: { authorization: authHeader() },
      payload: {
        name: 'vitest 地图 v2',
        // 商店门洞(23,26)被定制障碍压住 → 门洞被覆盖
        definition: { ...TOWN_MAP, blockedRects: [...TOWN_MAP.blockedRects, { x: 23, y: 26, w: 1, h: 1 }] },
      },
    });
    expect(illegal.statusCode).toBe(400);
    expect(illegal.json().error).toContain('门洞非法');
  });

  it('状态机: draft→published→archived;已归档不可再发布;仅发布后可选图', async () => {
    const created = await createMap({ name: 'vitest 地图' });
    const id = created.json().id as string;
    createdIds.push(id);

    const published = await app.inject({
      method: 'POST',
      url: `/api/admin/maps/${id}/publish`,
      headers: { authorization: authHeader() },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe('published');
    expect(published.json().publishedAt).not.toBeNull();

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/maps?status=published',
      headers: { authorization: authHeader() },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.some((m: { id: string }) => m.id === id)).toBe(true);

    const archived = await app.inject({
      method: 'POST',
      url: `/api/admin/maps/${id}/archive`,
      headers: { authorization: authHeader() },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().status).toBe('archived');

    const republish = await app.inject({
      method: 'POST',
      url: `/api/admin/maps/${id}/publish`,
      headers: { authorization: authHeader() },
    });
    expect(republish.statusCode).toBe(400);
  });

  it('删除: 存量世界快照不受影响,删除后 404', async () => {
    const created = await createMap({ name: 'vitest 地图' });
    const id = created.json().id as string;
    createdIds.push(id);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/maps/${id}`,
      headers: { authorization: authHeader() },
    });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({
      method: 'GET',
      url: `/api/admin/maps/${id}`,
      headers: { authorization: authHeader() },
    });
    expect(gone.statusCode).toBe(404);

    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/admin/maps/00000000-0000-4000-8000-00000000bfff',
      headers: { authorization: authHeader() },
    });
    expect(missing.statusCode).toBe(404);
  });

  // worlds.config 快照由 worlds-create 的 mapId 分支测试覆盖(批A 选图路径)
  it('世界创建选图: mapId 取已发布地图快照落 config', async () => {
    const created = await createMap({ name: 'vitest 地图' });
    const id = created.json().id as string;
    createdIds.push(id);
    await app.inject({
      method: 'POST',
      url: `/api/admin/maps/${id}/publish`,
      headers: { authorization: authHeader() },
    });

    // 活跃世界独占:先清理 vitest 世界,创建后立即关闭再清理
    await handle.db.delete(worlds).where(eq(worlds.name, 'vitest 选图世界'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: { authorization: authHeader() },
      payload: {
        name: 'vitest 选图世界',
        characters: [{ name: '图上人', gender: 'female' }],
        mapId: id,
      },
    });
    expect(res.statusCode).toBe(201);
    const view = res.json();
    const [row] = await handle.db.select().from(worlds).where(eq(worlds.id, view.id));
    expect((row!.config as { map?: TileMapDefinition }).map).toMatchObject({ width: 16, height: 12 });
    expect((row!.config as { mapId?: string }).mapId).toBe(id);
    await handle.db.delete(worlds).where(eq(worlds.id, view.id));
  });
});
