import { z } from 'zod';

/** 意图指令集(arch §5):玩家输入与 Agent 规划器共用的同一指令层 */

export const INTENT_TYPES = ['move_to'] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

export const moveToIntentSchema = z.object({
  type: z.literal('move_to'),
  characterId: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
});

export type MoveToIntent = z.infer<typeof moveToIntentSchema>;

export const intentSchema = z.discriminatedUnion('type', [moveToIntentSchema]);

export type Intent = z.infer<typeof intentSchema>;
