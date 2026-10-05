import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SysConfigView } from '@sims/shared';
import { applyWorldParams } from '../src/config/balance.js';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';

// 集成测试:连 dev compose 的 postgres;不可达时整组跳过。
// 参数世界化后本端点只读(PUT/reset 已移除,修改走 Lab /debug/params)。
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
  // 并行测试文件共享 vitest-admin:每次强制重置密码+不删除,避免彼此删号的登录竞态
  await handle.db
    .insert(adminUsers)
    .values({ username: TEST_USERNAME, passwordHash: hashPassword(TEST_PASSWORD) })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: { passwordHash: hashPassword(TEST_PASSWORD) },
    });
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

const inject = async (
  method: 'GET' | 'PUT' | 'POST',
  url: string,
  payload?: unknown,
  withToken = true,
): Promise<{ statusCode: number; body: Record<string, unknown> }> => {
  const app = buildApp();
  const res = await app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
    headers: withToken ? { authorization: `Bearer ${token}` } : {},
  });
  await app.close();
  return { statusCode: res.statusCode, body: res.json<Record<string, unknown>>() };
};

describe.skipIf(!dbUp)('世界参数目录查询 API(只读)', () => {
  it('未带 token 401', async () => {
    const res = await inject('GET', '/api/admin/sys-config', undefined, false);
    expect(res.statusCode).toBe(401);
  });

  it('GET 返回 fields/defaults/overrides/effective 形状', async () => {
    applyWorldParams(); // 复位 BALANCE,保证 effective 与 defaults 一致的确定性
    const res = await inject('GET', '/api/admin/sys-config');
    expect(res.statusCode).toBe(200);
    const view = res.body as unknown as SysConfigView;
    expect(view.fields.length).toBeGreaterThanOrEqual(15);
    const keys = view.fields.map((f) => f.key).sort();
    expect(Object.keys(view.defaults).sort()).toEqual(keys);
    expect(Object.keys(view.effective).sort()).toEqual(keys);
    expect(view.defaults.IDLE_ENERGY_DECAY).toBe(0.02);
    expect(view.effective.IDLE_ENERGY_DECAY).toBe(0.02);
    // overrides 反映活跃世界 config.rules.params(本测试不建世界,仅验证为对象)
    expect(typeof view.overrides).toBe('object');
  });

  it('PUT 修改 404(参数修改已迁移 Lab /debug/params)', async () => {
    const res = await inject('PUT', '/api/admin/sys-config', { updates: { START_COINS: 50 } });
    expect(res.statusCode).toBe(404);
  });

  it('POST reset 404', async () => {
    const res = await inject('POST', '/api/admin/sys-config/reset');
    expect(res.statusCode).toBe(404);
  });
});
