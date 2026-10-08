import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { registerAdminApi } from './admin-api/index.js';
import { env } from './config/env.js';
import { createDb, type DbHandle } from './db/client.js';
import { registerDebugRoutes } from './api/debug.js';
import { registerWorldEventRoutes } from './api/world-events.js';
import { registerWorldSettingsRoutes } from './api/world-settings.js';
import { ClientRegistry } from './socket/clients.js';
import { attachSocketGateway } from './socket/gateway.js';
import { initTechLog, logTech, whenTechLogIdle } from './telemetry.js';
import { attachWorldEventLog } from './world/event-log.js';
import { attachWorldParamPersist } from './world/param-persist.js';
import { ModelRouter } from './llm/router.js';
import { attachMemoryWriter, type MemoryLlm } from './agents/memory-writer.js';
import { AgentScheduler } from './agents/scheduler.js';
import { SOCKET_EVENTS, type AgentDecisionMessage } from '@sims/shared';
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

export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ ok: true }));
  // 当前世界地图定义(M-L.5:前端渲染经 manifest 素材绘制任意生成地图)
  app.get('/api/world/map', async () => app.simulation.map.definition);

  app.decorate('simulation', new Simulation());
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
  // 世界事件落库+参数存档订阅(EventBus 零 I/O,宿主侧串行链写入)
  attachWorldEventLog(handle, app.simulation.events);
  attachWorldParamPersist(handle, app.simulation.events);
  // 记忆写入(M4b/A2):订阅同一总线,管线异步走 Jev/embedding,不阻塞 tick;
  // llm 装饰器供检索 API 复用(测试可覆写为桩)
  app.decorate('llm', new ModelRouter(handle));
  attachMemoryWriter(app.simulation, handle, app.llm);
  // Agent 调度泵(M4c):自治角色默认空集(开关走 admin API),react 气泡经独立 socket 事件广播
  const agentScheduler = new AgentScheduler({
    sim: app.simulation,
    handle,
    llm: app.llm,
    onBubble: (message) => {
      app.io.emit(SOCKET_EVENTS.decision, message satisfies AgentDecisionMessage);
    },
  });
  registerAdminApi(app, handle, app.simulation);
  registerWorldEventRoutes(app, handle);
  registerWorldSettingsRoutes(app, app.simulation);
  if (env.NODE_ENV === 'development') {
    registerDebugRoutes(app, app.simulation, app.clients);
  }
  app.addHook('onClose', async () => {
    agentScheduler.dispose();
    // io.close 同时关闭底层 http server,先于 fastify 关停以避免双路并发 close 竞态
    await new Promise<void>((resolve) => {
      app.io.close(() => resolve());
    });
    // 先冲刷技术日志串行链再断库,避免关停窗口丢尾条
    await whenTechLogIdle();
    await handle.client.end();
  });

  return app;
}
