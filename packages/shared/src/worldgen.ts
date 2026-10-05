/**
 * 随机世界生成协议(M-L.4,design/06-worldgen-design.md):种子驱动整图随机,
 * 生成器为纯函数(server world/worldgen),结果落现行 TileMapDefinition——
 * 世界模拟层零改动。同 (seed, gameType, params, manifestVersion) 必得同图。
 */
import { z } from 'zod';

export const GAME_TYPES = ['growth', 'survival'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  growth: '成长型',
  survival: '生存型(敬请期待)',
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

/** 户外装饰坐标(生成地图数据化;内置地图缺省由渲染层静态坐标兜底) */
export interface DecorDefinition {
  trees: ReadonlyArray<readonly [number, number]>;
  lamps: ReadonlyArray<readonly [number, number]>;
  flowers: ReadonlyArray<readonly [number, number]>;
  bushes: ReadonlyArray<readonly [number, number]>;
  /** 公园水系(渲染 8 向水岸;blockedRects 需含同矩形) */
  pond?: { x: number; y: number; w: number; h: number };
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
