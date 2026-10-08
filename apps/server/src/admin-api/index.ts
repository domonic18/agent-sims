import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client.js';
import type { Simulation } from '../world/simulation.js';
import { attachAdminAuditLog } from './audit.js';
import { registerAssetIssueRoutes } from './asset-issues.js';
import { registerAssetRoutes } from './assets.js';
import { registerAuthRoutes } from './auth.js';
import { registerLogRoutes } from './logs.js';
import { registerMemoryRoutes } from './memories.js';
import { registerModelConfigRoutes } from './model-configs.js';
import { registerSysConfigRoutes } from './sys-configs.js';
import { registerTokenUsageRoutes } from './token-usage.js';
import { registerWorldArchiveRoutes } from './world-archives.js';
import { registerWorldRecipeRoutes } from './world-recipes.js';
import { registerWorldRoutes } from './worlds.js';

export function registerAdminApi(app: FastifyInstance, handle: DbHandle, sim: Simulation): void {
  attachAdminAuditLog(app, handle);
  registerAuthRoutes(app, handle);
  registerModelConfigRoutes(app, handle);
  registerSysConfigRoutes(app, handle, sim);
  registerWorldRecipeRoutes(app, sim);
  registerTokenUsageRoutes(app, handle);
  registerWorldRoutes(app, handle);
  registerWorldArchiveRoutes(app, handle);
  registerAssetRoutes(app, handle);
  registerAssetIssueRoutes(app, handle);
  registerMemoryRoutes(app, handle, sim);
  registerLogRoutes(app, handle);
}
