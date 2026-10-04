import { tokenUsage } from '../db/schema/index.js';
import type { DbHandle } from '../db/client.js';
import type { ModelSlot } from '@sims/shared';

export interface TokenUsageEntry {
  slot: ModelSlot;
  characterId?: string | null;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
}

/** 每次模型调用一行流水(cost 留 0,价格表落 M4f 成本面板再接) */
export async function recordTokenUsage(
  handle: DbHandle,
  entry: TokenUsageEntry,
): Promise<void> {
  await handle.db.insert(tokenUsage).values({
    slot: entry.slot,
    characterId: entry.characterId ?? null,
    taskType: entry.taskType,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    cost: '0',
  });
}
