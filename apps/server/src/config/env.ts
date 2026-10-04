import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GAME_PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().url(),
  MASTER_KEY: z.string().min(16),
  ADMIN_INITIAL_PASSWORD: z.string().min(6),
  /** 管理端会话有效期(默认 12 小时) */
  ADMIN_TOKEN_TTL_MS: z.coerce.number().int().positive().default(12 * 60 * 60 * 1000),
  /** 模型连通性探测超时(默认 15 秒) */
  PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** LLM 正式调用超时(默认 60 秒;慢思考长输出可 env 上调) */
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`环境变量校验失败: ${detail}`);
}

export const env = parsed.data;
export type Env = typeof env;
