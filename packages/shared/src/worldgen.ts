/**
 * 随机世界生成协议(M-L.4,design/06-worldgen-design.md):种子驱动整图随机,
 * 生成器为纯函数(server world/worldgen),结果落现行 TileMapDefinition——
 * 世界模拟层零改动。同 (seed, gameType, params, manifestVersion) 必得同图。
 */
import { z } from 'zod';

export const GAME_TYPES = ['growth', 'survival'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  growth: '成长小镇',
  survival: '末日生存',
};

export const WORLDGEN_SIZES = ['small', 'medium', 'large'] as const;
export type WorldgenSize = (typeof WORLDGEN_SIZES)[number];

export const WORLDGEN_SIZE_GRIDS: Record<WorldgenSize, { width: number; height: number }> = {
  small: { width: 64, height: 48 },
  medium: { width: 80, height: 60 },
  large: { width: 96, height: 72 },
};

export const WORLDGEN_DENSITIES = ['sparse', 'normal', 'dense'] as const;
export type WorldgenDensity = (typeof WORLDGEN_DENSITIES)[number];

export const WorldgenParamsSchema = z.object({
  size: z.enum(WORLDGEN_SIZES).default('small'),
  density: z.enum(WORLDGEN_DENSITIES).default('normal'),
});
export type WorldgenParams = z.infer<typeof WorldgenParamsSchema>;

/** 装饰条目:素材库 slug + 格坐标(立式=propSprite,贴地=overlay) */
export interface DecorEntry {
  slug: string;
  x: number;
  y: number;
  /** 实体装饰(废车/电线杆等):不可穿越,占地转 blockedRect */
  solid?: boolean;
  /** sprite 占地格数(solid 必填;propSprite 底边居中锚定) */
  w?: number;
  h?: number;
}

/** 户外装饰坐标(生成地图数据化;内置地图缺省由渲染层静态坐标兜底)。
 * props/flats 为池驱动通用条目(素材库随机选材);旧四数组为固定纹理回退路径 */
export interface DecorDefinition {
  trees: ReadonlyArray<readonly [number, number]>;
  lamps: ReadonlyArray<readonly [number, number]>;
  flowers: ReadonlyArray<readonly [number, number]>;
  bushes: ReadonlyArray<readonly [number, number]>;
  /** 池驱动立式装饰(树/街具/长椅等):slug 即纹理,渲染 propSprite */
  props?: ReadonlyArray<DecorEntry>;
  /** 池驱动贴地装饰(花丛等):渲染 overlay */
  flats?: ReadonlyArray<DecorEntry>;
  /** 公园水系(渲染 8 向水岸;blockedRects 需含同矩形) */
  pond?: { x: number; y: number; w: number; h: number };
}

/** solid 装饰占地矩形(propSprite 底边居中锚定:水平以锚格为中心、纵向自锚格向上 h 格;
 * 生成器占格与 TileMap blockedRect 同源此式) */
export function solidDecorRect(entry: DecorEntry): { x: number; y: number; w: number; h: number } {
  const w = entry.w ?? 1;
  const h = entry.h ?? 1;
  return { x: entry.x - Math.floor((w - 1) / 2), y: entry.y - h + 1, w, h };
}

/** 生成报告(向导第⑤步预览与调试端点用;无时间戳保证可比对) */
export interface WorldgenReport {
  seed: string;
  gameType: GameType;
  params: WorldgenParams;
  /** 参与派生的素材清单版本(manifest version;素材变更即世界不同) */
  manifestVersion: string;
  /** 场所清单(id/名称/尺寸) */
  places: ReadonlyArray<{ id: string; name: string; w: number; h: number }>;
  checks: {
    /** 全部入口自主街可达 */
    connectivity: boolean;
    /** 各场所必需活动锚点齐备 */
    anchorsComplete: boolean;
    /** 兜底回退内置地图标记(生成失败时 true) */
    fallback: boolean;
  };
}
