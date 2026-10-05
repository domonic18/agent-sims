import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { DbHandle } from '../db/client.js';
import { adminUsers } from '../db/schema/index.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { issueAdminToken, verifyAdminToken } from '../utils/token.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '原密码不能为空'),
  newPassword: z
    .string()
    .min(8, '新密码至少 8 位')
    .max(64, '新密码至多 64 位'),
});

/** 校验 Bearer token;失败时已发送 401 响应,返回 false */
export function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  return authenticate(request, reply) !== null;
}

/** 校验 Bearer token 并返回 username;失败时已发送 401 响应,返回 null */
export function authenticate(request: FastifyRequest, reply: FastifyReply): string | null {
  const header = request.headers.authorization;
  const token =
    typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const result = verifyAdminToken(token, env.MASTER_KEY);
  if (!result.valid) {
    void reply
      .code(401)
      .send({
        error:
          result.reason === 'expired' ? '登录已过期,请重新登录' : '未登录或凭证无效',
      });
    return null;
  }
  return result.username;
}

export function registerAuthRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.post('/api/admin/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: '请求参数不合法' });
    }
    const [user] = await handle.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, parsed.data.username))
      .limit(1);
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return await reply.code(401).send({ error: '用户名或密码错误' });
    }
    const issued = issueAdminToken({
      username: user.username,
      masterKey: env.MASTER_KEY,
      ttlMs: env.ADMIN_TOKEN_TTL_MS,
    });
    return await reply.send({ token: issued.token, expiresIn: issued.expiresIn });
  });

  app.get('/api/admin/auth/me', async (request, reply) => {
    const username = authenticate(request, reply);
    if (username === null) return;
    return await reply.send({ username });
  });

  app.post('/api/admin/auth/change-password', async (request, reply) => {
    const username = authenticate(request, reply);
    if (username === null) return;
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return await reply.code(400).send({ error: issue?.message ?? '请求参数不合法' });
    }
    const [user] = await handle.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    if (!user || !verifyPassword(parsed.data.oldPassword, user.passwordHash)) {
      return await reply.code(401).send({ error: '原密码错误' });
    }
    if (parsed.data.oldPassword === parsed.data.newPassword) {
      return await reply.code(400).send({ error: '新密码不能与原密码相同' });
    }
    await handle.db
      .update(adminUsers)
      .set({ passwordHash: hashPassword(parsed.data.newPassword) })
      .where(eq(adminUsers.username, username));
    // token 与密码无关(HMAC 签名),改密后当前会话继续有效
    return await reply.send({ ok: true });
  });
}
