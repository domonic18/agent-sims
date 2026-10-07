import { z } from 'zod';
import { ACTIVITY_DEFINITIONS, JOB_CATEGORIES, type JobCategoryId } from './activities.js';
import { ITEM_IDS } from './items.js';

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

/**
 * 节点存量表(design/09 §2):采尽枯竭后按重生天数回满;拾荒堆无限采(charges=null)。
 * 表值=出厂默认,运行时以 BALANCE.NODE_MAX_CHARGES_*(SYS_CONFIG resources 组热调)为准,
 * server 读点见 work-task/simulation。
 */
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
  /** 是否启用(禁用后 craft 意图拒绝;每世界快照恒有值,shared 源表缺省视为 true) */
  enabled?: boolean;
  /** 制作时长(分钟;每世界快照自活动定义定格,运行时以本值为准,不追溯进行中活动) */
  durationMinutes?: number;
  /** 可制作场所(每世界快照自活动定义) */
  placeIds?: string[];
  /** 岗位类别门槛快照(自活动定义;craft_berry_pie 等随类别门槛受知识约束) */
  category?: JobCategoryId;
}

/**
 * 出厂配方全集(每世界内容模板):RECIPES 源表 + 自活动定义快照的
 * durationMinutes/placeIds/category/enabled。建世界时深拷贝冻结进
 * config.rules.recipes,此后 admin 配方页编辑只改该世界存档与运行时,
 * shared 源表更新仅影响新世界(与 TOWN_MAP 冻结语义同构)。
 */
export function defaultRecipes(): Record<CraftRecipeId, RecipeDef> {
  return Object.fromEntries(
    CRAFT_RECIPE_IDS.map((id) => {
      const recipe = RECIPES[id];
      const activity = ACTIVITY_DEFINITIONS.find((def) => def.id === id);
      return [
        id,
        {
          ...recipe,
          enabled: true,
          durationMinutes: recipe.durationMinutes ?? activity?.durationMinutes ?? 20,
          placeIds: recipe.placeIds ?? [...(activity?.placeIds ?? [])],
          ...(recipe.category ?? activity?.category !== undefined
            ? { category: recipe.category ?? activity?.category }
            : {}),
        },
      ];
    }),
  ) as Record<CraftRecipeId, RecipeDef>;
}

/** 深拷贝配方全集(server 建世界/恢复时灌入 sim,隔离 admin 运行时修改与存档对象) */
export function cloneRecipes(recipes: Record<CraftRecipeId, RecipeDef>): Record<CraftRecipeId, RecipeDef> {
  return Object.fromEntries(
    CRAFT_RECIPE_IDS.map((id) => {
      const recipe = recipes[id];
      return [
        id,
        {
          ...recipe,
          inputs: recipe.inputs.map((io) => ({ ...io })),
          outputs: recipe.outputs.map((io) => ({ ...io })),
          ...(recipe.placeIds !== undefined ? { placeIds: [...recipe.placeIds] } : {}),
        },
      ];
    }),
  ) as Record<CraftRecipeId, RecipeDef>;
}

/**
 * 配方全集校验(后台 PUT 用):id 封闭联合逐项校验,缺项/材料或产物
 * ItemId 不在目录/数量非正整数/时长越界均拒;返回错误文案列表,空=全部合法。
 */
export function validateRecipes(recipes: unknown): string[] {
  const errors: string[] = [];
  if (recipes === null || typeof recipes !== 'object' || Array.isArray(recipes)) {
    return ['配方全集须为对象'];
  }
  const record = recipes as Record<string, unknown>;
  const validIO = (io: unknown): boolean => {
    if (io === null || typeof io !== 'object') return false;
    const entry = io as { itemId?: unknown; count?: unknown };
    return (
      typeof entry.itemId === 'string' &&
      (ITEM_IDS as readonly string[]).includes(entry.itemId) &&
      typeof entry.count === 'number' &&
      Number.isInteger(entry.count) &&
      entry.count >= 1 &&
      entry.count <= 99
    );
  };
  const ioList = (value: unknown): boolean =>
    Array.isArray(value) && value.length >= 1 && value.length <= 6 && value.every(validIO);
  for (const id of CRAFT_RECIPE_IDS) {
    const recipe = record[id];
    if (recipe === null || typeof recipe !== 'object') {
      errors.push(`${id}: 缺少配方定义`);
      continue;
    }
    const def = recipe as Record<string, unknown>;
    if (typeof def.name !== 'string' || def.name.trim() === '' || def.name.length > 20) {
      errors.push(`${id}.name: 须为 1~20 字文本`);
    }
    if (def.stationKind !== 'stove' && def.stationKind !== 'workbench') {
      errors.push(`${id}.stationKind: 仅支持 stove/workbench`);
    }
    if (typeof def.enabled !== 'boolean') {
      errors.push(`${id}.enabled: 须为布尔`);
    }
    if (
      typeof def.durationMinutes !== 'number' ||
      !Number.isInteger(def.durationMinutes) ||
      def.durationMinutes < 1 ||
      def.durationMinutes > 600
    ) {
      errors.push(`${id}.durationMinutes: 须为 1~600 整数分钟`);
    }
    if (!ioList(def.inputs)) {
      errors.push(`${id}.inputs: 须为 1~6 项材料(ItemId 在目录内,数量 1~99 整数)`);
    }
    if (!ioList(def.outputs)) {
      errors.push(`${id}.outputs: 须为 1~6 项产物(ItemId 在目录内,数量 1~99 整数)`);
    }
    if (
      !Array.isArray(def.placeIds) ||
      def.placeIds.length < 1 ||
      !def.placeIds.every((p) => typeof p === 'string' && p.length > 0)
    ) {
      errors.push(`${id}.placeIds: 须为非空场所 id 数组`);
    }
    if (
      def.category !== undefined &&
      !(Object.keys(JOB_CATEGORIES) as string[]).includes(def.category as string)
    ) {
      errors.push(`${id}.category: 未知岗位类别`);
    }
  }
  const known = new Set<string>(CRAFT_RECIPE_IDS);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      errors.push(`${key}: 未知配方 id(仅支持 ${CRAFT_RECIPE_IDS.join('/')})`);
    }
  }
  return errors;
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
