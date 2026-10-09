import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 本地 dev 服务端口可经 GAME_SERVER_ORIGIN 覆盖(如 3500,避开 3100 生产容器)
const SERVER_ORIGIN = process.env.GAME_SERVER_ORIGIN ?? 'http://localhost:3100';

// 构建信息(OPS-1): define 内联进前端,游戏页右下角一行展示。
// 取值链 环境变量 > 本地 git 推导 > dev 兜底;.dockerignore 排除了 .git,
// 容器内 git 不可用,Docker 构建须经 build args 注入(Dockerfile ARG+ENV)
function resolveBuildInfo(): { version: string; sha: string; time: string } {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
  ) as { version: string };
  const envSha = process.env.BUILD_SHA?.trim() ?? '';
  let sha = envSha;
  if (sha === '') {
    try {
      sha = execSync('git rev-parse --short HEAD', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    } catch {
      sha = 'dev';
    }
  }
  const envTime = process.env.BUILD_TIME?.trim() ?? '';
  return {
    version: pkg.version,
    sha,
    time: envTime !== '' ? envTime : new Date().toISOString().replace('T', ' ').slice(0, 16),
  };
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(resolveBuildInfo()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/health': SERVER_ORIGIN,
      '/api': SERVER_ORIGIN,
      '/debug': SERVER_ORIGIN,
      '/socket.io': { target: SERVER_ORIGIN, ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // antd 只被 /admin 懒加载 chunk 引用,独立 vendor 分包,游戏 bundle 零污染;
        // phaser 独立分包(L3):引擎版本稳定,跨部署缓存复用,游戏代码迭代不打掉它
        manualChunks: {
          antd: ['antd', '@ant-design/icons', 'dayjs'],
          phaser: ['phaser'],
        },
      },
    },
  },
});
