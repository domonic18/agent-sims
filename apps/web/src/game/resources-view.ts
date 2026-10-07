import Phaser from 'phaser';
import type { ResourceNode } from '@sims/shared';
import { TILE } from './assets';

/** 资源节点贴图按 kind 表驱动:浆果丛=灌木,拾荒堆=满垃圾桶,树/岩/金属堆为
 * M-S/S1 生存三件套(树 2x2 原生越格上悬,余 1x1);
 * 食物链两节点(2026-10-07):苹果树=苹果堆,麦丛=带土作物 */
export const BERRY_BUSH_SPRITE = 'garden-bush-2965';
export const JUNK_PILE_SPRITE = 'city-props-small-full-trash-can-1691';
export const TREE_SPRITE = 'camping-tree-1013';
export const ROCK_SPRITE = 'camping-rock-883';
export const METAL_PILE_SPRITE = 'garage-sales-air-conditioner-unit-2810';
export const APPLE_TREE_SPRITE = 'camping-apples-668';
export const WHEAT_PATCH_SPRITE = 'beach-small-sprout-3-vers-259';

const NODE_SPRITES: Record<ResourceNode['kind'], string> = {
  berry_bush: BERRY_BUSH_SPRITE,
  junk_pile: JUNK_PILE_SPRITE,
  tree: TREE_SPRITE,
  rock: ROCK_SPRITE,
  metal_pile: METAL_PILE_SPRITE,
  apple_tree: APPLE_TREE_SPRITE,
  wheat_patch: WHEAT_PATCH_SPRITE,
};

const NODE_FALLBACK_COLORS: Record<ResourceNode['kind'], number> = {
  berry_bush: 0x3f7d3a,
  junk_pile: 0x6b6b6b,
  tree: 0x2f6b34,
  rock: 0x8a8a8a,
  metal_pile: 0x706e6a,
  apple_tree: 0xc0472f,
  wheat_patch: 0xc9a83a,
};

/** preload 声明:资源层贴图 slug(纹理缺失渲染层有色块兜底) */
export const RESOURCE_SPRITES: ReadonlySet<string> = new Set(Object.values(NODE_SPRITES));

/** kind→贴图 slug 反查(InspectCard 缩略图同源) */
export const NODE_SPRITE_OF: Readonly<Record<ResourceNode['kind'], string>> = NODE_SPRITES;

/** 枯竭态(charges=0 待重生)半透明示意 */
const DRAINED_ALPHA = 0.45;

/**
 * 资源节点 diff 渲染(M-G.6):节点增删即贴图增删,同 id 不重建;
 * 采竭(charges=0)半透明,次日 00:00 重生回满恢复。
 * 节点占格不可行走由服务端地图裁决,渲染层纯展示。
 */
export function syncResourceViews(
  scene: Phaser.Scene,
  views: Map<string, Phaser.GameObjects.Container>,
  nodes: ResourceNode[],
): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    seen.add(node.id);
    const existing = views.get(node.id);
    if (existing === undefined) {
      views.set(node.id, createResourceNode(scene, node));
      continue;
    }
    existing.setAlpha(node.charges === 0 ? DRAINED_ALPHA : 1);
  }
  for (const [id, view] of views) {
    if (!seen.has(id)) {
      view.destroy();
      views.delete(id);
    }
  }
}

function createResourceNode(scene: Phaser.Scene, node: ResourceNode): Phaser.GameObjects.Container {
  const slug = NODE_SPRITES[node.kind];
  const container = scene.add.container(node.x * TILE, node.y * TILE);
  container.add(
    scene.textures.exists(slug)
      ? scene.add.image(TILE / 2, TILE, slug).setOrigin(0.5, 1)
      : scene.add.rectangle(
          TILE / 2,
          TILE / 2,
          8,
          8,
          NODE_FALLBACK_COLORS[node.kind],
          0.85,
        ),
  );
  container.setAlpha(node.charges === 0 ? DRAINED_ALPHA : 1);
  container.setDepth(7);
  return container;
}
