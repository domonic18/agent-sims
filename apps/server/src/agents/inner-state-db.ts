import { and, eq, isNotNull } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { characters } from '../db/schema/agent.js';
import { logTech } from '../telemetry.js';
import { innerState } from './cognition.js';
import type { Simulation } from '../world/simulation.js';

/**
 * 统一内心状态持久化(D2):cognition.innerState 的 focus/intents/lastEvaluation
 * 写穿 characters.inner_state,重启灌回。写穿由变更方(D3 意图生成/结算)
 * 落笔后触发,fire-and-forget 不阻塞决策;关停再全量兜底一次。
 */

export function persistInnerState(handle: DbHandle, characterId: string): void {
  const saved = innerState.persistedOf(characterId);
  if (saved === null) return;
  void handle.db
    .update(characters)
    .set({ innerState: saved })
    .where(eq(characters.id, characterId))
    .catch((err: unknown) => {
      logTech('warn', 'agent', '内心状态写穿失败', {
        characterId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}

/** 关停兜底:逐角色写穿(串行量小,角色数×1 行) */
export async function flushInnerStates(handle: DbHandle, characterIds: string[]): Promise<void> {
  for (const id of characterIds) {
    const saved = innerState.persistedOf(id);
    if (saved === null) continue;
    await handle.db
      .update(characters)
      .set({ innerState: saved })
      .where(eq(characters.id, id));
  }
}

/** 启动恢复(D2):characters.inner_state 灌回脑注册表(只灌 sim 里实际存在的
 * 角色),须在存档恢复(角色就位)之后调用;残缺库值逐字段兜默认防毒化 */
export async function restoreInnerStateFromDb(
  handle: DbHandle,
  worldId: string,
  sim: Simulation,
): Promise<void> {
  const rows = await handle.db
    .select({ id: characters.id, innerState: characters.innerState })
    .from(characters)
    .where(and(eq(characters.worldId, worldId), isNotNull(characters.innerState)));
  for (const row of rows) {
    if (!sim.characters.has(row.id)) continue;
    innerState.restore(row.id, row.innerState);
  }
}
