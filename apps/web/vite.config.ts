import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_ORIGIN = 'http://localhost:3100';

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
      '/socket.io': { target: SERVER_ORIGIN, ws: true },
    },
  },
});
