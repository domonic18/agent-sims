import Phaser from 'phaser';
import {
  TOWN_MAP,
  getActivityDefinition,
  type FurnitureDefinition,
  type PlaceDefinition,
  type TileMapDefinition,
} from '@sims/shared';
import { sendIntent } from '../net/socket';
import { useWorldStore } from '../store/worldStore';
import { pushToast } from '../store/toastStore';
import { CHARACTER, characterVariant, PROP_TREES, TILE_FRAME, TILESET } from './assets';

const TILE = 16;
/** 与服务端 BALANCE.WALK_SPEED_TILES_PER_MINUTE 对应的移动契约:每 tick 1 格 */
const TILES_PER_TICK = 2;
/** 目标偏差超过该格数视为瞬移(重连/重生),直接吸附 */
const SNAP_DISTANCE_TILES = 4;

const POND_RECT = { x: 4, y: 30, w: 4, h: 4 };
/** 广场铺装(paths 内矩形默认砂路,该矩形单独用灰石) */
const PLAZA_RECT = { x: 22, y: 15, w: 12, h: 11 };
/** 广场喷泉(blockedRect 内,程序化绘制+正弦波纹动画) */
const FOUNTAIN_RECT = { x: 30, y: 18, w: 3, h: 3 };

/** 内景配色(M3.6e 剖切风): 墙体按场所着色区分建筑,室内铺木地板双色棋盘 */
const WALL_COLORS: Record<string, number> = {
  'home-a': 0x9c7b5f,
  'home-b': 0xa8825f,
  'home-c': 0x8f7a9c,
  'home-d': 0x7f9c6f,
  library: 0x7a6f9e,
  office: 0x6f8496,
  shop: 0xa8894f,
  restaurant: 0xa26353,
  gym: 0x5f8472,
};
const WALL_DEFAULT = 0x7d7d85;
const FLOOR_A = 0xd9b98a;
const FLOOR_B = 0xcfae7e;
const FLOOR_LINE = 0xb1925f;
/** 相机:默认 2x 跟随选中角色,滚轮在 1x~4x 间缩放,1x 为全图概览 */
const ZOOM_DEFAULT = 2;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/** 方向键步进:两次下发最小间隔(ms),步进节奏实际由快照 pathRemaining 门控 */
const KEY_STEP_MIN_INTERVAL_MS = 180;
/** 长按朝不可行走方向时,拒绝 toast 的最小重复间隔(ms) */
const KEY_BLOCKED_TOAST_INTERVAL_MS = 1200;

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
/** M3.6f 围栏灯: 公园北缘/广场北角/健身房两侧/公寓 D 门前横路两端的夜间点缀灯 */
const FENCE_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [5, 25],
  [13, 25],
  [26, 14],
  [35, 14],
  [43, 25],
  [52, 25],
  [27, 44],
  [46, 44],
];
/** M3.6f 花丛点缀: 广场四角/主街沿线的固定花位(纯视觉) */
const DECOR_FLOWERS: ReadonlyArray<readonly [number, number]> = [
  [22, 15],
  [33, 15],
  [22, 25],
  [33, 25],
  [10, 19],
  [18, 21],
  [40, 19],
  [52, 21],
  [21, 25],
  [26, 25],
  [30, 45],
  [41, 45],
];
/** M3.6f 新公寓周边行道树(纯视觉) */
const APARTMENT_TREES: ReadonlyArray<readonly [number, number]> = [
  [2, 3],
  [15, 3],
  [15, 12],
  [25, 3],
  [25, 12],
  [54, 3],
  [54, 12],
  [31, 35],
  [41, 35],
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
  /** 最新体力值(≤20 低体力警示) */
  energy: number;
  /** rest 到位后横躺于床/长椅(吸附锚点中心+旋转 90°) */
  resting: boolean;
  /** 幽灵 👻 徽标(懒创建) */
  ghostBadge: Phaser.GameObjects.Text | null;
  /** 低体力 ⚡ 徽标(懒创建) */
  warnBadge: Phaser.GameObjects.Text | null;
}

/**
 * 世界渲染场景:Kenney tile 地图(水岸/装饰分层)+ 建筑剖切内景(地板/墙/家具程序化绘制)
 * + LPC 穿衣角色(walk/idle/sit 三组四向动画),角色向快照位置按 tick 速率插值移动。
 * 相机默认 2x 跟随选中角色,滚轮 1x~4x 缩放;
 * 数据源轮询 worldStore(避免与 React 渲染耦合),HUD 走 React 侧。
 */
export class WorldScene extends Phaser.Scene {
  private readonly _characters = new Map<string, CharacterRender>();
  private _nightOverlay: Phaser.GameObjects.Rectangle | null = null;
  /** 夜间灯光层(户外光圈+整屋暖光矩形),alpha 随 isNight 插值 */
  private _lightLayer: Phaser.GameObjects.Container | null = null;
  /** 选中角色脚下呼吸椭圆环 */
  private _selectionRing: Phaser.GameObjects.Graphics | null = null;
  /** 广场喷泉(程序化绘制,~200ms 正弦波纹重绘) */
  private _fountainGfx: Phaser.GameObjects.Graphics | null = null;
  private _lastFountainAt = 0;
  /** 当前相机跟随的角色 id,null = 全图概览 */
  private _followId: string | null = null;
  private _keyControls: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  private _lastKeyStepAt = 0;
  private _lastBlockedToastAt = 0;
  /** 交互开关: 主页面纯观看(仅点选角色/缩放),/lab 调试台全量操控(地图移动/方向键) */
  private _interactive = true;

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
      .rectangle(0, 0, TOWN_MAP.width * TILE, TOWN_MAP.height * TILE, 0x081024, 1)
      .setOrigin(0, 0)
      .setAlpha(0)
      .setDepth(100);
    this._buildLightLayer();
    this._selectionRing = this.add.graphics().setDepth(9);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, TOWN_MAP.width * TILE, TOWN_MAP.height * TILE);
    cam.setZoom(ZOOM_DEFAULT);
    this._interactive = this.registry.get('interactive') !== false;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this._handleMapClick(pointer));
    if (this._interactive) {
      const keyboard = this.input.keyboard;
      if (keyboard !== null) {
        this._keyControls = keyboard.addKeys(
          'UP,DOWN,LEFT,RIGHT,W,A,S,D',
        ) as Record<string, Phaser.Input.Keyboard.Key>;
      }
    }
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

  /**
   * 地图点击三分支(M3.6a): 点角色=选中;点建筑=侧栏定位联动;
   * 其余空地=下发 move_to 由服务端裁决(不可行走/不可达拒绝信息经 toast 展示)。
   */
  private _handleMapClick(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tx = Math.floor(world.x / TILE);
    const ty = Math.floor(world.y / TILE);
    if (tx < 0 || ty < 0 || tx >= TOWN_MAP.width || ty >= TOWN_MAP.height) return;

    for (const [id, render] of this._characters) {
      const hit =
        Math.abs(world.x - render.node.x) <= 10 &&
        world.y >= render.node.y - 28 &&
        world.y <= render.node.y + 8;
      if (hit) {
        useWorldStore.getState().selectCharacter(id);
        return;
      }
    }

    // 纯观看页(主页面): 点选角色跟随即可,不下发移动/定位
    if (!this._interactive) return;

    const place = TOWN_MAP.places.find((p) => p.id !== 'park' && inRect(tx, ty, p));
    if (place !== undefined) {
      useWorldStore.getState().focusPlace(place.id);
      pushToast(true, `已定位「${place.name}」`);
      return;
    }

    useWorldStore.getState().focusPlace(null);
    const { selectedCharacterId } = useWorldStore.getState();
    if (selectedCharacterId === null) {
      pushToast(false, '先点击角色选中,再下达移动指令');
      return;
    }
    void sendIntent({ type: 'move_to', characterId: selectedCharacterId, x: tx, y: ty }).then(
      (ack) => pushToast(ack.ok, ack.message),
    );
  }

  /**
   * 方向键/WASD 步进移动(验收反馈②): 人类输入层便利功能,客户端合成为一格
   * move_to,协议零改动——Agent 动作空间仍以 move_to 坐标为原语(设计点⑦,M3.6d 定稿)。
   * 行走中(pathRemaining>0)不重复下发,到达后才走下一步;焦点在表单控件时忽略按键。
   */
  private _handleKeyboardStep(time: number): void {
    const keys = this._keyControls;
    if (keys === null) return;
    const active = document.activeElement;
    if (active !== null && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
    const dir =
      keys.UP?.isDown || keys.W?.isDown ? { dx: 0, dy: -1 }
      : keys.DOWN?.isDown || keys.S?.isDown ? { dx: 0, dy: 1 }
      : keys.LEFT?.isDown || keys.A?.isDown ? { dx: -1, dy: 0 }
      : keys.RIGHT?.isDown || keys.D?.isDown ? { dx: 1, dy: 0 }
      : null;
    if (dir === null) return;
    if (time - this._lastKeyStepAt < KEY_STEP_MIN_INTERVAL_MS) return;
    const { snapshot, selectedCharacterId } = useWorldStore.getState();
    if (snapshot === null || snapshot.paused || selectedCharacterId === null) return;
    const character = snapshot.characters.find((c) => c.id === selectedCharacterId);
    if (character === undefined || character.pathRemaining > 0) return;
    this._lastKeyStepAt = time;
    void sendIntent({
      type: 'move_to',
      characterId: character.id,
      x: character.x + dir.dx,
      y: character.y + dir.dy,
    }).then((ack) => {
      if (!ack.ok && time - this._lastBlockedToastAt > KEY_BLOCKED_TOAST_INTERVAL_MS) {
        this._lastBlockedToastAt = time;
        pushToast(false, ack.message);
      }
    });
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

  override update(time: number, delta: number): void {
    const { snapshot, selectedCharacterId } = useWorldStore.getState();
    this._syncCharacterNodes(snapshot?.characters ?? []);
    this.anims.globalTimeScale = snapshot?.timeScale ?? 1;
    this._updateCamera(selectedCharacterId);
    this._handleKeyboardStep(time);
    if (this._nightOverlay !== null) {
      // 昼夜色调平滑过渡(M3.6f 加深夜色)
      const night = snapshot?.clock.isNight ?? false;
      const target = night ? 0.55 : 0;
      const ease = Math.min(1, (delta / 1000) * 2);
      this._nightOverlay.alpha = Phaser.Math.Linear(this._nightOverlay.alpha, target, ease);
      if (this._lightLayer !== null) {
        this._lightLayer.alpha = Phaser.Math.Linear(this._lightLayer.alpha, night ? 1 : 0, ease);
      }
    }
    // 1 tick = 1 游戏分钟,倍率加快 tick 频率 → 插值与步频随 timeScale 放大
    const now = this.time.now;
    const step = (delta / 1000) * (snapshot?.timeScale ?? 1) * TILES_PER_TICK;
    for (const render of this._characters.values()) {
      const dx = render.targetX - render.x;
      const dy = render.targetY - render.y;
      const distance = Math.hypot(dx, dy);
      let drawX = render.x;
      let drawY = render.y;
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
        // M3.6f 躺床: rest 到位后吸附锚点家具占地中心,纯视觉横躺
        // (M3.6g 按 anchorKind 匹配档位家具,沙发不再吸附到床)
        const anchor =
          render.inActivity && render.activityId === 'rest'
            ? this._nearestRestAnchor(render.x, render.y, render.anchorKind)
            : null;
        render.resting = anchor !== null;
        if (anchor !== null) {
          drawX = anchor.cx;
          drawY = anchor.cy;
        }
      } else {
        render.resting = false;
        render.x += (dx / distance) * step;
        render.y += (dy / distance) * step;
        this._playWalk(render, dx, dy);
      }
      render.sprite.setAngle(render.resting ? 90 : 0);
      // 幽灵态: 半透明飘浮
      const bob = render.alive ? 0 : Math.sin(now / 300) * 1.5 - 2;
      render.node.setPosition(drawX * TILE + TILE / 2, drawY * TILE + TILE / 2 + bob);
      this._updateBubble(render, now);
      this._updateBadges(render, now);
    }
    this._drawSelectionRing(now);
    this._updateFountain(now);
  }

  /** rest 锚点全集(床/沙发/长椅占地中心,格坐标),按档位 kind 过滤后取距角色最近者 */
  private _nearestRestAnchor(
    x: number,
    y: number,
    kind: string | null,
  ): { cx: number; cy: number } | null {
    let best: { cx: number; cy: number } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const place of TOWN_MAP.places) {
      for (const f of place.furniture ?? []) {
        if (f.activityId !== 'rest') continue;
        if (kind !== null && f.kind !== kind) continue;
        const cx = f.x + f.w / 2;
        const cy = f.y + f.h / 2;
        const dist = Math.abs(cx - x) + Math.abs(cy - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { cx, cy };
        }
      }
    }
    return best;
  }

  /** 幽灵 👻 与低体力 ⚡ 徽标(懒创建,闪烁驱动) */
  private _updateBadges(render: CharacterRender, now: number): void {
    if (render.ghostBadge === null) {
      render.ghostBadge = this.add
        .text(0, BUBBLE_Y - 14, '👻', { fontSize: '10px' })
        .setOrigin(0.5, 0.5);
      render.node.add(render.ghostBadge);
    }
    render.ghostBadge.setVisible(!render.alive);
    render.sprite.setTint(render.alive ? 0xffffff : 0x8899aa);
    render.sprite.alpha = render.alive ? 1 : 0.55;
    if (render.warnBadge === null) {
      render.warnBadge = this.add
        .text(13, -22, '⚡', { fontSize: '10px', color: '#ff4d4d' })
        .setOrigin(0.5, 0.5)
        .setStroke('rgba(0,0,0,0.5)', 2);
      render.node.add(render.warnBadge);
    }
    render.warnBadge.setVisible(render.alive && render.energy <= 20 && Math.floor(now / 400) % 2 === 0);
  }

  /** 选中角色脚下呼吸椭圆环 */
  private _drawSelectionRing(now: number): void {
    const ring = this._selectionRing;
    if (ring === null) return;
    ring.clear();
    const { selectedCharacterId } = useWorldStore.getState();
    if (selectedCharacterId === null) return;
    const render = this._characters.get(selectedCharacterId);
    if (render === undefined) return;
    ring.fillStyle(0x66ffcc, 0.25 + 0.15 * Math.sin(now / 500));
    ring.fillEllipse(render.node.x, render.node.y + 8, 22, 10);
  }

  /** 广场喷泉: 石池+立柱+水面,每 ~200ms 按正弦相位重绘波纹 */
  private _updateFountain(now: number): void {
    if (now - this._lastFountainAt < 200) return;
    this._lastFountainAt = now;
    if (this._fountainGfx === null) {
      this._fountainGfx = this.add.graphics().setDepth(2);
    }
    const g = this._fountainGfx;
    g.clear();
    const px = FOUNTAIN_RECT.x * TILE;
    const py = FOUNTAIN_RECT.y * TILE;
    const size = FOUNTAIN_RECT.w * TILE;
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

  /**
   * 夜间灯光层(M3.6g 重做): 圆形光圈只留户外(路灯/围栏灯/公园/广场);
   * 有门建筑改为整屋暖色矩形(整间亮),仅门口保留小光圈透光。
   */
  private _buildLightLayer(): void {
    const layer = this.add.container(0, 0).setDepth(101);
    this._lightLayer = layer;
    const glow = (tx: number, ty: number, scale = 1, alpha = 1): void => {
      const g = this.add.graphics();
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      const warm = 0xffd27a;
      g.fillStyle(warm, 0.1 * alpha);
      g.fillCircle(cx, cy, 40 * scale);
      g.fillStyle(warm, 0.18 * alpha);
      g.fillCircle(cx, cy, 22 * scale);
      g.fillStyle(warm, 0.5 * alpha);
      g.fillCircle(cx, cy, 6 * scale);
      g.blendMode = Phaser.BlendModes.ADD;
      layer.add(g);
    };
    for (const [x, y] of [...STREET_LAMPS, ...PLAZA_LAMPS, ...PARK_LAMPS, ...FENCE_LAMPS]) {
      glow(x, y);
    }
    for (const place of TOWN_MAP.places) {
      if (place.door === undefined) continue;
      // 整屋暖光: 覆盖场所占地的低强度矩形,ADD 混合随夜显隐
      const room = this.add.graphics();
      room.fillStyle(0xffd27a, 0.2);
      room.fillRect(place.x * TILE, place.y * TILE, place.w * TILE, place.h * TILE);
      room.blendMode = Phaser.BlendModes.ADD;
      layer.add(room);
      glow(place.door.x, place.door.y, 0.7, 0.9); // 门口透光
    }
    layer.alpha = 0;
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
          // 障碍占地现仅池塘(建筑改为墙圈内景,由 _drawInterior 绘制)
          if (inRect(x, y, POND_RECT)) {
            this._pondTile(x, y);
            continue;
          }
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
      } else if (place.door !== undefined) {
        this._drawInterior(place);
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

    for (const [lx, ly] of [...STREET_LAMPS, ...PLAZA_LAMPS, ...PARK_LAMPS, ...FENCE_LAMPS]) {
      this._prop(lx, ly, TILE_FRAME.lamp);
    }
    const flowerFrames = [TILE_FRAME.flowerPurple, TILE_FRAME.flowerYellow, TILE_FRAME.flowerOrange];
    for (const [fx, fy] of DECOR_FLOWERS) {
      this._overlay(fx, fy, flowerFrames[(fx + fy) % flowerFrames.length]!);
    }
    for (const [tx, ty] of APARTMENT_TREES) {
      this._prop(tx, ty, PROP_TREES[(tx * 3 + ty) % PROP_TREES.length]!);
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

  /**
   * 建筑内景(M3.6e 剖切风): 取消屋顶/立面,同一地图直接画出可行走的室内——
   * 木地板 + 四边墙体(门洞豁口)+ 家具精灵,角色经门入内。
   */
  private _drawInterior(place: PlaceDefinition): void {
    const g = this.add.graphics();
    const wall = WALL_COLORS[place.id] ?? WALL_DEFAULT;
    const right = place.x + place.w - 1;
    const bottom = place.y + place.h - 1;
    const px = place.x * TILE;
    const py = place.y * TILE;
    // 室内木地板: 双色棋盘 + 细缝线
    for (let y = place.y + 1; y < bottom; y += 1) {
      for (let x = place.x + 1; x < right; x += 1) {
        g.fillStyle((x + y) % 2 === 0 ? FLOOR_A : FLOOR_B, 1);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    g.lineStyle(1, FLOOR_LINE, 0.35);
    for (let x = place.x + 1; x <= right; x += 1) {
      g.lineBetween(x * TILE, (place.y + 1) * TILE, x * TILE, bottom * TILE);
    }
    for (let y = place.y + 1; y <= bottom; y += 1) {
      g.lineBetween((place.x + 1) * TILE, y * TILE, right * TILE, y * TILE);
    }
    // 墙体四边,门洞格跳过(露出门槛)
    const isDoor = (x: number, y: number): boolean =>
      place.door !== undefined && place.door.x === x && place.door.y === y;
    g.fillStyle(wall, 1);
    for (let x = place.x; x <= right; x += 1) {
      if (!isDoor(x, place.y)) g.fillRect(x * TILE, place.y * TILE, TILE, TILE);
      if (!isDoor(x, bottom)) g.fillRect(x * TILE, bottom * TILE, TILE, TILE);
    }
    for (let y = place.y + 1; y < bottom; y += 1) {
      if (!isDoor(place.x, y)) g.fillRect(place.x * TILE, y * TILE, TILE, TILE);
      if (!isDoor(right, y)) g.fillRect(right * TILE, y * TILE, TILE, TILE);
    }
    // 墙体外缘高光 + 北/西墙内侧投影,增强厚度感
    g.fillStyle(0xffffff, 0.16);
    g.fillRect(px, py, place.w * TILE, 3);
    g.fillRect(px, py, 3, place.h * TILE);
    g.fillStyle(0x000000, 0.2);
    g.fillRect((place.x + 1) * TILE, (place.y + 1) * TILE, (place.w - 2) * TILE, 2);
    g.fillRect((place.x + 1) * TILE, (place.y + 1) * TILE, 2, (place.h - 2) * TILE);
    if (place.door !== undefined) {
      g.fillStyle(FLOOR_A, 1);
      g.fillRect(place.door.x * TILE, place.door.y * TILE, TILE, TILE);
      g.fillStyle(0x8a5a3a, 1);
      g.fillRect(place.door.x * TILE + 2, place.door.y * TILE + 4, TILE - 4, TILE - 8);
    }
    const fg = this.add.graphics();
    fg.setDepth(2);
    for (const furniture of place.furniture ?? []) {
      this._drawFurniture(fg, furniture);
    }
  }

  /** 家具程序化像素画:每格 16px,锚点家具(床/桌/跑步机等)即活动使用位 */
  private _drawFurniture(g: Phaser.GameObjects.Graphics, f: FurnitureDefinition): void {
    const px = f.x * TILE;
    const py = f.y * TILE;
    const w = f.w * TILE;
    const h = f.h * TILE;
    const r = (x: number, y: number, ww: number, hh: number, color: number): void => {
      g.fillStyle(color, 1);
      g.fillRect(px + x, py + y, ww, hh);
    };
    switch (f.kind) {
      case 'bed': {
        r(0, 0, w, h, 0x8a6d4a); // 床架
        r(2, 2, w - 4, h - 4, 0xf2ead8); // 床垫
        r(3, 3, w - 6, 6, 0xffffff); // 枕头(床头在上)
        r(2, 11, w - 4, h - 15, 0x7f9fd9); // 被子
        r(2, 11, w - 4, 2, 0x6f8fc9); // 被沿
        break;
      }
      case 'desk': {
        r(0, 2, w, h - 5, 0x9a6b45); // 桌面
        r(0, 2, w, 2, 0xb98a5f); // 桌沿高光
        r(2, h - 3, 3, 3, 0x6f4a2f); // 桌腿
        r(w - 5, h - 3, 3, 3, 0x6f4a2f);
        r(w - 12, 5, 8, 5, 0xd9534f); // 桌上的书
        r(w - 12, 5, 8, 2, 0xe2776f);
        break;
      }
      case 'workstation': {
        r(0, 9, w, h - 11, 0x7f8fa0); // 桌面(下半)
        r(0, 9, w, 2, 0x9aabb8);
        r(w / 2 - 8, 0, 16, 8, 0x333a44); // 显示器
        r(w / 2 - 6, 1, 12, 5, 0x6fd3e8); // 屏
        break;
      }
      case 'treadmill': {
        r(2, 3, w - 4, h - 5, 0x4a525c); // 机身
        r(4, h / 2, w - 8, h / 2 - 4, 0x22262c); // 跑带
        r(4, h / 2, w - 8, 2, 0x3a4048);
        r(1, 0, w - 2, 6, 0x8a99a8); // 仪表台
        r(3, 1, 4, 3, 0x6fd3e8); // 仪表屏
        break;
      }
      case 'table': {
        r(1, 2, w - 2, h - 6, 0xa87748); // 桌面
        r(1, 2, w - 2, 2, 0xc09060);
        r(3, h - 4, 3, 3, 0x7a5230); // 桌腿
        r(w - 6, h - 4, 3, 3, 0x7a5230);
        r(w / 2 - 3, 5, 6, 4, 0xe8e0d0); // 餐盘
        break;
      }
      case 'bookshelf': {
        r(0, 0, w, h, 0x7a5230); // 柜体
        const books = [0xd9534f, 0x4f8fd9, 0xe8b84f, 0x6fae5f, 0xb08fd9];
        for (let i = 1; i < w - 2; i += 3) {
          r(i, 2, 2, 5, books[i % books.length]!);
          r(i, 9, 2, 5, books[(i + 2) % books.length]!);
        }
        g.lineStyle(1, 0x8f6540, 1);
        g.lineBetween(px + 1, py + 7.5, px + w - 1, py + 7.5); // 中层隔板
        break;
      }
      case 'shelf': {
        r(0, 0, w, h, 0x8f979f); // 货架框架
        g.lineStyle(1, 0x767e86, 1);
        for (let i = 1; i < 4; i += 1) {
          g.lineBetween(px + 1, py + (h / 4) * i, px + w - 1, py + (h / 4) * i);
        }
        r(2, 3, w - 4, 4, 0xc9a06a); // 货箱
        r(2, h / 2 + 1, w - 4, 4, 0x8fb0d9);
        r(2, h - 5, w - 4, 4, 0x9fd98f);
        break;
      }
      case 'counter': {
        r(0, 0, w, h, 0x8d6e4f); // 柜体
        r(0, 0, w, 4, 0xb08f6a); // 台面
        r(0, h - 2, w, 2, 0x6f5238); // 底沿
        break;
      }
      case 'sofa': {
        r(0, 0, w, h, 0x5f7f5a); // 靠背
        r(0, h / 2, w, h / 2, 0x6f8f6a); // 座
        r(0, h / 2, w, 2, 0x7f9f7a);
        r(0, 0, 3, h, 0x4f6f4a); // 扶手
        r(w - 3, 0, 3, h, 0x4f6f4a);
        break;
      }
      case 'plant': {
        r(4, h - 7, w - 8, 6, 0xb0603f); // 花盆
        r(4, h - 7, w - 8, 2, 0x8f4f33);
        g.fillStyle(0x4f8f4a, 1);
        g.fillCircle(px + w / 2, py + 6, 5); // 叶冠
        g.fillStyle(0x63a85c, 1);
        g.fillCircle(px + w / 2 - 2, py + 5, 3);
        break;
      }
    }
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
      energy: number;
      alive: boolean;
      activity: { activityId: string; elapsedMinutes: number; anchorKind: string | null } | null;
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
          anchorKind: character.activity?.anchorKind ?? null,
          elapsedMinutes: character.activity?.elapsedMinutes ?? 0,
          bubble: null,
          bubbleRing: null,
          bubbleText: null,
          bubbleElapsed: -1,
          animKey: null,
          alive: character.alive,
          energy: character.energy,
          resting: false,
          ghostBadge: null,
          warnBadge: null,
        };
        this._characters.set(character.id, render);
        render.node.setPosition(render.x * TILE + TILE / 2, render.y * TILE + TILE / 2);
      }
      render.targetX = character.x;
      render.targetY = character.y;
      render.inActivity = character.activity !== null;
      render.activityId = character.activity?.activityId ?? null;
      render.anchorKind = character.activity?.anchorKind ?? null;
      render.elapsedMinutes = character.activity?.elapsedMinutes ?? 0;
      render.alive = character.alive;
      render.energy = character.energy;
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
