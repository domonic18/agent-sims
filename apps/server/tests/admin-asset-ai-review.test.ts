import { existsSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssetAiReviewResponse } from '@sims/shared';
import { libraryRoot } from '../src/assets/paths.js';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, assets, modelConfigs } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';

// AI 审核端点错误路径:参数校验 + vision 槽未配置时逐条报错不炸整批;
// 真实模型链路(读图→chat→JSON 解析)由容器走查覆盖。
const TEST_USERNAME = 'vitest-admin';
const TEST_PASSWORD = 'vitest-pass-123456';

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

beforeAll(async () => {
  if (!dbUp) return;
  await handle.db
    .insert(adminUsers)
    .values({ username: TEST_USERNAME, passwordHash: hashPassword(TEST_PASSWORD) })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: { passwordHash: hashPassword(TEST_PASSWORD) },
    });
  await handle.db.delete(modelConfigs).where(eq(modelConfigs.slot, 'vision'));
  const login = await buildApp().inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
  });
  token = login.json<{ token: string }>().token;
}, 30_000);

afterAll(async () => {
  if (!dbUp) return;
  await handle.client.end();
});

const call = async (method: 'POST', url: string, payload?: unknown) => {
  const app = buildApp();
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
};

describe.skipIf(!dbUp)('POST /api/admin/assets/ai-review', () => {
  it('未登录 401', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/assets/ai-review',
      payload: { ids: [1] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('空 ids 400', async () => {
    const res = await call('POST', '/api/admin/assets/ai-review', { ids: [] });
    expect(res.statusCode).toBe(400);
  });

  it('超过 10 件 400', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => i + 1);
    const res = await call('POST', '/api/admin/assets/ai-review', { ids });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('10');
  });

  it('vision 槽未配置:逐条报错不炸整批', async () => {
    const root = libraryRoot();
    const rows = await handle.db
      .select({ id: assets.id, filePath: assets.filePath })
      .from(assets)
      .limit(300);
    const present = rows.filter((r) => existsSync(path.join(root, r.filePath))).slice(0, 2);
    if (present.length < 2) return; // 库文件未导入时无场景可测
    const res = await call('POST', '/api/admin/assets/ai-review', {
      ids: present.map((r) => r.id),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<AssetAiReviewResponse>();
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(item.ok).toBe(false);
      expect(item.error).toContain('vision');
    }
  });

  it('不存在的素材逐条报素材不存在', async () => {
    // 先给 vision 槽塞一条假配置,让链路走到查素材分支之外?素材查证在模型调用前,无需配置
    const res = await call('POST', '/api/admin/assets/ai-review', { ids: [99999999] });
    expect(res.statusCode).toBe(200);
    const body = res.json<AssetAiReviewResponse>();
    expect(body.items[0]!.ok).toBe(false);
    expect(body.items[0]!.error).toContain('素材不存在');
  });
});
