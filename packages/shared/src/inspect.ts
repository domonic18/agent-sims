/**
 * 物件信息卡内容面(游览体验):家具的中文名既有 FURNITURE_LABELS,此处补
 * 介绍文案——点击地图上任意物件弹卡时「这是什么、能干什么」的数据源。
 * 纯静态内容,不涉世界状态;资源/维护/场所的动态行由 web 侧组合实体元数据。
 */
import type { FurnitureKind, AnyFurnitureKind } from './furniture.js';

export const FURNITURE_DESCRIPTIONS: Record<FurnitureKind, string> = {
  bed: '睡眠与休息的锚点——睡在床上体力恢复最快,整夜安睡到清晨自然醒。',
  desk: '书桌——坐下学习可积累知识,知识达到门槛后解锁更高阶的岗位。',
  workstation: '办公桌——杂工岗位的工作台,按工时赚取金币。',
  treadmill: '跑步机——锻炼提升幸福感,消耗体力。',
  table: '餐桌——室内陈设,让公寓更有生活气息。',
  bookshelf: '书架——书房陈设,见证住户的求知日常。',
  shelf: '货架——商店陈列商品的建筑道具。',
  counter: '柜台——售货员岗位的工作台,为顾客结算。',
  sofa: '沙发——小憩档位,适合午后的能量快充。',
  plant: '盆栽——绿意装饰,净化心情。',
  fridge: '冰箱——存放食物的家电器具。',
  tv: '电视——客厅电器,休闲氛围担当。',
  wardrobe: '衣柜——收纳衣物的家具。',
  bench: '长椅——户外打盹档位,行人的歇脚处。',
  stove: '灶台——烹饪站点,可以把浆果烤成香喷喷的浆果派。',
  workbench: '木工台——制作站点,可以把废料加工成修补钉。',
};

/** 户外道具(素材库随机选材的 slug,全集之外)回退介绍 */
export const DECOR_FURNITURE_DESCRIPTION = '户外装饰道具——装点街道与庭院的陈设。';

export function furnitureDescription(kind: AnyFurnitureKind): string {
  return FURNITURE_DESCRIPTIONS[kind as FurnitureKind] ?? DECOR_FURNITURE_DESCRIPTION;
}
