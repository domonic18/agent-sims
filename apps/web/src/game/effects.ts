import Phaser from 'phaser';
import type { TileMapDefinition } from '@sims/shared';
import { TILE } from './assets';
import { FENCE_LAMPS, PARK_LAMPS, PLAZA_LAMPS, STREET_LAMPS } from './decor';
import type { CharacterRender } from './character-view';

/** 喷泉占地(仅内置地图广场有喷泉) */
export const FOUNTAIN_RECT = { x: 30, y: 18, w: 3, h: 3 };

/** 灯光圈纹理(程序生成径向渐变,懒创建一次) */
const GLOW_TEXTURE_KEY = 'light-glow';

/** 径向光晕贴图: 白→透明,渲染时 tint 上暖色;线性过滤避免像素阶梯(pixelArt 全局 NEAREST 的例外) */
function ensureGlowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW_TEXTURE_KEY)) return;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  scene.textures.addCanvas(GLOW_TEXTURE_KEY, canvas);
  scene.textures.get(GLOW_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
}

/**
 * 夜间灯光层(暖光对比夜): 路灯光圈(decor.lamps,内置地图回退四灯组)+
 * 门建筑整屋暖色矩形;全部 ADD 混合,显隐由场景按夜色强度插值 layer.alpha。
 * 灯为静态 Image,无每帧重绘。
 */
export function buildLightLayer(
  scene: Phaser.Scene,
  map: TileMapDefinition,
): Phaser.GameObjects.Container {
  ensureGlowTexture(scene);
  const layer = scene.add.container(0, 0).setDepth(101);
  const lamps = map.decor?.lamps ?? [
    ...STREET_LAMPS,
    ...PLAZA_LAMPS,
    ...PARK_LAMPS,
    ...FENCE_LAMPS,
  ];
  for (const [lx, ly] of lamps) {
    // 灯柱 propSprite 底边居中锚定,光圈中心取灯头上半格
    layer.add(
      scene.add
        .image(lx * TILE + TILE / 2, ly * TILE + TILE / 2, GLOW_TEXTURE_KEY)
        .setTint(0xffc266)
        .setAlpha(0.55)
        .setScale(1.6)
        .setBlendMode(Phaser.BlendModes.ADD),
    );
  }
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

/**
 * 选中角色指示(反馈轮定稿): 仅头顶浮动金色倒三角箭头(圆环已去——箭头已足够醒目,
 * 双指示显冗余),对齐容器中心即帧艺术区中心(表内容统一贴 x8 居中);bob 上下漂移,
 * 深色描边防夜间/浅色地面看不清。箭头悬于头顶上方,不遮角色。
 */
export function drawSelectionMarker(
  ring: Phaser.GameObjects.Graphics,
  now: number,
  selectedId: string | null,
  views: Map<string, CharacterRender>,
): void {
  ring.clear();
  if (selectedId === null) return;
  const view = views.get(selectedId);
  if (view === undefined) return;
  const bob = Math.sin(now / 320) * 2;
  const cx = view.node.x;
  const ay = view.node.y - 32 + bob;
  ring.fillStyle(0x1a1c2c, 0.9);
  ring.fillTriangle(cx - 7, ay - 6, cx + 7, ay - 6, cx, ay + 5);
  ring.fillStyle(0xffcd75, 1);
  ring.fillTriangle(cx - 5, ay - 4, cx + 5, ay - 4, cx, ay + 3);
}
