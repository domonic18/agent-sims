/**
 * 编辑器全局状态(批B,zustand 仅进 admin chunk):doc+选区+工具+视口+双栈。
 * 历史复用 history.ts 纯函数;拖拽类交互走 applyLive(只改 doc 不入栈)+
 * record(松手时一次性入栈),离散操作走 commit(应用+入栈),保证拖一段
 * = 一条命令,undo 不会逐帧回放。
 */
import { create } from 'zustand';
import type { PlaceKind, ResourceNode, TileMapDefinition } from '@sims/shared';
import { normalizeDefinition } from './normalize';
import {
  commit as commitCommand,
  createHistory,
  popRedo,
  popUndo,
  recordCommand,
  setAtPath,
  type EditorCommand,
  type History,
  type Path,
} from './history';

export type EditorTool =
  | 'select'
  | 'pan'
  | 'place'
  | 'path'
  | 'fence'
  | 'resource'
  | 'decor'
  | 'blocked';

/** 画布视图模式:semantic=语义色块(编辑),real=游戏贴图效果(所见即所玩) */
export type EditorViewMode = 'semantic' | 'real';

/** 点状装饰组([x,y] 元组数组,单击放格;props/flats 复杂对象 v1 不编辑) */
export type DecorPointGroup = 'trees' | 'lamps' | 'flowers' | 'bushes';

export type Selection =
  | { kind: 'place'; id: string }
  | { kind: 'path'; index: number }
  | { kind: 'fence'; index: number }
  | { kind: 'resource'; index: number }
  | { kind: 'blocked'; index: number }
  | { kind: 'decor'; group: DecorPointGroup; index: number };

export type LayerKey =
  | 'patches'
  | 'paths'
  | 'places'
  | 'fences'
  | 'resources'
  | 'decor'
  | 'blocked'
  | 'townCore'
  | 'grid';

export interface Viewport {
  tile: number;
  ox: number;
  oy: number;
}

interface EditorState {
  mapId: string | null;
  name: string;
  doc: TileMapDefinition;
  dirty: boolean;
  tool: EditorTool;
  placeKind: PlaceKind;
  decorGroup: DecorPointGroup;
  resourceKind: ResourceNode['kind'];
  selection: Selection | null;
  view: Viewport;
  viewMode: EditorViewMode;
  showGrid: boolean;
  showLabels: boolean;
  hidden: Record<Exclude<LayerKey, 'grid'>, boolean>;
  history: History;

  loadMap(init: { mapId: string | null; name: string; definition: TileMapDefinition }): void;
  setName(name: string): void;
  setTool(tool: EditorTool): void;
  setPlaceKind(kind: PlaceKind): void;
  setDecorGroup(group: DecorPointGroup): void;
  setResourceKind(kind: ResourceNode['kind']): void;
  select(selection: Selection | null): void;
  setView(patch: Partial<Viewport>): void;
  setViewMode(mode: EditorViewMode): void;
  toggleGrid(): void;
  toggleLabels(): void;
  toggleLayer(key: Exclude<LayerKey, 'grid'>): void;
  /** 离散编辑:应用 after 到 doc+入栈 */
  commit(command: EditorCommand): void;
  /** 拖拽收尾:doc 已被 applyLive 更新,仅入栈 */
  record(command: EditorCommand): void;
  /** 拖拽过程预览:只改 doc 不动历史 */
  applyLive(path: Path, value: unknown): void;
  undo(): void;
  redo(): void;
  markSaved(mapId: string): void;
}

/** kind-N 唯一 id(与生成图命名约定一致,placeKindOf 可反解 kind) */
export function nextPlaceId(doc: TileMapDefinition, kind: PlaceKind): string {
  const taken = new Set(doc.places.map((p) => p.id));
  let n = 1;
  while (taken.has(`${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

/** 选区 → doc 路径(对象已被删时返回 null,面板自然落空) */
export function selectionPath(doc: TileMapDefinition, selection: Selection): Path | null {
  switch (selection.kind) {
    case 'place': {
      const index = doc.places.findIndex((p) => p.id === selection.id);
      return index >= 0 ? ['places', index] : null;
    }
    case 'path':
      return ['paths', selection.index];
    case 'fence':
      return ['fences', selection.index];
    case 'resource':
      return ['resources', selection.index];
    case 'blocked':
      return ['blockedRects', selection.index];
    case 'decor':
      return ['decor', selection.group, selection.index];
  }
}

export const useEditor = create<EditorState>((set, get) => ({
  mapId: null,
  name: '未命名地图',
  doc: { width: 24, height: 18, blockedRects: [], paths: [], places: [] },
  dirty: false,
  tool: 'select',
  placeKind: 'home',
  decorGroup: 'trees',
  resourceKind: 'berry_bush',
  selection: null,
  view: { tile: 24, ox: 0, oy: 0 },
  viewMode: 'semantic',
  showGrid: true,
  showLabels: true,
  hidden: {
    patches: false,
    paths: false,
    places: false,
    fences: false,
    resources: false,
    decor: false,
    blocked: false,
    townCore: false,
  },
  history: createHistory(),

  loadMap: (init) =>
    set({
      mapId: init.mapId,
      name: init.name,
      doc: normalizeDefinition(init.definition),
      dirty: false,
      selection: null,
      history: createHistory(),
      view: { tile: init.definition.width > 64 ? 16 : 24, ox: 0, oy: 0 },
    }),
  setName: (name) => set({ name, dirty: true }),
  setTool: (tool) => set({ tool, selection: null }),
  setPlaceKind: (placeKind) => set({ placeKind }),
  setDecorGroup: (decorGroup) => set({ decorGroup }),
  setResourceKind: (resourceKind) => set({ resourceKind }),
  select: (selection) => set({ selection }),
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  setViewMode: (viewMode) => set({ viewMode }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  toggleLayer: (key) => set((s) => ({ hidden: { ...s.hidden, [key]: !s.hidden[key] } })),

  commit: (command) => {
    const { doc, history } = get();
    const last = history.undo[history.undo.length - 1];
    if (
      command.coalesce !== undefined &&
      last !== undefined &&
      last.coalesce === command.coalesce
    ) {
      // 连续微编辑(逐键/拖步进)合并进上一条:只更新其 after
      const undo = [...history.undo.slice(0, -1), { ...last, after: command.after }];
      set({
        doc: setAtPath(doc, command.path, command.after),
        history: { undo, redo: [] },
        dirty: true,
      });
      return;
    }
    const next = commitCommand(doc, history, command);
    set({ doc: next.doc, history: next.history, dirty: true });
  },
  record: (command) =>
    set((s) => ({
      history: recordCommand(s.history, command),
      dirty: true,
    })),
  applyLive: (path, value) =>
    set((s) => ({ doc: setAtPath(s.doc, path, value) })),
  undo: () => {
    const { doc, history } = get();
    const result = popUndo(doc, history);
    if (result === null) return;
    set({ doc: result.doc, history: result.history, dirty: true, selection: null });
  },
  redo: () => {
    const { doc, history } = get();
    const result = popRedo(doc, history);
    if (result === null) return;
    set({ doc: result.doc, history: result.history, dirty: true, selection: null });
  },
  markSaved: (mapId) => set({ mapId, dirty: false }),
}));
