import type {
  CharacterArrivedEvent,
  CharacterDiedEvent,
  CharacterRevivedEvent,
  TraitVector,
  WorldControlEvent,
  WorldEvent,
  WorldParamsEvent,
  WorldResetEvent,
  WorldRules,
  WorldSnapshotMessage,
} from '@sims/shared';
import { DEFAULT_WORLD_RULES, PROPERTY_IDS, TOWN_MAP, getActivityDefinition, type TileMapDefinition } from '@sims/shared';
import { applyBalanceOverrides, BALANCE, currentWorldParams } from '../config/balance.js';
import {
  finishActivity,
  settleActivityMinute,
  startActivity,
  stopActivity,
} from './activity.js';
import { GameClock } from './clock.js';
import { applyLifeScoreTick, applyVitalDecay, stepMovement, type WorldCharacter } from './character.js';
import { EventBus } from './event-bus.js';
import { buyProperty, rentProperty } from './housing.js';
import { buyItem, eatItem, storeItem, takeItem } from './inventory.js';
import { TileMap } from './map.js';
import { findPath } from './pathfinding.js';
import { worldSnapshot } from './snapshot.js';
import {
  applySocialDailyRollover,
  applySocialPresenceBonus,
  chat,
  randomTraits,
  type SocialRelation,
} from './social.js';

/**
 * 世界模拟核心:固定 tick(1 tick = 1 游戏分钟),纯逻辑零 I/O。
 * 推进来源有二:实时驱动器(TickDriver,暂停时冻结)与手动推进
 * (调试端点/headless,不受暂停限制)。
 * 请求类 API 按域委托(activity/inventory/housing 模块,M3.6h 拆分),
 * 本类保留 tick 循环、出生、移动与控制面。
 */
export class Simulation {
  readonly clock = new GameClock();
  private _map: TileMap = TileMap.fromDefinition(TOWN_MAP);
  readonly characters = new Map<string, WorldCharacter>();
  /** 有向关系表(社交 v1):key = `fromId|toId`,A→B 与 B→A 各一条 */
  readonly socials = new Map<string, SocialRelation>();
  /** 世界事件总线:离散事件与控制变更即时分发,感知/同步层订阅 */
  readonly events = new EventBus<WorldEvent>();
  tick = 0;
  paused = false;
  timeScale: number = BALANCE.DEFAULT_TIME_SCALE;
  /** 世界规则(M5):默认全开;后台创建世界时随配置覆写,reset 回默认 */
  rules: WorldRules = { ...DEFAULT_WORLD_RULES };

  /** 世界地图(M-L.5:创建世界时注入生成地图;缺省内置固定地图) */
  get map(): TileMap {
    return this._map;
  }

  setMap(definition: TileMapDefinition): void {
    this._map = TileMap.fromDefinition(definition);
  }

  advanceTicks(n: number): void {
    for (let i = 0; i < n; i += 1) {
      this.tick += 1;
      this.clock.advance(1);
      this._stepCharacters();
    }
  }

  /**
   * 世界重置(M3.6k 后台创建世界时调用):清空全部角色、时钟与控制面回到
   * 初始;保留实例与事件总线订阅(socket 网关/驱动器持本实例引用,不可替换),
   * 快照流经 world.reset 事件与后续全量快照自动收敛。
   */
  reset(): void {
    this.characters.clear();
    this.socials.clear();
    this.tick = 0;
    this.clock.reset();
    this.paused = false;
    this.timeScale = BALANCE.DEFAULT_TIME_SCALE;
    this.rules = { ...DEFAULT_WORLD_RULES };
    const event: WorldResetEvent = { type: 'world.reset', tick: this.tick };
    this.events.emit(event);
    this._emitControl();
  }

  spawnCharacter(
    id: string,
    x: number,
    y: number,
    name = id,
    traits?: Partial<TraitVector>,
  ): WorldCharacter {
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
      lifeScore: 0,
      traits: { ...randomTraits(), ...traits },
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

  requestStartActivity(characterId: string, activityId: string): WorldCharacter {
    return startActivity(this, characterId, activityId);
  }

  requestStopActivity(characterId: string): WorldCharacter {
    return stopActivity(this, characterId);
  }

  requestBuyItem(characterId: string, itemId: string): WorldCharacter {
    return buyItem(this, characterId, itemId);
  }

  requestEatItem(characterId: string, itemId: string): WorldCharacter {
    return eatItem(this, characterId, itemId);
  }

  requestStoreItem(characterId: string, itemId: string, count: number): WorldCharacter {
    return storeItem(this, characterId, itemId, count);
  }

  requestTakeItem(characterId: string, itemId: string, count: number): WorldCharacter {
    return takeItem(this, characterId, itemId, count);
  }

  requestRentProperty(characterId: string, propertyId: string): WorldCharacter {
    return rentProperty(this, characterId, propertyId);
  }

  requestBuyProperty(characterId: string, propertyId: string): WorldCharacter {
    return buyProperty(this, characterId, propertyId);
  }

  /** 闲聊(社交 v1):返回本句话内容(回执/气泡显示) */
  requestChat(characterId: string, targetId: string): string {
    return chat(this, characterId, targetId);
  }

  /** 重新规划到目标的路径(意图指令层校验后调用);移动打断进行中活动 */
  requestMoveTo(characterId: string, x: number, y: number): WorldCharacter {
    const character = this.character(characterId);
    if (!character.alive) {
      throw new Error(`${character.name} 已死亡(幽灵态),等待复活`);
    }
    if (!this.map.isWalkable(x, y)) {
      throw new Error(`目标不可行走: (${x},${y})`);
    }
    const path = findPath(this.map, { x: character.x, y: character.y }, { x, y });
    if (path === null) {
      throw new Error(`不可达: (${character.x},${character.y}) → (${x},${y})`);
    }
    if (character.activity !== null) {
      finishActivity(this, character, 'interrupted');
    }
    character.path = path;
    return character;
  }

  /** 停止移动(M3.6g 验收反馈):清空剩余路径下一 tick 起静止;不干预活动、不发到达事件 */
  requestStopMove(characterId: string): WorldCharacter {
    const character = this.character(characterId);
    if (!character.alive) {
      throw new Error(`${character.name} 已死亡(幽灵态),等待复活`);
    }
    character.path = [];
    return character;
  }

  /** 复活(debug 通道,经 /debug/revive 暴露):幽灵态解除,恢复满状态 */
  debugRevive(characterId: string): WorldCharacter {
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

  /** 世界参数热调(Lab 调试台):应用覆盖后广播生效值全集,落档由订阅侧回写世界记录 */
  setParams(updates: Record<string, number>): void {
    applyBalanceOverrides(updates);
    const event: WorldParamsEvent = {
      type: 'world.params',
      tick: this.tick,
      params: currentWorldParams(),
    };
    this.events.emit(event);
  }

  /** 状态快照:调试端点与同步层共用的对外形态(序列化在 snapshot.ts) */
  snapshot(): WorldSnapshotMessage {
    return worldSnapshot(this);
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

  private _stepCharacters(): void {
    // 世界日翻转(00:00)社交结算:熟悉度衰减+聊天防刷计数跨日自然重置
    if (this.clock.minuteOfDay === 0) {
      applySocialDailyRollover(this);
    }
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
            finishActivity(
              this,
              character,
              result === 'completed' ? 'completed' : 'insufficient_coins',
            );
          }
        }
      }
      // 繁荣分质量流(M3.6j): 本分钟数值结算完毕后按当前幸福累计,死亡当分钟也计入
      applyLifeScoreTick(character);
      // 同场增益(社交 v1): 活动角色按附近活动人数得幸福修正
      applySocialPresenceBonus(this, character);
      this._checkDeath(character);
    }
  }

  /** 体力耗尽即死亡(M3.6f):转幽灵态,清路径/打断活动,等待 Lab 复活 */
  private _checkDeath(character: WorldCharacter): void {
    // 世界规则关闭死亡(M5):体力卡 0 持续躺平,不转幽灵不扣繁荣分
    if (!this.rules.allowDeath) {
      return;
    }
    if (!character.alive || character.energy > 0) {
      return;
    }
    character.alive = false;
    character.path = [];
    // 繁荣分死亡扣减(M3.6j 方案B): 比例扣无套利——活得越厚实,死亡的绝对损失越大
    character.lifeScore *= 1 - BALANCE.LIFE_SCORE_DEATH_DEDUCTION;
    finishActivity(this, character, 'died');
    const event: CharacterDiedEvent = {
      type: 'character.died',
      characterId: character.id,
      tick: this.tick,
    };
    this.events.emit(event);
  }
}
