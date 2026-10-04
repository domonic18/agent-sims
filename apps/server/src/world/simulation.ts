import type {
  ActivityFinishedEvent,
  ActivityStartedEvent,
  CharacterArrivedEvent,
  WorldControlEvent,
  WorldEvent,
  WorldSnapshotMessage,
} from '@sims/shared';
import {
  getActivityDefinition,
  getPropertyDefinition,
  getShopItem,
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
      coins: 0,
      activity: null,
      items: [],
      housing: {
        propertyId: 'home', // 初始租房: 公寓,预付当日+次日租
        ownership: 'rent',
        paidThroughDay: this.clock.day + 1,
        placedItems: [],
      },
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
   * 开始活动:须在活动场所的入口格或矩形内;已有进行中活动则拒绝
   * (先显式 stop 或移动打断)。
   */
  requestStartActivity(characterId: string, activityId: string): WorldCharacter {
    const definition = getActivityDefinition(activityId);
    if (definition === null) {
      throw new Error(`未知活动: ${activityId}`);
    }
    const character = this.character(characterId);
    if (character.activity !== null) {
      throw new Error(`${character.name} 已在进行活动: ${character.activity.activityId}`);
    }
    if (character.path.length > 0) {
      throw new Error(`${character.name} 移动中,到达后再开始活动`);
    }
    if (!definition.placeIds.some((placeId) => this._atPlace(character, placeId))) {
      throw new Error(`${definition.name} 须在场所 ${definition.placeIds.join('、')} 入口或范围内`);
    }
    character.activity = { activityId, elapsed: 0 };
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
    if (character.activity === null) {
      throw new Error(`${character.name} 当前没有进行中的活动`);
    }
    this._finishActivity(character, 'stopped');
    return character;
  }

  /**
   * 购买商品:结算前判定余额(不透支);food 即买即结算一次性效果,
   * furniture 入库存待摆放(M3.3)。
   */
  requestBuyItem(characterId: string, itemId: string): WorldCharacter {
    const item = getShopItem(itemId);
    if (item === null) {
      throw new Error(`未知商品: ${itemId}`);
    }
    const character = this.character(characterId);
    if (character.coins < item.price) {
      throw new Error(
        `${character.name} 金币不足: 「${item.name}」需 ${item.price},现有 ${Math.floor(character.coins)}`,
      );
    }
    character.coins -= item.price;
    if (item.category === 'food') {
      character.energy = clampVital(character.energy + item.effects.energy);
      character.happiness = clampVital(character.happiness + item.effects.happiness);
    } else {
      character.items.push(item.id);
    }
    return character;
  }

  /** 续租: 扣一日期租金,租约顺延一天(已过期则从今日起算) */
  requestRentProperty(characterId: string, propertyId: string): WorldCharacter {
    const property = getPropertyDefinition(propertyId);
    if (property === null) {
      throw new Error(`未知房产: ${propertyId}`);
    }
    const character = this.character(characterId);
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
      placedItems: character.housing?.placedItems ?? [],
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
      placedItems: character.housing?.placedItems ?? [],
    };
    return character;
  }

  /** 摆放家具: 从库存移入住宅;须持有有效住宿(自有或租约未到期) */
  requestPlaceFurniture(characterId: string, itemId: string): WorldCharacter {
    const item = getShopItem(itemId);
    if (item === null) {
      throw new Error(`未知商品: ${itemId}`);
    }
    if (item.category !== 'furniture') {
      throw new Error(`「${item.name}」是食物,购买时即已食用`);
    }
    const character = this.character(characterId);
    const housing = character.housing;
    if (housing === null) {
      throw new Error(`${character.name} 无住宿,无法摆放家具`);
    }
    if (housing.ownership === 'rent' && housing.paidThroughDay < this.clock.day) {
      throw new Error(`${character.name} 租约已过期(付至第 ${housing.paidThroughDay} 日),请先续租`);
    }
    const index = character.items.indexOf(itemId);
    if (index === -1) {
      throw new Error(`${character.name} 库存中没有「${item.name}」`);
    }
    character.items.splice(index, 1);
    housing.placedItems.push(itemId);
    return character;
  }

  /** 重新规划到目标的路径(意图指令层校验后调用);移动打断进行中活动 */
  requestMoveTo(characterId: string, x: number, y: number): WorldCharacter {
    const character = this.character(characterId);
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
        energy: Math.round(character.energy * 10) / 10,
        happiness: Math.round(character.happiness * 10) / 10,
        coins: character.coins,
        activity: character.activity
          ? { activityId: character.activity.activityId, elapsedMinutes: character.activity.elapsed }
          : null,
        items: [...character.items],
        housing: character.housing
          ? {
              propertyId: character.housing.propertyId,
              ownership: character.housing.ownership,
              paidThroughDay: character.housing.paidThroughDay,
              placedItems: [...character.housing.placedItems],
            }
          : null,
      })),
    };
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

  /** 角色是否位于场所矩形内或其入口格(建筑为障碍,入口格即"门口") */
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
      applyVitalDecay(character, 1);
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
      this._applyFurnitureBonus(character);
    }
  }

  /** 已摆放家具每游戏分钟被动加成;住宿失效(欠租)即停发 */
  private _applyFurnitureBonus(character: WorldCharacter): void {
    const housing = character.housing;
    if (housing === null || housing.placedItems.length === 0) {
      return;
    }
    if (housing.ownership === 'rent' && housing.paidThroughDay < this.clock.day) {
      return;
    }
    let energy = 0;
    let happiness = 0;
    for (const itemId of housing.placedItems) {
      const item = getShopItem(itemId);
      if (item !== null && item.category === 'furniture') {
        energy += item.bonus.energy;
        happiness += item.bonus.happiness;
      }
    }
    if (energy !== 0) {
      character.energy = clampVital(character.energy + energy);
    }
    if (happiness !== 0) {
      character.happiness = clampVital(character.happiness + happiness);
    }
  }
}
