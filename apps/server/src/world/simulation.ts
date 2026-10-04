import type {
  ActivityFinishedEvent,
  ActivityStartedEvent,
  CharacterArrivedEvent,
  CharacterDiedEvent,
  CharacterRevivedEvent,
  WorldControlEvent,
  WorldEvent,
  WorldSnapshotMessage,
} from '@sims/shared';
import {
  BASIC_ACTIVITY_IDS,
  FURNITURE_LABELS,
  PROPERTY_IDS,
  getActivityDefinition,
  getPropertyDefinition,
  getShopItem,
  inventoryVolume,
  TOWN_MAP,
  type ActivityFinishReason,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { settleActivityMinute } from './activity.js';
import { GameClock } from './clock.js';
import { applyVitalDecay, clampVital, stepMovement, type WorldCharacter } from './character.js';
import { EventBus } from './event-bus.js';
import { TileMap } from './map.js';
import { findPath } from './pathfinding.js';

/**
 * 世界模拟核心:固定 tick(1 tick = 1 游戏分钟),纯逻辑零 I/O。
 * 推进来源有二:实时驱动器(TickDriver,暂停时冻结)与手动推进
 * (调试端点/headless,不受暂停限制)。
 */
export class Simulation {
  readonly clock = new GameClock();
  readonly map: TileMap = TileMap.fromDefinition(TOWN_MAP);
  readonly characters = new Map<string, WorldCharacter>();
  /** 世界事件总线:离散事件与控制变更即时分发,感知/同步层订阅 */
  readonly events = new EventBus<WorldEvent>();
  tick = 0;
  paused = false;
  timeScale: number = BALANCE.DEFAULT_TIME_SCALE;

  advanceTicks(n: number): void {
    for (let i = 0; i < n; i += 1) {
      this.tick += 1;
      this.clock.advance(1);
      this._stepCharacters();
    }
  }

  spawnCharacter(id: string, x: number, y: number, name = id): WorldCharacter {
    if (this.characters.has(id)) {
      throw new Error(`角色已存在: ${id}`);
    }
    if (!this.map.isWalkable(x, y)) {
      throw new Error(`出生点不可行走: (${x},${y})`);
    }
    const character: WorldCharacter = {
      id,
      name,
      x,
      y,
      path: [],
      energy: BALANCE.START_ENERGY,
      happiness: BALANCE.START_HAPPINESS,
      coins: BALANCE.START_COINS,
      activity: null,
      housing: {
        // 出生自动分房(M3.6f): 按已有角色数对 4 栋公寓轮询,预付租金入 BALANCE
        propertyId: PROPERTY_IDS[this.characters.size % PROPERTY_IDS.length]!,
        ownership: 'rent',
        paidThroughDay: this.clock.day + BALANCE.SPAWN_PREPAID_DAYS,
      },
      alive: true,
      backpack: {},
      fridge: {},
    };
    this.characters.set(id, character);
    return character;
  }

  character(id: string): WorldCharacter {
    const character = this.characters.get(id);
    if (!character) {
      throw new Error(`角色不存在: ${id}`);
    }
    return character;
  }

  /**
   * 开始活动:有锚点家具的活动须站在其使用格上(M3.6e 内景化,如书桌/床);
   * 无锚点活动(散步)沿用场所范围判定。已有进行中活动则拒绝(先显式 stop 或移动打断)。
   * M3.6f 体力区段: 体力≤阈值仅允许基础活动;rest 使用住宅床铺须本人租约有效(公园长椅放行)。
   */
  requestStartActivity(characterId: string, activityId: string): WorldCharacter {
    const definition = getActivityDefinition(activityId);
    if (definition === null) {
      throw new Error(`未知活动: ${activityId}`);
    }
    const character = this.character(characterId);
    this._ensureAlive(character);
    if (character.activity !== null) {
      throw new Error(`${character.name} 已在进行活动: ${character.activity.activityId}`);
    }
    if (character.path.length > 0) {
      throw new Error(`${character.name} 移动中,到达后再开始活动`);
    }
    const isBasic = (BASIC_ACTIVITY_IDS as readonly string[]).includes(activityId);
    if (character.energy <= BALANCE.LOW_ENERGY_THRESHOLD && !isBasic) {
      throw new Error(
        `${character.name} 体力过低(${Math.floor(character.energy)}≤${BALANCE.LOW_ENERGY_THRESHOLD}),只能进行基础活动(${BASIC_ACTIVITY_IDS.join('/')})`,
      );
    }
    const anchors = this.map.activityAnchors(activityId);
    let anchorKind: string | null = null;
    if (anchors.length > 0) {
      const anchor = anchors.find(
        (candidate) => character.x === candidate.x && character.y === candidate.y,
      );
      if (anchor === undefined) {
        const spots = anchors.map((item) => `(${item.x},${item.y})`).join('/');
        throw new Error(
          `${definition.name} 须站在${FURNITURE_LABELS[anchors[0]!.kind]}使用格: ${spots}`,
        );
      }
      anchorKind = anchor.kind;
      this._ensureRestAccess(character, anchor.placeId);
    } else if (!definition.placeIds.some((placeId) => this._atPlace(character, placeId))) {
      throw new Error(`${definition.name} 须在场所 ${definition.placeIds.join('、')} 入口或范围内`);
    }
    character.activity = { activityId, elapsed: 0, anchorKind };
    const event: ActivityStartedEvent = {
      type: 'activity.started',
      characterId: character.id,
      activityId,
      tick: this.tick,
    };
    this.events.emit(event);
    return character;
  }

  requestStopActivity(characterId: string): WorldCharacter {
    const character = this.character(characterId);
    this._ensureAlive(character);
    if (character.activity === null) {
      throw new Error(`${character.name} 当前没有进行中的活动`);
    }
    this._finishActivity(character, 'stopped');
    return character;
  }

  /**
   * 购买商品(M3.6g 背包制):须在商店内;买入入随身背包,
   * 体积超限拒绝;经 eat_item 意图随时进食(任意地点)。
   */
  requestBuyItem(characterId: string, itemId: string): WorldCharacter {
    const item = getShopItem(itemId);
    if (item === null) {
      throw new Error(`未知商品: ${itemId}`);
    }
    const character = this.character(characterId);
    this._ensureAlive(character);
    if (!this._atPlace(character, 'shop')) {
      throw new Error(`${character.name} 须在商店内购买(先移动到商店)`);
    }
    const used = inventoryVolume(character.backpack);
    if (used + item.volume > BALANCE.BACKPACK_VOLUME_LIMIT) {
      throw new Error(
        `背包已满(${used}/${BALANCE.BACKPACK_VOLUME_LIMIT}),装不下「${item.name}」(体积 ${item.volume});先吃点或回家存冰箱`,
      );
    }
    if (character.coins < item.price) {
      throw new Error(
        `${character.name} 金币不足: 「${item.name}」需 ${item.price},现有 ${Math.floor(character.coins)}`,
      );
    }
    character.coins -= item.price;
    character.backpack[itemId] = (character.backpack[itemId] ?? 0) + 1;
    return character;
  }

  /** 吃背包食物(M3.6g):任意地点可吃;扣背包并结算一次性效果 */
  requestEatItem(characterId: string, itemId: string): WorldCharacter {
    const item = getShopItem(itemId);
    if (item === null) {
      throw new Error(`未知商品: ${itemId}`);
    }
    const character = this.character(characterId);
    this._ensureAlive(character);
    if ((character.backpack[itemId] ?? 0) <= 0) {
      throw new Error(`${character.name} 背包里没有「${item.name}」(先到商店购买)`);
    }
    character.backpack[itemId] = (character.backpack[itemId] ?? 0) - 1;
    if (character.backpack[itemId]! <= 0) {
      delete character.backpack[itemId];
    }
    character.energy = clampVital(character.energy + item.effects.energy);
    character.happiness = clampVital(character.happiness + item.effects.happiness);
    return character;
  }

  /** 背包→家中冰箱:须在自己住所且租约有效,目标容积足够 */
  requestStoreItem(characterId: string, itemId: string, count: number): WorldCharacter {
    const item = this._ensureTransferItem(itemId);
    const character = this.character(characterId);
    this._ensureAlive(character);
    this._ensureAtOwnHome(character, '存入冰箱');
    if ((character.backpack[itemId] ?? 0) < count) {
      throw new Error(`${character.name} 背包里「${item.name}」不足 ${count} 个`);
    }
    const used = inventoryVolume(character.fridge);
    if (used + item.volume * count > BALANCE.FRIDGE_VOLUME_LIMIT) {
      throw new Error(
        `冰箱已满(${used}/${BALANCE.FRIDGE_VOLUME_LIMIT}),放不下 ${count} 个「${item.name}」(余 ${BALANCE.FRIDGE_VOLUME_LIMIT - used} 体积)`,
      );
    }
    character.backpack[itemId] = character.backpack[itemId]! - count;
    if (character.backpack[itemId]! <= 0) {
      delete character.backpack[itemId];
    }
    character.fridge[itemId] = (character.fridge[itemId] ?? 0) + count;
    return character;
  }

  /** 家中冰箱→背包:须在自己住所且租约有效,背包容积足够 */
  requestTakeItem(characterId: string, itemId: string, count: number): WorldCharacter {
    const item = this._ensureTransferItem(itemId);
    const character = this.character(characterId);
    this._ensureAlive(character);
    this._ensureAtOwnHome(character, '从冰箱取出');
    if ((character.fridge[itemId] ?? 0) < count) {
      throw new Error(`${character.name} 冰箱里「${item.name}」不足 ${count} 个`);
    }
    const used = inventoryVolume(character.backpack);
    if (used + item.volume * count > BALANCE.BACKPACK_VOLUME_LIMIT) {
      throw new Error(
        `背包已满(${used}/${BALANCE.BACKPACK_VOLUME_LIMIT}),装不下 ${count} 个「${item.name}」(余 ${BALANCE.BACKPACK_VOLUME_LIMIT - used} 体积)`,
      );
    }
    character.fridge[itemId] = character.fridge[itemId]! - count;
    if (character.fridge[itemId]! <= 0) {
      delete character.fridge[itemId];
    }
    character.backpack[itemId] = (character.backpack[itemId] ?? 0) + count;
    return character;
  }

  /** 续租: 扣一日期租金,租约顺延一天(已过期则从今日起算) */
  requestRentProperty(characterId: string, propertyId: string): WorldCharacter {
    const property = getPropertyDefinition(propertyId);
    if (property === null) {
      throw new Error(`未知房产: ${propertyId}`);
    }
    const character = this.character(characterId);
    this._ensureAlive(character);
    if (character.housing?.ownership === 'owned') {
      throw new Error(`${character.name} 已拥有 ${property.name},无需续租`);
    }
    if (character.coins < property.rentPrice) {
      throw new Error(
        `${character.name} 金币不足: 租金需 ${property.rentPrice},现有 ${Math.floor(character.coins)}`,
      );
    }
    character.coins -= property.rentPrice;
    character.housing = {
      propertyId: property.id,
      ownership: 'rent',
      paidThroughDay: Math.max(character.housing?.paidThroughDay ?? this.clock.day, this.clock.day) + 1,
    };
    return character;
  }

  /** 买断房产: 一次性扣全款,此后免租金 */
  requestBuyProperty(characterId: string, propertyId: string): WorldCharacter {
    const property = getPropertyDefinition(propertyId);
    if (property === null) {
      throw new Error(`未知房产: ${propertyId}`);
    }
    const character = this.character(characterId);
    this._ensureAlive(character);
    if (character.housing?.ownership === 'owned') {
      throw new Error(`${character.name} 已拥有 ${property.name}`);
    }
    if (character.coins < property.buyPrice) {
      throw new Error(
        `${character.name} 金币不足: ${property.name}售价 ${property.buyPrice},现有 ${Math.floor(character.coins)}`,
      );
    }
    character.coins -= property.buyPrice;
    character.housing = {
      propertyId: property.id,
      ownership: 'owned',
      paidThroughDay: character.housing?.paidThroughDay ?? this.clock.day,
    };
    return character;
  }

  /** 重新规划到目标的路径(意图指令层校验后调用);移动打断进行中活动 */
  requestMoveTo(characterId: string, x: number, y: number): WorldCharacter {
    const character = this.character(characterId);
    this._ensureAlive(character);
    if (!this.map.isWalkable(x, y)) {
      throw new Error(`目标不可行走: (${x},${y})`);
    }
    const path = findPath(this.map, { x: character.x, y: character.y }, { x, y });
    if (path === null) {
      throw new Error(`不可达: (${character.x},${character.y}) → (${x},${y})`);
    }
    if (character.activity !== null) {
      this._finishActivity(character, 'interrupted');
    }
    character.path = path;
    return character;
  }

  /** 停止移动(M3.6g 验收反馈):清空剩余路径下一 tick 起静止;不干预活动、不发到达事件 */
  requestStopMove(characterId: string): WorldCharacter {
    const character = this.character(characterId);
    this._ensureAlive(character);
    character.path = [];
    return character;
  }

  /** 复活(debug 通道):幽灵态解除,恢复满状态 */
  revive(characterId: string): WorldCharacter {
    const character = this.character(characterId);
    if (character.alive) {
      throw new Error(`${character.name} 尚存活,无需复活`);
    }
    character.alive = true;
    character.energy = BALANCE.REVIVE_ENERGY;
    character.happiness = BALANCE.REVIVE_HAPPINESS;
    const event: CharacterRevivedEvent = {
      type: 'character.revived',
      characterId: character.id,
      tick: this.tick,
    };
    this.events.emit(event);
    return character;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this._emitControl();
  }

  setTimeScale(scale: number): void {
    if (!(BALANCE.TIME_SCALES as readonly number[]).includes(scale)) {
      throw new RangeError(`非法时间倍率: ${scale}(可用档位: ${BALANCE.TIME_SCALES.join('/')})`);
    }
    this.timeScale = scale;
    this._emitControl();
  }

  /** 状态快照:调试端点与同步层共用的对外形态(协议面在 @sims/shared) */
  snapshot(): WorldSnapshotMessage {
    const round = (value: number): number => {
      const f = 10 ** BALANCE.SNAPSHOT_DECIMALS;
      return Math.round(value * f) / f;
    };
    return {
      tick: this.tick,
      paused: this.paused,
      timeScale: this.timeScale,
      clock: {
        gameMinutes: this.clock.gameMinutes,
        day: this.clock.day,
        time: this.clock.formatTime(),
        isNight: this.clock.isNight,
      },
      characters: [...this.characters.values()].map((character) => ({
        id: character.id,
        name: character.name,
        x: character.x,
        y: character.y,
        pathRemaining: character.path.length,
        energy: round(character.energy),
        happiness: round(character.happiness),
        coins: character.coins,
        alive: character.alive,
        backpack: { ...character.backpack },
        fridge: { ...character.fridge },
        activity: character.activity
          ? {
              activityId: character.activity.activityId,
              elapsedMinutes: character.activity.elapsed,
              anchorKind: character.activity.anchorKind,
            }
          : null,
        housing: character.housing
          ? {
              propertyId: character.housing.propertyId,
              ownership: character.housing.ownership,
              paidThroughDay: character.housing.paidThroughDay,
            }
          : null,
      })),
    };
  }

  /** 幽灵态拒绝一切意图(M3.6f 死亡机制) */
  private _ensureAlive(character: WorldCharacter): void {
    if (!character.alive) {
      throw new Error(`${character.name} 已死亡(幽灵态),等待复活`);
    }
  }

  /** rest 锚点在住宅时:须为本人住房且租约有效(owned 或未过期);公园等场所放行 */
  private _ensureRestAccess(character: WorldCharacter, anchorPlaceId: string): void {
    if (!(PROPERTY_IDS as readonly string[]).includes(anchorPlaceId)) {
      return;
    }
    const housing = character.housing;
    const placeName = this.map.placeById(anchorPlaceId)?.name ?? anchorPlaceId;
    if (housing === null || housing.propertyId !== anchorPlaceId) {
      throw new Error(`${placeName} 的床不是你的床位(须租住或拥有该公寓)`);
    }
    this._ensureHousingLease(character, '使用床铺');
  }

  /** 租约有效性:自有产权放行;租赁须 paidThroughDay ≥ 今日 */
  private _ensureHousingLease(character: WorldCharacter, action: string): void {
    const housing = character.housing;
    if (housing === null || housing.ownership === 'owned') {
      return;
    }
    if (housing.paidThroughDay < this.clock.day) {
      throw new Error(
        `${character.name} 租约已过期(付至第 ${housing.paidThroughDay} 日,今日第 ${this.clock.day} 日),无法${action}(先续租或买断)`,
      );
    }
  }

  /** 存取冰箱位置校验:须位于本人住房场所内且租约有效 */
  private _ensureAtOwnHome(character: WorldCharacter, action: string): void {
    const housing = character.housing;
    if (housing === null || !this._atPlace(character, housing.propertyId)) {
      const placeName = housing
        ? (this.map.placeById(housing.propertyId)?.name ?? housing.propertyId)
        : '住所';
      throw new Error(`${character.name} 须回到${placeName}才能${action}`);
    }
    this._ensureHousingLease(character, action);
  }

  /** 存取意图商品校验:存在性 + count 为正整数 */
  private _ensureTransferItem(itemId: string) {
    const item = getShopItem(itemId);
    if (item === null) {
      throw new Error(`未知商品: ${itemId}`);
    }
    return item;
  }

  private _emitControl(): void {
    const event: WorldControlEvent = {
      type: 'world.control',
      tick: this.tick,
      paused: this.paused,
      timeScale: this.timeScale,
    };
    this.events.emit(event);
  }

  /** 角色是否位于场所矩形内(内景建筑可入内,矩形即含室内)或其入口格 */
  private _atPlace(character: WorldCharacter, placeId: string): boolean {
    const place = this.map.placeById(placeId);
    if (place === null) {
      return false;
    }
    const inRect =
      character.x >= place.x &&
      character.x < place.x + place.w &&
      character.y >= place.y &&
      character.y < place.y + place.h;
    const atEntrance = character.x === place.entrance.x && character.y === place.entrance.y;
    return inRect || atEntrance;
  }

  private _finishActivity(character: WorldCharacter, reason: ActivityFinishReason): void {
    if (character.activity === null) {
      return;
    }
    const event: ActivityFinishedEvent = {
      type: 'activity.finished',
      characterId: character.id,
      activityId: character.activity.activityId,
      tick: this.tick,
      elapsedMinutes: character.activity.elapsed,
      reason,
    };
    character.activity = null;
    this.events.emit(event);
  }

  private _stepCharacters(): void {
    for (const character of this.characters.values()) {
      // 净速率模型(M3.6g):活动数值已含代谢,仅待机走基础代谢衰减
      if (character.activity === null) {
        applyVitalDecay(character, 1);
      }
      const arrived = stepMovement(character, BALANCE.WALK_SPEED_TILES_PER_MINUTE);
      if (arrived) {
        const event: CharacterArrivedEvent = {
          type: 'character.arrived',
          characterId: character.id,
          tick: this.tick,
          x: character.x,
          y: character.y,
        };
        this.events.emit(event);
      }
      if (character.activity !== null) {
        const definition = getActivityDefinition(character.activity.activityId);
        if (definition !== null) {
          const result = settleActivityMinute(character.activity, character, definition);
          if (result !== 'continue') {
            this._finishActivity(
              character,
              result === 'completed' ? 'completed' : 'insufficient_coins',
            );
          }
        }
      }
      this._checkDeath(character);
    }
  }

  /** 体力耗尽即死亡(M3.6f):转幽灵态,清路径/打断活动,等待 Lab 复活 */
  private _checkDeath(character: WorldCharacter): void {
    if (!character.alive || character.energy > 0) {
      return;
    }
    character.alive = false;
    character.path = [];
    this._finishActivity(character, 'died');
    const event: CharacterDiedEvent = {
      type: 'character.died',
      characterId: character.id,
      tick: this.tick,
    };
    this.events.emit(event);
  }
}
