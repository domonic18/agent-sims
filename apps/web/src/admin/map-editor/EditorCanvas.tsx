/**
 * 编辑器画布(批B):语义/贴图双渲染+交互层。
 * 滚轮缩放(光标锚点)/抓手工具、空格或中键平移;按工具分发: 选择命中+拖移
 * 场所、矩形拖画(场所/路径/围栏/堵塞)、单击放置(资源/装饰)。拖拽过程走
 * applyLive 预览、松手 record 单条命令;离散放置走 commit。
 * 效果视图走 mapRenderReal(游戏贴图),素材异步装载完成后重绘。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PlaceDefinition, ResourceNodeSeed, TileMapDefinition } from '@sims/shared';
import { renderMapDefinition } from '../mapRender';
import { ensureTownRenderAssets, renderTownMapReal } from '../mapRenderReal';
import { getAtPath } from './history';
import { KIND_PRESETS } from './kinds';
import { nextPlaceId, selectionPath, useEditor, type Selection } from './editorStore';

interface TilePos {
  tx: number;
  ty: number;
}

interface DraftRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const draftRectOf = (d: DraftRect) => ({
  x: Math.min(d.x0, d.x1),
  y: Math.min(d.y0, d.y1),
  w: Math.abs(d.x1 - d.x0) + 1,
  h: Math.abs(d.y1 - d.y0) + 1,
});

/** 命中检测优先级:点状(资源/装饰)→ 小矩形(围栏/铺装/堵塞)→ 场所占地 */
function hitTest(doc: TileMapDefinition, tx: number, ty: number): Selection | null {
  const inR = (r: { x: number; y: number; w: number; h: number }): boolean =>
    tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
  const resIndex = (doc.resources ?? []).findIndex((r) => r.x === tx && r.y === ty);
  if (resIndex >= 0) return { kind: 'resource', index: resIndex };
  const decorGroups = ['trees', 'lamps', 'flowers', 'bushes'] as const;
  if (doc.decor !== undefined) {
    for (const group of decorGroups) {
      const pts = doc.decor[group];
      const idx = pts.findIndex((p) => p[0] === tx && p[1] === ty);
      if (idx >= 0) return { kind: 'decor', group, index: idx };
    }
  }
  const fenceIndex = (doc.fences ?? []).findIndex((r) => inR(r));
  if (fenceIndex >= 0) return { kind: 'fence', index: fenceIndex };
  const pathIndex = doc.paths.findIndex((r) => inR(r));
  if (pathIndex >= 0) return { kind: 'path', index: pathIndex };
  const blockedIndex = doc.blockedRects.findIndex((r) => inR(r));
  if (blockedIndex >= 0) return { kind: 'blocked', index: blockedIndex };
  const place = doc.places.find((p) => inR(p));
  if (place !== undefined) return { kind: 'place', id: place.id };
  return null;
}

/** 选区 → 可绘制矩形 */
function selectionRect(doc: TileMapDefinition, selection: Selection | null) {
  if (selection === null) return null;
  const obj: unknown = getAtPath(doc, selectionPath(doc, selection) ?? []);
  if (obj === undefined || obj === null) return null;
  if (selection.kind === 'decor') {
    const p = obj as [number, number];
    return { x: p[0], y: p[1], w: 1, h: 1 };
  }
  if (selection.kind === 'resource') {
    const r = obj as { x: number; y: number };
    return { x: r.x, y: r.y, w: 1, h: 1 };
  }
  return obj as { x: number; y: number; w: number; h: number };
}

export function EditorCanvas() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const tool = useEditor((s) => s.tool);
  const placeKind = useEditor((s) => s.placeKind);
  const decorGroup = useEditor((s) => s.decorGroup);
  const resourceKind = useEditor((s) => s.resourceKind);
  const selection = useEditor((s) => s.selection);
  const hidden = useEditor((s) => s.hidden);
  const showGrid = useEditor((s) => s.showGrid);
  const showLabels = useEditor((s) => s.showLabels);
  const viewMode = useEditor((s) => s.viewMode);

  const [draft, setDraft] = useState<DraftRect | null>(null);
  const [assetsVersion, setAssetsVersion] = useState(0);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const moveRef = useRef<{ index: number; start: TilePos; orig: PlaceDefinition; dx: number; dy: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // 效果视图:按当前文档装载贴图素材,有新图落地才 bump 重绘(失败静默降级色块)
  useEffect(() => {
    if (viewMode !== 'real') return;
    let alive = true;
    void ensureTownRenderAssets(doc).then((loaded) => {
      if (alive && loaded) setAssetsVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, [viewMode, doc]);

  // 绘制(可见层过滤后交给共享渲染;叠加草稿与选区)
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (wrap === null || canvas === null) return;
    const draw = (): void => {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.translate(view.ox, view.oy);
      const visible: TileMapDefinition = {
        ...doc,
        patches: hidden.patches ? [] : doc.patches,
        paths: hidden.paths ? [] : doc.paths,
        places: hidden.places ? [] : doc.places,
        fences: hidden.fences ? [] : doc.fences,
        resources: hidden.resources ? [] : doc.resources,
        decor: hidden.decor ? undefined : doc.decor,
        blockedRects: hidden.blocked ? [] : doc.blockedRects,
        townCore: hidden.townCore ? undefined : doc.townCore,
      };
      if (viewMode === 'real') {
        renderTownMapReal(ctx, visible, { tile: view.tile, grid: showGrid, labels: showLabels });
      } else {
        renderMapDefinition(ctx, visible, { tile: view.tile, grid: showGrid, labels: showLabels });
      }

      if (draft !== null) {
        const r = draftRectOf(draft);
        ctx.strokeStyle = '#f4f4f4';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(r.x * view.tile + 0.5, r.y * view.tile + 0.5, r.w * view.tile - 1, r.h * view.tile - 1);
        ctx.setLineDash([]);
      }
      const sel = selectionRect(doc, selection);
      if (sel !== null) {
        ctx.strokeStyle = '#41a6f6';
        ctx.lineWidth = 2;
        ctx.strokeRect(sel.x * view.tile + 1, sel.y * view.tile + 1, sel.w * view.tile - 2, sel.h * view.tile - 2);
      }
      ctx.restore();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [doc, view, tool, selection, hidden, showGrid, showLabels, draft, viewMode, assetsVersion]);

  // 滚轮缩放(光标锚点;React 根节点 wheel 被动化,须原生监听才能 preventDefault)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const { tile, ox, oy } = useEditor.getState().view;
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nextTile = Math.min(48, Math.max(4, Math.round(tile * factor)));
      if (nextTile === tile) return;
      useEditor.getState().setView({
        tile: nextTile,
        ox: Math.round(mx - ((mx - ox) / tile) * nextTile),
        oy: Math.round(my - ((my - oy) / tile) * nextTile),
      });
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, []);

  // 空格按住平移
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceRef.current = true;
        setPanning(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setPanning(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toTile = (e: ReactPointerEvent<HTMLCanvasElement>): TilePos => {
    const canvas = canvasRef.current;
    if (canvas === null) return { tx: 0, ty: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      tx: Math.floor((e.clientX - rect.left - view.ox) / view.tile),
      ty: Math.floor((e.clientY - rect.top - view.oy) / view.tile),
    };
  };

  const clampTile = (p: TilePos): TilePos => ({
    tx: Math.min(doc.width - 1, Math.max(0, p.tx)),
    ty: Math.min(doc.height - 1, Math.max(0, p.ty)),
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && (spaceRef.current || tool === 'pan'))) {
      panRef.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    const pos = clampTile(toTile(e));
    const store = useEditor.getState();

    if (tool === 'select') {
      const hit = hitTest(doc, pos.tx, pos.ty);
      if (
        hit !== null &&
        hit.kind === 'place' &&
        selection?.kind === 'place' &&
        selection.id === hit.id
      ) {
        const index = doc.places.findIndex((p) => p.id === hit.id);
        moveRef.current = { index, start: pos, orig: doc.places[index]!, dx: 0, dy: 0 };
        return;
      }
      store.select(hit);
      return;
    }
    if (tool === 'place' || tool === 'path' || tool === 'fence' || tool === 'blocked') {
      setDraft({ x0: pos.tx, y0: pos.ty, x1: pos.tx, y1: pos.ty });
      return;
    }
    if (tool === 'resource') {
      const after: ResourceNodeSeed = { kind: resourceKind, x: pos.tx, y: pos.ty };
      store.commit({
        kind: 'add',
        label: `放资源(${after.kind})`,
        path: ['resources', (doc.resources ?? []).length],
        before: null,
        after,
      });
      store.select({ kind: 'resource', index: (doc.resources ?? []).length });
      return;
    }
    if (tool === 'decor') {
      const count = doc.decor?.[decorGroup]?.length ?? 0;
      store.commit({
        kind: 'add',
        label: `放装饰(${decorGroup})`,
        path: ['decor', decorGroup, count],
        before: null,
        after: [pos.tx, pos.ty],
      });
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (panRef.current !== null) {
      useEditor.getState().setView({
        ox: panRef.current.ox + (e.clientX - panRef.current.x),
        oy: panRef.current.oy + (e.clientY - panRef.current.y),
      });
      return;
    }
    const pos = clampTile(toTile(e));
    if (moveRef.current !== null) {
      const { index, start, orig } = moveRef.current;
      const dx = Math.min(
        doc.width - orig.x - orig.w,
        Math.max(-orig.x, pos.tx - start.tx),
      );
      const dy = Math.min(
        doc.height - orig.y - orig.h,
        Math.max(-orig.y, pos.ty - start.ty),
      );
      moveRef.current.dx = dx;
      moveRef.current.dy = dy;
      const moved: PlaceDefinition = {
        ...orig,
        x: orig.x + dx,
        y: orig.y + dy,
        entrance: { x: orig.entrance.x + dx, y: orig.entrance.y + dy },
        ...(orig.door !== undefined ? { door: { x: orig.door.x + dx, y: orig.door.y + dy } } : {}),
        ...(orig.furniture !== undefined
          ? { furniture: orig.furniture.map((f) => ({ ...f, x: f.x + dx, y: f.y + dy })) }
          : {}),
      };
      useEditor.getState().applyLive(['places', index], moved);
      return;
    }
    if (draft !== null) setDraft({ ...draft, x1: pos.tx, y1: pos.ty });
  };

  const onPointerUp = (): void => {
    panRef.current = null;
    setPanning(spaceRef.current);
    const store = useEditor.getState();
    if (moveRef.current !== null) {
      const { index, orig, dx, dy } = moveRef.current;
      moveRef.current = null;
      if (dx !== 0 || dy !== 0) {
        store.record({
          kind: 'move',
          label: `移动「${orig.name}」`,
          path: ['places', index],
          before: orig,
          after: doc.places[index]!,
        });
      }
      return;
    }
    if (draft === null) return;
    const r = draftRectOf(draft);
    setDraft(null);
    const single = r.w === 1 && r.h === 1;
    if (tool === 'place') {
      const preset = KIND_PRESETS[placeKind];
      const w = single ? Math.min(preset.size[0], doc.width) : r.w;
      const h = single ? Math.min(preset.size[1], doc.height) : r.h;
      const x = Math.min(r.x, doc.width - w);
      const y = Math.min(r.y, doc.height - h);
      const id = nextPlaceId(doc, placeKind);
      const n = Number(id.slice(id.lastIndexOf('-') + 1));
      const doorX = x + Math.floor((w - 1) / 2);
      const place: PlaceDefinition = {
        id,
        name: n <= 1 ? preset.label : `${preset.label}${n}`,
        x,
        y,
        w,
        h,
        entrance: { x: doorX, y: Math.min(y + h, doc.height - 1) },
        ...(preset.door ? { door: { x: doorX, y: y + h - 1 } } : {}),
      };
      store.commit({
        kind: 'add',
        label: `加${preset.label}`,
        path: ['places', doc.places.length],
        before: null,
        after: place,
      });
      store.select({ kind: 'place', id });
      return;
    }
    if (tool === 'path' || tool === 'fence' || tool === 'blocked') {
      const target =
        tool === 'path' ? 'paths' : tool === 'fence' ? 'fences' : 'blockedRects';
      const count =
        target === 'paths' ? doc.paths.length : target === 'fences' ? (doc.fences ?? []).length : doc.blockedRects.length;
      const labels = { paths: '铺装', fences: '围栏', blockedRects: '障碍' } as const;
      store.commit({
        kind: 'add',
        label: `画${labels[target]}`,
        path: [target, count],
        before: null,
        after: r,
      });
      const selKind = tool === 'path' ? 'path' : tool === 'fence' ? 'fence' : 'blocked';
      store.select({ kind: selKind, index: count } as Selection);
    }
  };

  const cursor = panning ? 'grabbing' : tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';

  return (
    <div
      ref={wrapRef}
      className="map-editor-canvas-wrap"
      style={{ background: '#14162a', width: '100%', height: '100%', overflow: 'hidden', cursor }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', imageRendering: 'pixelated', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
