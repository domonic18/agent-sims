import type { TraitVector } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { Point } from './pathfinding.js';

/** 角色进行中活动(elapsed 为已进行游戏分钟;anchorKind=rest 档位家具 kind) */
export interface CharacterActivity {
  activityId: string;
  elapsed: number;
  anchorKind: string | null;
}

/** 住宿状态: 租约付到日(含)或自有 */
export interface CharacterHousing {
  propertyId: string;
  ownership: 'rent' | 'owned';
  paidThroughDay: number;
}

/** 世界运行时角色(权威状态在服务端内存;持久化衔接后置) */
export interface WorldCharacter {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 待走路径(相邻格序列,不含当前格);空=原地 */
  path: Point[];
  /** 数值系统 0~100;金币经活动增减(M3.1) */
  energy: number;
  happiness: number;
  coins: number;
  /** 进行中活动(null=空闲) */
  activity: CharacterActivity | null;
  /** 住宿状态(null=无住宿) */
  housing: CharacterHousing | null;
  /** 存活状态(false=幽灵态 M3.6f:拒绝一切意图,等待 Lab 复活) */
  alive: boolean;
  /** 随身背包(itemId→数量):买入入库,任意地点 eat_item 消耗;体积受 BACKPACK_VOLUME_LIMIT */
  backpack: Record<string, number>;
  /** 家中冰箱库存(itemId→数量):store_item/take_item 在家存取;体积受 FRIDGE_VOLUME_LIMIT */
  fridge: Record<string, number>;
  /** 繁荣分(M3.6j,goal-design §5):生涯质量账本,只增不减(死亡扣减除外) */
  lifeScore: number;
  /** 知识(M-G.4,goal-design §4.2):完成一次完整学习 +1,不衰减;岗位类别门槛(numerical §5.1) */
  knowledge: number;
  /** 特质向量 v0(social-design §4):出生随机生成,世界配置可覆盖部分维度;仅用于相性 */
  traits: TraitVector;
}

export const clampVital = (value: number): number =>
  Math.max(0, Math.min(BALANCE.VITAL_MAX, value));

/** 幽灵态拒绝一切意图(M3.6f 死亡机制) */
export function ensureAlive(character: WorldCharacter): void {
  if (!character.alive) {
    throw new Error(`${character.name} 已死亡(幽灵态),等待复活`);
  }
}

/**
 * 按速度沿路径推进 n 格(1 tick 调 1 次,tiles=速度 格/游戏分钟)。
 * 返回本步是否恰好到达终点(离散事件触发点)。
 */
export function stepMovement(character: WorldCharacter, tiles: number): boolean {
  let moved = 0;
  while (moved < tiles && character.path.length > 0) {
    const next = character.path[0];
    if (!next) break;
    character.x = next.x;
    character.y = next.y;
    character.path.shift();
    moved += 1;
  }
  return moved > 0 && character.path.length === 0;
}

/** 待机基础代谢衰减(M3.6g 净速率模型:仅无活动时调用;上限 100 供活动增益夹取) */
export function applyVitalDecay(character: WorldCharacter, gameMinutes: number): void {
  character.energy = clampVital(character.energy - BALANCE.IDLE_ENERGY_DECAY * gameMinutes);
  character.happiness = clampVital(
    character.happiness - BALANCE.IDLE_HAPPINESS_DECAY * gameMinutes,
  );
}

/** 繁荣分质量流(M3.6j):每游戏分钟按当前幸福累计,≈等效幸福天(幸福 80 活一天 ≈ +80 分) */
export function applyLifeScoreTick(character: WorldCharacter): void {
  character.lifeScore += character.happiness / BALANCE.DAY_MINUTES;
}
