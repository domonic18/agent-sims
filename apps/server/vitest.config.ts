import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 读取仓库根 .env(若存在):单测用兜底值,集成测试连真实 dev 库
function loadDotEnv(): Record<string, string> {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
    return Object.fromEntries(
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=');
          const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
          return [line.slice(0, index).trim(), value];
        }),
    );
  } catch {
    return {};
  }
}

const dotEnv = loadDotEnv();

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: dotEnv.DATABASE_URL ?? 'postgres://vitest:vitest@localhost:5432/vitest',
      MASTER_KEY: dotEnv.MASTER_KEY ?? 'vitest-master-key-0123456789abcdef',
      ADMIN_INITIAL_PASSWORD: dotEnv.ADMIN_INITIAL_PASSWORD ?? 'vitest-admin-password',
    },
  },
});
