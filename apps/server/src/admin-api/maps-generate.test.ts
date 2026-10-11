import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { env } from '../config/env.js';
import { issueAdminToken } from '../utils/token.js';

/** 随机起步图端点(批B):纯生成不落库,无需 DB——复用 buildApp 独立装配 */
describe('POST /api/admin/maps/generate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const authHeader = (): string =>
    `Bearer ${issueAdminToken({ username: 'vitest', masterKey: env.MASTER_KEY, ttlMs: 3_600_000 }).token}`;

  const generate = (payload: Record<string, unknown>): ReturnType<typeof app.inject> =>
    app.inject({
      method: 'POST',
      url: '/api/admin/maps/generate',
      headers: { authorization: authHeader() },
      payload,
    });

  beforeAll(async () => {
    app = buildApp();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('无凭证 401', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/admin/maps/generate', payload: {} });
    expect(anon.statusCode).toBe(401);
  });

  it('同种子同参复现同图;survival 小档带镇核心', async () => {
    const payload = { seed: 20261011, gameType: 'survival', size: 'small' };
    const a = await generate(payload);
    expect(a.statusCode).toBe(200);
    const bodyA = a.json();
    expect(bodyA.seed).toBe(20261011);
    expect(bodyA.map.width).toBe(64);
    expect(bodyA.map.height).toBe(48);
    expect(bodyA.map.townCore).toBeDefined();
    expect(bodyA.map.places.length).toBeGreaterThan(0);

    const b = await generate(payload);
    expect(b.json().map).toEqual(bodyA.map);
  });

  it('缺省种子由服务端生成并回显;尺寸档 medium 生效', async () => {
    const res = await generate({ gameType: 'growth', size: 'medium' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Number.isInteger(body.seed)).toBe(true);
    expect(body.map.width).toBe(80);
    expect(body.map.height).toBe(60);
  });

  it('非法参数 400(坏种子/未知 gameType)', async () => {
    const badSeed = await generate({ seed: 12345678901, gameType: 'growth' });
    expect(badSeed.statusCode).toBe(400);
    const badType = await generate({ gameType: 'mmo' });
    expect(badType.statusCode).toBe(400);
  });
});
