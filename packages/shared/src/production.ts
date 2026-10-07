import { z } from 'zod';

/**
 * 生产系统协议面(M-G.6,design/09):资源节点双端形态与采集岗位参数。
 * 采集无工资以物代薪(与工资型维护岗构成双轨奖励模型):节点=有存量的
 * 可采目标实体,采集走 work_task(目标=节点),产出入背包,枯竭重生。
 */

export const resourceNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['berry_bush', 'junk_pile', 'tree', 'rock', 'metal_pile', 'apple_tree', 'wheat_patch']),
  x: z.number().int(),
  y: z.number().int(),
  /** 剩余可采次数;null=无限(拾荒堆),0=已枯竭(浆果丛待重生) */
  charges: z.number().int().min(0).nullable(),
  /** 重生于第几游戏日 00:00;null=不重生/无需重生 */
  respawnAtDay: z.number().int().min(1).nullable(),
});

/** 资源节点(采集目标):浆果丛有存量可枯竭,拾荒堆无限采 */
export type ResourceNode = z.infer<typeof resourceNodeSchema>;

/** 地图定义内的节点种子(占格不可行走,采集站四邻) */
export interface ResourceNodeSeed {
  kind: ResourceNode['kind'];
  x: number;
  y: number;
}

/** 采集岗位(numerical §5.4):同属采集类(知识 3 班门槛,JOB_CATEGORIES.gather) */
export type GatherTaskId =
  | 'gather_berry'
  | 'scavenge'
  | 'chop_tree'
  | 'mine_rock'
  | 'salvage_metal'
  | 'pick_apple'
  | 'harvest_wheat';

export interface GatherYield {
  itemId: string;
  count: number;
  /** 掉落概率(缺省=必得) */
  chance?: number;
}

export interface GatherTaskDef {
  id: GatherTaskId;
  /** 活动类别(与维护岗同构,门槛查 JOB_CATEGORIES) */
  category: 'gather';
  durationMinutes: number;
  nodeKind: ResourceNode['kind'];
  /** 产出表(接单按最坏总体积校验背包,完成逐项 roll 入包) */
  yields: GatherYield[];
}

export const GATHER_TASKS: Record<GatherTaskId, GatherTaskDef> = {
  gather_berry: {
    id: 'gather_berry',
    category: 'gather',
    durationMinutes: 20,
    nodeKind: 'berry_bush',
    yields: [{ itemId: 'berry', count: 2 }],
  },
  scavenge: {
    id: 'scavenge',
    category: 'gather',
    durationMinutes: 15,
    nodeKind: 'junk_pile',
    yields: [{ itemId: 'scrap', count: 1 }, { itemId: 'twig', count: 1, chance: 0.3 }],
  },
  // 生存资源三件套(M-S/S1,07-survival §2):建造材料采集,S2 建造配方消费
  chop_tree: {
    id: 'chop_tree',
    category: 'gather',
    durationMinutes: 25,
    nodeKind: 'tree',
    yields: [{ itemId: 'wood', count: 2 }],
  },
  mine_rock: {
    id: 'mine_rock',
    category: 'gather',
    durationMinutes: 30,
    nodeKind: 'rock',
    yields: [{ itemId: 'stone', count: 2 }],
  },
  salvage_metal: {
    id: 'salvage_metal',
    category: 'gather',
    durationMinutes: 25,
    nodeKind: 'metal_pile',
    yields: [{ itemId: 'metal', count: 2 }],
  },
  // 食物链采集两岗(2026-10-07,numerical §5.4):直采恢复<制作——苹果直食 +4,
  // 小麦为面包原料(经灶台制作 +6,再制三明治 +8)
  pick_apple: {
    id: 'pick_apple',
    category: 'gather',
    durationMinutes: 20,
    nodeKind: 'apple_tree',
    yields: [{ itemId: 'apple', count: 1 }],
  },
  harvest_wheat: {
    id: 'harvest_wheat',
    category: 'gather',
    durationMinutes: 20,
    nodeKind: 'wheat_patch',
    yields: [{ itemId: 'wheat', count: 2 }],
  },
};

/** 节点存量表(design/09 §2):采尽枯竭次日 00:00 回满;拾荒堆无限采(charges=null) */
export const NODE_MAX_CHARGES: Record<ResourceNode['kind'], number | null> = {
  berry_bush: 3,
  junk_pile: null,
  tree: 5,
  rock: 4,
  metal_pile: 3,
  apple_tree: 4,
  wheat_patch: 3,
};

/**
 * 配方制作(design/09 §3):key=制作活动 id,站点锚点家具(stove/workbench)
 * 绑定同名活动;开始验料扣料,中断退料,完成产出入包(产出体积恒<输入)。
 * 制作类别门槛随活动定义(craft_berry_pie→gather 3 班,craft_repair_kit→build 6 班)。
 */
export type CraftRecipeId = 'craft_berry_pie' | 'craft_repair_kit' | 'craft_bread' | 'craft_sandwich';

export const CRAFT_RECIPE_IDS = [
  'craft_berry_pie',
  'craft_repair_kit',
  'craft_bread',
  'craft_sandwich',
] as const;

export interface RecipeIO {
  itemId: string;
  count: number;
}

export interface RecipeDef {
  id: CraftRecipeId;
  name: string;
  /** 站点家具 kind(活动锚点所在) */
  stationKind: 'stove' | 'workbench';
  inputs: RecipeIO[];
  outputs: RecipeIO[];
}

export const RECIPES: Record<CraftRecipeId, RecipeDef> = {
  craft_berry_pie: {
    id: 'craft_berry_pie',
    name: '浆果派',
    stationKind: 'stove',
    inputs: [{ itemId: 'berry', count: 3 }],
    outputs: [{ itemId: 'berry_pie', count: 1 }],
  },
  craft_repair_kit: {
    id: 'craft_repair_kit',
    name: '修补钉',
    stationKind: 'workbench',
    inputs: [{ itemId: 'scrap', count: 2 }],
    outputs: [{ itemId: 'repair_kit', count: 1 }],
  },
  // 食物链制作两配方(2026-10-07,numerical §5.4):产出复用货架同 ItemId,
  // 制作恢复>直采(面包 +6/三明治 +8 > 直采苹果 +4/浆果×2 = +4)
  craft_bread: {
    id: 'craft_bread',
    name: '面包',
    stationKind: 'stove',
    inputs: [{ itemId: 'wheat', count: 2 }],
    outputs: [{ itemId: 'bread', count: 1 }],
  },
  craft_sandwich: {
    id: 'craft_sandwich',
    name: '三明治',
    stationKind: 'stove',
    inputs: [{ itemId: 'bread', count: 1 }, { itemId: 'apple', count: 1 }],
    outputs: [{ itemId: 'sandwich', count: 1 }],
  },
};

export function getRecipe(id: string): RecipeDef | null {
  return (RECIPES as Record<string, RecipeDef>)[id] ?? null;
}
