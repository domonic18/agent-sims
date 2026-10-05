import {
  furnitureLabel,
  placeIdMatches,
  type PlaceDefinition,
  type TileMapDefinition,
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

/** 与服务端 _atPlace 同规则: 位于场所矩形内或入口格即"在场所"(按传入地图查,内置/生成通用) */
export function findPlaceAt(
  map: TileMapDefinition,
  x: number,
  y: number,
): PlaceDefinition | null {
  for (const place of map.places) {
    const inRect =
      x >= place.x && x < place.x + place.w && y >= place.y && y < place.y + place.h;
    if (inRect || (x === place.entrance.x && y === place.entrance.y)) {
      return place;
    }
  }
  return null;
}

/** 按 placeId 或 kind 前缀查场所(生成地图 kind-N 命名;与服务端 contains 同语义) */
export function findPlaceByRef(
  map: TileMapDefinition,
  placeId: string,
): PlaceDefinition | null {
  return map.places.find((p) => placeIdMatches(placeId, p.id)) ?? null;
}

/** 活动锚点使用格全集(M3.6e 内景): 与服务端 TileMap.activityAnchors 同源(按传入地图查) */
export function activityAnchors(map: TileMapDefinition, activityId: string): ActivityAnchor[] {
  const anchors: ActivityAnchor[] = [];
  for (const place of map.places) {
    for (const furniture of place.furniture ?? []) {
      if (furniture.activityId === activityId && furniture.use !== undefined) {
        anchors.push({
          x: furniture.use.x,
          y: furniture.use.y,
          placeId: place.id,
          label: furnitureLabel(furniture.kind),
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
