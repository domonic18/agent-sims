/**
 * 协议面统一出口(@sims/shared):双端唯一 import 入口。
 * export * 直出各协议模块——新增导出零登记,根治"定义了但漏加出口"的漂移
 * (MODEL_PROTOCOL_BASE_URL_HINT 定义后漏出口零消费的事故)。
 */
export * from './admin.js';
export * from './asset-manifest.js';
export * from './activities.js';
export * from './constants.js';
export * from './events.js';
export * from './intents.js';
export * from './items.js';
export * from './maintenance.js';
export * from './property.js';
export * from './production.js';
export * from './shop.js';
export * from './social.js';
export * from './sync.js';
export * from './sys-config.js';
export * from './work-tasks.js';
export * from './world.js';
export * from './world-admin.js';
export * from './world-presets.js';
export * from './worldgen.js';
