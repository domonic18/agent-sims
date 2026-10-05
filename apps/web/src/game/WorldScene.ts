import Phaser from 'phaser';
import { TOWN_MAP, WALK_SPEED_TILES_PER_TICK, type WorldEvent } from '@sims/shared';
import { useWorldStore } from '../store/worldStore';
import { FURNITURE_SPRITES, PROPS, TILE, TILESET, CHARACTER, furnitureKey, propKey } from './assets';
import {
  createCharacterAnims,
  syncCharacterViews,
  textureKey,
  updateCharacterView,
  type CharacterRender,
} from './character-view';
import { buildLightLayer, drawSelectionRing, FountainFx } from './effects';
import { handleMapClick, KeyboardController } from './input';
import { drawTownMap } from './terrain';
import { showSpeechBubble } from './speech';

/** 相机:默认 2x 跟随选中角色,滚轮在 1x~4x 间缩放,1x 为全图概览 */
const ZOOM_DEFAULT = 2;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/**
 * 世界渲染场景编排:地形/内景/灯光/喷泉/角色视图各模块装配
 * (M3.6h 拆分,细节见 terrain/effects/input/character-view)。
 * 数据源轮询 worldStore(避免与 React 渲染耦合),HUD 走 React 侧。
 */
export class WorldScene extends Phaser.Scene {
  private readonly _views = new Map<string, CharacterRender>();
  private _nightOverlay: Phaser.GameObjects.Rectangle | null = null;
  /** 夜间灯光层(户外光圈+整屋暖光矩形),alpha 随 isNight 插值 */
  private _lightLayer: Phaser.GameObjects.Container | null = null;
  /** 选中角色脚下呼吸椭圆环 */
  private _selectionRing: Phaser.GameObjects.Graphics | null = null;
  /** 广场喷泉波纹动画 */
  private readonly _fountain = new FountainFx();
  /** 方向键/WASD 连续移动控制器(仅 /lab 交互模式挂载) */
  private _keyboard: KeyboardController | null = null;
  /** 当前相机跟随的角色 id,null = 全图概览 */
  private _followId: string | null = null;
  /** 交互开关: 主页面纯观看(仅点选角色/缩放),/lab 调试台全量操控(地图移动/方向键) */
  private _interactive = true;
  /** 已消费的事件序号(事件队列增量拉取,同 tick 多事件不丢) */
  private _lastEventSeq = 0;

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
      this.load.spritesheet(textureKey(variant), `/assets/character/char-${variant}.png`, {
        frameWidth: CHARACTER.frameWidth,
        frameHeight: CHARACTER.frameHeight,
      });
    }
    for (const name of PROPS) {
      this.load.image(propKey(name), `/assets/props/${name}.png`);
    }
    for (const name of FURNITURE_SPRITES) {
      this.load.image(furnitureKey(name), `/assets/furniture/${name}.png`);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#8fc978');
    drawTownMap(this);
    createCharacterAnims(this);
    this._nightOverlay = this.add
      .rectangle(0, 0, TOWN_MAP.width * TILE, TOWN_MAP.height * TILE, 0x081024, 1)
      .setOrigin(0, 0)
      .setAlpha(0)
      .setDepth(100);
    this._lightLayer = buildLightLayer(this);
    this._selectionRing = this.add.graphics().setDepth(9);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, TOWN_MAP.width * TILE, TOWN_MAP.height * TILE);
    cam.setZoom(ZOOM_DEFAULT);
    this._interactive = this.registry.get('interactive') !== false;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) =>
      handleMapClick(this, pointer, this._views, this._interactive),
    );
    if (this._interactive) {
      this._keyboard = new KeyboardController(this);
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

  override update(time: number, delta: number): void {
    const { snapshot, selectedCharacterId, events } = useWorldStore.getState();
    syncCharacterViews(this, this._views, snapshot?.characters ?? []);
    this._drainSocialEvents(events);
    this.anims.globalTimeScale = snapshot?.timeScale ?? 1;
    this._updateCamera(selectedCharacterId);
    this._keyboard?.step(time);
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
    const step = (delta / 1000) * (snapshot?.timeScale ?? 1) * WALK_SPEED_TILES_PER_TICK;
    for (const view of this._views.values()) {
      updateCharacterView(this, view, step, now);
    }
    if (this._selectionRing !== null) {
      drawSelectionRing(this._selectionRing, now, selectedCharacterId, this._views);
    }
    this._fountain.update(this, now);
  }

  /** 闲聊事件 → 双方头顶对话气泡(社交 v1;幽灵不显示) */
  private _drainSocialEvents(queue: Array<{ seq: number; event: WorldEvent }>): void {
    for (const { seq, event } of queue) {
      if (seq <= this._lastEventSeq) continue;
      this._lastEventSeq = seq;
      if (event.type !== 'social.chat') continue;
      for (const id of new Set([event.fromId, event.toId])) {
        const view = this._views.get(id);
        if (view !== undefined && view.alive) {
          showSpeechBubble(this, view.node, event.content);
        }
      }
    }
  }

  private _updateCamera(selectedId: string | null): void {
    const cam = this.cameras.main;
    const desired = cam.zoom > ZOOM_MIN && selectedId !== null ? selectedId : null;
    if (desired === this._followId) return;
    const view = desired !== null ? this._views.get(desired) : undefined;
    if (desired === null) {
      cam.stopFollow();
      cam.centerOn((TOWN_MAP.width * TILE) / 2, (TOWN_MAP.height * TILE) / 2);
      this._followId = null;
    } else if (view !== undefined) {
      cam.startFollow(view.node, true, 0.15, 0.15);
      this._followId = desired;
    }
  }
}
