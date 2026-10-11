/**
 * 游戏模式档案(plan/02 GameModeProfile):growth/survival 的全部模式差异收敛为
 * 两张声明表——worldgen(配额/镇核/镇外簇/资源落点/装饰档)与 sim(健康/死亡/苏醒
 * 语义)。新增第三种模式=注册一个 profile,worldgen/simulation/character 主干
 * 零 gameType 字面量;gameType 字段保留仅作协议透传。
 * rng 纪律:resourcePlacement 组序即消耗序,batchDraw 编码「整组先抽数量档再
 * 依次撒放」与「逐条抽取撒放」两种既有节拍——改动任一组内顺序都会让同种子
 * 地图变化(特征化快照 characterization.test.ts 会拦)。
 */
import type { GameType, ResourceNodeSeed } from '@sims/shared';
import {
  GROWTH_QUOTA,
  SURVIVAL_QUOTA,
  SURVIVAL_SMALL_SIZE_OVERRIDES,
  type PlaceKind,
  type QuotaRow,
} from './worldgen/blueprint.js';

/** 资源撒点规则:区域决定落点集(食物场所/全镇街面/镇外簇/废墟场所)、避让集与重试档 */
export interface ResourcePlacementRule {
  kind: ResourceNodeSeed['kind'];
  /** 数量档 [min,max](rng.int 一次消耗) */
  count: readonly [number, number];
  area: 'food' | 'streets' | 'forests' | 'rocks' | 'ruins';
}

/** 撒点组:batchDraw=true 整组先抽齐数量档再依次撒放;false 逐条抽取撒放 */
export interface ResourcePlacementGroup {
  batchDraw: boolean;
  rules: ReadonlyArray<ResourcePlacementRule>;
}

/** worldgen 模式差异(全部为已存在的 growth/survival 分支,新差异出现再扩字段) */
export interface WorldgenModeOptions {
  /** 场所配额,撒放顺序=数组序 */
  quota: ReadonlyArray<QuotaRow>;
  /** small 档占地覆写(survival 窄框适配);null=不覆写 */
  smallSizeOverrides: Readonly<Partial<Record<PlaceKind, ReadonlyArray<readonly [number, number]>>>> | null;
  /** 道路骨架紧凑档:低折弯/减支路(镇内核心容量吃紧) */
  compactRoads: boolean;
  /** 镇内核心+镇界围栏(围栏落路格=镇出口;街面资源避围栏) */
  townCore: boolean;
  /** 镇外森林/岩石簇(资源三件套落点+密植装饰区) */
  wildClusters: boolean;
  /** 镇外废土 solid 装饰 pass */
  wreckDecor: boolean;
  /** 食物资源落点场所 id 前缀(growth=park;survival 加 camping) */
  foodPlacePrefixes: readonly string[];
  /** 资源撒点组(有序=rng 消耗序) */
  resourcePlacement: ReadonlyArray<ResourcePlacementGroup>;
  /** 路灯间距档(survival 更稀疏) */
  lampGap: readonly [number, number];
  /** 宅前花丛跳过率(survival 0.5 显荒凉);null=不跳过且零 rng 消耗 */
  flowerSkipChance: number | null;
}

/** 模拟层模式差异:健康结算与死亡/苏醒语义 */
export interface SimModeOptions {
  /** 每游戏分钟生存健康结算(饥饿线损耗/康复线恢复) */
  healthTick: boolean;
  /** 健康归零→重伤休整幽灵态(非死亡;allowDeath 关闭时健康钳 1) */
  healthZeroToInjury: boolean;
  /** 体力归零累倒死亡(growth 送医窗口语义) */
  energyZeroToDeath: boolean;
  /** 救治窗口超时苏醒按比例扣繁荣分 */
  wakeScoreDeduction: boolean;
  /** 重伤休整超时苏醒数值回恢复线(非满状态) */
  injuryWakeToRecoverLine: boolean;
}

/** buildDecor 用到的 worldgen 差异子集(装饰 pass 的模式开关) */
export type DecorModeOptions = Pick<
  WorldgenModeOptions,
  'lampGap' | 'flowerSkipChance' | 'wildClusters' | 'wreckDecor'
>;

export interface GameModeProfile {
  id: GameType;
  worldgen: WorldgenModeOptions;
  sim: SimModeOptions;
}

/** growth(默认模式):公园食物区/满配城镇设施/累倒送医 */
const GROWTH_PROFILE: GameModeProfile = {
  id: 'growth',
  worldgen: {
    quota: GROWTH_QUOTA,
    smallSizeOverrides: null,
    compactRoads: false,
    townCore: false,
    wildClusters: false,
    wreckDecor: false,
    foodPlacePrefixes: ['park'],
    resourcePlacement: [
      {
        batchDraw: true,
        rules: [
          { kind: 'berry_bush', count: [4, 7], area: 'food' },
          { kind: 'junk_pile', count: [2, 4], area: 'streets' },
        ],
      },
      {
        batchDraw: true,
        rules: [
          { kind: 'apple_tree', count: [2, 4], area: 'food' },
          { kind: 'wheat_patch', count: [2, 4], area: 'food' },
        ],
      },
    ],
    lampGap: [12, 18],
    flowerSkipChance: null,
  },
  sim: {
    healthTick: false,
    healthZeroToInjury: false,
    energyZeroToDeath: true,
    wakeScoreDeduction: true,
    injuryWakeToRecoverLine: false,
  },
};

/** survival(M-S/S1):镇内核心+镇外环带/资源三件套/健康数值与重伤休整 */
const SURVIVAL_PROFILE: GameModeProfile = {
  id: 'survival',
  worldgen: {
    quota: SURVIVAL_QUOTA,
    smallSizeOverrides: SURVIVAL_SMALL_SIZE_OVERRIDES,
    compactRoads: true,
    townCore: true,
    wildClusters: true,
    wreckDecor: true,
    foodPlacePrefixes: ['park', 'camping'],
    resourcePlacement: [
      {
        batchDraw: true,
        rules: [
          { kind: 'berry_bush', count: [5, 9], area: 'food' },
          { kind: 'junk_pile', count: [5, 9], area: 'streets' },
        ],
      },
      {
        batchDraw: true,
        rules: [
          { kind: 'apple_tree', count: [3, 6], area: 'food' },
          { kind: 'wheat_patch', count: [3, 6], area: 'food' },
        ],
      },
      {
        batchDraw: false,
        rules: [
          { kind: 'tree', count: [6, 10], area: 'forests' },
          { kind: 'rock', count: [4, 7], area: 'rocks' },
          { kind: 'metal_pile', count: [3, 6], area: 'ruins' },
        ],
      },
    ],
    lampGap: [18, 27],
    flowerSkipChance: 0.5,
  },
  sim: {
    healthTick: true,
    healthZeroToInjury: true,
    energyZeroToDeath: false,
    wakeScoreDeduction: false,
    injuryWakeToRecoverLine: true,
  },
};

const REGISTRY = new Map<GameType, GameModeProfile>([
  [GROWTH_PROFILE.id, GROWTH_PROFILE],
  [SURVIVAL_PROFILE.id, SURVIVAL_PROFILE],
]);

/** 模式档案查询(未注册即抛,Simulation.setGameMode 与 worldgen 共用此收口) */
export function getGameModeProfile(id: GameType): GameModeProfile {
  const profile = REGISTRY.get(id);
  if (profile === undefined) throw new Error(`未注册的游戏模式: ${id}`);
  return profile;
}

/** 测试注册沙箱模式用(演练:注册即新增模式,主干零改动;协议层 zod 天然拒绝) */
export function registerGameModeProfileForTests(profile: GameModeProfile): void {
  REGISTRY.set(profile.id, profile);
}
