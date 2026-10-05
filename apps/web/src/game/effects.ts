import Phaser from 'phaser';
import type { TileMapDefinition } from '@sims/shared';
import { TILE } from './assets';
import type { CharacterRender } from './character-view';

/** 喷泉占地(仅内置地图广场有喷泉) */
export const FOUNTAIN_RECT = { x: 30, y: 18, w: 3, h: 3 };

/**
 * 夜间灯光层(M3.6i 收敛): 圆形光圈全部移除(路灯/围栏灯/公园/广场/门口透光),
 * 仅保有门建筑整屋暖色矩形(整间亮),灯柱本体仍由 terrain 绘制。
 */
export function buildLightLayer(
  scene: Phaser.Scene,
  map: TileMapDefinition,
): Phaser.GameObjects.Container {
  const layer = scene.add.container(0, 0).setDepth(101);
  for (const place of map.places) {
    if (place.door === undefined) continue;
    // 整屋暖光: 覆盖场所占地的低强度矩形,ADD 混合随夜显隐
    const room = scene.add.graphics();
    room.fillStyle(0xffd27a, 0.2);
    room.fillRect(place.x * TILE, place.y * TILE, place.w * TILE, place.h * TILE);
    room.blendMode = Phaser.BlendModes.ADD;
    layer.add(room);
  }
  layer.alpha = 0;
  return layer;
}

/** 广场喷泉: 石池+立柱+水面,每 ~200ms 按正弦相位重绘波纹(rect=null 不绘制) */
export class FountainFx {
  private _gfx: Phaser.GameObjects.Graphics | null = null;
  private _lastAt = 0;

  constructor(private readonly _rect: { x: number; y: number; w: number; h: number } | null) {}

  update(scene: Phaser.Scene, now: number): void {
    if (this._rect === null || now - this._lastAt < 200) return;
    this._lastAt = now;
    if (this._gfx === null) {
      this._gfx = scene.add.graphics().setDepth(2);
    }
    const g = this._gfx;
    g.clear();
    const px = this._rect.x * TILE;
    const py = this._rect.y * TILE;
    const size = this._rect.w * TILE;
    g.fillStyle(0x9a9aa2, 1);
    g.fillRoundedRect(px + 1, py + 1, size - 2, size - 2, 5); // 石池外圈
    g.fillStyle(0x7d7d85, 1);
    g.fillRoundedRect(px + 3, py + 3, size - 6, size - 6, 4); // 池沿
    g.fillStyle(0x5f9fd9, 1);
    g.fillRect(px + 5, py + 5, size - 10, size - 10); // 水面
    const cx = px + size / 2;
    const cy = py + size / 2;
    for (let i = 0; i < 3; i += 1) {
      const phase = (now / 600 + i / 3) % 1;
      g.lineStyle(1, 0xbfe3ff, 0.55 * (1 - phase));
      g.strokeCircle(cx, cy, 4 + phase * (size / 2 - 6)); // 扩散波纹
    }
    g.fillStyle(0xb8b8c0, 1);
    g.fillRect(cx - 3, cy - 3, 6, 8); // 中央立柱
    g.fillStyle(0xd8d8e0, 1);
    g.fillEllipse(cx, cy - 4, 14, 5); // 顶盆
    g.fillStyle(0x9fe0ff, 1);
    g.fillEllipse(cx, cy - 4, 9, 3); // 盆中水
  }
}

/** 选中角色脚下呼吸椭圆环 */
export function drawSelectionRing(
  ring: Phaser.GameObjects.Graphics,
  now: number,
  selectedId: string | null,
  views: Map<string, CharacterRender>,
): void {
  ring.clear();
  if (selectedId === null) return;
  const view = views.get(selectedId);
  if (view === undefined) return;
  ring.fillStyle(0x66ffcc, 0.25 + 0.15 * Math.sin(now / 500));
  ring.fillEllipse(view.node.x, view.node.y + 8, 22, 10);
}
