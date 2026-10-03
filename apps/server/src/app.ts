import Fastify, { type FastifyInstance } from 'fastify';
import { registerAdminApi } from './admin-api/index.js';
import { env } from './config/env.js';
import { createDb } from './db/client.js';
import { registerDebugRoutes } from './api/debug.js';
import { Simulation } from './world/simulation.js';

declare module 'fastify' {
  interface FastifyInstance {
    simulation: Simulation;
  }
}

export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ ok: true }));

  app.decorate('simulation', new Simulation());

  const handle = createDb(env.DATABASE_URL);
  registerAdminApi(app, handle);
  if (env.NODE_ENV === 'development') {
    registerDebugRoutes(app, app.simulation);
  }
  app.addHook('onClose', async () => {
    await handle.client.end();
  });

  return app;
}
