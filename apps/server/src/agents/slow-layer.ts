import { getActivityDefinition, getPropertyDefinition } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import type { LlmMessage } from '../llm/types.js';
import type { WorldCharacter } from '../world/character.js';
import { retrieveMemories } from './memory-retrieval.js';
import type { MemoryLlm } from './memory-writer.js';

/** 计划块(agent-design §3.3):当日分钟区间 + 意图活动,块内由快层 rule 执行 */
export interface PlanBlock {
  /** 当日分钟(0~1440),含头不含尾 */
  startMin: number;
  endMin: number;
  activityId: string;
}

export interface DayPlan {
  day: number;
  blocks: PlanBlock[];
  /** llm=慢槽生成;fallback=模板回落(LLM 不可用/输出非法) */
  source: 'llm' | 'fallback';
}

/** 计划白名单:免门槛/无条件可直接 start_activity 的活动
 * (sleep 由执行层按夜强制,不进计划;带 category 岗位与工单须接单,不排程) */
export const PLAN_ACTIVITY_IDS = ['study', 'work', 'workout', 'stroll', 'meal', 'rest'] as const;

/** 回落模板:LLM 不可用时的通用作息(8~22 点,夜间由执行层强制回家睡) */
export const DEFAULT_PLAN_TEMPLATE: readonly PlanBlock[] = [
  { startMin: 480, endMin: 720, activityId: 'study' },
  { startMin: 720, endMin: 780, activityId: 'meal' },
  { startMin: 780, endMin: 840, activityId: 'rest' },
  { startMin: 840, endMin: 1080, activityId: 'work' },
  { startMin: 1080, endMin: 1200, activityId: 'stroll' },
  { startMin: 1200, endMin: 1320, activityId: 'rest' },
];

const EVIDENCE_LIMIT = 6;

const ACTIVITY_MENU = PLAN_ACTIVITY_IDS.map((id) => {
  const def = getActivityDefinition(id);
  return `${def?.name ?? id}(${id})`;
}).join('、');

function fallbackPlan(day: number): DayPlan {
  return { day, blocks: [...DEFAULT_PLAN_TEMPLATE], source: 'fallback' };
}

/** 慢槽输出→计划块:截取首个 JSON 数组,剔除非法行(活动不在白名单/区间越界/倒挂)。
 * 无有效行或不可解析返回 null(调用方回落模板)。 */
export function parseDayPlan(raw: string): PlanBlock[] | null {
  const match = raw.match(/\[[\s\S]*\]/);
  if (match === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const blocks: PlanBlock[] = [];
  for (const row of parsed) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const start = Number(r.start);
    const end = Number(r.end);
    const activity = r.activity;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (
      typeof activity !== 'string' ||
      !(PLAN_ACTIVITY_IDS as readonly string[]).includes(activity)
    ) {
      continue;
    }
    if (start < 0 || end > 24 || end <= start) continue;
    blocks.push({
      startMin: Math.round(start * 60),
      endMin: Math.round(end * 60),
      activityId: activity,
    });
  }
  if (blocks.length === 0) return null;
  blocks.sort((a, b) => a.startMin - b.startMin);
  return blocks;
}

/** 当前分钟落在哪个计划块(含头不含尾);空档/无计划返回 null */
export function planBlockAt(plan: DayPlan, minuteOfDay: number): PlanBlock | null {
  return plan.blocks.find((b) => b.startMin <= minuteOfDay && minuteOfDay < b.endMin) ?? null;
}

/** 计划的人类可读摘要(记忆写回/日程面板共用):「学习(08:00~12:00)、就餐(12:00~13:00)」 */
export function describePlan(plan: DayPlan): string {
  const hhmm = (m: number): string =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return plan.blocks
    .map((b) => `${getActivityDefinition(b.activityId)?.name ?? b.activityId}(${hhmm(b.startMin)}~${hhmm(b.endMin)})`)
    .join('、');
}

function housingLine(char: WorldCharacter): string {
  if (char.housing === null) return '居无定所';
  if (char.housing.ownership === 'owned') return '有自有住房';
  const name = getPropertyDefinition(char.housing.propertyId)?.name ?? char.housing.propertyId;
  return `租住${name}`;
}

function buildPlanMessages(
  char: WorldCharacter,
  evidence: string[],
  day: number,
): LlmMessage[] {
  const memoryLines = evidence.length > 0
    ? evidence.map((c) => `- ${c}`).join('\n')
    : '- (暂无记忆)';
  return [
    {
      role: 'system',
      content: `你是小镇居民「${char.name}」的内心。请根据当前状态与记忆,为今天(第 ${day} 天)安排一份务实的日程。`,
    },
    {
      role: 'user',
      content: [
        `状态: 金币 ${char.coins},体力 ${char.energy},健康 ${char.health},知识 ${char.knowledge},${housingLine(char)}。`,
        '近期记忆:',
        memoryLines,
        `可选活动: ${ACTIVITY_MENU}。`,
        '要求: 覆盖 8 点到 22 点,时间段首尾相接,每段 1~4 小时;22 点到次日 8 点是睡觉时间,无需安排;结合记忆与状态做选择(如缺钱多安排工作,知识低多学习)。',
        '只输出 JSON 数组,格式: [{"start":8,"end":12,"activity":"study"}]。',
      ].join('\n'),
    },
  ];
}

/** 记忆证据:状态摘要做语义查询,embed 失败退双因子,检索失败退空证据(绝不阻塞计划) */
async function loadEvidence(
  llm: MemoryLlm,
  handle: DbHandle,
  char: WorldCharacter,
  gameMinutes: number,
): Promise<string[]> {
  try {
    const emb = await llm.embed(
      'embedding',
      [`${char.name}的日常生活、工作与人际经历`],
      { taskType: 'agent.day_plan', characterId: char.id },
    );
    const scored = await retrieveMemories(handle, {
      characterId: char.id,
      currentGameMinutes: gameMinutes,
      queryVector: emb.vector,
      limit: EVIDENCE_LIMIT,
    });
    return scored.map((m) => m.content);
  } catch {
    return [];
  }
}

/**
 * 慢层日计划(agent-design §4.3 slow):检索记忆证据(top-6)→ slow 槽 chat
 * 生成当日作息(JSON,白名单活动)→解析失败/调用失败回落通用模板。
 * 纯生成器,不写脑状态不落库——装配与时序归调度泵(M4d-C2)。
 */
export async function planDay(
  llm: MemoryLlm,
  handle: DbHandle,
  char: WorldCharacter,
  clock: { day: number; gameMinutes: number },
): Promise<DayPlan> {
  const evidence = await loadEvidence(llm, handle, char, clock.gameMinutes);
  try {
    const result = await llm.chat(
      'slow',
      buildPlanMessages(char, evidence, clock.day),
      { taskType: 'agent.day_plan', characterId: char.id },
    );
    const blocks = parseDayPlan(result.content);
    return blocks !== null ? { day: clock.day, blocks, source: 'llm' } : fallbackPlan(clock.day);
  } catch {
    return fallbackPlan(clock.day);
  }
}
