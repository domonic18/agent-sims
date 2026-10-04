/**
 * 协议版本号:跟踪 @sims/shared 协议演进,破坏性变更时随双端同步升级。
 */
export const SHARED_PROTOCOL_VERSION = '0.1.0' as const;

export {
  ADMIN_API,
  MODEL_PROTOCOLS,
  MODEL_PROTOCOL_LABELS,
  MODEL_SLOTS,
  MODEL_SLOT_LABELS,
  type AdminLoginRequest,
  type AdminLoginResponse,
  type ModelConfigTestResult,
  type ModelConfigUpdate,
  type ModelConfigView,
  type ModelProtocol,
  type ModelSlot,
} from './admin.js';

export {
  INTENT_TYPES,
  intentSchema,
  moveToIntentSchema,
  startActivityIntentSchema,
  stopActivityIntentSchema,
  type Intent,
  type IntentType,
  type MoveToIntent,
  type StartActivityIntent,
  type StopActivityIntent,
} from './intents.js';

export {
  ACTIVITY_FINISH_REASONS,
  activityFinishedEventSchema,
  activityStartedEventSchema,
  characterArrivedEventSchema,
  worldControlEventSchema,
  worldEventSchema,
  type ActivityFinishReason,
  type ActivityFinishedEvent,
  type ActivityStartedEvent,
  type CharacterArrivedEvent,
  type WorldControlEvent,
  type WorldEvent,
} from './events.js';

export {
  ACTIVITY_DEFINITIONS,
  ACTIVITY_IDS,
  getActivityDefinition,
  type ActivityDefinition,
  type ActivityEffects,
  type ActivityId,
} from './activities.js';

export {
  SOCKET_EVENTS,
  SOCKET_ROLES,
  type SocketEventName,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from './sync.js';

export {
  TOWN_MAP,
  type BlockedRect,
  type PlaceDefinition,
  type TileMapDefinition,
} from './world.js';
