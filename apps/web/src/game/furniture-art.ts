import type Phaser from 'phaser';
import type { FurnitureDefinition } from '@sims/shared';
import { TILE, furnitureKey } from './assets';

/**
 * 家具精灵摆放(LimeZu 16x16 裁切,自程序化绘制迁移):
 * 底边中心锚定占地格底边中心,竖高家具(书架/衣柜/冰箱)自然向上延伸;
 * 健身房横向 shelf(2x1)用矮凳精灵,竖向 shelf(1x3)用高货架。
 */
export function addFurnitureSprite(scene: Phaser.Scene, f: FurnitureDefinition): void {
  const name = f.kind === 'shelf' && f.w > f.h ? 'bench' : f.kind;
  scene.add
    .image((f.x + f.w / 2) * TILE, (f.y + f.h) * TILE, furnitureKey(name))
    .setOrigin(0.5, 1)
    .setDepth(3);
}
