import Phaser from 'phaser';
import { TOWN_MAP, type PlaceDefinition, type TileMapDefinition } from '@sims/shared';
import { useWorldStore } from '../store/worldStore';
import { CHARACTER, characterVariant, ROOF_FRAME, TILE_FRAME, TILESET } from './assets';

const TILE = 16;
/** 与服务端 BALANCE.WALK_SPEED_TILES_PER_MINUTE 对应的移动契约:每 tick 1 格 */
const TILES_PER_TICK = 1;
/** 目标偏差超过该格数视为瞬移(重连/重生),直接吸附 */
const SNAP_DISTANCE_TILES = 4;

const POND_RECT = { x: 4, y: 30, w: 4, h: 4 };

const inRect = (x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/** 公园内点缀的圆树(格坐标,纯视觉,不参与寻路,避开池塘与门前小路) */
const PARK_TREES: ReadonlyArray<readonly [number, number]> = [
  [5, 27],
  [11, 28],
  [14, 31],
  [6, 34],
  [12, 34],
  [16, 27],
];

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
  /** 是否处于活动中(坐姿指示) */
  inActivity: boolean;
  /** 当前播放的动画 key,null = 从未播放 */
  animKey: string | null;
}

/**
 * 世界渲染场景:Kenney tile 地图 + LPC 穿衣角色(walk/idle/sit 三组四向动画,见 game/assets.ts),
 * 角色向快照位置按 tick 速率插值移动——快照暂停时自然冻结,步频随 timeScale 放大。
 * 数据源轮询 worldStore(避免与 React 渲染耦合),HUD 走 React 侧。
 */
export class WorldScene extends Phaser.Scene {
  private readonly _characters = new Map<string, CharacterRender>();
  private _nightOverlay: Phaser.GameObjects.Rectangle | null = null;

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
  }

  override update(_time: number, delta: number): void {
    const { snapshot } = useWorldStore.getState();
    this._syncCharacterNodes(snapshot?.characters ?? []);
    this.anims.globalTimeScale = snapshot?.timeScale ?? 1;
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
    const step = (delta / 1000) * (snapshot?.timeScale ?? 1) * TILES_PER_TICK;
    for (const render of this._characters.values()) {
      const dx = render.targetX - render.x;
      const dy = render.targetY - render.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= step || distance > SNAP_DISTANCE_TILES) {
        render.x = render.targetX;
        render.y = render.targetY;
        if (render.inActivity) {
          this._playAnim(render, 'sit');
        } else {
          this._playAnim(render, 'idle');
        }
      } else {
        render.x += (dx / distance) * step;
        render.y += (dy / distance) * step;
        this._playWalk(render, dx, dy);
      }
      render.node.setPosition(render.x * TILE + TILE / 2, render.y * TILE + TILE / 2);
    }
  }

  private _drawMap(map: TileMapDefinition): void {
    const border = (x: number, y: number): boolean =>
      x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const rect = map.blockedRects.find((r) => inRect(x, y, r));
        if (rect !== undefined) {
          if (inRect(x, y, POND_RECT)) {
            this._ground(x, y, TILE_FRAME.water);
            continue;
          }
          // 建筑:底行为墙身,其余铺所属场所的屋顶
          const bottom = y === rect.y + rect.h - 1;
          const place = map.places.find((p) => inRect(x, y, p));
          const frame =
            place !== undefined ? ROOF_FRAME[place.id] ?? TILE_FRAME.wall : TILE_FRAME.wall;
          this._ground(x, y, bottom ? TILE_FRAME.wall : frame);
          continue;
        }
        this._ground(x, y, TILE_FRAME.grass);
        if (map.paths.some((r) => inRect(x, y, r))) {
          this._ground(x, y, TILE_FRAME.path);
          continue;
        }
        if (border(x, y)) this._prop(x, y, TILE_FRAME.pine);
      }
    }

    for (const place of map.places) {
      if (place.id === 'park') {
        this._fillPlace(map, place, TILE_FRAME.parkGrass);
        for (const [tx, ty] of PARK_TREES) this._prop(tx, ty, TILE_FRAME.tree);
      } else {
        this._ground(place.entrance.x, place.entrance.y, TILE_FRAME.path);
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
  }

  private _ground(x: number, y: number, frame: number): void {
    this.add.image(x * TILE, y * TILE, TILESET.key, frame).setOrigin(0, 0);
  }

  private _prop(x: number, y: number, frame: number): void {
    this.add.image(x * TILE, y * TILE, TILESET.key, frame).setOrigin(0, 0).setDepth(5);
  }

  /** 可行走场所整块铺装;障碍格(如公园内的池塘)跳过,保留主循环已画的水面 */
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
      activity: { activityId: string } | null;
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
          animKey: null,
        };
        this._characters.set(character.id, render);
        render.node.setPosition(render.x * TILE + TILE / 2, render.y * TILE + TILE / 2);
      }
      render.targetX = character.x;
      render.targetY = character.y;
      render.inActivity = character.activity !== null;
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
