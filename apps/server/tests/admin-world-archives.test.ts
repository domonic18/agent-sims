import { randomBytes, scryptSync } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateWorldRequest, WorldArchiveView, WorldView } from '@sims/shared';
import { buildApp } from '../src/app.js';
import { setupIntegrationDb } from './helpers/integration.js';
import { adminUsers, worlds } from '../src/db/schema/index.js';
import { AUTO_LABEL_PREFIX, persistAutoArchive } from '../src/admin-api/world-archives.js';
import { restoreActiveWorld } from '../src/admin-api/worlds.js';

const TEST_USERNAME = 'vitest-archive-admin';
const TEST_PASSWORD = 'vitest-pass-123456';
const WORLD_NAME_PREFIX = 'vitest-archive-world-';
const CREATE_BODY: CreateWorldRequest = {
  name: `${WORLD_NAME_PREFIX}一号镇`,
  characters: [
    { name: '阿泽', gender: 'male' },
    { name: '苏晚', gender: 'female' },
  ],
};

const { handle, up: dbUp } = await setupIntegrationDb();

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

describe.skipIf(!dbUp)('世界存档多档 save/load(C6)', () => {
  it('未鉴权访问 401', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/world-archives' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('save→改现场→load 完整还原;列表与删除闭环', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: CREATE_BODY,
    });
    expect(created.statusCode).toBe(201);
    const world = created.json() as WorldView & { simIds: string[] };

    // 存档时刻现场:tick 30,甲 coins=42
    app.simulation.advanceTicks(30);
    const jiaId = world.simIds[0]!;
    app.simulation.character(jiaId).coins = 42;
    const saved = await app.inject({
      method: 'POST',
      url: '/api/admin/world-archives',
      headers: auth,
      payload: { label: '三十分钟存档' },
    });
    expect(saved.statusCode).toBe(201);
    const archive = saved.json() as WorldArchiveView;
    expect(archive.label).toBe('三十分钟存档');
    expect(archive.worldId).toBe(world.id);
    expect(archive.worldName).toBe(CREATE_BODY.name);
    expect(archive.characterCount).toBe(2);

    // 列表可见(payload 不外透)
    const list = (
      await app.inject({ method: 'GET', url: '/api/admin/world-archives', headers: auth })
    ).json() as WorldArchiveView[];
    expect(list.map((a) => a.id)).toContain(archive.id);
    expect('payload' in list[0]!).toBe(false);

    // 破坏现场:再走 40 tick+动态加一人
    app.simulation.advanceTicks(40);
    await app.inject({
      method: 'POST',
      url: '/api/admin/characters',
      headers: auth,
      payload: { name: '后来者', gender: 'male' },
    });
    expect(app.simulation.characters.size).toBe(3);

    // load:现场回到存档时刻(tick/人数/coins),后来者消失
    const loaded = await app.inject({
      method: 'POST',
      url: `/api/admin/world-archives/${archive.id}/load`,
      headers: auth,
    });
    expect(loaded.statusCode).toBe(200);
    expect(app.simulation.tick).toBe(30);
    expect(app.simulation.characters.size).toBe(2);
    expect(app.simulation.characters.has(jiaId)).toBe(true);
    expect(app.simulation.character(jiaId).coins).toBe(42);
    expect(app.simulation.clock.gameMinutes).toBe(8 * 60 + 30);

    // 删除→列表消失→再删 404
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/admin/world-archives/${archive.id}`,
      headers: auth,
    });
    expect(removed.statusCode).toBe(200);
    const after = (
      await app.inject({ method: 'GET', url: '/api/admin/world-archives', headers: auth })
    ).json() as WorldArchiveView[];
    expect(after.map((a) => a.id)).not.toContain(archive.id);
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/admin/world-archives/${archive.id}`,
      headers: auth,
    });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it('无活跃世界 save 400;跨世界 load 400', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };

    // 世界 A:存档后关闭(转 closed)
    const createdA = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { ...CREATE_BODY, name: `${WORLD_NAME_PREFIX}甲镇` },
    });
    expect(createdA.statusCode).toBe(201);
    const saved = await app.inject({
      method: 'POST',
      url: '/api/admin/world-archives',
      headers: auth,
      payload: {},
    });
    expect(saved.statusCode).toBe(201);
    const archive = saved.json() as WorldArchiveView;
    // label 缺省=时间戳形态
    expect(archive.label).toContain('存档');

    // 建世界 B(A 自动归档):旧档 worldId 不匹配 → load 400
    const createdB = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { ...CREATE_BODY, name: `${WORLD_NAME_PREFIX}乙镇` },
    });
    expect(createdB.statusCode).toBe(201);
    const crossLoad = await app.inject({
      method: 'POST',
      url: `/api/admin/world-archives/${archive.id}/load`,
      headers: auth,
    });
    expect(crossLoad.statusCode).toBe(400);

    // 关闭 B:无活跃世界 → save 400、load 400
    const bId = (createdB.json() as WorldView).id;
    await app.inject({ method: 'POST', url: `/api/admin/worlds/${bId}/close`, headers: auth });
    const noWorldSave = await app.inject({
      method: 'POST',
      url: '/api/admin/world-archives',
      headers: auth,
      payload: {},
    });
    expect(noWorldSave.statusCode).toBe(400);
    const noWorldLoad = await app.inject({
      method: 'POST',
      url: `/api/admin/world-archives/${archive.id}/load`,
      headers: auth,
    });
    expect(noWorldLoad.statusCode).toBe(400);
    await app.close();
  });

  it('不存在的存档 404', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const missing = await app.inject({
      method: 'POST',
      url: '/api/admin/world-archives/00000000-0000-0000-0000-000000000000/load',
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});

describe.skipIf(!dbUp)('退出自动存档+启动自动恢复(C8)', () => {
  it('persist 自动档只留最近 3 条且手动档不清理;新实例 restoreActiveWorld 现场还原;无居民跳过', async () => {
    const app = buildApp();
    const auth = { authorization: `Bearer ${await login(app)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: auth,
      payload: { ...CREATE_BODY, name: `${WORLD_NAME_PREFIX}自动档镇` },
    });
    expect(created.statusCode).toBe(201);
    const world = created.json() as WorldView & { simIds: string[] };

    // 手动档不受自动档保留策略清理
    const manual = await app.inject({
      method: 'POST',
      url: '/api/admin/world-archives',
      headers: auth,
      payload: { label: '手动保留档' },
    });
    expect(manual.statusCode).toBe(201);

    // 现场标记:tick 30 + coins 42,此后 persist #1
    app.simulation.advanceTicks(30);
    const jiaId = world.simIds[0]!;
    app.simulation.character(jiaId).coins = 42;
    expect(await persistAutoArchive(app, handle)).toBe(true);

    // 再 persist 4 次 → 自动档共 5 条,清理后只留最近 3 条
    for (let i = 0; i < 4; i += 1) {
      app.simulation.advanceTicks(1);
      expect(await persistAutoArchive(app, handle)).toBe(true);
    }
    const list = (
      await app.inject({ method: 'GET', url: '/api/admin/world-archives', headers: auth })
    ).json() as WorldArchiveView[];
    const autoLabels = list
      .filter((a) => a.worldId === world.id && a.label.startsWith(AUTO_LABEL_PREFIX))
      .map((a) => a.label);
    expect(autoLabels).toHaveLength(3);
    expect(list.some((a) => a.label === '手动保留档')).toBe(true);

    // 模拟重启:全新 app 实例走 restoreActiveWorld,现场回到最后一次 persist 时刻
    const app2 = buildApp();
    await restoreActiveWorld(app2, handle);
    expect(app2.simulation.tick).toBe(34);
    expect(app2.simulation.characters.size).toBe(2);
    expect(app2.simulation.character(jiaId).coins).toBe(42);

    // 无居民(空场)不落档
    app2.simulation.reset();
    expect(await persistAutoArchive(app2, handle)).toBe(false);
    await app.close();
    await app2.close();
  });
});
