import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { env } from '../config/env.js';
import { createDb, type DbHandle } from '../db/client.js';
import { adminUsers } from '../db/schema/index.js';
import { hashPassword } from '../utils/crypto.js';

const USER = 'throttle-test-admin';
const PASSWORD = 'correct-horse-42';
const IP = '203.0.113.7';

let handle: DbHandle;
let app: Awaited<ReturnType<typeof buildApp>>;

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

async function login(body: { username?: string; password?: string }, ip = IP) {
  return await app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    headers: { 'x-forwarded-for': ip },
    payload: body,
  });
}

describe.skipIf(!dbUp)('POST /api/admin/auth/login 防暴力(OPS-2)', () => {
  beforeAll(async () => {
    await handle.db
      .delete(adminUsers)
      .where(eq(adminUsers.username, USER));
    await handle.db.insert(adminUsers).values({
      username: USER,
      passwordHash: hashPassword(PASSWORD),
    });
    app = buildApp();
  }, 30_000);

  afterAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(adminUsers).where(eq(adminUsers.username, USER));
    await handle.client.end();
    await app.close();
  });

  it('连错 5 次后锁定:正确密码也 429+Retry-After', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await login({ username: USER, password: `wrong-${i}` });
      expect(res.statusCode).toBe(401);
    }
    const res = await login({ username: USER, password: PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('失败次数过多') });
  });

  it('双键独立:同用户名换 IP 仍拒,全新 IP+用户名放行到 401', async () => {
    // 用户名键已锁 → 换 IP 依旧 429
    const sameUser = await login({ username: USER, password: PASSWORD }, '198.51.100.9');
    expect(sameUser.statusCode).toBe(429);
    // 双键全新 → 走到密码校验,返回 401(而非 429)
    const fresh = await login({ username: 'no-such-user', password: 'x' }, '198.51.100.10');
    expect(fresh.statusCode).toBe(401);
  });

  it('参数不合法(400)不计入失败,不推进锁定', async () => {
    const before = await login({ username: 'no-such-user-2', password: 'x' }, '198.51.100.11');
    expect(before.statusCode).toBe(401);
    const bad = await login({ username: '' }, '198.51.100.11');
    expect(bad.statusCode).toBe(400);
    // 若 400 被误计入,连打 4 次 400 后 ip 键已到 5 → 会 429;正确行为应仍 401(未锁)
    for (let i = 0; i < 4; i += 1) {
      await login({ username: '' }, '198.51.100.11');
    }
    const after = await login({ username: 'no-such-user-2', password: 'x' }, '198.51.100.11');
    expect(after.statusCode).toBe(401);
  });
});
