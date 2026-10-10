/**
 * 当前活跃世界 id(观测性):Simulation 是进程单例,同一时刻至多一个活跃世界,
 * 但 Simulation 本身不持有 worlds 表 UUID。建世界/恢复读档时写入,落库侧
 * (trace/world_events/token_usage)各取一次完成归属标注。进程内可变、无需锁。
 */
let currentWorldId: string | null = null;

export function setWorldId(worldId: string | null): void {
  currentWorldId = worldId;
}

export function getWorldId(): string | null {
  return currentWorldId;
}
