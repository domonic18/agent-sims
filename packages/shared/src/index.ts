/**
 * 协议版本号:跟踪 @sims/shared 协议演进,破坏性变更时随双端同步升级。
 */
export const SHARED_PROTOCOL_VERSION = '0.1.0' as const;

export { MODEL_SLOTS, type ModelSlot } from './admin.js';
