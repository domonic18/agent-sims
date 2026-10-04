import {
  FURNITURE_LABELS,
  TOWN_MAP,
  type PlaceDefinition,
  type WorldSnapshotMessage,
} from '@sims/shared';

/** 快照中驱动面板的角色字段(协议超集可直接传入) */
export type CharacterView = WorldSnapshotMessage['characters'][number];

export interface ActivityAnchor {
  x: number;
  y: number;
  placeId: string;
  label: string;
}

/** 与服务端 _atPlace 同规则: 位于场所矩形内或入口格即"在场所" */
export function findPlaceAt(
  snapshot: WorldSnapshotMessage,
  x: number,
  y: number,
): PlaceDefinition | null {
  for (const place of TOWN_MAP.places) {
    const inRect =
      x >= place.x && x < place.x + place.w && y >= place.y && y < place.y + place.h;
    if (inRect || (x === place.entrance.x && y === place.entrance.y)) {
      return place;
    }
  }
  return null;
}

/** 活动锚点使用格全集(M3.6e 内景): 与服务端 TileMap.activityAnchors 同源 TOWN_MAP */
export function activityAnchors(activityId: string): ActivityAnchor[] {
  const anchors: ActivityAnchor[] = [];
  for (const place of TOWN_MAP.places) {
    for (const furniture of place.furniture ?? []) {
      if (furniture.activityId === activityId && furniture.use !== undefined) {
        anchors.push({
          x: furniture.use.x,
          y: furniture.use.y,
          placeId: place.id,
          label: FURNITURE_LABELS[furniture.kind],
        });
      }
    }
  }
  return anchors;
}

/** 冰箱存取前提: 位于自己住房(矩形内或入口格)且(自有或租约未过期) */
export function homeAccess(
  housing: CharacterView['housing'],
  atPlaceId: string | null,
  day: number,
): { atHome: boolean; leaseValid: boolean } {
  return {
    atHome: housing !== null && atPlaceId === housing.propertyId,
    leaseValid:
      housing === null || housing.ownership === 'owned' || housing.paidThroughDay >= day,
  };
}
