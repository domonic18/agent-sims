import Fastify, { type FastifyInstance } from 'fastify';
import { registerAdminApi } from './admin-api/index.js';
import { env } from './config/env.js';
import { createDb } from './db/client.js';

export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ ok: true }));

  const handle = createDb(env.DATABASE_URL);
  registerAdminApi(app, handle);
  app.addHook('onClose', async () => {
    await handle.client.end();
  });

  return app;
}
