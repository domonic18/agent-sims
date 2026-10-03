import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client.js';
import { registerAuthRoutes } from './auth.js';
import { registerModelConfigRoutes } from './model-configs.js';

export function registerAdminApi(app: FastifyInstance, handle: DbHandle): void {
  registerAuthRoutes(app, handle);
  registerModelConfigRoutes(app, handle);
}
