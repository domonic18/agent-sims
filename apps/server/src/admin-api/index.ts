import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/client.js';
import type { Simulation } from '../world/simulation.js';
import { attachAdminAuditLog } from './audit.js';
import { registerAssetIssueRoutes } from './asset-issues.js';
import { registerAssetRoutes } from './assets.js';
import { adminGuard, registerAuthRoutes } from './auth.js';
import { registerAutonomyRoutes } from './autonomy.js';
import { registerHostingRoutes } from './hosting.js';
import { registerMindTalkRoutes } from './mindtalk.js';
import { registerMoodRoutes } from './mood.js';
import { registerLogRoutes } from './logs.js';
import { registerMemoryRoutes } from './memories.js';
import { registerModelConfigRoutes } from './model-configs.js';
import { registerPersonaRoutes } from './persona.js';
import { registerPromptRoutes } from './prompts.js';
import { registerScheduleRoutes } from './schedules.js';
import { registerSysConfigRoutes } from './sys-configs.js';
import { registerTokenUsageRoutes } from './token-usage.js';
import { registerWorldArchiveRoutes } from './world-archives.js';
import { registerWorldRecipeRoutes } from './world-recipes.js';
import { registerWorldRoutes } from './worlds.js';

/**
 * 后台 API 装配: 审计 onSend 挂 app 层(覆盖含 401 失败尝试),login 免守卫走认证自身,
 * 其余 /api/admin 路由收进 scoped plugin 由 adminGuard preHandler 统一守护。
 */
export function registerAdminApi(app: FastifyInstance, handle: DbHandle, sim: Simulation): void {
  attachAdminAuditLog(app, handle);
  registerAuthRoutes(app, handle);
  app.register(async (scope) => {
    scope.addHook('preHandler', adminGuard());
    registerModelConfigRoutes(scope, handle);
    registerSysConfigRoutes(scope, handle, sim);
    registerWorldRecipeRoutes(scope, sim);
    registerTokenUsageRoutes(scope, handle);
    registerWorldRoutes(scope, handle);
    registerWorldArchiveRoutes(scope, handle);
    registerAssetRoutes(scope, handle);
    registerAssetIssueRoutes(scope, handle);
    registerMemoryRoutes(scope, handle, sim);
    registerAutonomyRoutes(scope, handle, sim);
    registerHostingRoutes(scope, handle, sim);
    registerPersonaRoutes(scope, handle, sim);
    registerMindTalkRoutes(scope, handle, sim);
    registerMoodRoutes(scope, handle, sim);
    registerScheduleRoutes(scope, sim);
    registerLogRoutes(scope, handle);
    registerPromptRoutes(scope);
  });
}
