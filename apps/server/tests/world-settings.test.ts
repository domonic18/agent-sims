import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorldSettingsView } from '@sims/shared';
import { SYS_CONFIG_FIELDS } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { applyWorldParams, BALANCE, BALANCE_DEFAULTS } from '../src/config/balance.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, worlds } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';
import { whenParamPersistIdle } from '../src/world/param-persist.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate);库不可达时整组跳过。
// 覆盖常开设置通道 /api/world/settings:读写形状→暂停倍率→规则热改+持久→
// 参数热调+持久→resetParams 清残留(难度预设切换语义)。
const TEST_USERNAME = 'vitest-settings-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const WORLD_NAME_PREFIX = 'vitest-settings-world-';

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
  await handle.db.delete(worlds).where(eq(worlds.name, `${WORLD_NAME_PREFIX}设置镇`));
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/worlds',
    headers: { authorization: `Bearer ${await login(app)}` },
    payload: {
      name: `${WORLD_NAME_PREFIX}设置镇`,
      characters: [{ name: '阿泽', gender: 'male' as const }],
    },
  });
  expect(res.statusCode).toBe(201);
  await app.close();
}, 30_000);

afterAll(async () => {
  applyWorldParams(); // BALANCE 为进程内全局,结束复位避免语义混淆
  if (!dbUp) return;
  await handle.db.delete(worlds).where(eq(worlds.name, `${WORLD_NAME_PREFIX}设置镇`));
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

async function activeRulesConfig(): Promise<Record<string, unknown>> {
  const [row] = await handle.db.select().from(worlds).where(eq(worlds.status, 'active'));
  return ((row?.config as { rules?: Record<string, unknown> }).rules ?? {}) as Record<string, unknown>;
}

describe.skipIf(!dbUp)('/api/world/settings 设置通道', () => {
  it('GET 返回读写全形状:params 为目录全集,rules 三字段', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/world/settings' });
    expect(res.statusCode).toBe(200);
    const body = res.json<WorldSettingsView>();
    expect(typeof body.paused).toBe('boolean');
    expect(typeof body.timeScale).toBe('number');
    expect(Object.keys(body.params).sort()).toEqual(SYS_CONFIG_FIELDS.map((f) => f.key).sort());
    expect(body.rules).toEqual({ allowDeath: true, allowChat: true, initialTimeScale: 1 });
    await app.close();
  });

  it('POST 暂停/倍率:生效并广播 world.control', async () => {
    const app = buildApp();
    const seen: string[] = [];
    app.simulation.events.subscribe((event) => seen.push(event.type));
    const res = await app.inject({
      method: 'POST',
      url: '/api/world/settings',
      payload: { paused: true, timeScale: 4 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<WorldSettingsView>();
    expect(body.paused).toBe(true);
    expect(body.timeScale).toBe(4);
    expect(app.simulation.paused).toBe(true);
    expect(seen).toContain('world.control');
    app.simulation.setPaused(false);
    await app.close();
  });

  it('POST rules:规则热改+world.rules 事件+config.rules 持久', async () => {
    const app = buildApp();
    const seen: string[] = [];
    app.simulation.events.subscribe((event) => seen.push(event.type));
    const res = await app.inject({
      method: 'POST',
      url: '/api/world/settings',
      payload: { rules: { allowDeath: false } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<WorldSettingsView>().rules.allowDeath).toBe(false);
    expect(app.simulation.rules.allowDeath).toBe(false);
    expect(seen).toContain('world.rules');
    await whenParamPersistIdle();
    expect(await activeRulesConfig()).toMatchObject({ allowDeath: false, allowChat: true });
    await app.close();
  });

  it('POST params:BALANCE 热调+world.params 事件+config.params 全集持久', async () => {
    const app = buildApp();
    const seen: string[] = [];
    app.simulation.events.subscribe((event) => seen.push(event.type));
    const res = await app.inject({
      method: 'POST',
      url: '/api/world/settings',
      payload: { params: { CHAT_HAPPINESS: 7, START_COINS: 300 } },
    });
    expect(res.statusCode).toBe(200);
    expect(BALANCE.CHAT_HAPPINESS).toBe(7);
    expect(BALANCE.START_COINS).toBe(300);
    expect(seen).toContain('world.params');
    const body = res.json<WorldSettingsView>();
    expect(body.params.CHAT_HAPPINESS).toBe(7);
    await whenParamPersistIdle();
    const config = await activeRulesConfig();
    expect(config.params).toMatchObject({ CHAT_HAPPINESS: 7, START_COINS: 300 });
    await app.close();
  });

  it('POST resetParams:复位默认后套覆盖,上一档残留清除', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/world/settings',
      payload: { resetParams: true, params: { VITAL_MAX: 120 } },
    });
    expect(res.statusCode).toBe(200);
    // 未提及的 START_COINS(上一测试残留 300)回到默认;VITAL_MAX 套用新覆盖
    expect(BALANCE.START_COINS).toBe(BALANCE_DEFAULTS.START_COINS);
    expect(BALANCE.VITAL_MAX).toBe(120);
    await whenParamPersistIdle();
    const config = await activeRulesConfig();
    expect(config.params).toMatchObject({ START_COINS: BALANCE_DEFAULTS.START_COINS, VITAL_MAX: 120 });
    await app.close();
  });

  it('POST 非法输入 400:越界参数/非法倍率/坏类型,且不落值', async () => {
    const app = buildApp();
    const cases: Array<Record<string, unknown>> = [
      { params: { CHAT_HAPPINESS: 999 } },
      { timeScale: 3 },
      { paused: 'yes' },
      { rules: { allowDeath: 1 } },
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/world/settings', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(BALANCE.CHAT_HAPPINESS).toBe(BALANCE_DEFAULTS.CHAT_HAPPINESS); // 校验拒绝不落值(此前已被 resetParams 复位)
    expect(BALANCE.VITAL_MAX).toBe(120);
    await app.close();
  });
});
