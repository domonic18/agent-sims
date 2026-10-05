import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 本地 dev 服务端口可经 GAME_SERVER_ORIGIN 覆盖(如 3500,避开 3100 生产容器)
const SERVER_ORIGIN = process.env.GAME_SERVER_ORIGIN ?? 'http://localhost:3100';

export default defineConfig({
  plugins: [react()],
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
        // antd 只被 /admin 懒加载 chunk 引用,独立 vendor 分包,游戏 bundle 零污染
        manualChunks: { antd: ['antd', '@ant-design/icons', 'dayjs'] },
      },
    },
  },
});
