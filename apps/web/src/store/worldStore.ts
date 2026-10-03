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
  setStatus: (status: ConnectionStatus) => void;
  applySnapshot: (snapshot: WorldSnapshotMessage) => void;
  applyEvent: (event: WorldEvent) => void;
  /** 控制事件就地修正快照(暂停期间无 tick 广播) */
  applyControl: (paused: boolean, timeScale: number) => void;
}

export const useWorldStore = create<WorldStore>((set) => ({
  status: 'connecting',
  snapshot: null,
  lastEvent: null,
  setStatus: (status) => set({ status }),
  applySnapshot: (snapshot) => set({ snapshot }),
  applyEvent: (event) => set({ lastEvent: event }),
  applyControl: (paused, timeScale) =>
    set((state) => ({
      snapshot:
        state.snapshot === null
          ? null
          : { ...state.snapshot, paused, timeScale },
    })),
}));
