/**
 * 后台协议统一出口(admin/ 六域文件分域维护):
 * model-config 模型槽位/协议/配置,assets 素材管理+问题反馈,character 日程/托管/人设/访谈,
 * usage token 用量,logs 日志与配方视图,routes 路由表+登录/ui-meta/提示词。
 * 对外 API 面零变化——消费端一律 `from '@sims/shared'`,不直接 import 子路径。
 */
export * from './admin/routes.js';
export * from './admin/model-config.js';
export * from './admin/assets.js';
export * from './admin/character.js';
export * from './admin/usage.js';
export * from './admin/logs.js';
