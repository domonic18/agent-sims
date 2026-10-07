import type {
  ActivityDefinition,
  CharacterArrivedEvent,
  CharacterDiedEvent,
  CraftCompletedEvent,
  MaintenanceSpot,
  ResourceNode,
  TraitVector,
  WorkTaskCancelledEvent,
  WorkTaskCompletedEvent,
  WorkTaskId,
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
  MAINTENANCE_TASKS,
  NODE_MAX_CHARGES,
  PROPERTY_IDS,
  RECIPES,
  REVIVE_WINDOW_MINUTES,
  TOWN_MAP,
  WORK_TARGETS,
  getActivityDefinition,
  isGatherTask,
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
  applyHealthTick,
  applyLifeScoreTick,
  applyVitalDecay,
  reviveCharacter,
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
import { debtFactor, inSleepWindow, settleSleep } from './settlement.js';
import { completeWorkTask, requestWorkTask } from './work-task.js';
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
  /** 游戏模式(M-S/S1):survival 启用生存健康数值;创建/恢复世界时注入,reset 回 growth */
  gameType: GameType = 'growth';
  /** 随机源(损耗生成器 roll;默认 Math.random,测试注入确定性实现) */
  readonly rng: RandomFn;

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
      happiness: BALANCE.START_HAPPINESS,
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
            const result = settleActivityMinute(
              character.activity,
              character,
              definition,
              debtFactor(character, this.clock.gameMinutes),
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
      // 繁荣分质量流(M3.6j): 本分钟数值结算完毕后按当前幸福累计,死亡当分钟也计入
      applyLifeScoreTick(character);
      // 同场增益(社交 v1): 活动角色按附近活动人数得幸福修正
      applySocialPresenceBonus(this, character);
      // 生存健康(M-S/S1):仅 survival 有压力源;置于死亡判定前,健康归零当分钟入重伤
      if (this.gameType === 'survival') {
        applyHealthTick(character);
      }
      this._checkDeath(character);
      this._checkReviveWindow(character);
    }
  }

  /**
   * 维护/采集工单逐分钟结算(M-G.5/M-G.6):在途不计时;到位先验目标仍有效——
   * 维护点被清/幽灵被抢先救治或窗口超时/节点被采空→无薪中断发 work_task.cancelled;
   * 完成→世界侧变更走完成钩子注册表(TD-1,work-task.ts),此后统一结算尾段:
   * 采集以物代薪 pay=0,维护岗按单入账,金币均乘缺觉系数(M-G.2)。
   */
  private _stepWorkTask(character: WorldCharacter, definition: ActivityDefinition): void {
    const activity = character.activity;
    if (activity === null || character.path.length > 0) {
      return; // 在途不结算
    }
    const targetId = activity.targetId!;
    const task = activity.activityId as WorkTaskId;
    const cancel = (): void => {
      const event: WorkTaskCancelledEvent = {
        type: 'work_task.cancelled',
        characterId: character.id,
        targetId,
        tick: this.tick,
      };
      this.events.emit(event);
      finishActivity(this, character, 'interrupted');
    };
    if (!this._workTargetValid(task, targetId)) {
      cancel();
      return;
    }
    const result = settleActivityMinute(activity, character, definition);
    if (result !== 'completed') {
      return;
    }
    const outcome = completeWorkTask({
      sim: this,
      character,
      task,
      targetId,
      debtFactor: debtFactor(character, this.clock.gameMinutes),
    });
    if (outcome === 'cancelled') {
      cancel();
      return;
    }
    const pay =
      (isGatherTask(task) ? 0 : MAINTENANCE_TASKS[task].pay) * debtFactor(character, this.clock.gameMinutes);
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
    const factor = debtFactor(character, this.clock.gameMinutes);
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

  /** 工单目标仍有效(TD-1 按 WORK_TARGETS.source 分派):维护点在场;
   * 待救角色仍处幽灵救治窗口内;节点存在且未枯竭 */
  private _workTargetValid(task: WorkTaskId, targetId: string): boolean {
    const source = WORK_TARGETS[task].source;
    if (source === 'characters') {
      const target = this.characters.get(targetId);
      return (
        target !== undefined &&
        !target.alive &&
        target.diedAtGameMinutes !== null &&
        this.clock.gameMinutes - target.diedAtGameMinutes < REVIVE_WINDOW_MINUTES
      );
    }
    if (source === 'resources') {
      const node = this.resourceNodes.get(targetId);
      return node !== undefined && (node.charges === null || node.charges > 0);
    }
    return this.maintenanceSpots.has(targetId);
  }

  /** 资源节点从地图种子重建(构造/setMap/reset 共用):存量按 NODE_MAX_CHARGES 表
   * (浆果丛 3/树木 5/岩石 4/金属堆 3,拾荒堆无限) */
  private _rebuildResourceNodes(): void {
    this.resourceNodes.clear();
    for (const seed of this._map.resourceSeeds) {
      const id = `${seed.kind}:${seed.x}:${seed.y}`;
      this.resourceNodes.set(id, {
        id,
        kind: seed.kind,
        x: seed.x,
        y: seed.y,
        charges: NODE_MAX_CHARGES[seed.kind],
        respawnAtDay: null,
      });
    }
  }

  /** 跨日 00:00 重生(design/09 §2):到日枯竭节点按表回满;拾荒堆无需重生 */
  private _respawnResourceNodes(): void {
    for (const node of this.resourceNodes.values()) {
      if (node.respawnAtDay !== null && this.clock.day >= node.respawnAtDay) {
        node.charges = NODE_MAX_CHARGES[node.kind];
        node.respawnAtDay = null;
      }
    }
  }

  /**
   * 体力耗尽死亡(M-G.5 救治窗口,goal-design §7):转幽灵态,清路径/打断活动,
   * 繁荣分扣减**挂起**——窗口内救治/debug 免扣,超时按现值生效。
   * survival(M-S/S1)语义为重伤休整:健康归零(饥饿)同样触发,角色不死;
   * 超时苏醒不扣繁荣分、数值回恢复线(reviveCharacter 分支),救治复活满状态。
   */
  private _checkDeath(character: WorldCharacter): void {
    // 世界规则关闭死亡(M5):体力卡 0 持续躺平,不转幽灵不扣繁荣分;
    // survival 下健康同步卡 1(归零即重伤,与关闭语义一致)
    if (!this.rules.allowDeath) {
      if (this.gameType === 'survival' && character.health <= 0) {
        character.health = 1;
      }
      return;
    }
    const injured = this.gameType === 'survival' && character.health <= 0;
    if (!character.alive || (character.energy > 0 && !injured)) {
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

  /** 救治窗口超时结算(M-G.5):挂起扣减按超时时刻现值 ×(1-比例) 生效,自动复活;
   * survival 重伤休整(M-S/S1)软惩罚原则——超时苏醒不扣繁荣分,数值回恢复线 */
  private _checkReviveWindow(character: WorldCharacter): void {
    if (character.alive || character.diedAtGameMinutes === null) {
      return;
    }
    if (this.clock.gameMinutes - character.diedAtGameMinutes < REVIVE_WINDOW_MINUTES) {
      return;
    }
    // 繁荣分死亡扣减(M3.6j 方案B): 比例扣无套利——活得越厚实,死亡的绝对损失越大
    if (this.gameType !== 'survival') {
      character.lifeScore *= 1 - BALANCE.LIFE_SCORE_DEATH_DEDUCTION;
    }
    reviveCharacter(this, character, 'timeout');
  }
}
