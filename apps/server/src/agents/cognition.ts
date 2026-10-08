import type { DayPlan } from './slow-layer.js';

/**
 * 脑状态(agent-design §3.2):角色"脑内"的东西存本模块内存结构,
 * 不进 WorldCharacter——世界侧角色只保留模拟必需的数值/位置/库存。
 * M4c 自治开关;M4d 日程计划;M4e 托管状态(含方针缓存)。
 */

/** 方针编译产物(agent-design §4.5 Talker-Reasoner):慢思考把方针文本编译为
 * 计划层可校验的白名单活动集;编译失败为 null(只用原文) */
export interface CompiledPolicy {
  focus: string[];
  avoid: string[];
}

/** 托管状态(M4e):full=Agent 完全自主;policy=生活方针约束(原文+编译缓存)。
 * 托管即「指令来源=Agent」:泵驱动角色+玩家意图被网关拒收,世界状态零触碰 */
export interface HostingState {
  mode: 'full' | 'policy';
  policyText: string | null;
  compiled: CompiledPolicy | null;
}

/** 托管注册表:单一事实源,autonomy 是它的全托管视图(兼容 M4c 开关语义) */
const hosted = new Map<string, HostingState>();

export const hosting = {
  set(characterId: string, state: HostingState): void {
    hosted.set(characterId, state);
  },
  get(characterId: string): HostingState | undefined {
    return hosted.get(characterId);
  },
  delete(characterId: string): void {
    hosted.delete(characterId);
  },
  has(characterId: string): boolean {
    return hosted.has(characterId);
  },
};

/** 自治角色注册表(M4c 语义保留):=托管中的角色,泵只处理这些角色 */
export const autonomy = {
  enable(characterId: string): void {
    if (hosted.has(characterId)) return;
    hosted.set(characterId, { mode: 'full', policyText: null, compiled: null });
  },
  disable(characterId: string): void {
    hosted.delete(characterId);
  },
  has(characterId: string): boolean {
    return hosted.has(characterId);
  },
  list(): string[] {
    return [...hosted.keys()];
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
