/**
 * 房产目录(M3.3):与活动/商品同层,游戏内容双端共用。
 * placeId 对应 TOWN_MAP 场所;rentPrice 为每游戏日租金,
 * buyPrice 为买断价(自有后免租金)。
 */
export const PROPERTY_IDS = ['home'] as const;

export type PropertyId = (typeof PROPERTY_IDS)[number];

export interface PropertyDefinition {
  id: PropertyId;
  name: string;
  placeId: string;
  rentPrice: number;
  buyPrice: number;
}

export const PROPERTY_DEFINITIONS: readonly PropertyDefinition[] = [
  { id: 'home', name: '公寓', placeId: 'home', rentPrice: 8, buyPrice: 500 },
];

export function getPropertyDefinition(id: string): PropertyDefinition | null {
  return PROPERTY_DEFINITIONS.find((property) => property.id === id) ?? null;
}
