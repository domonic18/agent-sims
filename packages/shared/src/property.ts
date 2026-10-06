/**
 * 房产目录(M3.3):与活动/商品同层,游戏内容双端共用。
 * placeId 对应 TOWN_MAP 场所;rentPrice 为每游戏日租金,
 * buyPrice 为买断价(自有后免租金)。
 */
export const PROPERTY_IDS = ['home-a', 'home-b', 'home-c', 'home-d'] as const;

export type PropertyId = (typeof PROPERTY_IDS)[number];

export interface PropertyDefinition {
  id: PropertyId;
  name: string;
  placeId: string;
  rentPrice: number;
  buyPrice: number;
}

export const PROPERTY_DEFINITIONS: readonly PropertyDefinition[] = [
  { id: 'home-a', name: '公寓 A(两居)', placeId: 'home-a', rentPrice: 8, buyPrice: 500 },
  { id: 'home-b', name: '公寓 B(两居)', placeId: 'home-b', rentPrice: 6, buyPrice: 360 },
  { id: 'home-c', name: '公寓 C(单居)', placeId: 'home-c', rentPrice: 4, buyPrice: 240 },
  { id: 'home-d', name: '公寓 D(两居)', placeId: 'home-d', rentPrice: 6, buyPrice: 360 },
];

export function getPropertyDefinition(id: string): PropertyDefinition | null {
  return PROPERTY_DEFINITIONS.find((property) => property.id === id) ?? null;
}

/** 住宿状态双端形态(sync.ts 角色快照 housing 同构): 谓词入参取结构子集即可 */
export interface HousingState {
  propertyId: string;
  ownership: 'rent' | 'owned';
  /** 租约付到的游戏日(含);自有忽略此字段 */
  paidThroughDay: number;
}

/** 租约有效性(TD-1 自 server housing.ts/web homeAccess 双份上提): 自有放行;租赁须付到日 ≥ 今日 */
export function isLeaseValid(
  housing: Pick<HousingState, 'ownership' | 'paidThroughDay'> | null,
  day: number,
): boolean {
  return housing === null || housing.ownership === 'owned' || housing.paidThroughDay >= day;
}
