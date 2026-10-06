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
    // 集成测试文件共享同一 dev 库(活跃世界/worldState 单例行),文件级并行互相踩
    // (admin-worlds 建世界关闭旧活跃 vs world-settings 改规则读到串档),故串行执行
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: dotEnv.DATABASE_URL ?? 'postgres://vitest:vitest@localhost:5432/vitest',
      MASTER_KEY: dotEnv.MASTER_KEY ?? 'vitest-master-key-0123456789abcdef',
      ADMIN_INITIAL_PASSWORD: dotEnv.ADMIN_INITIAL_PASSWORD ?? 'vitest-admin-password',
    },
  },
});
