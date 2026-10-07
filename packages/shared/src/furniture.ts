/**
 * 室内家具/休息档位定义(M3.6e 内景化;M3.6f 增电器与户外长椅):
 * 世界内置内容,不可购买。协议面一部分——服务端模拟与客户端渲染共用。
 */
import type { ActivityId } from './activities.js';
import { getRecipe } from './production.js';

/** 家具/设施类型全集 */
export const FURNITURE_KINDS = [
  'bed',
  'desk',
  'workstation',
  'treadmill',
  'table',
  'bookshelf',
  'shelf',
  'counter',
  'sofa',
  'plant',
  'fridge',
  'tv',
  'wardrobe',
  'bench',
  'stove',
  'workbench',
] as const;

export type FurnitureKind = (typeof FURNITURE_KINDS)[number];

/**
 * 扩展家具 kind:全集之外的素材库道具 slug(户外道具池——帐篷/木桶/路灯等,
 * worldgen 随机选材直挂)。非全集 kind 无活动档位语义(rest 速率回退活动默认),
 * 标签回退用 slug 本身。
 */
export type AnyFurnitureKind = FurnitureKind | (string & {});

export const furnitureLabel = (kind: AnyFurnitureKind): string =>
  FURNITURE_LABELS[kind as FurnitureKind] ?? kind;

export const FURNITURE_LABELS: Record<FurnitureKind, string> = {
  bed: '床',
  desk: '书桌',
  workstation: '办公桌',
  treadmill: '跑步机',
  table: '餐桌',
  bookshelf: '书架',
  shelf: '货架',
  counter: '柜台',
  sofa: '沙发',
  plant: '盆栽',
  fridge: '冰箱',
  tv: '电视',
  wardrobe: '衣柜',
  bench: '长椅',
  stove: '灶台',
  workbench: '木工台',
};

/** 朝向(家具面朝方向;worldgen 布局时由锚点派生,渲染方向变体消费) */
export type FacingDirection = 'north' | 'south' | 'east' | 'west';

/**
 * 家具定义:占地 x..x+w-1 / y..y+h-1(格,均不可行走)。
 * 锚点家具(activityId+use):角色立于 use 格即可开始绑定活动;
 * 非锚点家具为室内装饰,仅占格。
 */
export interface FurnitureDefinition {
  kind: AnyFurnitureKind;
  x: number;
  y: number;
  /** 占地宽高(格,≥1) */
  w: number;
  h: number;
  /** 绑定活动(锚点家具) */
  activityId?: ActivityId;
  /** 使用格(锚点必填):紧邻家具的可行走室内格 */
  use?: { x: number; y: number };
  /**
   * 具体素材 slug(素材库随机选材;缺省回退 kind 同名纹理——
   * 内置固定地图与未选材场景兼容)
   */
  sprite?: string;
  /**
   * 朝向(06-worldgen §3③):worldgen 锚点派生——north 槽→facing south
   * (贴北墙面朝房间)、south→north、east→west、west→east;center/scatter
   * 省略。渲染侧按 facing 选方向变体(-b 后缀=背面件)
   */
  facing?: FacingDirection;
}

/** 可作 rest 锚点的家具档位(satisfies 约束新增档位必须先入 FURNITURE_KINDS) */
export const REST_ANCHOR_KINDS = ['bed', 'sofa', 'bench'] as const satisfies readonly FurnitureKind[];

export type RestAnchorKind = (typeof REST_ANCHOR_KINDS)[number];

/**
 * 休息档位速率(M3.6g,数值文档 §2.1):同一 rest 活动按锚点家具 kind
 * 决定恢复速率——床(睡眠)最快、沙发(小憩)次之、长椅(打盹)最慢。
 * key 从 REST_ANCHOR_KINDS 派生:新增档位漏配速率即编译错误。
 */
export const REST_RATES_BY_KIND: Record<RestAnchorKind, { energy: number }> = {
  bed: { energy: 0.35 },
  sofa: { energy: 0.22 },
  bench: { energy: 0.12 },
};

/** 可作 sleep 锚点的家具档位(M-G.2 睡眠):仅床;新增档位(如帐篷)须同步扩 REST_RATES_BY_KIND */
export const SLEEP_ANCHOR_KINDS = ['bed'] as const satisfies readonly FurnitureKind[];

export type SleepAnchorKind = (typeof SLEEP_ANCHOR_KINDS)[number];

/**
 * 锚点家具是否服务某活动(M-G.2 锚点绑定泛化):声明绑定直接命中;
 * sleep 额外复用绑 rest 且档位 ∈ SLEEP_ANCHOR_KINDS 的家具——床双服务
 * rest/sleep,地图数据保持单一绑定 activityId:'rest' 不变;
 * 配方站点泛化(M-G.6/2026-10-07 食物链):灶台/木工台只声明一个同名配方,
 * 其余同 stationKind 配方(craft_bread/craft_sandwich…)复用同锚点。
 * 双端同源(server TileMap / web place.ts / findActivityAnchorAt 共用)。
 */
export function furnitureServesActivity(
  boundActivityId: ActivityId,
  kind: AnyFurnitureKind,
  activityId: string,
): boolean {
  if (boundActivityId === activityId) return true;
  if (
    activityId === 'sleep' &&
    boundActivityId === 'rest' &&
    (SLEEP_ANCHOR_KINDS as readonly string[]).includes(kind)
  ) {
    return true;
  }
  const boundRecipe = getRecipe(boundActivityId);
  if (boundRecipe === null) return false;
  const recipe = getRecipe(activityId);
  return recipe !== null && recipe.stationKind === boundRecipe.stationKind;
}
