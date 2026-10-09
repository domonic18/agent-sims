import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { setupIntegrationDb } from './helpers/integration.js';
import { adminUsers } from '../src/db/schema/index.js';
import { hashPassword } from '../src/utils/crypto.js';

// 用独立用户 vitest-auth 改密,避免影响 vitest-admin(其他测试文件并行登录用它)。
const TEST_USERNAME = 'vitest-auth';
const TEST_PASSWORD = 'vitest-auth-pass-1';

let token = '';

const { handle, up: dbUp } = await setupIntegrationDb();

beforeAll(async () => {
  if (!dbUp) return;
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
  await handle.db.delete(adminUsers).where(eq(adminUsers.username, TEST_USERNAME));
  await handle.client.end();
});

const inject = async (
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: Record<string, unknown> }> => {
  const app = buildApp();
  const res = await app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  await app.close();
  return { statusCode: res.statusCode, body: res.json<Record<string, unknown>>() };
};

describe.skipIf(!dbUp)('管理员账户安全 API', () => {
  it('未带 token 访问 /me 401', async () => {
    token = '';
    const res = await inject('GET', '/api/admin/auth/me');
    expect(res.statusCode).toBe(401);
  });

  it('/me 返回当前用户名', async () => {
    const login = await inject('POST', '/api/admin/auth/login', {
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });
    token = login.body.token as string;
    const res = await inject('GET', '/api/admin/auth/me');
    expect(res.statusCode).toBe(200);
    expect(res.body.username).toBe(TEST_USERNAME);
  });

  it('弱密码/新旧相同 400', async () => {
    const weak = await inject('POST', '/api/admin/auth/change-password', {
      oldPassword: TEST_PASSWORD,
      newPassword: 'short',
    });
    expect(weak.statusCode).toBe(400);
    const same = await inject('POST', '/api/admin/auth/change-password', {
      oldPassword: TEST_PASSWORD,
      newPassword: TEST_PASSWORD.padEnd(12, 'x'),
    });
    expect(same.statusCode).toBe(400);
  });

  it('原密码错误 401', async () => {
    const res = await inject('POST', '/api/admin/auth/change-password', {
      oldPassword: 'wrong-old-pass',
      newPassword: 'new-pass-123456',
    });
    expect(res.statusCode).toBe(401);
  });

  it('改密成功→旧密码登录 401→新密码可登录', async () => {
    const next = 'vitest-new-pass-2';
    const change = await inject('POST', '/api/admin/auth/change-password', {
      oldPassword: TEST_PASSWORD,
      newPassword: next,
    });
    expect(change.statusCode).toBe(200);
    const oldLogin = await inject('POST', '/api/admin/auth/login', {
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await inject('POST', '/api/admin/auth/login', {
      username: TEST_USERNAME,
      password: next,
    });
    expect(newLogin.statusCode).toBe(200);
    token = newLogin.body.token as string;
  });
});
