import Phaser from 'phaser';
import { WALK_SPEED_TILES_PER_TICK, type TileMapDefinition, type WorldEvent } from '@sims/shared';
import { useWorldStore } from '../store/worldStore';
import type { CameraMode } from '../store/worldStore';
import { TILE } from './assets';
import { registryOf } from './manifest';
import {
  createCharacterAnims,
  syncCharacterViews,
  updateCharacterView,
  type CharacterRender,
} from './character-view';
import { buildLightLayer, drawSelectionMarker, FOUNTAIN_RECT, FountainFx } from './effects';
import { handleMapClick, KeyboardController } from './input';
import { MAINTENANCE_SPRITES, syncMaintenanceViews } from './maintenance-view';
import { RESOURCE_SPRITES, syncResourceViews } from './resources-view';
import { drawTownMap } from './terrain';
import { showSpeechBubble } from './speech';

/** 相机(UI-1 全屏模式):默认 2x 跟随选中角色;缩放下限动态=视口能容下全图;overview 模式缩到下限居中 */
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
  /** 维护点贴图节点(M-G.5):key = spot id */
  private readonly _maintenanceViews = new Map<string, Phaser.GameObjects.Container>();
  /** 资源节点贴图节点(M-G.6):key = node id */
  private readonly _resourceViews = new Map<string, Phaser.GameObjects.Container>();
  /** 当前世界地图(创建时从 registry 取,相机/灯光/点击统一以此为源) */
  private _map: TileMapDefinition | null = null;
  private _nightOverlay: Phaser.GameObjects.Rectangle | null = null;
  /** 夜间灯光层(户外光圈+整屋暖光矩形),alpha 随 isNight 插值 */
  private _lightLayer: Phaser.GameObjects.Container | null = null;
  /** 选中角色脚下呼吸椭圆环 */
  private _selectionMarker: Phaser.GameObjects.Graphics | null = null;
  /** 广场喷泉波纹动画(仅内置地图有喷泉;生成地图置 null 不绘制) */
  private _fountain = new FountainFx(null);
  /** 方向键/WASD 连续移动控制器(仅 /lab 交互模式挂载) */
  private _keyboard: KeyboardController | null = null;
  /** 当前相机跟随的角色 id,null = 未跟随 */
  private _followId: string | null = null;
  /** 已落实到相机的模式(防逐帧重复 startFollow/centerOn) */
  private _appliedMode: CameraMode | null = null;
  /** 交互开关: 主页面纯观看(仅点选角色/缩放),/lab 调试台全量操控(地图移动/方向键) */
  private _interactive = true;
  /** 已消费的事件序号(事件队列增量拉取,同 tick 多事件不丢) */
  private _lastEventSeq = 0;

  constructor() {
    super('world');
  }

  preload(): void {
    // 素材库 manifest 驱动加载(M-L.3):纹理 key=slug,anim 素灵表按帧尺寸切分。
    // 全量导入后 active 达万级,按需加载——角色表/tile/固定装饰全量,
    // 家具(室内+户外道具)只加载当前地图引用的 slug(sprite 或 kind 兜底)
    const registry = registryOf(this);
    const map = this.registry.get('map') as TileMapDefinition | null;
    const usedSlugs = new Set<string>();
    for (const place of map?.places ?? []) {
      if (place.floorTile) usedSlugs.add(place.floorTile);
      if (place.wallTile) usedSlugs.add(place.wallTile);
      for (const furniture of place.furniture ?? []) {
        usedSlugs.add(furniture.sprite ?? furniture.kind);
      }
    }
    // 池驱动装饰/铺装(C3/C2b 数据条目):slug 即纹理,同地图引用同加载
    for (const entry of map?.decor?.props ?? []) usedSlugs.add(entry.slug);
    for (const entry of map?.decor?.flats ?? []) usedSlugs.add(entry.slug);
    for (const path of map?.paths ?? []) {
      if (path.tile) usedSlugs.add(path.tile);
    }
    for (const patch of map?.patches ?? []) usedSlugs.add(patch.tile);
    for (const asset of registry.manifest.assets) {
      const needed =
        asset.anim !== null ||
        asset.slug.startsWith('tile-') ||
        asset.categorySlug === 'props' ||
        asset.slug === 'plant' || // 家具缺素材的兜底纹理(见 furniture-art),恒加载
        MAINTENANCE_SPRITES.has(asset.slug) || // 维护点贴图(M-G.5)
        RESOURCE_SPRITES.has(asset.slug) || // 资源节点贴图(M-G.6)
        usedSlugs.has(asset.slug);
      if (!needed) continue;
      const url = `/assets/${asset.url}`;
      if (asset.anim !== null) {
        this.load.spritesheet(asset.slug, url, {
          frameWidth: asset.anim.frameWidth,
          frameHeight: asset.anim.frameHeight,
        });
      } else {
        this.load.image(asset.slug, url);
      }
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#8fc978');
    const map = (this._map = this.registry.get('map') as TileMapDefinition);
    drawTownMap(this, map);
    createCharacterAnims(this);
    this._nightOverlay = this.add
      .rectangle(0, 0, map.width * TILE, map.height * TILE, 0x081024, 1)
      .setOrigin(0, 0)
      .setAlpha(0)
      .setDepth(100);
    this._lightLayer = buildLightLayer(this, map);
    this._selectionMarker = this.add.graphics().setDepth(9);
    // 喷泉是内置地图广场的固定装饰;生成地图无此物件不绘制
    this._fountain = new FountainFx(map.places.some((p) => p.id === 'park') ? FOUNTAIN_RECT : null);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.width * TILE, map.height * TILE);
    cam.setZoom(ZOOM_DEFAULT);
    this._interactive = this.registry.get('interactive') !== false;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) =>
      handleMapClick(this, pointer, this._views, this._interactive, map),
    );
    if (this._interactive) {
      this._keyboard = new KeyboardController(this, map);
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
        const minZoom = this._minZoom();
        const store = useWorldStore.getState();
        if (store.cameraMode === 'overview' && dy < 0) {
          // 概览态滚轮放大 = 一键回到跟随(由 _updateCamera 跳到默认倍率)
          store.setCameraMode('follow');
          return;
        }
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, minZoom, ZOOM_MAX));
        if (cam.zoom <= minZoom + 0.001) {
          cam.centerOn((map.width * TILE) / 2, (map.height * TILE) / 2);
          if (store.cameraMode !== 'overview') store.setCameraMode('overview');
        } else {
          // 保持指针下的世界坐标不动(围绕指针缩放)
          cam.setScroll(anchor.x - pointer.x / cam.zoom, anchor.y - pointer.y / cam.zoom);
        }
      },
    );
    // /lab 调试钩子: Playwright 走查直接读改相机(定位截图/输入诊断)
    (window as unknown as { __worldScene?: WorldScene }).__worldScene = this;
  }

  override update(time: number, delta: number): void {
    const { snapshot, selectedCharacterId, events, cameraMode } = useWorldStore.getState();
    syncCharacterViews(this, this._views, snapshot?.characters ?? [], snapshot?.clock.gameMinutes ?? 0);
    syncMaintenanceViews(this, this._maintenanceViews, snapshot?.maintenance ?? []);
    syncResourceViews(this, this._resourceViews, snapshot?.resources ?? []);
    this._drainSocialEvents(events);
    this.anims.globalTimeScale = snapshot?.timeScale ?? 1;
    this._updateCamera(selectedCharacterId, cameraMode);
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
    if (this._map !== null) {
      for (const view of this._views.values()) {
        updateCharacterView(this, view, step, now, this._map);
      }
    }
    if (this._selectionMarker !== null) {
      drawSelectionMarker(this._selectionMarker, now, selectedCharacterId, this._views);
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

  /** 相机模式驱动(UI-1): follow=跟随选中角色(切换瞬间跳回默认倍率),overview=缩到下限看全图 */
  private _updateCamera(selectedId: string | null, cameraMode: CameraMode): void {
    if (this._map === null) return;
    const cam = this.cameras.main;
    const minZoom = this._minZoom();
    if (cameraMode === 'overview') {
      cam.stopFollow();
      cam.setZoom(minZoom);
      cam.centerOn((this._map.width * TILE) / 2, (this._map.height * TILE) / 2);
      this._appliedMode = 'overview';
      this._followId = null;
      return;
    }
    if (this._appliedMode !== 'follow') {
      cam.setZoom(Math.max(ZOOM_DEFAULT, minZoom));
      this._appliedMode = 'follow';
    }
    if (selectedId === this._followId) return;
    const view = selectedId !== null ? this._views.get(selectedId) : undefined;
    if (selectedId === null) {
      cam.stopFollow();
      this._followId = null;
    } else if (view !== undefined) {
      cam.startFollow(view.node, true, 0.15, 0.15);
      this._followId = selectedId;
    }
  }

  /** 缩放下限: 视口恰好容下全图(小窗时允许 <1x,保证 overview 始终能看到完整地图) */
  private _minZoom(): number {
    const cam = this.cameras.main;
    if (this._map === null) return ZOOM_MIN;
    const mapWidth = this._map.width * TILE;
    const mapHeight = this._map.height * TILE;
    return Phaser.Math.Clamp(Math.min(cam.width / mapWidth, cam.height / mapHeight), 0.25, ZOOM_MIN);
  }
}
