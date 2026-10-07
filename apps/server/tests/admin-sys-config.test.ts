import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SysConfigView } from '@sims/shared';
import { applyWorldParams, BALANCE, BALANCE_DEFAULTS } from '../src/config/balance.js';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, worlds } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';
import { whenParamPersistIdle } from '../src/world/param-persist.js';

// 集成测试:连 dev compose 的 postgres;不可达时整组跳过。
// 后台参数写通道:PUT 覆盖热调+持久→非法 400 不落值→reset 复位出厂默认;
// 与 /api/world/settings 共用 applySettingParams(校验→setParams→param-persist)。
const TEST_USERNAME = 'vitest-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const WORLD_NAME = 'vitest-sysconfig-world-参数镇';

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
  await handle.db.delete(worlds).where(eq(worlds.name, WORLD_NAME));
  const app = buildApp();
  token = (
    await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
    })
  ).json<{ token: string }>().token;
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/worlds',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: WORLD_NAME,
      characters: [{ name: '阿参', gender: 'female' as const }],
    },
  });
  expect(res.statusCode).toBe(201);
  await app.close();
}, 30_000);

afterAll(async () => {
  applyWorldParams(); // BALANCE 为进程内全局,结束复位避免语义混淆
  if (!dbUp) return;
  await handle.db.delete(worlds).where(eq(worlds.name, WORLD_NAME));
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

async function activeParamsConfig(): Promise<Record<string, number> | undefined> {
  const [row] = await handle.db.select().from(worlds).where(eq(worlds.status, 'active'));
  return (row?.config as { rules?: { params?: Record<string, number> } })?.rules?.params;
}

describe.skipIf(!dbUp)('/api/admin/sys-config 参数目录读写', () => {
  it('未带 token 401', async () => {
    const res = await inject('GET', '/api/admin/sys-config', undefined, false);
    expect(res.statusCode).toBe(401);
    const put = await inject('PUT', '/api/admin/sys-config', { params: {} }, false);
    expect(put.statusCode).toBe(401);
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
    // 本文件已建活跃世界:overrides 为其 config.rules.params(创建时未覆盖=空对象)
    expect(typeof view.overrides).toBe('object');
  });

  it('PUT 合法覆盖:BALANCE 热调+config.params 持久+响应 effective 同步', async () => {
    const res = await inject('PUT', '/api/admin/sys-config', {
      params: { NODE_MAX_CHARGES_BERRY: 1, NODE_RESPAWN_DAYS: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(BALANCE.NODE_MAX_CHARGES_BERRY).toBe(1);
    expect(BALANCE.NODE_RESPAWN_DAYS).toBe(3);
    const view = res.body as unknown as SysConfigView;
    expect(view.effective.NODE_MAX_CHARGES_BERRY).toBe(1);
    expect(view.overrides).toMatchObject({ NODE_MAX_CHARGES_BERRY: 1, NODE_RESPAWN_DAYS: 3 });
    await whenParamPersistIdle();
    expect(await activeParamsConfig()).toMatchObject({
      NODE_MAX_CHARGES_BERRY: 1,
      NODE_RESPAWN_DAYS: 3,
    });
  });

  it('PUT 非法输入 400:未知 key/越界/坏类型/非整数,均不落值', async () => {
    const cases: Array<Record<string, unknown>> = [
      { params: { NOT_A_KEY: 1 } },
      { params: { NODE_MAX_CHARGES_BERRY: -5 } },
      { params: { NODE_RESPAWN_DAYS: 'soon' } },
      { params: { NODE_RESPAWN_DAYS: 1.5 } },
    ];
    for (const payload of cases) {
      const res = await inject('PUT', '/api/admin/sys-config', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect((res.body as { error?: string }).error).toBeTruthy();
    }
    expect(BALANCE.NODE_MAX_CHARGES_BERRY).toBe(1); // 上一用例残留值,未被非法请求改动
    expect(BALANCE.NODE_RESPAWN_DAYS).toBe(3);
  });

  it('POST reset:复位出厂默认,残留覆盖清除且持久', async () => {
    const res = await inject('POST', '/api/admin/sys-config/reset');
    expect(res.statusCode).toBe(200);
    expect(BALANCE.NODE_MAX_CHARGES_BERRY).toBe(BALANCE_DEFAULTS.NODE_MAX_CHARGES_BERRY);
    expect(BALANCE.NODE_RESPAWN_DAYS).toBe(BALANCE_DEFAULTS.NODE_RESPAWN_DAYS);
    const view = res.body as unknown as SysConfigView;
    expect(view.overrides).toMatchObject({
      NODE_MAX_CHARGES_BERRY: BALANCE_DEFAULTS.NODE_MAX_CHARGES_BERRY,
      NODE_RESPAWN_DAYS: BALANCE_DEFAULTS.NODE_RESPAWN_DAYS,
    });
    await whenParamPersistIdle();
    expect(await activeParamsConfig()).toMatchObject({
      NODE_MAX_CHARGES_BERRY: BALANCE_DEFAULTS.NODE_MAX_CHARGES_BERRY,
    });
  });
});
