import type { DayPlan } from './slow-layer.js';

/**
 * 脑状态(agent-design §3.2):角色"脑内"的东西存本模块内存结构,
 * 不进 WorldCharacter——世界侧角色只保留模拟必需的数值/位置/库存。
 * M4c 自治开关;M4d 日程计划;方针缓存等随 M4e 扩展。
 */
const autonomousIds = new Set<string>();

/** 自治角色注册表:泵只处理显式开启自治的角色(M4e 才有正式托管切换,
 * 期间默认全关,避免泵接管玩家角色) */
export const autonomy = {
  enable(characterId: string): void {
    autonomousIds.add(characterId);
  },
  disable(characterId: string): void {
    autonomousIds.delete(characterId);
  },
  has(characterId: string): boolean {
    return autonomousIds.has(characterId);
  },
  list(): string[] {
    return [...autonomousIds];
  },
};

/** 日程脑状态(M4d 慢层):characterId→当日计划;重规划/角色移除时清 */
const plans = new Map<string, DayPlan>();

export const schedule = {
  set(characterId: string, plan: DayPlan): void {
    plans.set(characterId, plan);
  },
  get(characterId: string): DayPlan | undefined {
    return plans.get(characterId);
  },
  clear(characterId: string): void {
    plans.delete(characterId);
  },
};
