import { create } from 'zustand';
import type { WorldEvent, WorldSnapshotMessage } from '@sims/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * 世界状态仓:同步层(net/socket)写入,React HUD 与 Phaser 场景读取。
 * 快照每 tick 全量覆盖(tick 序号天然防乱序);Phaser 在 update 轮询 getState 做插值。
 */
export interface WorldStore {
  status: ConnectionStatus;
  snapshot: WorldSnapshotMessage | null;
  lastEvent: WorldEvent | null;
  /** 面板当前操作的角色(null=未选,快照到位后自动选首个) */
  selectedCharacterId: string | null;
  /** 地图点击定位的场所(null=无高亮),侧栏滚动联动 */
  focusPlaceId: string | null;
  setStatus: (status: ConnectionStatus) => void;
  applySnapshot: (snapshot: WorldSnapshotMessage) => void;
  applyEvent: (event: WorldEvent) => void;
  selectCharacter: (id: string | null) => void;
  focusPlace: (id: string | null) => void;
  /** 控制事件就地修正快照(暂停期间无 tick 广播) */
  applyControl: (paused: boolean, timeScale: number) => void;
}

export const useWorldStore = create<WorldStore>((set) => ({
  status: 'connecting',
  snapshot: null,
  lastEvent: null,
  selectedCharacterId: null,
  focusPlaceId: null,
  setStatus: (status) => set({ status }),
  applySnapshot: (snapshot) =>
    set((state) => {
      const ids = snapshot.characters.map((character) => character.id);
      const selected =
        state.selectedCharacterId !== null && ids.includes(state.selectedCharacterId)
          ? state.selectedCharacterId
          : (ids[0] ?? null);
      return { snapshot, selectedCharacterId: selected };
    }),
  applyEvent: (event) => set({ lastEvent: event }),
  selectCharacter: (id) => set({ selectedCharacterId: id }),
  focusPlace: (id) => set({ focusPlaceId: id }),
  applyControl: (paused, timeScale) =>
    set((state) => ({
      snapshot:
        state.snapshot === null
          ? null
          : { ...state.snapshot, paused, timeScale },
    })),
}));
