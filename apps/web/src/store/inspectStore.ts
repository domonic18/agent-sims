import { create } from 'zustand';
import type { MaintenanceSpot, PlaceDefinition, ResourceNode } from '@sims/shared';
import type { FurnitureDefinition } from '@sims/shared';

/** 点选物件(信息卡内容):优先级 角色 > 维护点/资源点 > 家具 > 场所 */
export type InspectTarget =
  | { kind: 'furniture'; furniture: FurnitureDefinition; placeName: string }
  | { kind: 'resource'; resource: ResourceNode }
  | { kind: 'maintenance'; spot: MaintenanceSpot }
  | { kind: 'place'; place: PlaceDefinition };

interface InspectState {
  target: InspectTarget | null;
  open: (target: InspectTarget) => void;
  close: () => void;
}

/** 游览信息卡(游客与管理员共用):点画布物件弹卡看介绍,点空白地/✕关闭 */
export const useInspectStore = create<InspectState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
