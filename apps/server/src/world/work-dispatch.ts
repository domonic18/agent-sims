import type {
  ActivityDefinition,
  CraftCompletedEvent,
  ResourceNode,
  WorkTaskCancelledEvent,
  WorkTaskCompletedEvent,
  WorkTaskId,
} from '@sims/shared';
import {
  MAINTENANCE_TASKS,
  REVIVE_WINDOW_MINUTES,
  SHOP_ITEM_IDS,
  WORK_TARGETS,
  isGatherTask,
} from '@sims/shared';
import { BALANCE, type BalanceConfig } from '../config/balance.js';
import { settleActivityMinute, finishActivity } from './activity.js';
import type { WorldCharacter } from './character.js';
import { completeWorkTask } from './work-task.js';
import { debtFactor } from './settlement.js';
import type { Simulation } from './simulation.js';

/** 节点 kind → 热调参数键(SYS_CONFIG resources 组);-1 哨兵=null 无限 */
type NodeChargeKey = Extract<keyof BalanceConfig, `NODE_MAX_CHARGES_${string}`>;
const NODE_CHARGE_KEYS: Record<ResourceNode['kind'], NodeChargeKey> = {
  berry_bush: 'NODE_MAX_CHARGES_BERRY',
  junk_pile: 'NODE_MAX_CHARGES_JUNK',
  tree: 'NODE_MAX_CHARGES_TREE',
  rock: 'NODE_MAX_CHARGES_ROCK',
  metal_pile: 'NODE_MAX_CHARGES_METAL',
  apple_tree: 'NODE_MAX_CHARGES_APPLE',
  wheat_patch: 'NODE_MAX_CHARGES_WHEAT',
};

function nodeMaxCharges(kind: ResourceNode['kind']): number | null {
  const value = BALANCE[NODE_CHARGE_KEYS[kind]];
  return value < 0 ? null : value;
}

/**
 * 维护/采集工单逐分钟结算(M-G.5/M-G.6):在途不计时;到位先验目标仍有效——
 * 维护点被清/幽灵被抢先救治或窗口超时/节点被采空→无薪中断发 work_task.cancelled;
 * 完成→世界侧变更走完成钩子注册表(TD-1,work-task.ts),此后统一结算尾段:
 * 采集以物代薪 pay=0,维护岗按单入账,金币均乘缺觉系数(M-G.2)。
 */
export function stepWorkTask(
  sim: Simulation,
  character: WorldCharacter,
  definition: ActivityDefinition,
): void {
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
      tick: sim.tick,
    };
    sim.events.emit(event);
    finishActivity(sim, character, 'interrupted');
  };
  if (!workTargetValid(sim, task, targetId)) {
    cancel();
    return;
  }
  const result = settleActivityMinute(activity, character, definition);
  if (result !== 'completed') {
    return;
  }
  const outcome = completeWorkTask({
    sim,
    character,
    task,
    targetId,
    debtFactor: debtFactor(character, sim.clock.gameMinutes),
  });
  if (outcome === 'cancelled') {
    cancel();
    return;
  }
  const pay =
    (isGatherTask(task) ? 0 : MAINTENANCE_TASKS[task].pay) * debtFactor(character, sim.clock.gameMinutes);
  character.coins += pay;
  const event: WorkTaskCompletedEvent = {
    type: 'work_task.completed',
    characterId: character.id,
    targetId,
    task,
    pay,
    tick: sim.tick,
  };
  sim.events.emit(event);
  finishActivity(sim, character, 'completed');
}

/** 配方完成(M-G.6):产出凭开始时快照入包+craft.completed;中断退料在
 * finishActivity 凭快照分流(配方热改不追溯在制单)。
 * 缺觉日(M-G.2)产出 floor(count×系数)——单件产出可能为 0(材料已扣不退,有意) */
export function completeCraft(sim: Simulation, character: WorldCharacter): void {
  const recipeId = character.activity?.craftRecipeId;
  if (recipeId === undefined) {
    return;
  }
  const outputs = character.activity?.craftOutputs ?? sim.recipe(recipeId)?.outputs ?? [];
  const factor = debtFactor(character, sim.clock.gameMinutes);
  for (const output of outputs) {
    character.backpack[output.itemId] =
      (character.backpack[output.itemId] ?? 0) + Math.floor(output.count * factor);
  }
  const event: CraftCompletedEvent = {
    type: 'craft.completed',
    characterId: character.id,
    recipeId,
    tick: sim.tick,
  };
  sim.events.emit(event);
}

/** 工单目标仍有效(TD-1 按 WORK_TARGETS.source 分派):维护点在场;
 * 待救角色仍处幽灵救治窗口内;节点存在且未枯竭 */
function workTargetValid(sim: Simulation, task: WorkTaskId, targetId: string): boolean {
  const source = WORK_TARGETS[task].source;
  if (source === 'characters') {
    const target = sim.characters.get(targetId);
    return (
      target !== undefined &&
      !target.alive &&
      target.diedAtGameMinutes !== null &&
      sim.clock.gameMinutes - target.diedAtGameMinutes < REVIVE_WINDOW_MINUTES
    );
  }
  if (source === 'resources') {
    const node = sim.resourceNodes.get(targetId);
    return node !== undefined && (node.charges === null || node.charges > 0);
  }
  return sim.maintenanceSpots.has(targetId);
}

/** 资源节点从地图种子重建(构造/setMap/reset 共用):存量按热调参数
 * NODE_MAX_CHARGES_*(出厂默认 04 §5.4 表值,拾荒堆 -1=无限) */
export function rebuildResourceNodes(sim: Simulation): void {
  sim.resourceNodes.clear();
  for (const seed of sim.map.resourceSeeds) {
    const id = `${seed.kind}:${seed.x}:${seed.y}`;
    sim.resourceNodes.set(id, {
      id,
      kind: seed.kind,
      x: seed.x,
      y: seed.y,
      charges: nodeMaxCharges(seed.kind),
      respawnAtDay: null,
    });
  }
}

/** 商店货架初始化(构造/reset 共用):8 货架食物按 SHOP_INITIAL_FOOD_STOCK 各置份数;
 * E1 起供给主渠道=居民卖货(sell_item),此初始化只是开市底货 */
export function initShopStock(sim: Simulation): void {
  sim.shopStock.clear();
  for (const itemId of SHOP_ITEM_IDS) {
    sim.shopStock.set(itemId, BALANCE.SHOP_INITIAL_FOOD_STOCK);
  }
}

/** 每日兜底补货(E1 生产经济,日翻转 00:00 调用):每种货架食物补
 * SHOP_RESTOCK_DAILY 份,封顶初始存量——主供给靠居民采集制作卖入,小额补货
 * 只防全店断粮死锁;0=不补 */
export function restockShopDaily(sim: Simulation): void {
  if (BALANCE.SHOP_RESTOCK_DAILY <= 0) return;
  const cap = BALANCE.SHOP_INITIAL_FOOD_STOCK;
  for (const itemId of SHOP_ITEM_IDS) {
    const stock = sim.shopStock.get(itemId) ?? 0;
    if (stock >= cap) continue;
    sim.shopStock.set(itemId, Math.min(cap, stock + BALANCE.SHOP_RESTOCK_DAILY));
  }
}

/** 跨日 00:00 重生(design/09 §2):到日枯竭节点按热调重生天数回满;拾荒堆无需重生 */
export function respawnResourceNodes(sim: Simulation): void {
  for (const node of sim.resourceNodes.values()) {
    if (node.respawnAtDay !== null && sim.clock.day >= node.respawnAtDay) {
      node.charges = nodeMaxCharges(node.kind);
      node.respawnAtDay = null;
    }
  }
}
