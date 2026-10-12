/**
 * 文档归一化(进编辑器的唯一入口约定):可选数组(patches/fences/resources)与
 * decor 四组补齐为真实数组。setAtPath 不造容器——place/decor 落在缺失数组上
 * 会静默抛错、hitTest 会在半残 decor 上崩掉全部点选;AI 整图替换与地图库
 * 载入都过此函数,保证编辑器全程面对完整结构。
 * 内置图 decor 未数据化:渲染层兜底的灯/树/花物化进文档——所见即可选可删。
 */
import type { DecorDefinition, TileMapDefinition } from '@sims/shared';
import {
  APARTMENT_TREES,
  DECOR_FLOWERS,
  FENCE_LAMPS,
  PARK_LAMPS,
  PLAZA_LAMPS,
  STREET_LAMPS,
} from '../../game/decor';

/** 内置图渲染兜底的点状装饰(mapRenderReal 同源)物化为文档对象 */
export function builtinDefaultDecor(): DecorDefinition {
  return {
    trees: [...APARTMENT_TREES],
    lamps: [...STREET_LAMPS, ...PLAZA_LAMPS, ...PARK_LAMPS, ...FENCE_LAMPS],
    flowers: [...DECOR_FLOWERS],
    bushes: [],
  };
}

export function normalizeDefinition(def: TileMapDefinition): TileMapDefinition {
  const src = def.decor;
  const decor: DecorDefinition =
    src === undefined
      ? builtinDefaultDecor()
      : {
          trees: [...src.trees],
          lamps: [...src.lamps],
          flowers: [...src.flowers],
          bushes: [...src.bushes],
          ...(src.props !== undefined ? { props: src.props } : {}),
          ...(src.flats !== undefined ? { flats: src.flats } : {}),
          ...(src.pond !== undefined ? { pond: src.pond } : {}),
        };
  return {
    ...def,
    patches: def.patches ?? [],
    fences: def.fences ?? [],
    resources: def.resources ?? [],
    decor,
  };
}
