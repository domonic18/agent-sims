/**
 * 城镇装饰坐标(纯视觉,不参与寻路):树/灌木/野餐桌/灯/花位。
 * terrain(白天实体)与 effects(夜间光圈)共用同一份坐标。
 */

/** 公园内点缀的树 [x, y](格坐标,避开池塘与入口小路) */
export const PARK_TREES: ReadonlyArray<readonly [number, number]> = [
  [5, 27],
  [11, 28],
  [14, 31],
  [6, 34],
  [12, 34],
  [16, 27],
];
/** 公园灌木/池塘边野餐桌/园灯与街灯 */
export const PARK_BUSHES: ReadonlyArray<readonly [number, number]> = [
  [10, 27],
  [15, 33],
];
export const PARK_BENCHES: ReadonlyArray<readonly [number, number]> = [
  [8, 31],
  [8, 32],
];
export const PARK_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [6, 28],
  [14, 28],
];
export const STREET_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [6, 18],
  [34, 18],
  [46, 18],
];
export const PLAZA_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [21, 14],
  [34, 14],
];
/** M3.6f 围栏灯: 公园北缘/广场北角/健身房两侧/公寓 D 门前横路两端的夜间点缀灯 */
export const FENCE_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [5, 25],
  [13, 25],
  [26, 14],
  [35, 14],
  [43, 25],
  [52, 25],
  [27, 44],
  [46, 44],
];
/** M3.6f 花丛点缀: 广场四角/主街沿线的固定花位 */
export const DECOR_FLOWERS: ReadonlyArray<readonly [number, number]> = [
  [22, 15],
  [33, 15],
  [22, 25],
  [33, 25],
  [10, 19],
  [18, 21],
  [40, 19],
  [52, 21],
  [21, 25],
  [26, 25],
  [30, 45],
  [41, 45],
];
/** M3.6f 新公寓周边行道树 */
export const APARTMENT_TREES: ReadonlyArray<readonly [number, number]> = [
  [2, 3],
  [15, 3],
  [15, 12],
  [25, 3],
  [25, 12],
  [54, 3],
  [54, 12],
  [31, 35],
  [41, 35],
];
