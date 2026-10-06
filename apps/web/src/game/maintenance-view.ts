import Phaser from 'phaser';
import type { MaintenanceSpot } from '@sims/shared';
import { TILE } from './assets';

/** 杂物贴图池(variant 取模;city-props 小件,底边中心锚定) */
export const LITTER_SPRITES = [
  'city-props-junk-1576',
  'city-props-single-trash-1685',
  'city-props-box-trash-1405',
  'city-props-paper-trash-1632',
] as const;

/** 围栏破损叠片(小碎块盖在 fence tile 上) */
export const FENCE_DAMAGE_SPRITE = 'subway-and-train-station-brown-rail-broken-fragment-4372';

/** preload 声明:维护层用到的全部贴图 slug(纹理缺失渲染层有 Graphics 兜底) */
export const MAINTENANCE_SPRITES: ReadonlySet<string> = new Set([
  ...LITTER_SPRITES,
  FENCE_DAMAGE_SPRITE,
]);

/**
 * 维护点 diff 渲染(M-G.5 损耗系统):spot 增删即贴图增删,同 id 不重建。
 * 纯氛围不阻塞通行;纹理缺失回退色块保底。
 */
export function syncMaintenanceViews(
  scene: Phaser.Scene,
  views: Map<string, Phaser.GameObjects.Container>,
  spots: MaintenanceSpot[],
): void {
  const seen = new Set<string>();
  for (const spot of spots) {
    seen.add(spot.id);
    if (views.has(spot.id)) continue;
    views.set(spot.id, createSpotNode(scene, spot));
  }
  for (const [id, node] of views) {
    if (!seen.has(id)) {
      node.destroy();
      views.delete(id);
    }
  }
}

function createSpotNode(scene: Phaser.Scene, spot: MaintenanceSpot): Phaser.GameObjects.Container {
  const node = scene.add.container(spot.x * TILE, spot.y * TILE);
  if (spot.kind === 'litter') {
    const slug = LITTER_SPRITES[spot.variant % LITTER_SPRITES.length]!;
    node.add(
      scene.textures.exists(slug)
        ? scene.add.image(TILE / 2, TILE, slug).setOrigin(0.5, 1)
        : fallbackBlock(scene, 0x8a7a5c),
    );
  } else {
    node.add(
      scene.textures.exists(FENCE_DAMAGE_SPRITE)
        ? scene.add
            .image(TILE / 2, TILE - 3, FENCE_DAMAGE_SPRITE)
            .setOrigin(0.5, 1)
            .setRotation(0.5)
        : fallbackBlock(scene, 0x6b4a2f),
    );
  }
  node.setDepth(7);
  return node;
}

/** 纹理缺失兜底:半透明色块示意(素材库未发布时不阻塞玩法) */
function fallbackBlock(scene: Phaser.Scene, color: number): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(TILE / 2, TILE / 2, 8, 8, color, 0.85);
}
