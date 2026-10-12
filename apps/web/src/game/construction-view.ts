import Phaser from 'phaser';
import {
  evaluateBuildPlacement,
  getBuildBlueprint,
  type BlockedRect,
  type BuildBlueprint,
  type BuildBlueprintId,
  type BuildIssue,
  type ConstructionSite,
  type TileMapDefinition,
} from '@sims/shared';
import { sendIntent } from '../net/socket';
import { pushToast } from '../store/toastStore';
import { useWorldStore } from '../store/worldStore';
import { TILE } from './assets';

/** 在建工单脚手架色板:琥珀未完工感,与围栏/建筑铺装区分 */
const SCAFFOLD_FILL = 0xd9a441;
const SCAFFOLD_FILL_ALPHA = 0.22;
const SCAFFOLD_LINE = 0xb37a1f;

/**
 * 在建工单 diff 渲染(S2批2):工单增删即节点增删,同 id 不重建;
 * 脚手架 = 足迹半透明琥珀块 + 斜撑线 + 蓝图名标注(仅示意不阻塞玩法)。
 */
export function syncConstructionViews(
  scene: Phaser.Scene,
  views: Map<string, Phaser.GameObjects.Container>,
  sites: ConstructionSite[],
): void {
  const seen = new Set<string>();
  for (const site of sites) {
    seen.add(site.id);
    if (views.has(site.id)) continue;
    views.set(site.id, createScaffoldNode(scene, site));
  }
  for (const [id, node] of views) {
    if (!seen.has(id)) {
      node.destroy();
      views.delete(id);
    }
  }
}

function createScaffoldNode(scene: Phaser.Scene, site: ConstructionSite): Phaser.GameObjects.Container {
  const node = scene.add.container(site.x * TILE, site.y * TILE);
  const w = site.w * TILE;
  const h = site.h * TILE;
  const g = scene.add.graphics();
  g.fillStyle(SCAFFOLD_FILL, SCAFFOLD_FILL_ALPHA);
  g.fillRect(0, 0, w, h);
  g.lineStyle(2, SCAFFOLD_LINE, 0.85);
  g.strokeRect(1, 1, w - 2, h - 2);
  // 斜撑线(脚手架意象):沿主对角方向等距短斜线
  g.lineStyle(1, SCAFFOLD_LINE, 0.4);
  const step = TILE;
  const vertical = h >= w;
  for (let i = 0; i * step < (vertical ? h : w); i += 1) {
    if (vertical) {
      g.lineBetween(0, i * step, w, i * step + w);
    } else {
      g.lineBetween(i * step, 0, i * step + h, h);
    }
  }
  node.add(g);
  const label = getBuildBlueprint(site.blueprintId)?.label ?? site.blueprintId;
  node.add(
    scene
      .add
      .text(w / 2, 3, `🏗️ ${label}`, { fontSize: '11px', color: '#ffe9b0' })
      .setOrigin(0.5, 0)
      .setStroke('rgba(0,0,0,0.6)', 3),
  );
  node.setDepth(7);
  return node;
}

/**
 * 单仓实体标记(S2批2):琥珀描边格 + 📦;spot=null(无镇核心世界)销毁节点。
 * 放快照层随 tick 对齐(世界切换时自然重建),不进地形静态绘制。
 */
export function syncStorageSpotView(
  scene: Phaser.Scene,
  current: Phaser.GameObjects.Container | null,
  spot: { x: number; y: number } | null,
): Phaser.GameObjects.Container | null {
  if (spot === null) {
    current?.destroy();
    return null;
  }
  if (current !== null) return current;
  const node = scene.add.container(spot.x * TILE, spot.y * TILE);
  const g = scene.add.graphics();
  g.lineStyle(2, SCAFFOLD_LINE, 0.9);
  g.strokeRect(2, 2, TILE - 4, TILE - 4);
  node.add(g);
  node.add(scene.add.text(TILE / 2, TILE + 1, '📦', { fontSize: '12px' }).setOrigin(0.5, 0));
  node.setDepth(8);
  return node;
}

/** 服务端同源选位评估(ghost 红绿/下发前预检):本地合并图 + 空增量即等价评估 */
export function buildPlacementIssues(
  map: TileMapDefinition,
  blueprint: BuildBlueprint,
  rect: BlockedRect,
): BuildIssue[] {
  const nextSeq =
    map.places.reduce((max, place) => {
      const match = /^built-(\d+)$/.exec(place.id);
      const seq = match !== null ? Number(match[1]) : 0;
      return seq > max ? seq : max;
    }, 0) + 1;
  return evaluateBuildPlacement(
    map,
    { places: [], fences: [], nextPlaceSeq: nextSeq },
    blueprint,
    rect,
  ).issues;
}

/** 指针 → tile 格(不钳界,越界交给选位评估拒绝) */
export function pointerTile(scene: Phaser.Scene, pointer: Phaser.Input.Pointer): { x: number; y: number } {
  const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
  return { x: Math.floor(world.x / TILE), y: Math.floor(world.y / TILE) };
}

/** 围栏弹性条:主轴取位移较大方向,锚点行/列固定;单击 = 1×1 */
export function elasticFenceRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
): BlockedRect {
  const w = Math.abs(b.x - a.x) + 1;
  const h = Math.abs(b.y - a.y) + 1;
  return w >= h
    ? { x: Math.min(a.x, b.x), y: a.y, w, h: 1 }
    : { x: a.x, y: Math.min(a.y, b.y), w: 1, h };
}

/** 建造幽灵预览:每帧重画;绿=评估通过,红=有问题(越界不出画) */
export function drawBuildGhost(
  graphics: Phaser.GameObjects.Graphics,
  scene: Phaser.Scene,
  draft: { blueprintId: BuildBlueprintId } | null,
  anchor: { x: number; y: number } | null,
): void {
  graphics.clear();
  if (draft === null) return;
  const state = useWorldStore.getState();
  const map = state.map;
  const blueprint = getBuildBlueprint(draft.blueprintId);
  if (map === null || blueprint === null) return;
  const start = anchor ?? pointerTile(scene, scene.input.activePointer);
  const rect =
    blueprint.kind === 'fence'
      ? elasticFenceRect(start, pointerTile(scene, scene.input.activePointer))
      : { x: start.x, y: start.y, w: blueprint.size!.w, h: blueprint.size!.h };
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.w > map.width ||
    rect.y + rect.h > map.height
  ) {
    return;
  }
  const ok = buildPlacementIssues(map, blueprint, rect).length === 0;
  const fill = ok ? 0x3ecf6e : 0xe0524a;
  const line = ok ? 0x2ea355 : 0xb23327;
  graphics.fillStyle(fill, 0.32);
  graphics.fillRect(rect.x * TILE, rect.y * TILE, rect.w * TILE, rect.h * TILE);
  graphics.lineStyle(2, line, 0.95);
  graphics.strokeRect(rect.x * TILE + 1, rect.y * TILE + 1, rect.w * TILE - 2, rect.h * TILE - 2);
}

/** 选区落单:place=单击整占地;fence=拖画条形;客户端预检通过才发 build 意图 */
export function commitBuild(
  scene: Phaser.Scene,
  pointer: Phaser.Input.Pointer,
  anchor: { x: number; y: number } | null,
): void {
  const store = useWorldStore.getState();
  const draft = store.buildDraft;
  if (draft === null) return;
  const blueprint = getBuildBlueprint(draft.blueprintId);
  if (store.map === null || blueprint === null) {
    store.setBuildDraft(null);
    return;
  }
  if (store.selectedCharacterId === null) {
    pushToast(false, '先点击角色选中,再下达建造指令');
    return;
  }
  const start = anchor ?? pointerTile(scene, pointer);
  const hover = pointerTile(scene, pointer);
  const rect =
    blueprint.kind === 'fence'
      ? elasticFenceRect(start, hover)
      : { x: start.x, y: start.y, w: blueprint.size!.w, h: blueprint.size!.h };
  const issues = buildPlacementIssues(store.map, blueprint, rect);
  if (issues.length > 0) {
    pushToast(false, issues[0]!.message);
    return;
  }
  const characterId = store.selectedCharacterId;
  void sendIntent({
    type: 'build',
    characterId,
    blueprintId: draft.blueprintId,
    x: rect.x,
    y: rect.y,
    ...(blueprint.kind === 'fence' ? { w: rect.w, h: rect.h } : {}),
  }).then((ack) => {
    pushToast(ack.ok, ack.message);
    if (ack.ok) useWorldStore.getState().setBuildDraft(null);
  });
}
