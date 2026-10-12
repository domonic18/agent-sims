/**
 * TileMapDefinition → 2D canvas 语义色块渲染(MS-1)。
 * admin 域专用(不引 Phaser,不进 game chunk);MapPreviewCanvas 与批B 编辑器画布
 * 共用同一实现,保证「所见即所存」。层序: 底色→patches→paths→场所(地板/家具)
 * →围栏→资源→blocked→townCore→门/入口标注→文字。
 */
import type { PlaceKind, TileMapDefinition } from '@sims/shared';

/** Sweetie-16 同源语义配色(场所 kind → 主色) */
export const PLACE_KIND_COLORS: Record<PlaceKind | 'default', string> = {
  home: '#38b764',
  library: '#41a6f6',
  office: '#3b5dc9',
  shop: '#ffcd75',
  restaurant: '#ef7d57',
  gym: '#b13e53',
  park: '#a7f070',
  cafe: '#73eff7',
  school: '#41a6f6',
  hotel: '#5d275d',
  clinic: '#f4f4f4',
  plaza: '#94b0c2',
  beach: '#73eff7',
  camping: '#a7f070',
  graveyard: '#5d275d',
  ruins: '#566c86',
  hospital: '#f4f4f4',
  police: '#3b5dc9',
  default: '#94b0c2',
};

/** 从场所 id 提取 kind 前缀(生成图 kind-N 命名,内置图 id 即语义名) */
function placeKindColor(placeId: string): string {
  const base = placeId.replace(/-[a-z]$/, '').replace(/-\d+$/, '');
  return (PLACE_KIND_COLORS as Partial<Record<PlaceKind, string>>)[base as PlaceKind] ??
    PLACE_KIND_COLORS.default;
}

export interface MapRenderOptions {
  /** 每格像素(css px;调用方决定缩放) */
  tile: number;
  /** 叠加网格线 */
  grid?: boolean;
  /** 场所名文字(tile<6 或场所过小自动省略) */
  labels?: boolean;
}

/** 画布 css 尺寸 */
export function mapPixelSize(definition: TileMapDefinition, tile: number): { width: number; height: number } {
  return { width: definition.width * tile, height: definition.height * tile };
}

const rect = (
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  tile: number,
): void => {
  ctx.fillRect(r.x * tile, r.y * tile, r.w * tile, r.h * tile);
};

const frame = (
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  tile: number,
): void => {
  ctx.strokeRect(r.x * tile + 0.5, r.y * tile + 0.5, r.w * tile - 1, r.h * tile - 1);
};

/** 主渲染入口(同步纯绘制;调用方负责 canvas 尺寸与 DPR 变换) */
export function renderMapDefinition(
  ctx: CanvasRenderingContext2D,
  definition: TileMapDefinition,
  opts: MapRenderOptions,
): void {
  const { tile } = opts;
  ctx.clearRect(0, 0, definition.width * tile, definition.height * tile);

  // 底色(草地基准)
  ctx.fillStyle = '#232741';
  ctx.fillRect(0, 0, definition.width * tile, definition.height * tile);

  // 地表覆块(patches,纯视觉)
  for (const patch of definition.patches ?? []) {
    ctx.fillStyle = patch.tile.includes('water') ? '#257179' : '#333c57';
    rect(ctx, patch, tile);
  }
  // 铺装(paths,主街/广场)
  for (const path of definition.paths) {
    ctx.fillStyle = '#566c86';
    rect(ctx, path, tile);
  }

  // 场所:地板色块+边框+家具
  for (const place of definition.places) {
    const color = placeKindColor(place.id);
    const box = { x: place.x, y: place.y, w: place.w, h: place.h };
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = color;
    rect(ctx, box, tile);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    frame(ctx, box, tile);
    // 家具(暗色内嵌块)
    ctx.fillStyle = '#1a1c2c';
    for (const f of place.furniture ?? []) rect(ctx, f, tile);
  }

  // 围栏
  ctx.fillStyle = '#94b0c2';
  for (const fence of definition.fences ?? []) rect(ctx, fence, tile);

  // 资源节点(1×1 亮点)
  for (const res of definition.resources ?? []) {
    ctx.fillStyle = res.kind === 'berry_bush' ? '#b13e53' : '#ef7d57';
    rect(ctx, { x: res.x, y: res.y, w: 1, h: 1 }, tile);
  }

  // 定制障碍(含池塘/喷泉等,统一深色)
  ctx.fillStyle = '#151726';
  for (const blocked of definition.blockedRects) rect(ctx, blocked, tile);

  // 点状装饰(树/灯/花/灌木):标记点让语义视图下放置有即时反馈
  const decor = definition.decor;
  if (decor !== undefined) {
    const dot = (pts: ReadonlyArray<readonly [number, number]>, color: string, ratio: number): void => {
      ctx.fillStyle = color;
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc((x + 0.5) * tile, (y + 0.5) * tile, Math.max(1.5, tile * ratio), 0, Math.PI * 2);
        ctx.fill();
      }
    };
    dot(decor.trees, '#38b764', 0.3);
    dot(decor.lamps, '#ffcd75', 0.22);
    dot(decor.flowers, '#ef7d57', 0.18);
    dot(decor.bushes, '#a7f070', 0.22);
  }

  // 镇核心区(金色虚线框)
  if (definition.townCore !== undefined) {
    ctx.strokeStyle = '#ffcd75';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    frame(ctx, definition.townCore, tile);
    ctx.setLineDash([]);
  }

  // 门洞(白豁口)与入口(主色亮块)
  for (const place of definition.places) {
    if (place.door !== undefined) {
      ctx.fillStyle = '#f4f4f4';
      rect(ctx, { x: place.door.x, y: place.door.y, w: 1, h: 1 }, tile);
    }
    ctx.fillStyle = placeKindColor(place.id);
    rect(ctx, { x: place.entrance.x, y: place.entrance.y, w: 1, h: 1 }, tile);
  }

  // 网格线
  if (opts.grid === true && tile >= 6) {
    ctx.strokeStyle = '#ffffff0d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= definition.width; x += 1) {
      ctx.moveTo(x * tile + 0.5, 0);
      ctx.lineTo(x * tile + 0.5, definition.height * tile);
    }
    for (let y = 0; y <= definition.height; y += 1) {
      ctx.moveTo(0, y * tile + 0.5);
      ctx.lineTo(definition.width * tile, y * tile + 0.5);
    }
    ctx.stroke();
  }

  // 场所名
  if (opts.labels !== false && tile >= 8) {
    ctx.fillStyle = '#f4f4f4';
    ctx.font = `${Math.max(9, Math.min(12, tile))}px "SF Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const place of definition.places) {
      if (place.w * tile < place.name.length * 9) continue;
      ctx.fillText(place.name, (place.x + place.w / 2) * tile, (place.y + place.h / 2) * tile);
    }
  }
}
