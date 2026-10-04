import type {
  BlockedRect,
  FurnitureKind,
  PlaceDefinition,
  TileMapDefinition,
} from '@sims/shared';

const inRect = (x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 有门洞场所的墙体展开:占地边缘一圈细矩形,门洞格留豁口(寻路即自然穿门) */
function wallRectsOf(place: PlaceDefinition): BlockedRect[] {
  const door = place.door;
  if (door === undefined) return [];
  const right = place.x + place.w - 1;
  const bottom = place.y + place.h - 1;
  const seg = (x: number, y: number, w: number, h: number): BlockedRect[] =>
    w > 0 && h > 0 ? [{ x, y, w, h }] : [];
  const rowSegs = (row: number): BlockedRect[] => {
    if (door.y === row) {
      return [
        ...seg(place.x, row, door.x - place.x, 1),
        ...seg(door.x + 1, row, right - door.x, 1),
      ];
    }
    return seg(place.x, row, place.w, 1);
  };
  return [
    ...rowSegs(place.y),
    ...rowSegs(bottom),
    ...seg(place.x, place.y + 1, 1, place.h - 2),
    ...seg(right, place.y + 1, 1, place.h - 2),
  ];
}

/** 家具占地矩形(锚点/装饰统一按格阻塞) */
function furnitureRectsOf(place: PlaceDefinition): BlockedRect[] {
  return (place.furniture ?? []).map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }));
}

/**
 * tile 网格与可行走层(纯逻辑):网格默认可行走,障碍占地覆盖为不可行走;
 * 边界一圈不可行走。M3.6e 内景化:有 door 的场所展开墙体(门洞豁口)与
 * 家具占地为细障碍矩形,角色经门入内;构造即校验门洞/家具锚点/室内连通。
 */
export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly places: readonly PlaceDefinition[];
  private readonly _blocked: readonly BlockedRect[];

  private constructor(definition: TileMapDefinition) {
    this.width = definition.width;
    this.height = definition.height;
    this.places = definition.places;
    // 边界墙(网格最内一圈,渲染为树林/围墙)+ 定制障碍 + 建筑墙体 + 家具占地
    this._blocked = [
      ...definition.blockedRects,
      { x: 0, y: 0, w: definition.width, h: 1 }, // 上
      { x: 0, y: definition.height - 1, w: definition.width, h: 1 }, // 下
      { x: 0, y: 0, w: 1, h: definition.height }, // 左
      { x: definition.width - 1, y: 0, w: 1, h: definition.height }, // 右
      ...definition.places.flatMap(wallRectsOf),
      ...definition.places.flatMap(furnitureRectsOf),
    ];
    this._validatePlaces();
  }

  static fromDefinition(definition: TileMapDefinition): TileMap {
    return new TileMap(definition);
  }

  isWalkable(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    return !this._blocked.some((rect) => inRect(x, y, rect));
  }

  /** 点位所属场所(含公园等可行走场所),不在任何场所返回 null */
  placeAt(x: number, y: number): PlaceDefinition | null {
    return this.places.find((place) => inRect(x, y, place)) ?? null;
  }

  placeById(id: string): PlaceDefinition | null {
    return this.places.find((place) => place.id === id) ?? null;
  }

  /** 活动锚点使用格全集:各场所锚点家具的 use 格(无锚点活动返回空) */
  activityAnchors(activityId: string): Array<{ x: number; y: number; placeId: string; kind: FurnitureKind }> {
    const anchors: Array<{ x: number; y: number; placeId: string; kind: FurnitureKind }> = [];
    for (const place of this.places) {
      for (const f of place.furniture ?? []) {
        if (f.activityId === activityId && f.use !== undefined) {
          anchors.push({ x: f.use.x, y: f.use.y, placeId: place.id, kind: f.kind });
        }
      }
    }
    return anchors;
  }

  /** ASCII 渲染(debug 端点/脚本对照):#=障碍 .=地面 E=入口 D=门洞 */
  toAscii(): string {
    const doorSet = new Set(
      this.places.flatMap((place) => (place.door ? [`${place.door.x},${place.door.y}`] : [])),
    );
    const entranceSet = new Set(
      this.places.map((place) => `${place.entrance.x},${place.entrance.y}`),
    );
    const rows: string[] = [];
    for (let y = 0; y < this.height; y += 1) {
      let row = '';
      for (let x = 0; x < this.width; x += 1) {
        if (entranceSet.has(`${x},${y}`)) row += 'E';
        else if (doorSet.has(`${x},${y}`)) row += 'D';
        else row += this.isWalkable(x, y) ? '.' : '#';
      }
      rows.push(row);
    }
    return rows.join('\n');
  }

  private _validatePlaces(): void {
    for (const place of this.places) {
      this._validateEntrance(place);
      if (place.door !== undefined) {
        this._validateDoor(place);
        this._validateFurniture(place, true);
        this._validateInteriorReachability(place);
      } else if ((place.furniture ?? []).length > 0) {
        // 无墙场所(公园)家具: 户外长椅等锚点,仅校验矩形内+使用格紧邻可行走(无室内圈/门/连通约束)
        this._validateFurniture(place, false);
      }
    }
  }

  private _validateEntrance(place: PlaceDefinition): void {
    const { x, y } = place.entrance;
    if (inRect(x, y, place) || !this.isWalkable(x, y)) {
      throw new Error(`场所 ${place.id} 入口非法: (${x},${y}) 须在占地外且可行走`);
    }
  }

  private _validateDoor(place: PlaceDefinition): void {
    const door = place.door!;
    const right = place.x + place.w - 1;
    const bottom = place.y + place.h - 1;
    const onPerimeter =
      door.x >= place.x &&
      door.x <= right &&
      door.y >= place.y &&
      door.y <= bottom &&
      (door.x === place.x || door.x === right || door.y === place.y || door.y === bottom);
    if (!onPerimeter) {
      throw new Error(`场所 ${place.id} 门洞非法: (${door.x},${door.y}) 须在占地边缘`);
    }
    if (manhattan(door, place.entrance) !== 1) {
      throw new Error(
        `场所 ${place.id} 门洞非法: (${door.x},${door.y}) 须与入口 (${place.entrance.x},${place.entrance.y}) 四邻相接`,
      );
    }
    if (!this.isWalkable(door.x, door.y)) {
      throw new Error(`场所 ${place.id} 门洞非法: (${door.x},${door.y}) 被障碍覆盖`);
    }
  }

  private _validateFurniture(place: PlaceDefinition, indoor: boolean): void {
    const interior = (v: number, base: number, size: number): boolean =>
      v > base && v < base + size - 1;
    for (const f of place.furniture ?? []) {
      if (f.w < 1 || f.h < 1) {
        throw new Error(`场所 ${place.id} 家具 ${f.kind} 占地非法: w/h 须 ≥1`);
      }
      const inside = indoor
        ? interior(f.x, place.x, place.w) &&
          interior(f.x + f.w - 1, place.x, place.w) &&
          interior(f.y, place.y, place.h) &&
          interior(f.y + f.h - 1, place.y, place.h)
        : f.x >= place.x &&
          f.y >= place.y &&
          f.x + f.w <= place.x + place.w &&
          f.y + f.h <= place.y + place.h;
      if (!inside) {
        throw new Error(
          `场所 ${place.id} 家具 ${f.kind} 位置非法: 占地须在${indoor ? '室内(墙内圈)' : '场所矩形内'}`,
        );
      }
      if ((f.activityId === undefined) !== (f.use === undefined)) {
        throw new Error(`场所 ${place.id} 家具 ${f.kind} 非法: activityId 与 use 须成对出现`);
      }
      if (f.use === undefined) continue;
      // 使用格到家具占地的最小曼哈顿距离=1(四邻相接)
      const gapX = Math.max(f.x - f.use.x, 0, f.use.x - (f.x + f.w - 1));
      const gapY = Math.max(f.y - f.use.y, 0, f.use.y - (f.y + f.h - 1));
      if (gapX + gapY !== 1) {
        throw new Error(
          `场所 ${place.id} 家具 ${f.kind} 使用格非法: (${f.use.x},${f.use.y}) 须紧邻家具占地`,
        );
      }
      if (!this.isWalkable(f.use.x, f.use.y)) {
        throw new Error(`场所 ${place.id} 家具 ${f.kind} 使用格非法: (${f.use.x},${f.use.y}) 被阻塞`);
      }
    }
  }

  /** 门洞 BFS 可达性:门洞须连通全部锚点使用格(防家具布置把室内割裂) */
  private _validateInteriorReachability(place: PlaceDefinition): void {
    const door = place.door!;
    const uses = (place.furniture ?? [])
      .filter((f) => f.use !== undefined)
      .map((f) => f.use!);
    if (uses.length === 0) return;
    const seen = new Set<string>([`${door.x},${door.y}`]);
    const queue: Array<{ x: number; y: number }> = [door];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !this.isWalkable(nx, ny)) continue;
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    for (const use of uses) {
      if (!seen.has(`${use.x},${use.y}`)) {
        throw new Error(
          `场所 ${place.id} 室内不连通: 门洞 (${door.x},${door.y}) 无法到达使用格 (${use.x},${use.y})`,
        );
      }
    }
  }
}
