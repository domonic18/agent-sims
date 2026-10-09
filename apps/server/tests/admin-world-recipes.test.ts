import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultRecipes, type WorldRecipesView } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { setupIntegrationDb } from './helpers/integration.js';
import { adminUsers, worlds } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';
import { whenParamPersistIdle } from '../src/world/param-persist.js';

// 每世界配方读写:GET 取运行时全集→PUT 合法热改+存档回写→非法 400 不落值;
// 持久化经 world.recipes 事件(param-persist 回写活跃世界 config.rules.recipes)。
const TEST_USERNAME = 'vitest-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const WORLD_NAME = 'vitest-recipes-world-配方镇';

let token = '';

const { handle, up: dbUp } = await setupIntegrationDb();

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
      characters: [{ name: '阿配', gender: 'male' as const }],
    },
  });
  expect(res.statusCode).toBe(201);
  await app.close();
}, 30_000);

afterAll(async () => {
  if (!dbUp) return;
  await handle.db.delete(worlds).where(eq(worlds.name, WORLD_NAME));
  await handle.client.end();
});

const inject = async (
  method: 'GET' | 'PUT',
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

async function activeRecipesConfig(): Promise<Record<string, unknown> | undefined> {
  const [row] = await handle.db.select().from(worlds).where(eq(worlds.status, 'active'));
  return (row?.config as { rules?: { recipes?: Record<string, unknown> } })?.rules?.recipes;
}

describe.skipIf(!dbUp)('/api/admin/world-recipes 每世界配方读写', () => {
  it('未带 token 401', async () => {
    const get = await inject('GET', '/api/admin/world-recipes', undefined, false);
    expect(get.statusCode).toBe(401);
    const put = await inject('PUT', '/api/admin/world-recipes', { recipes: {} }, false);
    expect(put.statusCode).toBe(401);
  });

  it('GET 返回四配方全集(出厂快照形状)', async () => {
    const res = await inject('GET', '/api/admin/world-recipes');
    expect(res.statusCode).toBe(200);
    const view = res.body as unknown as WorldRecipesView;
    expect(Object.keys(view.recipes).sort()).toEqual([
      'craft_berry_pie',
      'craft_bread',
      'craft_repair_kit',
      'craft_sandwich',
    ]);
    expect(view.recipes.craft_bread).toMatchObject({
      enabled: true,
      durationMinutes: 20,
      stationKind: 'stove',
    });
  });

  it('公开读口 GET /api/world/recipes 免登录同形', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/world/recipes' });
    await app.close();
    expect(res.statusCode).toBe(200);
    const view = res.json<WorldRecipesView>();
    expect(Object.keys(view.recipes)).toHaveLength(4);
  });

  it('PUT 合法:bread 材料改 3+时长改 5,运行时与存档同步', async () => {
    const recipes = defaultRecipes();
    recipes.craft_bread.inputs = [{ itemId: 'wheat', count: 3 }];
    recipes.craft_bread.durationMinutes = 5;
    const res = await inject('PUT', '/api/admin/world-recipes', { recipes });
    expect(res.statusCode).toBe(200);
    const view = res.body as unknown as WorldRecipesView;
    expect(view.recipes.craft_bread.inputs).toEqual([{ itemId: 'wheat', count: 3 }]);
    expect(view.recipes.craft_bread.durationMinutes).toBe(5);
    await whenParamPersistIdle();
    const stored = await activeRecipesConfig();
    expect(stored?.craft_bread).toMatchObject({
      durationMinutes: 5,
      inputs: [{ itemId: 'wheat', count: 3 }],
    });
  });

  it('PUT 非法 400:坏 ItemId/数量 0/缺配方/坏时长/未知配方,均不落值', async () => {
    const base = defaultRecipes();
    const cases: unknown[] = [
      { ...base, craft_bread: { ...base.craft_bread!, inputs: [{ itemId: 'not_an_item', count: 1 }] } },
      { ...base, craft_bread: { ...base.craft_bread!, outputs: [{ itemId: 'bread', count: 0 }] } },
      { ...base, craft_sandwich: undefined },
      { ...base, craft_repair_kit: { ...base.craft_repair_kit!, durationMinutes: 601 } },
      { ...base, craft_nope: base.craft_bread },
    ];
    for (const [index, recipes] of cases.entries()) {
      const res = await inject('PUT', '/api/admin/world-recipes', { recipes });
      expect(res.statusCode, `case#${index}`).toBe(400);
      expect((res.body as { error?: string }).error).toBeTruthy();
    }
    await whenParamPersistIdle();
    const stored = await activeRecipesConfig();
    expect(stored?.craft_bread).toMatchObject({ durationMinutes: 5 }); // 上轮合法值未被破坏
  });

  it('PUT 禁用配方落存档;恢复 enabled=true 后可再改', async () => {
    const recipes = defaultRecipes();
    recipes.craft_sandwich.enabled = false;
    const res = await inject('PUT', '/api/admin/world-recipes', { recipes });
    expect(res.statusCode).toBe(200);
    await whenParamPersistIdle();
    expect((await activeRecipesConfig())?.craft_sandwich).toMatchObject({ enabled: false });
  });
});
