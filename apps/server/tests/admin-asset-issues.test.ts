import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssetIssueListResponse, AssetIssueView } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, assetIssues } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate);库不可达时整组跳过
const TEST_USERNAME = 'vitest-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const MARK = 'vitest-issue';

let handle: DbHandle;
let token = '';

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

const cleanup = async () => {
  await handle.db.delete(assetIssues).where(eq(assetIssues.refSlug, MARK));
};

beforeAll(async () => {
  if (!dbUp) return;
  await handle.db
    .insert(adminUsers)
    .values({ username: TEST_USERNAME, passwordHash: hashPassword(TEST_PASSWORD) })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: { passwordHash: hashPassword(TEST_PASSWORD) },
    });
  await cleanup();
  const login = await buildApp().inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
  });
  token = login.json<{ token: string }>().token;
}, 30_000);

afterAll(async () => {
  if (!dbUp) return;
  await cleanup();
  await handle.client.end();
});

const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
  const app = buildApp();
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });
  await app.close();
  return res;
};

describe.skipIf(!dbUp)('UI-2 素材问题单 API', () => {
  it('未带 token 访问 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/asset-issues' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('非法 scope 400', async () => {
    const res = await call('POST', '/api/admin/asset-issues', { scope: 'bogus', refSlug: MARK });
    expect(res.statusCode).toBe(400);
  });

  it('空 refSlug 400', async () => {
    const res = await call('POST', '/api/admin/asset-issues', { scope: 'asset', refSlug: ' ' });
    expect(res.statusCode).toBe(400);
  });

  it('上报素材问题→清单可查,refId/context/note 回读', async () => {
    const created = await call('POST', '/api/admin/asset-issues', {
      scope: 'asset',
      refSlug: MARK,
      refId: 42,
      context: { key: 'sofa', kind: 'sofa', theme: 'furniture' },
      note: '沙发画成了斗柜',
    });
    expect(created.statusCode).toBe(201);
    const view = created.json<AssetIssueView>();
    expect(view).toMatchObject({
      scope: 'asset',
      refSlug: MARK,
      refId: 42,
      status: 'open',
      note: '沙发画成了斗柜',
    });
    expect(view.context).toMatchObject({ kind: 'sofa' });
    expect(view.resolvedAt).toBeNull();

    const list = await call('GET', `/api/admin/asset-issues?status=open&refSlug=${MARK}`);
    expect(list.statusCode).toBe(200);
    const body = list.json<AssetIssueListResponse>();
    expect(body.total).toBe(1);
    expect(body.items[0]!.id).toBe(view.id);
  });

  it('同对象重复上报幂等收敛为同一单', async () => {
    const first = await call('POST', '/api/admin/asset-issues', {
      scope: 'asset',
      refSlug: MARK,
      context: { key: 'wardrobe' },
    });
    const second = await call('POST', '/api/admin/asset-issues', {
      scope: 'asset',
      refSlug: MARK,
      context: { key: 'wardrobe' },
      note: '再说一遍',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<AssetIssueView>().id).toBe(first.json<AssetIssueView>().id);
    const list = await call('GET', `/api/admin/asset-issues?refSlug=${MARK}&scope=asset`);
    const keys = list.json<AssetIssueListResponse>().items.filter((i) => i.context?.key === 'wardrobe');
    expect(keys).toHaveLength(1);
    expect(keys[0]!.note).toBeNull();
  });

  it('不同 context.key 各自成单(动画按组/向分单)', async () => {
    await call('POST', '/api/admin/asset-issues', {
      scope: 'anim',
      refSlug: MARK,
      context: { key: 'walk/left', group: 'walk', dir: 'left', row: 4 },
    });
    await call('POST', '/api/admin/asset-issues', {
      scope: 'anim',
      refSlug: MARK,
      context: { key: 'walk/right', group: 'walk', dir: 'right', row: 7 },
    });
    const list = await call('GET', `/api/admin/asset-issues?scope=anim&refSlug=${MARK}`);
    const body = list.json<AssetIssueListResponse>();
    expect(body.total).toBe(2);
    const keys = body.items.map((i) => i.context?.key).sort();
    expect(keys).toEqual(['walk/left', 'walk/right']);
  });

  it('resolve→重开流转:resolvedAt 写入,open 槽位释放与守卫', async () => {
    const created = await call('POST', '/api/admin/asset-issues', {
      scope: 'asset',
      refSlug: MARK,
      context: { key: 'desk' },
    });
    const id = created.json<AssetIssueView>().id;
    const resolved = await call('PATCH', `/api/admin/asset-issues/${id}`, { status: 'resolved' });
    expect(resolved.statusCode).toBe(200);
    const doneRow = resolved.json<AssetIssueView>();
    expect(doneRow.status).toBe('resolved');
    expect(doneRow.resolvedAt).not.toBeNull();

    const openList = await call('GET', `/api/admin/asset-issues?status=open&refSlug=${MARK}`);
    expect(openList.json<AssetIssueListResponse>().items.some((i) => i.id === id)).toBe(false);

    // resolved 后 open 槽位释放,同 dedupe 可再开新单
    const again = await call('POST', '/api/admin/asset-issues', {
      scope: 'asset',
      refSlug: MARK,
      context: { key: 'desk' },
    });
    expect(again.statusCode).toBe(201);
    const newId = again.json<AssetIssueView>().id;
    expect(newId).not.toBe(id);

    // 已有新 open 单时重开旧单被守卫拦截
    const guarded = await call('PATCH', `/api/admin/asset-issues/${id}`, { status: 'open' });
    expect(guarded.statusCode).toBe(400);
    expect(guarded.json<{ error: string }>().error).toContain(`#${newId}`);

    // 无冲突重开:resolvedAt 清空
    const reopenOk = await call('PATCH', `/api/admin/asset-issues/${newId}`, { status: 'open' });
    expect(reopenOk.statusCode).toBe(200);
    expect(reopenOk.json<AssetIssueView>().resolvedAt).toBeNull();
  });

  it('patch 不存在的问题单 400', async () => {
    const res = await call('PATCH', '/api/admin/asset-issues/99999999', { status: 'resolved' });
    expect(res.statusCode).toBe(400);
  });
});
