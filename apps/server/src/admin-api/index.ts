import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client.js';
import { attachAdminAuditLog } from './audit.js';
import { registerAssetIssueRoutes } from './asset-issues.js';
import { registerAssetRoutes } from './assets.js';
import { registerAuthRoutes } from './auth.js';
import { registerLogRoutes } from './logs.js';
import { registerModelConfigRoutes } from './model-configs.js';
import { registerSysConfigRoutes } from './sys-configs.js';
import { registerTokenUsageRoutes } from './token-usage.js';
import { registerWorldRoutes } from './worlds.js';

export function registerAdminApi(app: FastifyInstance, handle: DbHandle): void {
  attachAdminAuditLog(app, handle);
  registerAuthRoutes(app, handle);
  registerModelConfigRoutes(app, handle);
  registerSysConfigRoutes(app, handle);
  registerTokenUsageRoutes(app, handle);
  registerWorldRoutes(app, handle);
  registerAssetRoutes(app, handle);
  registerAssetIssueRoutes(app, handle);
  registerLogRoutes(app, handle);
}
