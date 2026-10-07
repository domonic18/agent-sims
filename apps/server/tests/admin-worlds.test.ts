import { randomBytes, scryptSync } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultRecipes, type CreateWorldRequest, type WorldView } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { restoreActiveWorld } from '../src/admin-api/worlds.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { adminUsers, characters, worldState, worlds } from '../src/db/schema/index.js';

// 集成测试:连 dev compose 的 postgres(需已 migrate+seed);库不可达时整组跳过
const TEST_USERNAME = 'vitest-worlds-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const WORLD_NAME_PREFIX = 'vitest-world-';
const CREATE_BODY: CreateWorldRequest = {
  name: `${WORLD_NAME_PREFIX}一号镇`,
  characters: [
    { name: '阿泽', gender: 'male' },
    { name: '苏晚', gender: 'female', traits: { sociability: 0.8 }, persona: '爱逛公园', modelSlot: 'slow' },
    { name: '周牧', gender: 'unspecified' },
  ],
};

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
  const salt = randomBytes(16).toString('hex');
  await handle.db
    .insert(adminUsers)
    .values({
      username: TEST_USERNAME,
      passwordHash: `scrypt:${salt}:${scryptSync(TEST_PASSWORD, salt, 64).toString('hex')}`,
    })
    .onConflictDoNothing({ target: adminUsers.username });
  // 清理历史残留测试世界(级联清 characters)
  await handle.db.delete(worlds).where(like(worlds.name, `${WORLD_NAME_PREFIX}%`));
}, 30_000);

afterAll(async () => {
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

describe.skipIf(!dbUp)('世界生命周期管理 API(M3.6k)', () => {
  it('未鉴权访问 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/worlds' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('创建世界:归档旧活跃+模拟层批量出生+人物落库', async () => {
    const app = buildApp();
    token = await login(app);
    const auth = { authorization: `Bearer ${token}` };

    const first = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: CREATE_BODY,
    });
    expect(first.statusCode).toBe(201);
    const world = first.json() as WorldView & { simIds: string[] };
    expect(world.name).toBe(CREATE_BODY.name);
    expect(world.status).toBe('active');
    expect(world.characters).toHaveLength(3);
    expect(world.simIds).toHaveLength(3);

    // 模拟层:3 人出生,世界回到 tick 0
    expect(app.simulation.characters.size).toBe(3);
    const suWan = [...app.simulation.characters.values()].find((c) => c.name === '苏晚');
    expect(suWan?.traits.sociability).toBe(0.8); // 配置特质覆盖出生随机值(社交 v1 相性输入)
    expect(app.simulation.tick).toBe(0);
    expect(app.simulation.clock.formatTime()).toBe('08:00');

    // 人物落库:world_id 关联+gender/persona 透传
    const rows = await handle.db.select().from(characters).where(eq(characters.worldId, world.id));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.gender).sort()).toEqual(['female', 'male', 'unspecified']);
    const withPersona = rows.find((r) => r.name === '苏晚');
    expect(withPersona?.persona).toMatchObject({
      traits: { sociability: 0.8 },
      bio: '爱逛公园',
      modelSlot: 'slow',
    });

    // 第二个世界:旧 active 归档
    const second = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { ...CREATE_BODY, name: `${WORLD_NAME_PREFIX}二号镇` },
    });
    expect(second.statusCode).toBe(201);
    const list = (
      await app.inject({ method: 'GET', url: '/api/admin/worlds', headers: auth })
    ).json() as WorldView[];
    const byName = new Map(list.map((w) => [w.name, w] as const));
    expect(byName.get(CREATE_BODY.name)?.status).toBe('closed');
    expect(byName.get(`${WORLD_NAME_PREFIX}二号镇`)?.status).toBe('active');
    // 模拟现场已切换为二号镇(3 人,重新出生)
    expect(app.simulation.characters.size).toBe(3);
    await app.close();
  });

  it('生成地图落库+启动恢复:config.map 与对外地图一致,重建 app 恢复同图', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: {
        ...CREATE_BODY,
        name: `${WORLD_NAME_PREFIX}恢复镇`,
        worldgen: { gameType: 'growth', params: { size: 'small', density: 'normal' } },
      },
    });
    expect(created.statusCode).toBe(201);
    const world = created.json() as WorldView & { simIds: string[] };
    expect(world.worldgen).toBeDefined();

    const servedMap = (await app.inject({ method: 'GET', url: '/api/world/map' })).json();
    // config.map 落库且深等于对外地图;视图不透出 map 字段
    const [row] = await handle.db.select().from(worlds).where(eq(worlds.id, world.id));
    expect((row.config as { map?: unknown }).map).toEqual(servedMap);
    expect('map' in world).toBe(false);

    // 重建 app + restoreActiveWorld 后地图与重启前一致
    const app2 = buildApp();
    await restoreActiveWorld(app2, app2.db);
    const restoredMap = (await app2.inject({ method: 'GET', url: '/api/world/map' })).json();
    expect(restoredMap).toEqual(servedMap);
    await app2.close();
    await app.close();
  });

  it('世界规则:创建时透传生效,非法倍率 400,缺省兜底默认', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: {
        ...CREATE_BODY,
        name: `${WORLD_NAME_PREFIX}规则镇`,
        rules: { allowDeath: false, allowChat: false, initialTimeScale: 4 },
      },
    });
    expect(created.statusCode).toBe(201);
    const world = created.json() as WorldView;
    expect(world.rules).toEqual({
      allowDeath: false,
      allowChat: false,
      initialTimeScale: 4,
      recipes: defaultRecipes(), // 建世界冻结出厂配方快照
    });
    // 模拟层规则与初始倍率即时生效
    expect(app.simulation.rules.allowDeath).toBe(false);
    expect(app.simulation.rules.allowChat).toBe(false);
    expect(app.simulation.timeScale).toBe(4);
    const [state] = await handle.db.select().from(worldState).where(eq(worldState.id, 1));
    expect(state?.timeScale).toBe(4);

    const badScale = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { ...CREATE_BODY, name: `${WORLD_NAME_PREFIX}倍率镇`, rules: { initialTimeScale: 5 } },
    });
    expect(badScale.statusCode).toBe(400);

    // 不带 rules → 旧世界语义,逐项兜底默认值
    const plain = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { ...CREATE_BODY, name: `${WORLD_NAME_PREFIX}默认镇` },
    });
    expect(plain.statusCode).toBe(201);
    const plainView = plain.json() as WorldView;
    expect(plainView.rules).toEqual({
      allowDeath: true,
      allowChat: true,
      initialTimeScale: 1,
      recipes: defaultRecipes(),
    });
    expect(app.simulation.rules.allowDeath).toBe(true);
    expect(app.simulation.timeScale).toBe(1);
    await app.close();
  });

  it('校验拒绝:人数越界/空名字/空人物', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const empty = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { name: `${WORLD_NAME_PREFIX}空`, characters: [] },
    });
    expect(empty.statusCode).toBe(400);
    const overflow = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: {
        name: `${WORLD_NAME_PREFIX}挤`,
        characters: Array.from({ length: 13 }, (_, i) => ({ name: `人物${i}`, gender: 'male' })),
      },
    });
    expect(overflow.statusCode).toBe(400);
    const blankName = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { name: ' ', characters: [{ name: '阿泽', gender: 'male' }] },
    });
    expect(blankName.statusCode).toBe(400);
    await app.close();
  });

  it('关闭活跃世界:标记归档+暂停模拟;重复关闭幂等', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: CREATE_BODY,
    });
    const { id } = created.json() as WorldView;

    const closed = await app.inject({
      method: 'POST',
      url: `/api/admin/worlds/${id}/close`,
      headers: auth,
    });
    expect(closed.statusCode).toBe(200);
    const closedView = closed.json() as WorldView;
    expect(closedView.status).toBe('closed');
    expect(closedView.closedAt).toBeTruthy();
    expect(app.simulation.paused).toBe(true);

    const again = await app.inject({
      method: 'POST',
      url: `/api/admin/worlds/${id}/close`,
      headers: auth,
    });
    expect(again.statusCode).toBe(200);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds/00000000-0000-0000-0000-000000000000/close',
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('删除世界:记录与人物级联清理;删除活跃世界清场', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: CREATE_BODY,
    });
    const { id } = created.json() as WorldView;
    expect(app.simulation.characters.size).toBe(3);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/admin/worlds/${id}`,
      headers: auth,
    });
    expect(removed.statusCode).toBe(200);
    expect(await handle.db.select().from(characters).where(eq(characters.worldId, id))).toHaveLength(0);
    expect(app.simulation.characters.size).toBe(0); // 活跃世界删除即清场

    const gone = await app.inject({
      method: 'DELETE',
      url: `/api/admin/worlds/${id}`,
      headers: auth,
    });
    expect(gone.statusCode).toBe(404);
    await app.close();
  });
});
