import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SysConfigView } from '@sims/shared';
import { BALANCE, BALANCE_DEFAULTS } from '../src/config/balance.js';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, sysConfigs } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate:0004 sys_configs);不可达时整组跳过
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
  // 清覆盖行保证 GET 默认值的确定性(同进程 BALANCE 可能已被其他用例改过,一并复位)
  await handle.db.delete(sysConfigs).where(eq(sysConfigs.id, 1));
  applyDefaults();
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

function applyDefaults(): void {
  for (const [key, value] of Object.entries(BALANCE_DEFAULTS)) {
    (BALANCE as unknown as Record<string, number>)[key] = value;
  }
}

afterAll(async () => {
  if (!dbUp) return;
  await handle.db.delete(sysConfigs).where(eq(sysConfigs.id, 1));
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

describe.skipIf(!dbUp)('系统参数后台 API', () => {
  it('未带 token 401', async () => {
    const res = await inject('GET', '/api/admin/sys-config', undefined, false);
    expect(res.statusCode).toBe(401);
  });

  it('GET 返回 fields/defaults/overrides/effective 且 effective 为默认值', async () => {
    const res = await inject('GET', '/api/admin/sys-config');
    expect(res.statusCode).toBe(200);
    const view = res.body as unknown as SysConfigView;
    expect(view.fields.length).toBeGreaterThanOrEqual(15);
    expect(view.defaults.IDLE_ENERGY_DECAY).toBe(0.02);
    expect(view.overrides).toEqual({});
    expect(view.effective.IDLE_ENERGY_DECAY).toBe(0.02);
  });

  it('PUT 合法更新→热更新 BALANCE+落库→GET effective 变化', async () => {
    const res = await inject('PUT', '/api/admin/sys-config', {
      updates: { IDLE_ENERGY_DECAY: 0.05, START_COINS: 50 },
    });
    expect(res.statusCode).toBe(200);
    const view = res.body as unknown as SysConfigView;
    expect(view.effective.IDLE_ENERGY_DECAY).toBe(0.05);
    expect(view.effective.START_COINS).toBe(50);
    expect(BALANCE.IDLE_ENERGY_DECAY).toBe(0.05);
    expect(BALANCE.START_COINS).toBe(50);
    const after = await inject('GET', '/api/admin/sys-config');
    const afterView = after.body as unknown as SysConfigView;
    expect(afterView.overrides.IDLE_ENERGY_DECAY).toBe(0.05);
    expect(afterView.effective.IDLE_ENERGY_DECAY).toBe(0.05);
  });

  it('PUT 越界/非整数/未知 key 400 且不生效', async () => {
    const outOfRange = await inject('PUT', '/api/admin/sys-config', {
      updates: { IDLE_ENERGY_DECAY: 99 },
    });
    expect(outOfRange.statusCode).toBe(400);
    expect((outOfRange.body as { error: string }).error).toContain('取值范围');
    const nonInt = await inject('PUT', '/api/admin/sys-config', {
      updates: { START_COINS: 1.5 },
    });
    expect(nonInt.statusCode).toBe(400);
    const unknown = await inject('PUT', '/api/admin/sys-config', {
      updates: { NOT_A_PARAM: 1 },
    });
    expect(unknown.statusCode).toBe(400);
    expect(BALANCE.IDLE_ENERGY_DECAY).toBe(0.05); // 前一用例的值,未被本次污染
  });

  it('reset 清覆盖并恢复默认', async () => {
    await inject('PUT', '/api/admin/sys-config', { updates: { IDLE_ENERGY_DECAY: 0.08 } });
    expect(BALANCE.IDLE_ENERGY_DECAY).toBe(0.08);
    const reset = await inject('POST', '/api/admin/sys-config/reset');
    expect(reset.statusCode).toBe(200);
    expect(BALANCE.IDLE_ENERGY_DECAY).toBe(0.02);
    const view = reset.body as unknown as SysConfigView;
    expect(view.overrides).toEqual({});
    expect(view.effective.IDLE_ENERGY_DECAY).toBe(0.02);
  });
});
