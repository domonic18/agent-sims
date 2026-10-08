/**
 * 脑状态(agent-design §3.2):角色"脑内"的东西存本模块内存结构,
 * 不进 WorldCharacter——世界侧角色只保留模拟必需的数值/位置/库存。
 * M4c 只有自治开关;计划块/方针缓存等随 M4d 扩展。
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
