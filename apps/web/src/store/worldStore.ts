import { create } from 'zustand';
import type {
  TileMapDefinition,
  WorkTaskId,
  WorldEvent,
  WorldRulesView,
  WorldSnapshotMessage,
} from '@sims/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** 带递增序号的事件条目:消费者按 seq 增量拉取,同 tick 多事件不丢 */
export interface SequencedEvent {
  seq: number;
  event: WorldEvent;
}

const EVENT_QUEUE_MAX = 64;

/**
 * 世界状态仓:同步层(net/socket)写入,React HUD 与 Phaser 场景读取。
 * 快照每 tick 全量覆盖(tick 序号天然防乱序);Phaser 在 update 轮询 getState 做插值。
 */
export interface WorldStore {
  status: ConnectionStatus;
  snapshot: WorldSnapshotMessage | null;
  lastEvent: WorldEvent | null;
  /** 离散事件环形队列(社交 v1:气泡/日志按 seq 增量消费,同 tick 多事件不互相覆盖) */
  events: SequencedEvent[];
  eventSeq: number;
  /** 面板当前操作的角色(null=未选,快照到位后自动选首个) */
  selectedCharacterId: string | null;
  /** 地图点击定位的场所(null=无高亮),侧栏滚动联动 */
  focusPlaceId: string | null;
  /** 当前世界地图定义(WorldCanvas fetch 后写入;侧面板场所/锚点/商店查此源,不再绑内置图) */
  map: TileMapDefinition | null;
  /** 世界参数生效全集与规则视图(设置弹窗首开 GET 回填,此后 world.params/rules 事件保鲜) */
  params: Record<string, number> | null;
  rules: WorldRulesView | null;
  /** 连续作业开关(M-G.5/M-G.6):key=characterId,开启后该角色空闲即自动接最近同岗单(含采集岗) */
  continuousWork: Record<string, WorkTaskId>;
  toggleContinuousWork: (characterId: string, task: WorkTaskId | null) => void;
  setStatus: (status: ConnectionStatus) => void;
  setMap: (map: TileMapDefinition) => void;
  applySnapshot: (snapshot: WorldSnapshotMessage) => void;
  applyEvent: (event: WorldEvent) => void;
  selectCharacter: (id: string | null) => void;
  focusPlace: (id: string | null) => void;
  /** 控制事件就地修正快照(暂停期间无 tick 广播) */
  applyControl: (paused: boolean, timeScale: number) => void;
  applyParams: (params: Record<string, number>) => void;
  applyRules: (rules: WorldRulesView) => void;
}

export const useWorldStore = create<WorldStore>((set) => ({
  status: 'connecting',
  snapshot: null,
  lastEvent: null,
  events: [],
  eventSeq: 0,
  selectedCharacterId: null,
  focusPlaceId: null,
  map: null,
  params: null,
  rules: null,
  continuousWork: {},
  setStatus: (status) => set({ status }),
  setMap: (map) => set({ map }),
  applySnapshot: (snapshot) =>
    set((state) => {
      const ids = snapshot.characters.map((character) => character.id);
      const selected =
        state.selectedCharacterId !== null && ids.includes(state.selectedCharacterId)
          ? state.selectedCharacterId
          : (ids[0] ?? null);
      return { snapshot, selectedCharacterId: selected };
    }),
  applyEvent: (event) =>
    set((state) => ({
      lastEvent: event,
      events: [...state.events, { seq: state.eventSeq + 1, event }].slice(-EVENT_QUEUE_MAX),
      eventSeq: state.eventSeq + 1,
    })),
  selectCharacter: (id) => set({ selectedCharacterId: id }),
  focusPlace: (id) => set({ focusPlaceId: id }),
  applyControl: (paused, timeScale) =>
    set((state) => ({
      snapshot:
        state.snapshot === null
          ? null
          : { ...state.snapshot, paused, timeScale },
    })),
  applyParams: (params) => set({ params }),
  applyRules: (rules) => set({ rules }),
  toggleContinuousWork: (characterId, task) =>
    set((state) => {
      const continuousWork = { ...state.continuousWork };
      if (task === null) {
        delete continuousWork[characterId];
      } else {
        continuousWork[characterId] = task;
      }
      return { continuousWork };
    }),
}));
