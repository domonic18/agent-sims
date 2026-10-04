/**
 * 内景调色板(M3.6h 收敛):墙体/地板/家具像素画的全部色值,
 * 调色只改此文件。家具色按 kind 分组,新增家具 kind 须同步补色与
 * terrain.ts drawFurniture 的绘制分支。
 */

/** 墙体按场所着色区分建筑,缺省灰 */
export const WALL_COLORS: Record<string, number> = {
  'home-a': 0x9c7b5f,
  'home-b': 0xa8825f,
  'home-c': 0x8f7a9c,
  'home-d': 0x7f9c6f,
  library: 0x7a6f9e,
  office: 0x6f8496,
  shop: 0xa8894f,
  restaurant: 0xa26353,
  gym: 0x5f8472,
};
export const WALL_DEFAULT = 0x7d7d85;

/** 室内木地板双色棋盘 + 细缝线 + 门槛木色 */
export const FLOOR = {
  a: 0xd9b98a,
  b: 0xcfae7e,
  line: 0xb1925f,
  doorThreshold: 0x8a5a3a,
} as const;

/** 家具配色(键=家具 kind) */
export const FURNITURE_COLORS = {
  bed: {
    frame: 0x8a6d4a,
    mattress: 0xf2ead8,
    pillow: 0xffffff,
    quilt: 0x7f9fd9,
    quiltEdge: 0x6f8fc9,
  },
  desk: {
    top: 0x9a6b45,
    edge: 0xb98a5f,
    leg: 0x6f4a2f,
    book: 0xd9534f,
    bookEdge: 0xe2776f,
  },
  workstation: {
    top: 0x7f8fa0,
    edge: 0x9aabb8,
    monitor: 0x333a44,
    screen: 0x6fd3e8,
  },
  treadmill: {
    body: 0x4a525c,
    belt: 0x22262c,
    beltEdge: 0x3a4048,
    console: 0x8a99a8,
    screen: 0x6fd3e8,
  },
  table: {
    top: 0xa87748,
    edge: 0xc09060,
    leg: 0x7a5230,
    plate: 0xe8e0d0,
  },
  bookshelf: {
    body: 0x7a5230,
    divider: 0x8f6540,
    books: [0xd9534f, 0x4f8fd9, 0xe8b84f, 0x6fae5f, 0xb08fd9],
  },
  shelf: {
    frame: 0x8f979f,
    line: 0x767e86,
    boxA: 0xc9a06a,
    boxB: 0x8fb0d9,
    boxC: 0x9fd98f,
  },
  counter: {
    body: 0x8d6e4f,
    top: 0xb08f6a,
    base: 0x6f5238,
  },
  sofa: {
    back: 0x5f7f5a,
    seat: 0x6f8f6a,
    seatEdge: 0x7f9f7a,
    arm: 0x4f6f4a,
  },
  plant: {
    pot: 0xb0603f,
    potEdge: 0x8f4f33,
    leaf: 0x4f8f4a,
    leafHighlight: 0x63a85c,
  },
  fridge: {
    body: 0xdde3e8,
    shade: 0xb8c2ca,
    handle: 0x6f7a84,
    seal: 0x9aa6ae,
  },
  tv: {
    body: 0x2a2f36,
    screen: 0x4f6f8f,
    screenGlow: 0x7fa8c9,
    stand: 0x3a4048,
  },
  wardrobe: {
    body: 0x8a6448,
    door: 0x9a7454,
    handle: 0xd9c9a8,
    top: 0x6f4f38,
  },
  bench: {
    wood: 0xa87848,
    woodEdge: 0xc09468,
    leg: 0x6f4a2f,
  },
} as const;
