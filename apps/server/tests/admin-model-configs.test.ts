import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, modelConfigs } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';
import type { ModelConfigView } from '@sims/shared';

// 集成测试:连 dev compose 的 postgres(需已 migrate+seed);库不可达时整组跳过
const TEST_USERNAME = 'vitest-admin';
const TEST_PASSWORD = 'vitest-pass-123456';

let handle: DbHandle;
let token = '';

// skipIf 在收集期求值,须在模块顶层探测 DB 可达性
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
  // 并行测试文件共享 vitest-admin:每次强制重置密码+不删除,避免彼此删号的登录竞态
  await handle.db
    .insert(adminUsers)
    .values({ username: TEST_USERNAME, passwordHash: hashPassword(TEST_PASSWORD) })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: { passwordHash: hashPassword(TEST_PASSWORD) },
    });
}, 30_000);

afterAll(async () => {
  if (!dbUp) return;
  for (const slot of ['light', 'slow'] as const) {
    await handle.db
      .update(modelConfigs)
      .set({
        protocol: 'openai',
        baseUrl: '',
        model: '',
        apiKeyEncrypted: null,
        enabled: false,
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
        updatedAt: new Date(),
      })
      .where(eq(modelConfigs.slot, slot));
  }
  await handle.client.end();
});

describe.skipIf(!dbUp)('admin 登录与模型配置 API', () => {
  it('错误口令登录 401', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: TEST_USERNAME, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('未知用户登录 401', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'no-such-user', password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('正确口令登录返回 token,凭 token 走通配置读写与测试', async () => {
    const app = buildApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const { token: jwt, expiresIn } = login.json();
    expect(typeof jwt).toBe('string');
    expect(expiresIn).toBeGreaterThan(0);
    token = jwt;

    const unauthorized = await app.inject({ method: 'GET', url: '/api/admin/model-configs' });
    expect(unauthorized.statusCode).toBe(401);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/model-configs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const views = list.json() as ModelConfigView[];
    expect(views.map((view) => view.slot)).toEqual(['slow', 'light', 'jev', 'vision', 'embedding']);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-configs/light',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        protocol: 'anthropic',
        baseUrl: 'https://api.example.com/v1/',
        model: 'test-model',
        apiKey: 'sk-vitest-12345678',
        enabled: true,
      },
    });
    expect(put.statusCode).toBe(200);
    const lightView = put.json() as ModelConfigView;
    expect(lightView.baseUrl).toBe('https://api.example.com/v1'); // 尾斜杠归一
    expect(lightView.protocol).toBe('anthropic');
    expect(lightView.apiKeyConfigured).toBe(true);
    expect(lightView.apiKeyMasked).toBe('sk-v********5678'); // 掩码,永不明文
    expect(lightView.enabled).toBe(true);

    // 只写语义:不带 apiKey 再存,原 Key 保留
    const putAgain = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-configs/light',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    });
    expect(putAgain.statusCode).toBe(200);
    expect((putAgain.json() as ModelConfigView).apiKeyMasked).toBe('sk-v********5678');

    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-configs/nope',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });
    expect(unknown.statusCode).toBe(404);

    const badUrl = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-configs/light',
      headers: { authorization: `Bearer ${token}` },
      payload: { baseUrl: 'not-a-url' },
    });
    expect(badUrl.statusCode).toBe(400);
    await app.close();
  });

  it('未配置槽位测试返回 ok=false 且不发起探测', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/model-configs/slow/test',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });
    expect((res.json() as { detail: string }).detail).toContain('未配置完整');
    await app.close();
  });

  it('已配置但不可达的槽位测试返回失败并落库测试结果', async () => {
    const app = buildApp();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-configs/light',
      headers: { authorization: `Bearer ${token}` },
      payload: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test-model', enabled: true },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/model-configs/light/test',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/model-configs',
      headers: { authorization: `Bearer ${token}` },
    });
    const light = (list.json() as ModelConfigView[]).find((view) => view.slot === 'light');
    expect(light?.lastTestStatus).toBe('failed');
    expect(light?.lastTestError).toBeTruthy();
    await app.close();
  });

  it('anthropic 协议探测走 /messages 路径,失败详情含探测 URL', async () => {
    const app = buildApp();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-configs/slow',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        protocol: 'anthropic',
        baseUrl: 'http://127.0.0.1:9/v1',
        model: 'test-anthropic',
        apiKey: 'sk-vitest-anthropic',
        enabled: true,
      },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/model-configs/slow/test',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });
    // 详情带实际探测 URL,便于自查 Base URL 填法
    expect((res.json() as { detail: string }).detail).toContain('/v1/messages');
    await app.close();
  });

  it('非法 protocol 值 400', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-configs/light',
      headers: { authorization: `Bearer ${token}` },
      payload: { protocol: 'grpc' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
