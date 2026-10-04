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
  buyItemIntentSchema,
  buyPropertyIntentSchema,
  eatItemIntentSchema,
  intentSchema,
  moveToIntentSchema,
  rentPropertyIntentSchema,
  startActivityIntentSchema,
  stopActivityIntentSchema,
  stopMoveIntentSchema,
  storeItemIntentSchema,
  takeItemIntentSchema,
  type BuyItemIntent,
  type BuyPropertyIntent,
  type EatItemIntent,
  type Intent,
  type IntentType,
  type MoveToIntent,
  type RentPropertyIntent,
  type StartActivityIntent,
  type StopActivityIntent,
  type StopMoveIntent,
  type StoreItemIntent,
  type TakeItemIntent,
} from './intents.js';

export {
  BACKPACK_VOLUME_LIMIT,
  FRIDGE_VOLUME_LIMIT,
  LOW_ENERGY_THRESHOLD,
  WALK_SPEED_TILES_PER_TICK,
  inventoryVolume,
} from './balances.js';

export {
  ACTIVITY_FINISH_REASONS,
  activityFinishedEventSchema,
  activityStartedEventSchema,
  characterArrivedEventSchema,
  characterDiedEventSchema,
  characterRevivedEventSchema,
  worldControlEventSchema,
  worldEventSchema,
  type ActivityFinishReason,
  type ActivityFinishedEvent,
  type ActivityStartedEvent,
  type CharacterArrivedEvent,
  type CharacterDiedEvent,
  type CharacterRevivedEvent,
  type WorldControlEvent,
  type WorldEvent,
} from './events.js';

export {
  ACTIVITY_DEFINITIONS,
  ACTIVITY_IDS,
  BASIC_ACTIVITY_IDS,
  getActivityDefinition,
  type ActivityDefinition,
  type ActivityEffects,
  type ActivityId,
} from './activities.js';

export {
  SHOP_CATEGORIES,
  SHOP_ITEMS,
  SHOP_ITEM_IDS,
  getShopItem,
  type FoodShopItem,
  type ShopCategory,
  type ShopItemDefinition,
  type ShopItemId,
} from './shop.js';

export {
  PROPERTY_DEFINITIONS,
  PROPERTY_IDS,
  getPropertyDefinition,
  type PropertyDefinition,
  type PropertyId,
} from './property.js';

export {
  CLIENT_EVENTS,
  SOCKET_EVENTS,
  SOCKET_ROLES,
  type ClientEventName,
  type IntentAck,
  type SocketEventName,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from './sync.js';

export {
  FURNITURE_KINDS,
  FURNITURE_LABELS,
  REST_RATES_BY_KIND,
  TOWN_MAP,
  furnitureRectsOf,
  wallRectsOf,
  type BlockedRect,
  type FurnitureDefinition,
  type FurnitureKind,
  type PlaceDefinition,
  type TileMapDefinition,
} from './world.js';
