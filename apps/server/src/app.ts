import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { registerAdminApi } from './admin-api/index.js';
import { env } from './config/env.js';
import { createDb, type DbHandle } from './db/client.js';
import { registerDebugRoutes } from './api/debug.js';
import { registerWorldEventRoutes } from './api/world-events.js';
import { registerWorldSettingsRoutes } from './api/world-settings.js';
import { registerUiMetaRoutes } from './api/ui-meta.js';
import { registerCharacterMemoryRoutes } from './api/character-memory.js';
import { ClientRegistry } from './socket/clients.js';
import { attachSocketGateway } from './socket/gateway.js';
import type { MemoryLlm } from './agents/memory-writer.js';
import { initTechLog, logTech } from './telemetry.js';
import { bootstrap } from './bootstrap.js';
import { Simulation } from './world/simulation.js';

declare module 'fastify' {
  interface FastifyInstance {
    simulation: Simulation;
    clients: ClientRegistry;
    io: Server;
    db: DbHandle;
    llm: MemoryLlm;
  }
}

export function buildApp(options: { logger?: boolean; clockGameMinutes?: number } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ ok: true }));
  // 当前世界地图定义(M-L.5:前端渲染经 manifest 素材绘制任意生成地图)
  app.get('/api/world/map', async () => app.simulation.map.definition);

  const simulation = new Simulation();
  // 测试注水: 事件历史查询有 tick 护栏(只回当前世界 tick 及以下),需要把世界时钟拨到未来
  if (options.clockGameMinutes !== undefined) simulation.clock.restore(options.clockGameMinutes);
  app.decorate('simulation', simulation);
  app.decorate('clients', new ClientRegistry());
  app.decorate('io', attachSocketGateway(app.server, app.simulation, app.clients));

  const handle = createDb(env.DATABASE_URL);
  app.decorate('db', handle);
  initTechLog(handle);
  // 未捕获异常统一落技术日志(M-G.1②):4xx 透传原因,5xx 概括避免泄漏内部细节
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      logTech('error', 'http', err.message, {
        method: request.method,
        url: request.url,
        stack: err.stack,
      });
    }
    void reply.code(status).send({ error: status >= 500 ? '内部错误' : err.message });
  });
  // 运行时子系统(事件落库/参数存档/记忆管线/调度泵)与 onClose 关停顺序
  bootstrap(app);

  registerAdminApi(app, handle, app.simulation);
  registerWorldEventRoutes(app, handle, app.simulation);
  registerWorldSettingsRoutes(app, app.simulation);
  registerUiMetaRoutes(app, handle);
  registerCharacterMemoryRoutes(app, handle, app.simulation);
  if (env.NODE_ENV === 'development') {
    registerDebugRoutes(app, app.simulation, app.clients);
  }

  return app;
}
