import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorldView } from '@sims/shared';
import { registerDebugRoutes } from '../src/api/debug.js';
import { buildApp } from '../src/app.js';
import { applyWorldParams, BALANCE, BALANCE_DEFAULTS } from '../src/config/balance.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, worlds } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';
import { whenParamPersistIdle } from '../src/world/param-persist.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate);库不可达时整组跳过。
// 覆盖系统参数世界化全链:创建应用→Lab 改参热调+事件+持久化→再创建复位默认。
const TEST_USERNAME = 'vitest-params-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const WORLD_NAME_PREFIX = 'vitest-params-world-';
const CREATE_BODY = {
  name: `${WORLD_NAME_PREFIX}参数镇`,
  characters: [{ name: '阿泽', gender: 'male' as const }],
};

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

beforeAll(async () => {
  if (!dbUp) return;
  await handle.db
    .insert(adminUsers)
    .values({ username: TEST_USERNAME, passwordHash: hashPassword(TEST_PASSWORD) })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: { passwordHash: hashPassword(TEST_PASSWORD) },
    });
  await handle.db.delete(worlds).where(like(worlds.name, `${WORLD_NAME_PREFIX}%`));
}, 30_000);

afterAll(async () => {
  applyWorldParams(); // BALANCE 为进程内全局,结束复位避免语义混淆
  if (!dbUp) return;
  await handle.db.delete(worlds).where(like(worlds.name, `${WORLD_NAME_PREFIX}%`));
  await handle.db.delete(adminUsers).where(eq(adminUsers.username, TEST_USERNAME));
  await handle.client.end();
});

async function login(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { username: TEST_USERNAME, password: TEST_PASSWORD },
  });
  return (res.json() as { token: string }).token;
}

describe.skipIf(!dbUp)('系统参数世界化', () => {
  it('创建世界带 rules.params:BALANCE 生效+config 落档', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: {
        ...CREATE_BODY,
        rules: { allowDeath: true, allowChat: true, initialTimeScale: 1,
          params: { NIGHT_START_MINUTE: 1200, CHAT_HAPPINESS: 9 } },
      },
    });
    expect(created.statusCode).toBe(201);
    const world = created.json() as WorldView;
    // BALANCE 应用覆盖,未提及参数保持默认
    expect(BALANCE.NIGHT_START_MINUTE).toBe(1200);
    expect(BALANCE.CHAT_HAPPINESS).toBe(9);
    expect(BALANCE.IDLE_ENERGY_DECAY).toBe(BALANCE_DEFAULTS.IDLE_ENERGY_DECAY);
    // 出生数值读 START_* 参数(默认值语境)
    expect(app.simulation.characters.size).toBe(1);
    // 世界记录 config.rules.params 落档
    const [row] = await handle.db.select().from(worlds).where(eq(worlds.id, world.id));
    expect((row?.config as { rules: { params?: Record<string, number> } }).rules.params)
      .toMatchObject({ NIGHT_START_MINUTE: 1200, CHAT_HAPPINESS: 9 });
    await app.close();
  });

  it('POST /debug/params:校验/热调/world.params 事件/config 持久', async () => {
    const app = buildApp();
    // vitest 固定 NODE_ENV=test,app.ts 不注册 debug 路由;此处手动挂载以覆盖路由逻辑
    registerDebugRoutes(app, app.simulation, app.clients);

    const bad = await app.inject({
      method: 'POST',
      url: '/debug/params',
      payload: { updates: { CHAT_HAPPINESS: 999 } },
    });
    expect(bad.statusCode).toBe(400);
    expect(BALANCE.CHAT_HAPPINESS).toBe(9); // 校验拒绝不落值

    const seen: string[] = [];
    app.simulation.events.subscribe((event) => seen.push(event.type));

    const res = await app.inject({
      method: 'POST',
      url: '/debug/params',
      payload: { updates: { CHAT_HAPPINESS: 5 } },
    });
    expect(res.statusCode).toBe(200);
    expect(BALANCE.CHAT_HAPPINESS).toBe(5);
    expect(seen).toContain('world.params');
    const body = res.json<{ params: Record<string, number> }>();
    expect(body.params.CHAT_HAPPINESS).toBe(5);

    await whenParamPersistIdle();
    const [row] = await handle.db
      .select()
      .from(worlds)
      .where(eq(worlds.status, 'active'));
    expect((row?.config as { rules: { params?: Record<string, number> } }).rules.params)
      .toMatchObject({ NIGHT_START_MINUTE: 1200, CHAT_HAPPINESS: 5 }); // 全集合并而非覆盖
    await app.close();
  });

  it('再创建不带 params:复位出厂默认,上一世界残留清除', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { ...CREATE_BODY, name: `${WORLD_NAME_PREFIX}默认镇` },
    });
    expect(created.statusCode).toBe(201);
    expect(BALANCE.NIGHT_START_MINUTE).toBe(BALANCE_DEFAULTS.NIGHT_START_MINUTE);
    expect(BALANCE.CHAT_HAPPINESS).toBe(BALANCE_DEFAULTS.CHAT_HAPPINESS);
    await app.close();
  });

  it('创建带越界 params 400', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: {
        ...CREATE_BODY,
        name: `${WORLD_NAME_PREFIX}越界镇`,
        rules: { allowDeath: true, allowChat: true, initialTimeScale: 1,
          params: { CHAT_HAPPINESS: 999 } },
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('取值范围');
    await app.close();
  });
});
