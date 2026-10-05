import Fastify, { type FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { registerAdminApi } from './admin-api/index.js';
import { loadSysConfigOverridesOnce } from './admin-api/sys-configs.js';
import { env } from './config/env.js';
import { createDb } from './db/client.js';
import { registerDebugRoutes } from './api/debug.js';
import { ClientRegistry } from './socket/clients.js';
import { attachSocketGateway } from './socket/gateway.js';
import { Simulation } from './world/simulation.js';

declare module 'fastify' {
  interface FastifyInstance {
    simulation: Simulation;
    clients: ClientRegistry;
    io: Server;
  }
}

export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ ok: true }));
  // 当前世界地图定义(M-L.5:前端渲染经 manifest 素材绘制任意生成地图)
  app.get('/api/world/map', async () => app.simulation.map.definition);

  app.decorate('simulation', new Simulation());
  app.decorate('clients', new ClientRegistry());
  app.decorate('io', attachSocketGateway(app.server, app.simulation, app.clients));

  const handle = createDb(env.DATABASE_URL);
  // 启动即应用 DB 保存的系统参数覆盖(进程内一次;异步不阻塞监听,失败用默认值)
  loadSysConfigOverridesOnce(handle).catch((err: unknown) => {
    app.log.warn({ err }, 'sys-config 覆盖加载失败,使用默认参数');
  });
  registerAdminApi(app, handle);
  if (env.NODE_ENV === 'development') {
    registerDebugRoutes(app, app.simulation, app.clients);
  }
  app.addHook('onClose', async () => {
    // io.close 同时关闭底层 http server,先于 fastify 关停以避免双路并发 close 竞态
    await new Promise<void>((resolve) => {
      app.io.close(() => resolve());
    });
    await handle.client.end();
  });

  return app;
}
