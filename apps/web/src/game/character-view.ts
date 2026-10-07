import Phaser from 'phaser';
import {
  LOW_ENERGY_THRESHOLD,
  REVIVE_WINDOW_MINUTES,
  getActivityDefinition,
  type ActivityId,
  type TileMapDefinition,
} from '@sims/shared';
import {
  ACTIVITY_EMOJI,
  ACTIVITY_POSES,
  CHARACTER_ROW_OFFSETS,
  TILE,
  characterVariant,
} from './assets';
import { characterAnim, registryOf, type GameAssetRegistry } from './manifest';
import { badgeTextStyle, bubbleEmojiTextStyle, nameTextStyle } from './text-style';

const BUBBLE_RADIUS = 8;
const BUBBLE_Y = -38;
/** 目标偏差超过该格数视为瞬移(重连/重生),直接吸附 */
const SNAP_DISTANCE_TILES = 4;

type Direction = keyof typeof CHARACTER_ROW_OFFSETS;
type AnimGroup = string;

export interface CharacterRender {
  node: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  /** 配色变体(按角色 id 稳定分配) */
  variant: string;
  /** 渲染坐标(tile 浮点) */
  x: number;
  y: number;
  /** 快照目标坐标(tile 整数) */
  targetX: number;
  targetY: number;
  dir: Direction;
  /** 是否处于活动中(姿态与气泡指示) */
  inActivity: boolean;
  /** 进行中活动 id(快照),null = 空闲 */
  activityId: string | null;
  /** rest 档位锚点家具 kind(快照,床/沙发/长椅吸附判定用) */
  anchorKind: string | null;
  /** 活动已进行分钟数(快照,驱动进度环) */
  elapsedMinutes: number;
  /** 头顶活动气泡(图标+环形进度),随 node 移动 */
  bubble: Phaser.GameObjects.Container | null;
  bubbleRing: Phaser.GameObjects.Graphics | null;
  bubbleText: Phaser.GameObjects.Text | null;
  /** 上次重绘进度环时的 elapsed(防逐帧重绘) */
  bubbleElapsed: number;
  /** 当前播放的动画 key,null = 从未播放 */
  animKey: string | null;
  /** 存活状态(false=幽灵态: 半透明+飘浮+👻) */
  alive: boolean;
  /** 当前游戏分钟(纪元起累计,救治倒计时基准) */
  gameMinutes: number;
  /** 死亡时刻(纪元起游戏分钟,null=存活);👻 徽标倒计时用 */
  diedAtGameMinutes: number | null;
  /** 最新体力值(≤LOW_ENERGY_THRESHOLD 低体力警示) */
  energy: number;
  /** rest 到位后横躺于床/长椅(吸附锚点中心+旋转 90°) */
  resting: boolean;
  /** 幽灵 👻 徽标(懒创建) */
  ghostBadge: Phaser.GameObjects.Text | null;
  /** 低体力 ⚡ 徽标(懒创建) */
  warnBadge: Phaser.GameObjects.Text | null;
}

/** 快照中驱动渲染的角色字段(协议超集可直接传入) */
export interface CharacterSnapshotView {
  id: string;
  name: string;
  x: number;
  y: number;
  energy: number;
  alive: boolean;
  diedAtGameMinutes: number | null;
  activity: { activityId: string; elapsedMinutes: number; anchorKind: string | null } | null;
}

/** 变体 slug 即纹理 key(M-L.3:manifest 素材 key=slug) */
export function textureKey(variant: string): string {
  return variant;
}

export function createCharacterAnims(scene: Phaser.Scene): void {
  const registry = registryOf(scene);
  for (const slug of registry.characterSlugs) {
    const anim = characterAnim(registry, slug);
    for (const group of Object.keys(anim.groups) as AnimGroup[]) {
      const frameCount = anim.framesPerGroup[group];
      if (frameCount === undefined) continue;
      const fps = anim.fps[group] ?? 2;
      for (const [dir, rowOffset] of Object.entries(CHARACTER_ROW_OFFSETS) as [Direction, number][]) {
        const start = (anim.groups[group]! + rowOffset) * anim.columns;
        scene.anims.create({
          key: animKey(slug, group, dir),
          frames: scene.anims.generateFrameNumbers(slug, {
            start,
            end: start + frameCount - 1,
          }),
          frameRate: fps,
          repeat: -1,
        });
      }
    }
  }
}

/** 快照 → 渲染节点同步:新增建节点,消失销毁,其余仅回写目标状态 */
export function syncCharacterViews(
  scene: Phaser.Scene,
  views: Map<string, CharacterRender>,
  characters: CharacterSnapshotView[],
  gameMinutes: number,
): void {
  const seen = new Set<string>();
  for (const character of characters) {
    seen.add(character.id);
    let view = views.get(character.id);
    if (!view) {
      view = {
        ...createCharacterNode(scene, character.id, character.name),
        x: character.x,
        y: character.y,
        targetX: character.x,
        targetY: character.y,
        dir: 'down',
        inActivity: character.activity !== null,
        activityId: character.activity?.activityId ?? null,
        anchorKind: character.activity?.anchorKind ?? null,
        elapsedMinutes: character.activity?.elapsedMinutes ?? 0,
        bubble: null,
        bubbleRing: null,
        bubbleText: null,
        bubbleElapsed: -1,
        animKey: null,
        alive: character.alive,
        energy: character.energy,
        gameMinutes,
        diedAtGameMinutes: character.diedAtGameMinutes,
        resting: false,
        ghostBadge: null,
        warnBadge: null,
      };
      views.set(character.id, view);
      view.node.setPosition(view.x * TILE + TILE / 2, view.y * TILE + TILE / 2);
    }
    view.targetX = character.x;
    view.targetY = character.y;
    view.inActivity = character.activity !== null;
    view.activityId = character.activity?.activityId ?? null;
    view.anchorKind = character.activity?.anchorKind ?? null;
    view.elapsedMinutes = character.activity?.elapsedMinutes ?? 0;
    view.alive = character.alive;
    view.energy = character.energy;
    view.gameMinutes = gameMinutes;
    view.diedAtGameMinutes = character.diedAtGameMinutes;
  }
  for (const [id, view] of views) {
    if (!seen.has(id)) {
      view.node.destroy();
      views.delete(id);
    }
  }
}

/**
 * 单角色逐帧更新:向快照目标插值(1 tick = 1 游戏分钟,步频随 timeScale 放大),
 * 到位后映射活动姿态与 rest 吸附横躺;幽灵态半透明飘浮。
 */
export function updateCharacterView(
  scene: Phaser.Scene,
  view: CharacterRender,
  step: number,
  now: number,
  map: TileMapDefinition,
): void {
  const dx = view.targetX - view.x;
  const dy = view.targetY - view.y;
  const distance = Math.hypot(dx, dy);
  let drawX = view.x;
  let drawY = view.y;
  if (distance <= step || distance > SNAP_DISTANCE_TILES) {
    view.x = view.targetX;
    view.y = view.targetY;
    // 活动姿态映射:健身=原地跑(walk 动画不位移),rest=躺卧帧,桌台/柜台类=坐姿,其余=站立待机
    if (view.inActivity && view.activityId !== null) {
      const pose = ACTIVITY_POSES[view.activityId as ActivityId] ?? 'idle';
      if (pose === 'sit') {
        // 坐姿面向锚点家具,位置留在使用格(区别于 rest/workout 的占地中心吸附)
        const dir = facingAnchorDir(view.activityId, view.x, view.y, view.anchorKind, map);
        if (dir !== null) view.dir = dir;
        playAnim(scene, view, 'sit');
      } else {
        playAnim(scene, view, pose === 'run' ? 'walk' : pose);
      }
    } else {
      playAnim(scene, view, 'idle');
    }
    // 锚点吸附(纯视觉): rest 到位后以躺卧帧横陈床/沙发/长椅中心
    // (M3.6g 按 anchorKind 匹配档位家具,躺卧帧自带姿态不再旋转精灵);
    // workout 站上跑步机占地中心原地跑(M3.6i 反馈①: 真正在机器上跑)
    const snapActivity =
      view.inActivity && (view.activityId === 'rest' || view.activityId === 'workout')
        ? view.activityId
        : null;
    const anchor =
      snapActivity !== null
        ? nearestAnchorFurniture(snapActivity, view.x, view.y, view.anchorKind, map)
        : null;
    view.resting = snapActivity === 'rest' && anchor !== null;
    if (anchor !== null) {
      drawX = anchor.x + anchor.w / 2;
      drawY = anchor.y + anchor.h / 2;
    }
  } else {
    view.resting = false;
    view.x += (dx / distance) * step;
    view.y += (dy / distance) * step;
    playWalk(scene, view, dx, dy);
  }
  // 幽灵态: 半透明飘浮
  const bob = view.alive ? 0 : Math.sin(now / 300) * 1.5 - 2;
  view.node.setPosition(drawX * TILE + TILE / 2, drawY * TILE + TILE / 2 + bob);
  updateBubble(scene, view, now);
  updateBadges(scene, view, now);
}

/** 最近锚点家具占地(rest=床/沙发/长椅,workout=跑步机,坐姿=桌台/柜台),按档位 kind 过滤 */
function nearestAnchorFurniture(
  activityId: string,
  x: number,
  y: number,
  kind: string | null,
  map: TileMapDefinition,
): { x: number; y: number; w: number; h: number } | null {
  let best: { x: number; y: number; w: number; h: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const place of map.places) {
    for (const f of place.furniture ?? []) {
      if (f.activityId !== activityId) continue;
      if (kind !== null && f.kind !== kind) continue;
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      const dist = Math.abs(cx - x) + Math.abs(cy - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: f.x, y: f.y, w: f.w, h: f.h };
      }
    }
  }
  return best;
}

/** 坐姿朝向: 锚点家具相对使用格的方位(站家具下侧→面向上),无锚点或重叠则保持原向 */
function facingAnchorDir(
  activityId: string,
  x: number,
  y: number,
  kind: string | null,
  map: TileMapDefinition,
): Direction | null {
  const f = nearestAnchorFurniture(activityId, x, y, kind, map);
  if (f === null) return null;
  if (y >= f.y + f.h) return 'up';
  if (y + 1 <= f.y) return 'down';
  if (f.x + f.w <= x) return 'left';
  if (f.x >= x + 1) return 'right';
  return null;
}

/** 幽灵 👻(带救治倒计时)与低体力 ⚡ 徽标(懒创建,闪烁驱动) */
function updateBadges(scene: Phaser.Scene, view: CharacterRender, now: number): void {
  const remaining =
    !view.alive && view.diedAtGameMinutes !== null
      ? Math.max(0, REVIVE_WINDOW_MINUTES - (view.gameMinutes - view.diedAtGameMinutes))
      : null;
  const ghostText = remaining === null ? '👻' : `👻${Math.ceil(remaining / 60)}h`;
  if (view.ghostBadge === null) {
    view.ghostBadge = scene.add
      .text(0, BUBBLE_Y - 14, ghostText, badgeTextStyle())
      .setOrigin(0.5, 0.5);
    view.node.add(view.ghostBadge);
  } else if (view.ghostBadge.text !== ghostText) {
    view.ghostBadge.setText(ghostText);
  }
  view.ghostBadge.setVisible(!view.alive);
  view.sprite.setTint(view.alive ? 0xffffff : 0x8899aa);
  view.sprite.alpha = view.alive ? 1 : 0.55;
  if (view.warnBadge === null) {
    view.warnBadge = scene.add
      .text(13, -22, '⚡', badgeTextStyle('#ff4d4d'))
      .setOrigin(0.5, 0.5)
      .setStroke('rgba(0,0,0,0.5)', 2);
    view.node.add(view.warnBadge);
  }
  view.warnBadge.setVisible(
    view.alive && view.energy <= LOW_ENERGY_THRESHOLD && Math.floor(now / 400) % 2 === 0,
  );
}

/** 头顶活动气泡:活动开始挂载/结束销毁,进度环仅在 elapsed 变化时重绘,悬浮呼吸 */
function updateBubble(scene: Phaser.Scene, view: CharacterRender, now: number): void {
  if (view.activityId === null || !view.inActivity) {
    if (view.bubble !== null) {
      view.bubble.destroy();
      view.bubble = null;
      view.bubbleRing = null;
      view.bubbleText = null;
    }
    return;
  }
  if (view.bubble === null) {
    const ring = scene.add.graphics();
    const emoji = ACTIVITY_EMOJI[view.activityId as ActivityId] ?? '❓';
    const text = scene.add.text(0, 0, emoji, bubbleEmojiTextStyle()).setOrigin(0.5, 0.5);
    const bubble = scene.add.container(0, BUBBLE_Y, [ring, text]);
    view.node.add(bubble);
    view.bubble = bubble;
    view.bubbleRing = ring;
    view.bubbleText = text;
    view.bubbleElapsed = -1;
  }
  const phase = (view.targetX + view.targetY) * 0.7;
  view.bubble.y = BUBBLE_Y + Math.sin(now / 400 + phase) * 1.5;
  const emoji = ACTIVITY_EMOJI[view.activityId as ActivityId] ?? '❓';
  if (view.bubbleText !== null && view.bubbleText.text !== emoji) {
    view.bubbleText.setText(emoji);
  }
  if (view.bubbleElapsed !== view.elapsedMinutes) {
    drawBubbleRing(view);
  }
}

/** 进度环:白底圆+图标,外圈绿色弧线自顶部顺时针随 elapsed/duration 增长 */
function drawBubbleRing(view: CharacterRender): void {
  const ring = view.bubbleRing;
  if (ring === null || view.activityId === null) return;
  const def = getActivityDefinition(view.activityId);
  const progress =
    def !== null && def.durationMinutes > 0
      ? Math.min(1, view.elapsedMinutes / def.durationMinutes)
      : 0;
  ring.clear();
  ring.fillStyle(0xffffff, 0.92);
  ring.fillCircle(0, 0, BUBBLE_RADIUS);
  ring.lineStyle(1, 0x444444, 0.9);
  ring.strokeCircle(0, 0, BUBBLE_RADIUS);
  if (progress > 0.02) {
    ring.lineStyle(2, 0x2fa042, 1);
    ring.beginPath();
    ring.arc(0, 0, BUBBLE_RADIUS + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ring.strokePath();
  }
  view.bubbleElapsed = view.elapsedMinutes;
}

function playWalk(scene: Phaser.Scene, view: CharacterRender, dx: number, dy: number): void {
  const dir: Direction =
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  view.dir = dir;
  playAnim(scene, view, 'walk', dir);
}

function playAnim(
  scene: Phaser.Scene,
  view: CharacterRender,
  group: AnimGroup,
  dir: Direction = view.dir,
): void {
  const key = animKey(view.variant, group, dir);
  if (view.animKey !== key) {
    view.animKey = key;
    view.sprite.play(key, true);
  }
}

function animKey(variant: string, group: AnimGroup, dir: Direction): string {
  return `${variant}-${group}-${dir}`;
}

function createCharacterNode(
  scene: Phaser.Scene,
  id: string,
  name: string,
): { node: Phaser.GameObjects.Container; sprite: Phaser.GameObjects.Sprite; variant: string } {
  const registry: GameAssetRegistry = registryOf(scene);
  const variant = characterVariant(id, registry.characterSlugs);
  const anim = characterAnim(registry, variant);
  const node = scene.add.container(0, 0);
  const sprite = scene.add
    .sprite(0, 0, textureKey(variant), (anim.groups.idle! + CHARACTER_ROW_OFFSETS.down) * anim.columns)
    .setOrigin(0.5, 0.82);
  const label = scene.add
    .text(0, -24, name, nameTextStyle())
    .setOrigin(0.5, 0)
    .setBackgroundColor('rgba(0,0,0,0.45)');
  node.add([sprite, label]);
  node.setDepth(10);
  return { node, sprite, variant };
}
