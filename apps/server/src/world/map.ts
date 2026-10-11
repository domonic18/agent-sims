import {
  activityAnchors,
  blockedRectsOf,
  findActivityAnchorAt,
  findPlaceByRef,
  isInPlace,
  validateMapDefinition,
  type AnyFurnitureKind,
  type BlockedRect,
  type PlaceDefinition,
  type ResourceNodeSeed,
  type TileMapDefinition,
} from '@sims/shared';

const inRect = (x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/**
 * tile 网格与可行走层(纯逻辑):网格默认可行走,障碍占地覆盖为不可行走;
 * 边界一圈不可行走。M3.6e 内景化:有 door 的场所展开墙体(门洞豁口)与
 * 家具占地为细障碍矩形,角色经门入内;构造即校验门洞/家具锚点/室内连通。
 * 展开与校验已上提 shared(map-validate),本类保留模拟侧查询接口,
 * 与后台编辑器共用同一实现防双端漂移(MS-1)。
 */
export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly places: readonly PlaceDefinition[];
  /** 资源节点种子(M-G.6:采集目标注册表,占格不可行走) */
  readonly resourceSeeds: readonly ResourceNodeSeed[];
  /** 原始定义(M-L.5:前端渲染/复现用) */
  readonly definition: TileMapDefinition;
  private readonly _blocked: readonly BlockedRect[];

  private constructor(definition: TileMapDefinition) {
    this.width = definition.width;
    this.height = definition.height;
    this.places = definition.places;
    this.definition = definition;
    this.resourceSeeds = definition.resources ?? [];
    this._blocked = blockedRectsOf(definition);
    // 构造即校验(收集式,取首条抛出=历史单错语义;错误文案契约见 shared map-validate)
    const [first] = validateMapDefinition(definition);
    if (first !== undefined) throw new Error(first.message);
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

  /** 围栏段展开格全集(M-G.5:修理工破损点候选集,破损 spot 坐标从此取样) */
  fenceTiles(): Array<{ x: number; y: number }> {
    const tiles: Array<{ x: number; y: number }> = [];
    for (const fence of this.definition.fences ?? []) {
      for (let y = fence.y; y < fence.y + fence.h; y += 1) {
        for (let x = fence.x; x < fence.x + fence.w; x += 1) {
          tiles.push({ x, y });
        }
      }
    }
    return tiles;
  }

  /** 位置判定(TD-1 谓词上提 shared,本方法仅薄委托): 位于场所矩形内或其入口格;placeId 按 id/kind 前缀匹配 */
  contains(placeId: string, x: number, y: number): boolean {
    const place = findPlaceByRef(this.definition, placeId);
    return place !== null && isInPlace(place, x, y);
  }

  /** 活动锚点使用格全集(shared 同源;无锚点活动返回空) */
  activityAnchors(activityId: string): Array<{ x: number; y: number; placeId: string; kind: AnyFurnitureKind; label: string }> {
    return activityAnchors(this.definition, activityId);
  }

  /**
   * 锚点命中判定(M3.6i 放宽,shared findActivityAnchorAt 同源薄委托):
   * 声明使用格或紧邻家具占地均算;返回命中锚点(rest 权属/档位结算用),未命中 null。
   */
  anchorAt(
    activityId: string,
    x: number,
    y: number,
  ): { placeId: string; kind: AnyFurnitureKind } | null {
    return findActivityAnchorAt(this.definition, activityId, x, y);
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
}
