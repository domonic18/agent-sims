import { create } from 'zustand';
import {
  RECIPES,
  type CraftRecipeId,
  type RecipeDef,
  type TileMapDefinition,
  type WorkTaskId,
  type WorldEvent,
  type WorldRulesView,
  type WorldSnapshotMessage,
} from '@sims/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** 相机模式(UI-1): follow=跟随选中角色,overview=缩到最小看全图,free=拖拽平移+滚轮缩放不跟随 */
export type CameraMode = 'follow' | 'overview' | 'free';

/**
 * 启动阶段(加载屏 L1): world-data=拉素材清单/地图,textures=Phaser 灌像素纹理,
 * scene-ready=场景已渲染(叠加快照是否到位判断摘罩),error=素材加载失败(露出错误文案)
 */
export type BootPhase = 'world-data' | 'textures' | 'scene-ready' | 'error';

/** 带递增序号的事件条目:消费者按 seq 增量拉取,同 tick 多事件不丢 */
export interface SequencedEvent {
  seq: number;
  event: WorldEvent;
}

const EVENT_QUEUE_MAX = 128;

/** 配方读用选择器:世界快照未拉到时出厂表兜底(admin 未热改过时两者一致) */
export const selectWorldRecipes = (state: WorldStore): Record<CraftRecipeId, RecipeDef> =>
  state.recipes ?? RECIPES;

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
  /** 相机模式(UI-1),Phaser 场景每帧消费;滚轮缩到最小自动切 overview */
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;
  /** 地图点击定位的场所(null=无高亮),侧栏滚动联动 */
  focusPlaceId: string | null;
  /** 当前世界地图定义(WorldCanvas fetch 后写入;侧面板场所/锚点/商店查此源,不再绑内置图) */
  map: TileMapDefinition | null;
  /** 世界参数生效全集与规则视图(设置弹窗首开 GET 回填,此后 world.params/rules 事件保鲜) */
  params: Record<string, number> | null;
  rules: WorldRulesView | null;
  /** 每世界配方全集(页面装载 GET 回填,此后 world.recipes 事件保鲜;null=未拉到,消费端出厂兜底) */
  recipes: Record<CraftRecipeId, RecipeDef> | null;
  applyRecipes: (recipes: Record<CraftRecipeId, RecipeDef>) => void;
  /** 在线查看人数(presence 事件驱动:页面打开的连接数,直播场景即访客数) */
  viewers: number;
  setViewers: (viewers: number) => void;
  /** 启动阶段与纹理加载进度(0~1;WorldCanvas/WorldScene 写,GamePage 加载屏读) */
  bootPhase: BootPhase;
  textureProgress: number;
  setBootPhase: (phase: BootPhase) => void;
  setTextureProgress: (progress: number) => void;
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
  cameraMode: 'follow',
  setCameraMode: (mode) => set({ cameraMode: mode }),
  focusPlaceId: null,
  map: null,
  params: null,
  rules: null,
  recipes: null,
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
  applyRecipes: (recipes) => set({ recipes }),
  viewers: 0,
  setViewers: (viewers) => set({ viewers }),
  bootPhase: 'world-data',
  textureProgress: 0,
  setBootPhase: (phase) => set({ bootPhase: phase }),
  setTextureProgress: (progress) => set({ textureProgress: progress }),
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
