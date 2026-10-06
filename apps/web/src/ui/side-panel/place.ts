import {
  activityAnchors,
  findPlaceAt,
  findPlaceByRef,
  isLeaseValid,
  type WorldSnapshotMessage,
} from '@sims/shared';

/** 快照中驱动面板的角色字段(协议超集可直接传入) */
export type CharacterView = WorldSnapshotMessage['characters'][number];

/** 场所在位/引用查询与锚点收集(TD-1 谓词上提 shared 同源,此处薄壳再导出) */
export { activityAnchors, findPlaceAt, findPlaceByRef };

/** 冰箱存取前提: 位于自己住房(矩形内或入口格)且(自有或租约未过期;谓词 shared 同源) */
export function homeAccess(
  housing: CharacterView['housing'],
  atPlaceId: string | null,
  day: number,
): { atHome: boolean; leaseValid: boolean } {
  return {
    atHome: housing !== null && atPlaceId === housing.propertyId,
    leaseValid: isLeaseValid(housing, day),
  };
}
