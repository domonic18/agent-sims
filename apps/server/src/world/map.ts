import type { BlockedRect, PlaceDefinition, TileMapDefinition } from '@sims/shared';

const inRect = (x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/**
 * tile 网格与可行走层(纯逻辑):网格默认可行走,障碍占地覆盖为不可行走;
 * 边界一圈不可行走。场所登记占地与入口,供寻路目标与活动归属查询。
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
    // 边界墙(网格最内一圈,渲染为树林/围墙)+ 定制障碍合并
    this._blocked = [
      ...definition.blockedRects,
      { x: 0, y: 0, w: definition.width, h: 1 }, // 上
      { x: 0, y: definition.height - 1, w: definition.width, h: 1 }, // 下
      { x: 0, y: 0, w: 1, h: definition.height }, // 左
      { x: definition.width - 1, y: 0, w: 1, h: definition.height }, // 右
    ];
    this._validateEntrances();
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

  /** ASCII 渲染(debug 端点/脚本对照):#=障碍 .=地面 E=入口 */
  toAscii(): string {
    const entranceSet = new Set(
      this.places.map((place) => `${place.entrance.x},${place.entrance.y}`),
    );
    const rows: string[] = [];
    for (let y = 0; y < this.height; y += 1) {
      let row = '';
      for (let x = 0; x < this.width; x += 1) {
        if (entranceSet.has(`${x},${y}`)) row += 'E';
        else row += this.isWalkable(x, y) ? '.' : '#';
      }
      rows.push(row);
    }
    return rows.join('\n');
  }

  private _validateEntrances(): void {
    for (const place of this.places) {
      const { x, y } = place.entrance;
      if (inRect(x, y, place) || !this.isWalkable(x, y)) {
        throw new Error(`场所 ${place.id} 入口非法: (${x},${y}) 须在占地外且可行走`);
      }
    }
  }
}
