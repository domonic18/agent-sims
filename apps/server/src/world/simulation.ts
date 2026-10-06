import type {
  ActivityDefinition,
  CharacterArrivedEvent,
  CharacterAutoRevivedEvent,
  CharacterDiedEvent,
  CharacterRevivedEvent,
  CraftCompletedEvent,
  GatherTaskId,
  MaintenanceSpot,
  ResourceNode,
  SleepDebtAppliedEvent,
  TraitVector,
  WorkTaskCancelledEvent,
  WorkTaskCompletedEvent,
  WorkTaskId,
  WorldControlEvent,
  WorldEvent,
  WorldParamsEvent,
  WorldResetEvent,
  WorldRules,
  WorldRulesEvent,
  WorldSnapshotMessage,
} from '@sims/shared';
import {
  BUSH_MAX_CHARGES,
  DEFAULT_WORLD_RULES,
  GATHER_TASKS,
  MAINTENANCE_TASKS,
  PROPERTY_IDS,
  RECIPES,
  REVIVE_WINDOW_MINUTES,
  TOWN_MAP,
  getActivityDefinition,
  type TileMapDefinition,
} from '@sims/shared';
import { applyBalanceOverrides, applyWorldParams, BALANCE, currentWorldParams } from '../config/balance.js';
import {
  finishActivity,
  settleActivityMinute,
  startActivity,
  stopActivity,
} from './activity.js';
import { GameClock } from './clock.js';
import {
  applyLifeScoreTick,
  applyVitalDecay,
  stepMovement,
  type WorldCharacter,
} from './character.js';
import { EventBus } from './event-bus.js';
import { requestCraft } from './craft.js';
import { buyProperty, rentProperty } from './housing.js';
import { buyItem, eatItem, storeItem, takeItem } from './inventory.js';
import { stepMaintenance, type RandomFn } from './maintenance.js';
import { TileMap } from './map.js';
import { findPath } from './pathfinding.js';
import { isGatherTask, requestWorkTask } from './task.js';
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
  /** 世界维护点(M-G.5 损耗系统):key = `kind:x:y`,reset 清空 */
  readonly maintenanceSpots = new Map<string, MaintenanceSpot>();
  /** 资源节点(M-G.6 生产系统):key = 节点 id `kind:x:y`,reset 从地图种子重建(存量回满) */
  readonly resourceNodes = new Map<string, ResourceNode>();
  /** 世界事件总线:离散事件与控制变更即时分发,感知/同步层订阅 */
  readonly events = new EventBus<WorldEvent>();
  tick = 0;
  paused = false;
  timeScale: number = BALANCE.DEFAULT_TIME_SCALE;
  /** 世界规则(M5):默认全开;后台创建世界时随配置覆写,reset 回默认 */
  rules: WorldRules = { ...DEFAULT_WORLD_RULES };
  /** 随机源(损耗生成器 roll;默认 Math.random,测试注入确定性实现) */
  private readonly rng: RandomFn;

  constructor(rng: RandomFn = Math.random) {
    this.rng = rng;
    this._rebuildResourceNodes();
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
      diedAtGameMinutes: null,
      backpack: {},
      fridge: {},
      lifeScore: 0,
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
    // 世界日翻转(00:00)社交结算+资源重生:熟悉度衰减/聊天防刷计数跨日自然重置,
    // 枯竭浆果丛回满(design/09 §2)
    if (this.clock.minuteOfDay === 0) {
      applySocialDailyRollover(this);
      this._respawnResourceNodes();
    }
    // 睡眠结算(M-G.2):夜窗口(22:00~06:00)结束于 06:00——窗口跨 00:00,
    // 结算挂 NIGHT_END 而非日翻转;缺觉挂惩罚,账本无论是否缺觉均清零
    if (this.clock.minuteOfDay === BALANCE.NIGHT_END_MINUTE) {
      this._settleSleep();
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
            const result = settleActivityMinute(
              character.activity,
              character,
              definition,
              this._debtFactor(character),
            );
            // 睡眠账本(M-G.2):仅窗口内的入睡分钟累计;06:00 后续睡不进新账本
            if (character.activity.activityId === 'sleep' && this._inSleepWindow()) {
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
      // 繁荣分质量流(M3.6j): 本分钟数值结算完毕后按当前幸福累计,死亡当分钟也计入
      applyLifeScoreTick(character);
      // 同场增益(社交 v1): 活动角色按附近活动人数得幸福修正
      applySocialPresenceBonus(this, character);
      this._checkDeath(character);
      this._checkReviveWindow(character);
    }
  }

  /**
   * 维护/采集工单逐分钟结算(M-G.5/M-G.6):在途不计时;到位先验目标仍有效——
   * 维护点被清/幽灵被抢先救治或窗口超时/节点被采空→无薪中断发 work_task.cancelled;
   * 完成→按任务分流:维护消目标+按单入账,采集产出入背包+节点扣存量(以物代薪 pay=0)。
   */
  private _stepWorkTask(character: WorldCharacter, definition: ActivityDefinition): void {
    const activity = character.activity;
    if (activity === null || character.path.length > 0) {
      return; // 在途不结算
    }
    const targetId = activity.targetId!;
    const task = activity.activityId as WorkTaskId;
    if (!this._workTargetValid(task, targetId)) {
      const event: WorkTaskCancelledEvent = {
        type: 'work_task.cancelled',
        characterId: character.id,
        targetId,
        tick: this.tick,
      };
      this.events.emit(event);
      finishActivity(this, character, 'interrupted');
      return;
    }
    const result = settleActivityMinute(activity, character, definition);
    if (result !== 'completed') {
      return;
    }
    if (isGatherTask(task)) {
      this._completeGather(character, task, targetId);
      return;
    }
    if (task === 'rescue') {
      reviveCharacter(this, this.characters.get(targetId)!, 'rescue'); // 免扣复活
    } else {
      if (task === 'repair') {
        // 修补钉闭环(M-G.6):完成时刻再验(作业期间存入冰箱等转移→无薪中断)
        const kit = character.backpack.repair_kit ?? 0;
        if (kit < 1) {
          const event: WorkTaskCancelledEvent = {
            type: 'work_task.cancelled',
            characterId: character.id,
            targetId,
            tick: this.tick,
          };
          this.events.emit(event);
          finishActivity(this, character, 'interrupted');
          return;
        }
        if (kit > 1) {
          character.backpack.repair_kit = kit - 1;
        } else {
          delete character.backpack.repair_kit;
        }
      }
      this.maintenanceSpots.delete(targetId);
    }
    const pay = MAINTENANCE_TASKS[task].pay * this._debtFactor(character);
    character.coins += pay;
    const event: WorkTaskCompletedEvent = {
      type: 'work_task.completed',
      characterId: character.id,
      targetId,
      task,
      pay,
      tick: this.tick,
    };
    this.events.emit(event);
    finishActivity(this, character, 'completed');
  }

  /** 配方完成(M-G.6):产出入包+craft.completed;中断退料在 finishActivity 分流。
   * 缺觉日(M-G.2)产出 floor(count×系数)——单件产出可能为 0(材料已扣不退,有意) */
  private _completeCraft(character: WorldCharacter): void {
    const recipeId = character.activity?.craftRecipeId;
    if (recipeId === undefined) {
      return;
    }
    const factor = this._debtFactor(character);
    for (const output of RECIPES[recipeId].outputs) {
      character.backpack[output.itemId] =
        (character.backpack[output.itemId] ?? 0) + Math.floor(output.count * factor);
    }
    const event: CraftCompletedEvent = {
      type: 'craft.completed',
      characterId: character.id,
      recipeId,
      tick: this.tick,
    };
    this.events.emit(event);
  }

  /** 采集完成(design/09 §2):产出逐项 roll 入背包,节点扣存量,枯竭记次日重生。
   * 缺觉日(M-G.2)产出 floor(count×系数)——单件产出可能为 0(有意) */
  private _completeGather(
    character: WorldCharacter,
    task: GatherTaskId,
    targetId: string,
  ): void {
    const node = this.resourceNodes.get(targetId)!;
    const factor = this._debtFactor(character);
    for (const yieldDef of GATHER_TASKS[task].yields) {
      if (yieldDef.chance !== undefined && this.rng() >= yieldDef.chance) {
        continue;
      }
      character.backpack[yieldDef.itemId] =
        (character.backpack[yieldDef.itemId] ?? 0) + Math.floor(yieldDef.count * factor);
    }
    if (node.charges !== null) {
      node.charges -= 1;
      if (node.charges <= 0) {
        node.respawnAtDay = this.clock.day + 1;
      }
    }
    const event: WorkTaskCompletedEvent = {
      type: 'work_task.completed',
      characterId: character.id,
      targetId,
      task,
      pay: 0,
      tick: this.tick,
    };
    this.events.emit(event);
    finishActivity(this, character, 'completed');
  }

  /** 工单目标仍有效:维护点在场;待救角色仍处幽灵救治窗口内;节点存在且未枯竭 */
  private _workTargetValid(task: WorkTaskId, targetId: string): boolean {
    if (task === 'rescue') {
      const target = this.characters.get(targetId);
      return (
        target !== undefined &&
        !target.alive &&
        target.diedAtGameMinutes !== null &&
        this.clock.gameMinutes - target.diedAtGameMinutes < REVIVE_WINDOW_MINUTES
      );
    }
    if (isGatherTask(task)) {
      const node = this.resourceNodes.get(targetId);
      return node !== undefined && (node.charges === null || node.charges > 0);
    }
    return this.maintenanceSpots.has(targetId);
  }

  /** 资源节点从地图种子重建(构造/setMap/reset 共用):浆果丛满存量,拾荒堆无限 */
  private _rebuildResourceNodes(): void {
    this.resourceNodes.clear();
    for (const seed of this._map.resourceSeeds) {
      const id = `${seed.kind}:${seed.x}:${seed.y}`;
      this.resourceNodes.set(id, {
        id,
        kind: seed.kind,
        x: seed.x,
        y: seed.y,
        charges: seed.kind === 'berry_bush' ? BUSH_MAX_CHARGES : null,
        respawnAtDay: null,
      });
    }
  }

  /** 跨日 00:00 重生(design/09 §2):到日枯竭浆果丛回满;拾荒堆无需重生 */
  private _respawnResourceNodes(): void {
    for (const node of this.resourceNodes.values()) {
      if (node.respawnAtDay !== null && this.clock.day >= node.respawnAtDay) {
        node.charges = BUSH_MAX_CHARGES;
        node.respawnAtDay = null;
      }
    }
  }

  /** 睡眠窗口判定(M-G.2):22:00~次日 06:00(与 clock.isNight 同窗口,读可热调参数) */
  private _inSleepWindow(): boolean {
    const m = this.clock.minuteOfDay;
    return m >= BALANCE.NIGHT_START_MINUTE || m < BALANCE.NIGHT_END_MINUTE;
  }

  /** 缺觉系数(M-G.2):惩罚生效中(未到 sleepDebtEndGameMinutes)返回 SLEEP_DEBT_MULTIPLIER,否则 1 */
  private _debtFactor(character: WorldCharacter): number {
    return character.sleepDebtEndGameMinutes !== null &&
      this.clock.gameMinutes < character.sleepDebtEndGameMinutes
      ? BALANCE.SLEEP_DEBT_MULTIPLIER
      : 1;
  }

  /**
   * 睡眠结算(M-G.2,数值文档 §2.7):每日 06:00——昨夜窗口累计 < SLEEP_MIN_MINUTES
   * 且存活者挂缺觉惩罚 24 游戏时并发 sleep.debt_applied;账本无条件清零
   * (含幽灵——死亡期间漏结算,复活后从零起算)。
   */
  private _settleSleep(): void {
    for (const character of this.characters.values()) {
      if (
        character.alive &&
        character.sleepWindowMinutes < BALANCE.SLEEP_MIN_MINUTES
      ) {
        character.sleepDebtEndGameMinutes = this.clock.gameMinutes + BALANCE.DAY_MINUTES;
        const event: SleepDebtAppliedEvent = {
          type: 'sleep.debt_applied',
          characterId: character.id,
          sleptMinutes: character.sleepWindowMinutes,
          tick: this.tick,
        };
        this.events.emit(event);
      }
      character.sleepWindowMinutes = 0;
    }
  }

  /**
   * 体力耗尽死亡(M-G.5 救治窗口,goal-design §7):转幽灵态,清路径/打断活动,
   * 繁荣分扣减**挂起**——窗口内救治/debug 免扣,超时按现值生效。
   */
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
    character.diedAtGameMinutes = this.clock.gameMinutes;
    finishActivity(this, character, 'died');
    const event: CharacterDiedEvent = {
      type: 'character.died',
      characterId: character.id,
      tick: this.tick,
      revivable: true,
    };
    this.events.emit(event);
  }

  /** 救治窗口超时结算(M-G.5):挂起扣减按超时时刻现值 ×(1-比例) 生效,自动复活 */
  private _checkReviveWindow(character: WorldCharacter): void {
    if (character.alive || character.diedAtGameMinutes === null) {
      return;
    }
    if (this.clock.gameMinutes - character.diedAtGameMinutes < REVIVE_WINDOW_MINUTES) {
      return;
    }
    // 繁荣分死亡扣减(M3.6j 方案B): 比例扣无套利——活得越厚实,死亡的绝对损失越大
    character.lifeScore *= 1 - BALANCE.LIFE_SCORE_DEATH_DEDUCTION;
    reviveCharacter(this, character, 'timeout');
  }
}

/** 复活公共路径(M-G.5):满状态回归+清死亡时刻;救治/debug 免扣,timeout 已在调用方扣减 */
function reviveCharacter(
  sim: Simulation,
  character: WorldCharacter,
  source: 'rescue' | 'debug' | 'timeout',
): void {
  character.alive = true;
  character.energy = BALANCE.REVIVE_ENERGY;
  character.happiness = BALANCE.REVIVE_HAPPINESS;
  character.diedAtGameMinutes = null;
  if (source === 'timeout') {
    const event: CharacterAutoRevivedEvent = {
      type: 'character.auto_revived',
      characterId: character.id,
      tick: sim.tick,
    };
    sim.events.emit(event);
  } else {
    const event: CharacterRevivedEvent = {
      type: 'character.revived',
      characterId: character.id,
      tick: sim.tick,
    };
    sim.events.emit(event);
  }
}
