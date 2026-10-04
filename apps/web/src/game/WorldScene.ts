import Phaser from 'phaser';
import {
  TOWN_MAP,
  getActivityDefinition,
  type PlaceDefinition,
  type TileMapDefinition,
} from '@sims/shared';
import { useWorldStore } from '../store/worldStore';
import { CHARACTER, characterVariant, PROP_TREES, ROOF_FRAME, TILE_FRAME, TILESET } from './assets';

const TILE = 16;
/** 与服务端 BALANCE.WALK_SPEED_TILES_PER_MINUTE 对应的移动契约:每 tick 1 格 */
const TILES_PER_TICK = 1;
/** 目标偏差超过该格数视为瞬移(重连/重生),直接吸附 */
const SNAP_DISTANCE_TILES = 4;

const POND_RECT = { x: 4, y: 30, w: 4, h: 4 };
/** 广场铺装(paths 内矩形默认砂路,该矩形单独用灰石) */
const PLAZA_RECT = { x: 22, y: 15, w: 12, h: 11 };
/** 相机:默认 2x 跟随选中角色,滚轮在 1x~4x 间缩放,1x 为全图概览 */
const ZOOM_DEFAULT = 2;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

const inRect = (x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/** 公园内点缀的树 [x, y](格坐标,纯视觉,不参与寻路,避开池塘与入口小路) */
const PARK_TREES: ReadonlyArray<readonly [number, number]> = [
  [5, 27],
  [11, 28],
  [14, 31],
  [6, 34],
  [12, 34],
  [16, 27],
];
/** 公园灌木/池塘边野餐桌/园灯与街灯(纯视觉) */
const PARK_BUSHES: ReadonlyArray<readonly [number, number]> = [
  [10, 27],
  [15, 33],
];
const PARK_BENCHES: ReadonlyArray<readonly [number, number]> = [
  [8, 31],
  [8, 32],
];
const PARK_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [6, 28],
  [14, 28],
];
const STREET_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [6, 18],
  [34, 18],
  [46, 18],
];
const PLAZA_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [21, 14],
  [34, 14],
];

/** 活动 → 头顶气泡图标(emoji,M4 决策气泡复用此形态) */
const ACTIVITY_EMOJI: Record<string, string> = {
  study: '📖',
  work: '🔨',
  rest: '💤',
  workout: '💪',
  stroll: '🚶',
  meal: '🍽️',
};
/** 活动 → 静止姿态:坐(sit)/原地跑(run)/站立(idle) */
const ACTIVITY_POSES: Record<string, 'sit' | 'run' | 'idle'> = {
  study: 'sit',
  work: 'sit',
  rest: 'sit',
  meal: 'sit',
  workout: 'run',
  stroll: 'idle',
};
const BUBBLE_RADIUS = 8;
const BUBBLE_Y = -38;

type Direction = keyof typeof CHARACTER.rows;
type AnimGroup = keyof typeof CHARACTER.groups;

interface CharacterRender {
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
}

/**
 * 世界渲染场景:Kenney tile 地图(建筑立面/水岸/装饰分层)+ LPC 穿衣角色(walk/idle/sit 三组四向动画),
 * 角色向快照位置按 tick 速率插值移动。相机默认 2x 跟随选中角色,滚轮 1x~4x 缩放;
 * 数据源轮询 worldStore(避免与 React 渲染耦合),HUD 走 React 侧。
 */
export class WorldScene extends Phaser.Scene {
  private readonly _characters = new Map<string, CharacterRender>();
  private _nightOverlay: Phaser.GameObjects.Rectangle | null = null;
  /** 当前相机跟随的角色 id,null = 全图概览 */
  private _followId: string | null = null;

  constructor() {
    super('world');
  }

  preload(): void {
    this.load.spritesheet(TILESET.key, TILESET.url, {
      frameWidth: TILESET.frameWidth,
      frameHeight: TILESET.frameHeight,
      spacing: TILESET.spacing,
    });
    for (const variant of CHARACTER.variants) {
      this.load.spritesheet(this._textureKey(variant), `/assets/character/char-${variant}.png`, {
        frameWidth: CHARACTER.frameWidth,
        frameHeight: CHARACTER.frameHeight,
      });
    }
  }

  private _textureKey(variant: string): string {
    return `${CHARACTER.keyPrefix}-${variant}`;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#8fc978');
    this._drawMap(TOWN_MAP);
    this._createCharacterAnims();
    this._nightOverlay = this.add
      .rectangle(0, 0, TOWN_MAP.width * TILE, TOWN_MAP.height * TILE, 0x0a1436, 1)
      .setOrigin(0, 0)
      .setAlpha(0)
      .setDepth(100);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, TOWN_MAP.width * TILE, TOWN_MAP.height * TILE);
    cam.setZoom(ZOOM_DEFAULT);
    this.input.on(
      'wheel',
      (
        pointer: Phaser.Input.Pointer,
        _over: Phaser.GameObjects.GameObject[],
        _dx: number,
        dy: number,
      ) => {
        const anchor = cam.getWorldPoint(pointer.x, pointer.y);
        const factor = dy > 0 ? 0.85 : 1.18;
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
        if (cam.zoom <= ZOOM_MIN) {
          cam.centerOn((TOWN_MAP.width * TILE) / 2, (TOWN_MAP.height * TILE) / 2);
        } else {
          // 保持指针下的世界坐标不动(围绕指针缩放)
          cam.setScroll(anchor.x - pointer.x / cam.zoom, anchor.y - pointer.y / cam.zoom);
        }
      },
    );
  }

  private _updateCamera(selectedId: string | null): void {
    const cam = this.cameras.main;
    const desired = cam.zoom > ZOOM_MIN && selectedId !== null ? selectedId : null;
    if (desired === this._followId) return;
    const render = desired !== null ? this._characters.get(desired) : undefined;
    if (desired === null) {
      cam.stopFollow();
      cam.centerOn((TOWN_MAP.width * TILE) / 2, (TOWN_MAP.height * TILE) / 2);
      this._followId = null;
    } else if (render !== undefined) {
      cam.startFollow(render.node, true, 0.15, 0.15);
      this._followId = desired;
    }
  }

  override update(_time: number, delta: number): void {
    const { snapshot, selectedCharacterId } = useWorldStore.getState();
    this._syncCharacterNodes(snapshot?.characters ?? []);
    this.anims.globalTimeScale = snapshot?.timeScale ?? 1;
    this._updateCamera(selectedCharacterId);
    if (this._nightOverlay !== null) {
      // 昼夜色调平滑过渡
      const target = (snapshot?.clock.isNight ?? false) ? 0.38 : 0;
      this._nightOverlay.alpha = Phaser.Math.Linear(
        this._nightOverlay.alpha,
        target,
        Math.min(1, (delta / 1000) * 2),
      );
    }
    // 1 tick = 1 游戏分钟,倍率加快 tick 频率 → 插值与步频随 timeScale 放大
    const now = this.time.now;
    const step = (delta / 1000) * (snapshot?.timeScale ?? 1) * TILES_PER_TICK;
    for (const render of this._characters.values()) {
      const dx = render.targetX - render.x;
      const dy = render.targetY - render.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= step || distance > SNAP_DISTANCE_TILES) {
        render.x = render.targetX;
        render.y = render.targetY;
        // 活动姿态映射:健身=原地跑(walk 动画不位移),散步=站立,其余=坐
        if (render.inActivity && render.activityId !== null) {
          const pose = ACTIVITY_POSES[render.activityId] ?? 'sit';
          if (pose === 'run') {
            this._playAnim(render, 'walk');
          } else {
            this._playAnim(render, pose);
          }
        } else {
          this._playAnim(render, 'idle');
        }
      } else {
        render.x += (dx / distance) * step;
        render.y += (dy / distance) * step;
        this._playWalk(render, dx, dy);
      }
      render.node.setPosition(render.x * TILE + TILE / 2, render.y * TILE + TILE / 2);
      this._updateBubble(render, now);
    }
  }

  /** 头顶活动气泡:活动开始挂载/结束销毁,进度环仅在 elapsed 变化时重绘,悬浮呼吸 */
  private _updateBubble(render: CharacterRender, now: number): void {
    if (render.activityId === null || !render.inActivity) {
      if (render.bubble !== null) {
        render.bubble.destroy();
        render.bubble = null;
        render.bubbleRing = null;
        render.bubbleText = null;
      }
      return;
    }
    if (render.bubble === null) {
      const ring = this.add.graphics();
      const emoji = ACTIVITY_EMOJI[render.activityId] ?? '❓';
      const text = this.add
        .text(0, 0, emoji, { fontSize: '9px', color: '#222222' })
        .setOrigin(0.5, 0.5);
      const bubble = this.add.container(0, BUBBLE_Y, [ring, text]);
      render.node.add(bubble);
      render.bubble = bubble;
      render.bubbleRing = ring;
      render.bubbleText = text;
      render.bubbleElapsed = -1;
    }
    const phase = (render.targetX + render.targetY) * 0.7;
    render.bubble.y = BUBBLE_Y + Math.sin(now / 400 + phase) * 1.5;
    const emoji = ACTIVITY_EMOJI[render.activityId] ?? '❓';
    if (render.bubbleText !== null && render.bubbleText.text !== emoji) {
      render.bubbleText.setText(emoji);
    }
    if (render.bubbleElapsed !== render.elapsedMinutes) {
      this._drawBubbleRing(render);
    }
  }

  /** 进度环:白底圆+图标,外圈绿色弧线自顶部顺时针随 elapsed/duration 增长 */
  private _drawBubbleRing(render: CharacterRender): void {
    const ring = render.bubbleRing;
    if (ring === null || render.activityId === null) return;
    const def = getActivityDefinition(render.activityId);
    const progress =
      def !== null && def.durationMinutes > 0
        ? Math.min(1, render.elapsedMinutes / def.durationMinutes)
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
    render.bubbleElapsed = render.elapsedMinutes;
  }

  private _drawMap(map: TileMapDefinition): void {
    const border = (x: number, y: number): boolean =>
      x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const rect = map.blockedRects.find((r) => inRect(x, y, r));
        if (rect !== undefined) {
          if (inRect(x, y, POND_RECT)) {
            this._pondTile(x, y);
            continue;
          }
          // 建筑立面:上侧铺所属场所的屋顶色,底部两行墙身(门窗在场所遍历时叠加)
          const place = map.places.find((p) => inRect(x, y, p));
          const frame =
            place !== undefined && y < rect.y + rect.h - 2
              ? ROOF_FRAME[place.id] ?? TILE_FRAME.wall
              : TILE_FRAME.wall;
          this._ground(x, y, frame);
          continue;
        }
        this._ground(x, y, TILE_FRAME.grass);
        if (inRect(x, y, PLAZA_RECT)) {
          this._ground(x, y, TILE_FRAME.plaza);
          continue;
        }
        if (map.paths.some((r) => inRect(x, y, r))) {
          this._ground(x, y, TILE_FRAME.path);
          continue;
        }
        if (border(x, y)) this._prop(x, y, TILE_FRAME.pine);
      }
    }

    for (const place of map.places) {
      if (place.id === 'park') {
        this._drawPark(map, place);
      } else {
        this._drawFacade(place);
      }
      this.add
        .text(place.x * TILE + (place.w * TILE) / 2, place.y * TILE + 2, place.name, {
          fontSize: '11px',
          color: '#ffffff',
        })
        .setOrigin(0.5, 0)
        .setDepth(20)
        .setStroke('rgba(0,0,0,0.6)', 3);
    }

    for (const [lx, ly] of [...STREET_LAMPS, ...PLAZA_LAMPS]) {
      this._prop(lx, ly, TILE_FRAME.lamp);
    }
  }

  /** 池塘:按格位铺 8 向水岸 + 中心水面 */
  private _pondTile(x: number, y: number): void {
    const f = TILE_FRAME;
    const west = x === POND_RECT.x;
    const east = x === POND_RECT.x + POND_RECT.w - 1;
    const north = y === POND_RECT.y;
    const south = y === POND_RECT.y + POND_RECT.h - 1;
    const frame = north && west ? f.shoreNW
      : north && east ? f.shoreNE
      : south && west ? f.shoreSW
      : south && east ? f.shoreSE
      : north ? f.shoreN
      : south ? f.shoreS
      : west ? f.shoreW
      : east ? f.shoreE
      : f.water;
    this._ground(x, y, frame);
  }

  /** 建筑立面:上层窗、底层入口列门;shop/restaurant 门上加密色遮阳篷作招牌 */
  private _drawFacade(place: PlaceDefinition): void {
    const doorRow = place.y + place.h - 1;
    const winRow = doorRow - 1;
    for (let x = place.x + 1; x < place.x + place.w - 1; x += 1) {
      if ((x - place.x) % 2 === 1) {
        const frame = (x + place.y) % 2 === 0 ? TILE_FRAME.windowBrown : TILE_FRAME.windowWhite;
        this._overlay(x, winRow, frame);
      }
    }
    if (place.id === 'shop') this._overlay(place.entrance.x, winRow, TILE_FRAME.awningOrange);
    if (place.id === 'restaurant') this._overlay(place.entrance.x, winRow, TILE_FRAME.awningGreen);
    this._overlay(place.entrance.x, doorRow, TILE_FRAME.door);
    this._ground(place.entrance.x, place.entrance.y, TILE_FRAME.path);
  }

  /** 公园:草皮 + 稀疏花丛 + 树/灌木/野餐桌/园灯 + 北缘栅栏(入口列留豁) */
  private _drawPark(map: TileMapDefinition, place: PlaceDefinition): void {
    this._fillPlace(map, place, TILE_FRAME.parkGrass);
    const flowers = [TILE_FRAME.flowerPurple, TILE_FRAME.flowerYellow, TILE_FRAME.flowerOrange];
    for (let y = place.y; y < place.y + place.h; y += 1) {
      for (let x = place.x; x < place.x + place.w; x += 1) {
        if (inRect(x, y, POND_RECT)) continue;
        if ((x * 7 + y * 5) % 13 === 0) this._overlay(x, y, flowers[(x + y) % flowers.length]!);
      }
    }
    for (const [tx, ty] of PARK_TREES) {
      this._prop(tx, ty, PROP_TREES[(tx + ty) % PROP_TREES.length]!);
    }
    for (const [bx, by] of PARK_BUSHES) this._prop(bx, by, TILE_FRAME.bush);
    for (const [bx, by] of PARK_BENCHES) this._prop(bx, by, TILE_FRAME.bench);
    for (const [lx, ly] of PARK_LAMPS) this._prop(lx, ly, TILE_FRAME.lamp);
    for (let x = place.x; x < place.x + place.w; x += 1) {
      if (x === place.entrance.x) continue;
      this._prop(x, place.y, TILE_FRAME.fence);
    }
  }

  private _ground(x: number, y: number, frame: number): void {
    this.add.image(x * TILE, y * TILE, TILESET.key, frame).setOrigin(0, 0);
  }

  private _prop(x: number, y: number, frame: number): void {
    this.add.image(x * TILE, y * TILE, TILESET.key, frame).setOrigin(0, 0).setDepth(5);
  }

  /** 立面门窗/花丛等覆盖在底瓦之上的装饰 */
  private _overlay(x: number, y: number, frame: number): void {
    this.add.image(x * TILE, y * TILE, TILESET.key, frame).setOrigin(0, 0).setDepth(6);
  }

  /** 可行走场所整块铺装;障碍格(如公园内的池塘)跳过,保留主循环已画的水岸 */
  private _fillPlace(map: TileMapDefinition, place: PlaceDefinition, frame: number): void {
    for (let y = place.y; y < place.y + place.h; y += 1) {
      for (let x = place.x; x < place.x + place.w; x += 1) {
        if (map.blockedRects.some((r) => inRect(x, y, r))) continue;
        this._ground(x, y, frame);
      }
    }
  }

  private _createCharacterAnims(): void {
    for (const variant of CHARACTER.variants) {
      for (const group of Object.keys(CHARACTER.groups) as AnimGroup[]) {
        for (const [dir, row] of Object.entries(CHARACTER.rows) as [Direction, number][]) {
          const start = (CHARACTER.groups[group] + row) * CHARACTER.columns;
          this.anims.create({
            key: this._animKey(variant, group, dir),
            frames: this.anims.generateFrameNumbers(this._textureKey(variant), {
              start,
              end: start + CHARACTER.framesPerGroup[group] - 1,
            }),
            frameRate: group === 'walk' ? CHARACTER.walkFps : group === 'idle' ? CHARACTER.idleFps : CHARACTER.sitFps,
            repeat: -1,
          });
        }
      }
    }
  }

  private _animKey(variant: string, group: AnimGroup, dir: Direction): string {
    return `${variant}-${group}-${dir}`;
  }

  private _syncCharacterNodes(
    characters: {
      id: string;
      name: string;
      x: number;
      y: number;
      activity: { activityId: string; elapsedMinutes: number } | null;
    }[],
  ): void {
    const seen = new Set<string>();
    for (const character of characters) {
      seen.add(character.id);
      let render = this._characters.get(character.id);
      if (!render) {
        render = {
          ...this._createCharacterNode(character.id, character.name),
          x: character.x,
          y: character.y,
          targetX: character.x,
          targetY: character.y,
          dir: 'down',
          inActivity: character.activity !== null,
          activityId: character.activity?.activityId ?? null,
          elapsedMinutes: character.activity?.elapsedMinutes ?? 0,
          bubble: null,
          bubbleRing: null,
          bubbleText: null,
          bubbleElapsed: -1,
          animKey: null,
        };
        this._characters.set(character.id, render);
        render.node.setPosition(render.x * TILE + TILE / 2, render.y * TILE + TILE / 2);
      }
      render.targetX = character.x;
      render.targetY = character.y;
      render.inActivity = character.activity !== null;
      render.activityId = character.activity?.activityId ?? null;
      render.elapsedMinutes = character.activity?.elapsedMinutes ?? 0;
    }
    for (const [id, render] of this._characters) {
      if (!seen.has(id)) {
        render.node.destroy();
        this._characters.delete(id);
      }
    }
  }

  private _createCharacterNode(
    id: string,
    name: string,
  ): {
    node: Phaser.GameObjects.Container;
    sprite: Phaser.GameObjects.Sprite;
    variant: string;
  } {
    const variant = characterVariant(id);
    const node = this.add.container(0, 0);
    const sprite = this.add
      .sprite(
        0,
        0,
        this._textureKey(variant),
        (CHARACTER.groups.idle + CHARACTER.rows.down) * CHARACTER.columns,
      )
      .setOrigin(0.5, 0.82);
    const label = this.add
      .text(0, -24, name, { fontSize: '10px', color: '#ffffff' })
      .setOrigin(0.5, 0)
      .setBackgroundColor('rgba(0,0,0,0.45)');
    node.add([sprite, label]);
    node.setDepth(10);
    return { node, sprite, variant };
  }

  private _playWalk(render: CharacterRender, dx: number, dy: number): void {
    const dir: Direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    render.dir = dir;
    this._playAnim(render, 'walk', dir);
  }

  private _playAnim(render: CharacterRender, group: AnimGroup, dir: Direction = render.dir): void {
    const key = this._animKey(render.variant, group, dir);
    if (render.animKey !== key) {
      render.animKey = key;
      render.sprite.play(key, true);
    }
  }
}
