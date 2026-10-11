/**
 * 编辑器本地预设(K-B):18 PlaceKind 的中文标签/默认尺寸/是否带门。
 * 尺寸仅是放置 UX 档(可改),漂移无害;颜色同源 mapRender 语义配色。
 */
import type { PlaceKind } from '@sims/shared';
import { PLACE_KIND_COLORS } from '../mapRender';

export interface KindPreset {
  label: string;
  /** 放置默认占地(可属性面板改) */
  size: [number, number];
  /** 封闭建筑自动补门洞+入口;开放场地只补入口 */
  door: boolean;
}

export const KIND_PRESETS: Record<PlaceKind, KindPreset> = {
  home: { label: '住宅', size: [5, 4], door: true },
  library: { label: '图书馆', size: [7, 5], door: true },
  office: { label: '办公室', size: [7, 5], door: true },
  shop: { label: '商店', size: [6, 5], door: true },
  restaurant: { label: '餐厅', size: [6, 5], door: true },
  gym: { label: '健身房', size: [7, 5], door: true },
  park: { label: '公园', size: [6, 6], door: false },
  cafe: { label: '咖啡馆', size: [5, 4], door: true },
  school: { label: '学校', size: [8, 6], door: true },
  hotel: { label: '旅馆', size: [8, 6], door: true },
  clinic: { label: '诊所', size: [5, 4], door: true },
  plaza: { label: '广场', size: [5, 5], door: false },
  beach: { label: '海滩', size: [6, 4], door: false },
  camping: { label: '营地', size: [5, 5], door: false },
  graveyard: { label: '墓地', size: [6, 5], door: false },
  ruins: { label: '遗迹', size: [5, 5], door: false },
  hospital: { label: '医院', size: [8, 6], door: true },
  police: { label: '警局', size: [6, 5], door: true },
};

export const KIND_ORDER = Object.keys(KIND_PRESETS) as PlaceKind[];

/** ToolPanel palette 用的色卡(kind → css 色) */
export function kindColor(kind: PlaceKind): string {
  return PLACE_KIND_COLORS[kind] ?? PLACE_KIND_COLORS.default;
}

/** 场所 id → kind(kind-N 命名约定,与 mapRender 着色同一提取规则) */
export function placeKindOf(id: string): PlaceKind | null {
  const base = id.replace(/-[a-z]$/, '').replace(/-\d+$/, '');
  return base in KIND_PRESETS ? (base as PlaceKind) : null;
}
