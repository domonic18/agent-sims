/**
 * 协议版本号:跟踪 @sims/shared 协议演进,破坏性变更时随双端同步升级。
 */
export const SHARED_PROTOCOL_VERSION = '0.1.0' as const;

export {
  ADMIN_API,
  MODEL_SLOTS,
  MODEL_SLOT_LABELS,
  type AdminLoginRequest,
  type AdminLoginResponse,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelSlot,
} from './admin.js';
