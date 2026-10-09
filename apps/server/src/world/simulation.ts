import type {
  ActivityDefinition,
  CharacterArrivedEvent,
  MaintenanceSpot,
  ResourceNode,
  TraitVector,
  WorldControlEvent,
  WorldEvent,
  GameType,
  WorldParamsEvent,
  WorldResetEvent,
  WorldRules,
  WorldRulesEvent,
  WorldSnapshotMessage,
} from '@sims/shared';
import {
  DEFAULT_WORLD_RULES,
  PROPERTY_IDS,
  TOWN_MAP,
  cloneRecipes,
  defaultRecipes,
  getActivityDefinition,
  type CraftRecipeId,
  type RecipeDef,
  type TileMapDefinition,
} from '@sims/shared';
import {
  applyBalanceOverrides,
  applyWorldParams,
  BALANCE,
  currentWorldParams,
} from '../config/balance.js';
import {
  finishActivity,
  settleActivityMinute,
  startActivity,
  stopActivity,
} from './activity.js';
import { GameClock } from './clock.js';
import {
  applyHealthTick,
  applyVitalDecay,
  reviveCharacter,
  stepMovement,
  type WorldCharacter,
} from './character.js';
import { EventBus } from './event-bus.js';
import { requestCraft } from './craft.js';
import { buyProperty, rentProperty } from './housing.js';
import { buyItem, eatItem, sellItem, storeItem, takeItem } from './inventory.js';
import { stepMaintenance, type RandomFn } from './maintenance.js';
import { TileMap } from './map.js';
import { findPath } from './pathfinding.js';
import { debtFactor, inSleepWindow, settleSleep } from './settlement.js';
import { requestWorkTask } from './work-task.js';
import { worldSnapshot } from './snapshot.js';
import {
  applySocialDailyRollover,
  chat,
  randomTraits,
  type SocialRelation,
} from './social.js';
import { checkCollapse, checkDeath, checkReviveWindow } from './death.js';
import {
  completeCraft,
  initShopStock,
  rebuildResourceNodes,
  respawnResourceNodes,
  restockShopDaily,
  stepWorkTask,
} from './work-dispatch.js';

/**
 * 世界存档载荷(C6):serialize() 产出、restoreArchive() 消费。
 * 全部为 JSON-safe 纯数据(EventBus 与 TileMap 不入档:前者是订阅关系,
 * 后者由 active 世界 config.map 重建);Map 以 entries 数组存档保 key。
 */
export interface SimulationArchive {
  tick: number;
  paused: boolean;
  timeScale: number;
  gameType: GameType;
  rules: WorldRules;
  recipes: Record<CraftRecipeId, RecipeDef>;
  /** 全局热调参数现场(BALANCE 进程态):load 时复位出厂后整体灌回 */
  params: Record<string, number>;
  clockGameMinutes: number;
  characters: WorldCharacter[];
  socials: Array<[string, SocialRelation]>;
  maintenanceSpots: Array<[string, MaintenanceSpot]>;
  resourceNodes: Array<[string, ResourceNode]>;
  shopStock: Array<[string, number]>;
}

/**
 * 世界模拟核心:固定 tick(1 tick = 1 游戏分钟),纯逻辑零 I/O。
 * 推进来源有二:实时驱动器(TickDriver,暂停时冻结)与手动推进
 * (调试端点/headless,不受暂停限制)。
 * 请求类 API 按域委托(activity/inventory/housing 模块,M3.6h 拆分),
 * 死亡闸门与工单/资源结算委托 death/work-dispatch 模块,
 * 本类保留 tick 循环、出生、移动与控制面。
 */
export class Simulation {
  readonly clock = new GameClock();
  private _map: TileMap = TileMap.fromDefinition(TOWN_MAP);
  readonly characters = new Map<string, WorldCharacter>();
  /** 有向关系表(社交 v1):key = `fromId|toId`,A→B 与 B→A 各一条 */
  readonly socials = new Map<string, SocialRelation>();
  /** 世界维护点(M-G.5 损耗系统):key = `kind:x:y`,reset 清空 */
  readonly maintenanceSpots = new Map<string, MaintenanceSpot>();
  /** 资源节点(M-G.6 生产系统):key = 节点 id `kind:x:y`,reset 从地图种子重建(存量回满) */
  readonly resourceNodes = new Map<string, ResourceNode>();
  /** 商店货架余量(食物经济 2026-10-07):key = 货架 itemId;售罄即止不补货,
   * 构造/reset 按 SHOP_INITIAL_FOOD_STOCK 重置(与 resourceNodes 恢复语义同构) */
  readonly shopStock = new Map<string, number>();
  /** 世界事件总线:离散事件与控制变更即时分发,感知/同步层订阅 */
  readonly events = new EventBus<WorldEvent>();
  tick = 0;
  paused = false;
  timeScale: number = BALANCE.DEFAULT_TIME_SCALE;
  /** 世界规则(M5):默认全开;后台创建世界时随配置覆写,reset 回默认 */
  rules: WorldRules = { ...DEFAULT_WORLD_RULES };
  /** 每世界配方(2026-10-07 配置化):建世界/恢复时灌入 config.rules.recipes 深拷贝,
   * admin 配方页运行时改写 live 生效(不追溯在制单,退料/产出凭 activity 快照);
   * reset 回出厂默认。craft/活动门槛/时长/场所/产出全部读本表 */
  recipes: Record<CraftRecipeId, RecipeDef> = defaultRecipes();
  /** 游戏模式(M-S/S1):survival 启用生存健康数值;创建/恢复世界时注入,reset 回 growth */
  gameType: GameType = 'growth';
  /** 随机源(损耗生成器 roll;默认 Math.random,测试注入确定性实现) */
  readonly rng: RandomFn;

  constructor(rng: RandomFn = Math.random) {
    this.rng = rng;
    this._rebuildResourceNodes();
    this._initShopStock();
  }

  /** 世界地图(M-L.5:创建世界时注入生成地图;缺省内置固定地图) */
  get map(): TileMap {
    return this._map;
  }

  setMap(definition: TileMapDefinition): void {
    this._map = TileMap.fromDefinition(definition);
    this._rebuildResourceNodes();
  }

  advanceTicks(n: number): void {
    for (let i = 0; i < n; i += 1) {
      this.tick += 1;
      this.clock.advance(1);
      this._stepCharacters();
      stepMaintenance(this, this.rng);
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
    this.maintenanceSpots.clear();
    this._rebuildResourceNodes();
    this._initShopStock();
    this.tick = 0;
    this.clock.reset();
    this.paused = false;
    this.timeScale = BALANCE.DEFAULT_TIME_SCALE;
    this.rules = { ...DEFAULT_WORLD_RULES };
    this.recipes = defaultRecipes();
    this.gameType = 'growth';
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
      health: BALANCE.VITAL_MAX,
      coins: BALANCE.START_COINS,
      activity: null,
      housing: {
        // 出生自动分房(M3.6f): 按已有角色数对 4 栋公寓轮询,预付租金入 BALANCE
        propertyId: PROPERTY_IDS[this.characters.size % PROPERTY_IDS.length]!,
        ownership: 'rent',
        paidThroughDay: this.clock.day + BALANCE.SPAWN_PREPAID_DAYS,
      },
      alive: true,
      collapsed: false,
      diedAtGameMinutes: null,
      backpack: {},
      fridge: {},
      score: 0,
      knowledge: 0,
      sleepWindowMinutes: 0,
      sleepDebtEndGameMinutes: null,
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

  requestSellItem(characterId: string, itemId: string, count: number): WorldCharacter {
    return sellItem(this, characterId, itemId, count);
  }

  requestRentProperty(characterId: string, propertyId: string): WorldCharacter {
    return rentProperty(this, characterId, propertyId);
  }

  requestBuyProperty(characterId: string, propertyId: string): WorldCharacter {
    return buyProperty(this, characterId, propertyId);
  }

  /** 闲聊(社交 v1):返回本句话内容(回执/气泡显示);line 缺省走模板池;
   * reply(C4 对话)=听者台词,与 line 合并双句进事件 content */
  requestChat(characterId: string, targetId: string, line?: string, reply?: string): string {
    return chat(this, characterId, targetId, line, reply);
  }

  /** 维护工单(M-G.5):接单寻路,到位后由 _stepWorkTask 计时结算 */
  requestWorkTask(characterId: string, targetId: string): WorldCharacter {
    return requestWorkTask(this, characterId, targetId);
  }

  /** 配方制作(M-G.6):验料扣料并开始站点作业,完成产出/中断退料由结算分流 */
  requestCraft(characterId: string, recipeId: string): WorldCharacter {
    return requestCraft(this, characterId, recipeId);
  }

  /** 重新规划到目标的路径(意图指令层校验后调用);移动打断进行中活动 */
  requestMoveTo(characterId: string, x: number, y: number): WorldCharacter {
    const character = this.character(characterId);
    if (!character.alive) {
      throw new Error(`${character.name} 已死亡(幽灵态),等待复活`);
    }
    if (character.collapsed) {
      throw new Error(`${character.name} 已虚脱倒地,无法移动(先休息或喂食恢复)`);
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

  /** 复活(debug 通道,经 /debug/revive 暴露):视同救治(M-G.5),免扣繁荣分满状态回归 */
  debugRevive(characterId: string): WorldCharacter {
    const character = this.character(characterId);
    if (character.alive) {
      throw new Error(`${character.name} 尚存活,无需复活`);
    }
    reviveCharacter(this, character, 'debug');
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

  /**
   * 世界参数热调(Lab 调试台/游戏内设置菜单):应用覆盖后广播生效值全集,
   * 落档由订阅侧回写世界记录;reset 时先复位出厂默认再应用(难度预设切换,
   * 清除上一档残留)。
   */
  setParams(updates: Record<string, number>, opts?: { reset?: boolean }): void {
    if (opts?.reset === true) {
      applyWorldParams(updates);
    } else {
      applyBalanceOverrides(updates);
    }
    const event: WorldParamsEvent = {
      type: 'world.params',
      tick: this.tick,
      params: currentWorldParams(),
    };
    this.events.emit(event);
  }

  /** 世界规则运行时变更(游戏内设置菜单):合并后广播三字段全集,initialTimeScale 运行中不改 */
  setRules(updates: { allowDeath?: boolean; allowChat?: boolean }): void {
    if (updates.allowDeath !== undefined) this.rules.allowDeath = updates.allowDeath;
    if (updates.allowChat !== undefined) this.rules.allowChat = updates.allowChat;
    const event: WorldRulesEvent = {
      type: 'world.rules',
      tick: this.tick,
      rules: {
        allowDeath: this.rules.allowDeath,
        allowChat: this.rules.allowChat,
        initialTimeScale: this.rules.initialTimeScale,
      },
    };
    this.events.emit(event);
  }

  /** 每世界配方查询(id 封闭联合;未知 id 返回 null,craft/活动门槛共用) */
  recipe(id: string): RecipeDef | null {
    return (this.recipes as Record<string, RecipeDef>)[id] ?? null;
  }

  /** 配方全集替换(建世界/恢复灌入深拷贝,与存档对象隔离;admin 编辑走本入口) */
  setRecipes(recipes: Record<CraftRecipeId, RecipeDef>): void {
    this.recipes = cloneRecipes(recipes);
  }

  /**
   * 配方运行时热改(admin 配方页):应用全集后广播 world.recipes 事件
   * (经离散事件流转发多端,param-persist 回写活跃世界存档);
   * 合法性由调用方 validateRecipes 先行,在制单不追溯(凭挂单快照结算)。
   */
  updateRecipes(recipes: Record<CraftRecipeId, RecipeDef>): void {
    this.setRecipes(recipes);
    this.events.emit({
      type: 'world.recipes',
      tick: this.tick,
      recipes: cloneRecipes(recipes),
    });
  }

  /** 状态快照:调试端点与同步层共用的对外形态(序列化在 snapshot.ts) */
  snapshot(): WorldSnapshotMessage {
    return worldSnapshot(this);
  }

  /**
   * 世界现场序列化(C6 存档):五个状态 Map+控制面+时钟全量导出,
   * 深拷贝隔离(后续 tick 不影响已存档载荷)。
   */
  serialize(): SimulationArchive {
    return {
      tick: this.tick,
      paused: this.paused,
      timeScale: this.timeScale,
      gameType: this.gameType,
      rules: JSON.parse(JSON.stringify(this.rules)) as WorldRules,
      recipes: cloneRecipes(this.recipes),
      params: currentWorldParams(),
      clockGameMinutes: this.clock.gameMinutes,
      characters: JSON.parse(JSON.stringify([...this.characters.values()])) as WorldCharacter[],
      socials: JSON.parse(JSON.stringify([...this.socials.entries()])) as Array<
        [string, SocialRelation]
      >,
      maintenanceSpots: JSON.parse(JSON.stringify([...this.maintenanceSpots.entries()])) as Array<
        [string, MaintenanceSpot]
      >,
      resourceNodes: JSON.parse(JSON.stringify([...this.resourceNodes.entries()])) as Array<
        [string, ResourceNode]
      >,
      shopStock: [...this.shopStock.entries()],
    };
  }

  /**
   * 世界现场恢复(C6 读档):调用方先 reset()+setMap(config.map)(覆盖触发的
   * 资源/货架重建),再灌本档全部状态;控制面变更经 world.control 事件广播收敛,
   * 每 tick 全量快照自动同步客户端。地图不入档——由 active 世界 config.map 重建。
   */
  restoreArchive(archive: SimulationArchive): void {
    this.characters.clear();
    this.socials.clear();
    this.maintenanceSpots.clear();
    this.resourceNodes.clear();
    this.shopStock.clear();
    this.tick = archive.tick;
    this.clock.restore(archive.clockGameMinutes);
    this.paused = archive.paused;
    this.timeScale = archive.timeScale;
    this.gameType = archive.gameType;
    this.rules = JSON.parse(JSON.stringify(archive.rules)) as WorldRules;
    this.setRecipes(archive.recipes);
    // 参数现场灌回(先复位出厂清残留,再整体应用存档值)
    applyWorldParams(archive.params);
    for (const [key, value] of archive.socials) {
      this.socials.set(key, JSON.parse(JSON.stringify(value)) as SocialRelation);
    }
    for (const [key, value] of archive.maintenanceSpots) {
      this.maintenanceSpots.set(key, JSON.parse(JSON.stringify(value)) as MaintenanceSpot);
    }
    for (const [key, value] of archive.resourceNodes) {
      this.resourceNodes.set(key, JSON.parse(JSON.stringify(value)) as ResourceNode);
    }
    for (const [key, value] of archive.shopStock) {
      this.shopStock.set(key, value);
    }
    for (const character of archive.characters) {
      this.characters.set(character.id, JSON.parse(JSON.stringify(character)) as WorldCharacter);
    }
    this._emitControl();
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
    // 世界日翻转(00:00)社交结算+资源重生:熟悉度衰减/聊天防刷计数跨日自然重置,
    // 枯竭浆果丛回满(design/09 §2)
    if (this.clock.minuteOfDay === 0) {
      applySocialDailyRollover(this);
      this._respawnResourceNodes();
      this._restockShopDaily();
    }
    // 睡眠结算(M-G.2):夜窗口(22:00~06:00)结束于 06:00——窗口跨 00:00,
    // 结算挂 NIGHT_END 而非日翻转;缺觉挂惩罚,账本无论是否缺觉均清零
    if (this.clock.minuteOfDay === BALANCE.NIGHT_END_MINUTE) {
      settleSleep(this);
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
          if (character.activity.targetId !== null) {
            // 维护工单(M-G.5):在途不结算;到位每分钟先验目标有效再计时
            this._stepWorkTask(character, definition);
          } else {
            const craftRecipe =
              character.activity.craftRecipeId !== undefined
                ? this.recipe(character.activity.craftRecipeId)
                : null;
            const result = settleActivityMinute(
              character.activity,
              character,
              definition,
              debtFactor(character, this.clock.gameMinutes),
              craftRecipe?.durationMinutes,
            );
            // 睡眠账本(M-G.2):仅窗口内的入睡分钟累计;06:00 后续睡不进新账本
            if (character.activity.activityId === 'sleep' && inSleepWindow(this.clock)) {
              character.sleepWindowMinutes += 1;
            }
            if (result !== 'continue') {
              // 知识(M-G.4): 完成一次完整学习 +1,中断不计(goal-design §4.2)
              if (result === 'completed' && definition.id === 'study') {
                character.knowledge += 1;
              }
              if (result === 'completed') {
                this._completeCraft(character);
              }
              finishActivity(
                this,
                character,
                result === 'completed' ? 'completed' : 'insufficient_coins',
              );
            }
          }
        }
      }
      // 生存健康(M-S/S1):仅 survival 有压力源;置于死亡判定前,健康归零当分钟入重伤
      if (this.gameType === 'survival') {
        applyHealthTick(character);
      }
      this._checkDeath(character);
      this._checkCollapse(character);
      this._checkReviveWindow(character);
    }
  }

  private _stepWorkTask(character: WorldCharacter, definition: ActivityDefinition): void {
    stepWorkTask(this, character, definition);
  }

  private _completeCraft(character: WorldCharacter): void {
    completeCraft(this, character);
  }

  private _rebuildResourceNodes(): void {
    rebuildResourceNodes(this);
  }

  private _initShopStock(): void {
    initShopStock(this);
  }

  private _respawnResourceNodes(): void {
    respawnResourceNodes(this);
  }

  private _restockShopDaily(): void {
    restockShopDaily(this);
  }

  private _checkDeath(character: WorldCharacter): void {
    checkDeath(this, character);
  }

  private _checkCollapse(character: WorldCharacter): void {
    checkCollapse(this, character);
  }

  private _checkReviveWindow(character: WorldCharacter): void {
    checkReviveWindow(this, character);
  }
}
