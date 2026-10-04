/**
 * 室内家具/休息档位定义(M3.6e 内景化;M3.6f 增电器与户外长椅):
 * 世界内置内容,不可购买。协议面一部分——服务端模拟与客户端渲染共用。
 */
import type { ActivityId } from './activities.js';

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
] as const;

export type FurnitureKind = (typeof FURNITURE_KINDS)[number];

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
};

/**
 * 家具定义:占地 x..x+w-1 / y..y+h-1(格,均不可行走)。
 * 锚点家具(activityId+use):角色立于 use 格即可开始绑定活动;
 * 非锚点家具为室内装饰,仅占格。
 */
export interface FurnitureDefinition {
  kind: FurnitureKind;
  x: number;
  y: number;
  /** 占地宽高(格,≥1) */
  w: number;
  h: number;
  /** 绑定活动(锚点家具) */
  activityId?: ActivityId;
  /** 使用格(锚点必填):紧邻家具的可行走室内格 */
  use?: { x: number; y: number };
}

/** 可作 rest 锚点的家具档位(satisfies 约束新增档位必须先入 FURNITURE_KINDS) */
export const REST_ANCHOR_KINDS = ['bed', 'sofa', 'bench'] as const satisfies readonly FurnitureKind[];

export type RestAnchorKind = (typeof REST_ANCHOR_KINDS)[number];

/**
 * 休息档位速率(M3.6g,数值文档 §2.1):同一 rest 活动按锚点家具 kind
 * 决定恢复速率——床(睡眠)最快、沙发(小憩)次之、长椅(打盹)最慢。
 * key 从 REST_ANCHOR_KINDS 派生:新增档位漏配速率即编译错误。
 */
export const REST_RATES_BY_KIND: Record<RestAnchorKind, { energy: number; happiness: number }> = {
  bed: { energy: 0.35, happiness: 0.05 },
  sofa: { energy: 0.22, happiness: 0.07 },
  bench: { energy: 0.12, happiness: 0.05 },
};
