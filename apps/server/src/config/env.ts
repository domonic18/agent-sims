import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GAME_PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().url(),
  MASTER_KEY: z.string().min(16),
  ADMIN_INITIAL_PASSWORD: z.string().min(6),
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
