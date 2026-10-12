/**
 * 编辑器画布(批B):语义/贴图双渲染+交互层。
 * 滚轮缩放(光标锚点,累计阈值降敏,右下角另有 +/-/适应 按钮)、抓手工具、
 * 空格或中键平移;按工具分发: 选择命中+直接拖拽平移(场所整体或屋内单件
 * 家具,use 格随动)、矩形拖画(场所/路径/围栏/堵塞)、单击放置(资源/装饰)。
 * 拖拽过程走 applyLive 预览、松手 record 单条命令;离散放置走 commit。
 * 效果视图走 mapRenderReal(游戏贴图),素材异步装载完成后重绘。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Tooltip } from 'antd';
import { ExpandOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import type { FurnitureDefinition, PlaceDefinition, ResourceNodeSeed, TileMapDefinition } from '@sims/shared';
import { furnitureLabel } from '@sims/shared';
import { renderMapDefinition } from '../mapRender';
import { ensureTownRenderAssets, renderTownMapReal } from '../mapRenderReal';
import { getAtPath } from './history';
import { KIND_PRESETS } from './kinds';
import { hitTest } from './hitTest';
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

/** 拖拽会话:furnIndex=null 移动整场所(家具随动),否则移动单件家具 */
interface MoveState {
  placeIndex: number;
  furnIndex: number | null;
  start: TilePos;
  orig: PlaceDefinition | FurnitureDefinition;
  dx: number;
  dy: number;
}

const ZOOM_MIN = 4;
const ZOOM_MAX = 48;
const ZOOM_FACTOR = 1.1;
/** 滚轮累计量达到该值才缩放一档(鼠标一格滚牙≈100,触控板小步累计) */
const ZOOM_STEP = 40;

const draftRectOf = (d: DraftRect) => ({
  x: Math.min(d.x0, d.x1),
  y: Math.min(d.y0, d.y1),
  w: Math.abs(d.x1 - d.x0) + 1,
  h: Math.abs(d.y1 - d.y0) + 1,
});

/** 以 (mx,my) 为锚点缩放一档:锚点下的地图坐标保持不动 */
function zoomStep(mx: number, my: number, dir: 1 | -1): void {
  const { tile, ox, oy } = useEditor.getState().view;
  const factor = dir > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  const nextTile = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(tile * factor)));
  if (nextTile === tile) return;
  useEditor.getState().setView({
    tile: nextTile,
    ox: Math.round(mx - ((mx - ox) / tile) * nextTile),
    oy: Math.round(my - ((my - oy) / tile) * nextTile),
  });
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
  const fitTick = useEditor((s) => s.fitTick);

  const [draft, setDraft] = useState<DraftRect | null>(null);
  const [assetsVersion, setAssetsVersion] = useState(0);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const moveRef = useRef<MoveState | null>(null);
  const zoomAccRef = useRef(0);
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

  // 载入/切换地图时整图居中适配视口
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const wrap = wrapRef.current;
      if (wrap === null) return;
      const d = useEditor.getState().doc;
      const cw = wrap.clientWidth - 32;
      const ch = wrap.clientHeight - 32;
      if (cw <= 0 || ch <= 0) return;
      const tile = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.floor(Math.min(cw / d.width, ch / d.height))));
      useEditor.getState().setView({
        tile,
        ox: Math.round((wrap.clientWidth - d.width * tile) / 2),
        oy: Math.round((wrap.clientHeight - d.height * tile) / 2),
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [fitTick]);

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

  // 滚轮缩放(光标锚点+累计阈值降敏;React 根节点 wheel 被动化,须原生监听才能 preventDefault)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const inc = -delta;
      if (zoomAccRef.current * inc < 0) zoomAccRef.current = 0;
      zoomAccRef.current += inc;
      if (Math.abs(zoomAccRef.current) < ZOOM_STEP) return;
      const dir: 1 | -1 = zoomAccRef.current > 0 ? 1 : -1;
      zoomAccRef.current = 0;
      const rect = wrap.getBoundingClientRect();
      zoomStep(e.clientX - rect.left, e.clientY - rect.top, dir);
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

  const zoomCenter = (dir: 1 | -1): void => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    zoomStep(wrap.clientWidth / 2, wrap.clientHeight / 2, dir);
  };

  const fitToDoc = (): void => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const d = useEditor.getState().doc;
    const cw = wrap.clientWidth - 32;
    const ch = wrap.clientHeight - 32;
    if (cw <= 0 || ch <= 0) return;
    const tile = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.floor(Math.min(cw / d.width, ch / d.height))));
    useEditor.getState().setView({
      tile,
      ox: Math.round((wrap.clientWidth - d.width * tile) / 2),
      oy: Math.round((wrap.clientHeight - d.height * tile) / 2),
    });
  };

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
      if (hit !== null && hit.kind === 'place') {
        const index = doc.places.findIndex((p) => p.id === hit.id);
        const place = doc.places[index];
        if (place !== undefined) {
          moveRef.current = { placeIndex: index, furnIndex: null, start: pos, orig: place, dx: 0, dy: 0 };
        }
      } else if (hit !== null && hit.kind === 'furniture') {
        const placeIndex = doc.places.findIndex((p) => p.id === hit.placeId);
        const furn = doc.places[placeIndex]?.furniture?.[hit.index];
        if (placeIndex >= 0 && furn !== undefined) {
          moveRef.current = { placeIndex, furnIndex: hit.index, start: pos, orig: furn, dx: 0, dy: 0 };
        }
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
      const m = moveRef.current;
      const orig = m.orig;
      const dx = Math.min(doc.width - orig.x - orig.w, Math.max(-orig.x, pos.tx - m.start.tx));
      const dy = Math.min(doc.height - orig.y - orig.h, Math.max(-orig.y, pos.ty - m.start.ty));
      m.dx = dx;
      m.dy = dy;
      if (m.furnIndex === null) {
        const place = orig as PlaceDefinition;
        const moved: PlaceDefinition = {
          ...place,
          x: place.x + dx,
          y: place.y + dy,
          entrance: { x: place.entrance.x + dx, y: place.entrance.y + dy },
          ...(place.door !== undefined ? { door: { x: place.door.x + dx, y: place.door.y + dy } } : {}),
          ...(place.furniture !== undefined
            ? { furniture: place.furniture.map((f) => ({ ...f, x: f.x + dx, y: f.y + dy })) }
            : {}),
        };
        useEditor.getState().applyLive(['places', m.placeIndex], moved);
      } else {
        const furn = orig as FurnitureDefinition;
        const moved: FurnitureDefinition = {
          ...furn,
          x: furn.x + dx,
          y: furn.y + dy,
          ...(furn.use !== undefined ? { use: { x: furn.use.x + dx, y: furn.use.y + dy } } : {}),
        };
        useEditor.getState().applyLive(['places', m.placeIndex, 'furniture', m.furnIndex], moved);
      }
      return;
    }
    if (draft !== null) setDraft({ ...draft, x1: pos.tx, y1: pos.ty });
  };

  const onPointerUp = (): void => {
    panRef.current = null;
    setPanning(spaceRef.current);
    const store = useEditor.getState();
    if (moveRef.current !== null) {
      const m = moveRef.current;
      moveRef.current = null;
      if (m.dx !== 0 || m.dy !== 0) {
        const place = doc.places[m.placeIndex];
        if (m.furnIndex === null) {
          if (place !== undefined) {
            store.record({
              kind: 'move',
              label: `移动「${(m.orig as PlaceDefinition).name}」`,
              path: ['places', m.placeIndex],
              before: m.orig,
              after: place,
            });
          }
        } else {
          const cur = place?.furniture?.[m.furnIndex];
          if (cur !== undefined) {
            const origF = m.orig as FurnitureDefinition;
            store.record({
              kind: 'move',
              label: `移动${furnitureLabel(origF.kind)}`,
              path: ['places', m.placeIndex, 'furniture', m.furnIndex],
              before: origF,
              after: cur,
            });
          }
        }
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
      style={{ background: '#14162a', width: '100%', height: '100%', overflow: 'hidden', cursor, position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', imageRendering: 'pixelated', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Tooltip title="放大" placement="left">
          <Button size="small" icon={<ZoomInOutlined />} onClick={() => zoomCenter(1)} />
        </Tooltip>
        <Tooltip title="缩小" placement="left">
          <Button size="small" icon={<ZoomOutOutlined />} onClick={() => zoomCenter(-1)} />
        </Tooltip>
        <Tooltip title="适应画布(整图居中)" placement="left">
          <Button size="small" icon={<ExpandOutlined />} onClick={fitToDoc} />
        </Tooltip>
      </div>
    </div>
  );
}
