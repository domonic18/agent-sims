import Phaser from 'phaser';
import type { ResourceNode } from '@sims/shared';
import { TILE } from './assets';

/** 资源节点贴图: 浆果丛=灌木,拾荒堆=满垃圾桶(与散落杂物小件区分) */
export const BERRY_BUSH_SPRITE = 'garden-bush-2965';
export const JUNK_PILE_SPRITE = 'city-props-small-full-trash-can-1691';

/** preload 声明:资源层贴图 slug(纹理缺失渲染层有色块兜底) */
export const RESOURCE_SPRITES: ReadonlySet<string> = new Set([
  BERRY_BUSH_SPRITE,
  JUNK_PILE_SPRITE,
]);

/** 枯竭态(浆果丛 charges=0 待重生)半透明示意 */
const DRAINED_ALPHA = 0.45;

/**
 * 资源节点 diff 渲染(M-G.6):节点增删即贴图增删,同 id 不重建;
 * 浆果丛采竭(charges=0)半透明,次日 00:00 重生回满恢复。
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
  const slug = node.kind === 'berry_bush' ? BERRY_BUSH_SPRITE : JUNK_PILE_SPRITE;
  const container = scene.add.container(node.x * TILE, node.y * TILE);
  container.add(
    scene.textures.exists(slug)
      ? scene.add.image(TILE / 2, TILE, slug).setOrigin(0.5, 1)
      : scene.add.rectangle(
          TILE / 2,
          TILE / 2,
          8,
          8,
          node.kind === 'berry_bush' ? 0x3f7d3a : 0x6b6b6b,
          0.85,
        ),
  );
  container.setAlpha(node.charges === 0 ? DRAINED_ALPHA : 1);
  container.setDepth(7);
  return container;
}
