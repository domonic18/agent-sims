import { getActivityDefinition, getPropertyDefinition } from '@sims/shared';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { characters } from '../db/schema/index.js';
import type { LlmMessage } from '../llm/types.js';
import type { WorldCharacter } from '../world/character.js';
import { retrieveMemories } from './memory-retrieval.js';
import type { CompiledPolicy } from './cognition.js';
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

/** 计划生成上下文(M4e):生活方针(原文+编译缓存)与人设卡,均可缺省 */
export interface PlanContext {
  policyText?: string;
  compiled?: CompiledPolicy | null;
  persona?: string;
}

/** 方针编译(slow 槽):文本→白名单活动偏好集;解析失败/调用失败返回 null,
 * 调用方回落「只用原文」(方针缓存,文本变更才重编译,agent-design §4.5) */
export async function compilePolicy(
  llm: MemoryLlm,
  text: string,
): Promise<CompiledPolicy | null> {
  try {
    const result = await llm.chat(
      'slow',
      [
        {
          role: 'system',
          content: '你把玩家的生活方针编译为结构化活动偏好。只输出 JSON,不要解释。',
        },
        {
          role: 'user',
          content: [
            `生活方针: ${text}`,
            `可选活动: ${ACTIVITY_MENU}。`,
            '只输出 JSON 对象: {"focus":["activityId",...],"avoid":["activityId",...]}。',
            'focus=方针鼓励的活动,avoid=方针排斥的活动;都可为空数组,只准用可选活动里的 id。',
          ].join('\n'),
        },
      ],
      { taskType: 'agent.policy_compile' },
    );
    return parsePolicy(result.content);
  } catch {
    return null;
  }
}

/** 慢槽输出→方针偏好:截取首个 JSON 对象,活动逐个过白名单,非字符串丢弃 */
export function parsePolicy(raw: string): CompiledPolicy | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const pick = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && (PLAN_ACTIVITY_IDS as readonly string[]).includes(id))
      : [];
  return { focus: pick(record.focus), avoid: pick(record.avoid) };
}

/** 人设卡上下文:读 characters.persona 拼人设段;无卡/查询失败返回 undefined(静默降级) */
export async function loadPersonaContext(
  handle: DbHandle,
  characterId: string,
): Promise<string | undefined> {
  try {
    const rows = await handle.db
      .select({ persona: characters.persona })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    const persona = rows[0]?.persona;
    if (typeof persona !== 'object' || persona === null) return undefined;
    const record = persona as Record<string, unknown>;
    const card = typeof record.card === 'object' && record.card !== null
      ? (record.card as Record<string, unknown>)
      : null;
    const parts: string[] = [];
    if (typeof record.bio === 'string' && record.bio.trim() !== '') parts.push(record.bio.trim());
    if (card !== null) {
      const fields = ['性格', '兴趣', '目标', '说话风格'] as const;
      for (const field of fields) {
        const value = card[field];
        if (typeof value === 'string' && value.trim() !== '') parts.push(`${field}: ${value.trim()}`);
      }
    }
    return parts.length > 0 ? parts.join(';') : undefined;
  } catch {
    return undefined;
  }
}

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
  ctx?: PlanContext,
): LlmMessage[] {
  const memoryLines = evidence.length > 0
    ? evidence.map((c) => `- ${c}`).join('\n')
    : '- (暂无记忆)';
  const contextLines: string[] = [];
  if (typeof ctx?.persona === 'string' && ctx.persona.trim() !== '') {
    contextLines.push(`你的人设: ${ctx.persona.trim()}——日程安排要符合这个人设。`);
  }
  if (typeof ctx?.policyText === 'string' && ctx.policyText.trim() !== '') {
    contextLines.push(`玩家给你的生活方针: ${ctx.policyText.trim()}`);
    if (ctx.compiled !== null && ctx.compiled !== undefined) {
      if (ctx.compiled.avoid.length > 0) {
        contextLines.push(`以下活动被方针明确排斥,禁止安排: ${ctx.compiled.avoid.join('、')}。`);
      }
      if (ctx.compiled.focus.length > 0) {
        contextLines.push(`以下活动是方针重点: ${ctx.compiled.focus.join('、')},请优先安排。`);
      }
    }
  }
  return [
    {
      role: 'system',
      content: `你是小镇居民「${char.name}」的内心。请根据当前状态与记忆,为今天(第 ${day} 天)安排一份务实的日程。`,
    },
    {
      role: 'user',
      content: [
        `状态: 金币 ${char.coins},体力 ${char.energy},健康 ${char.health},知识 ${char.knowledge},${housingLine(char)}。`,
        ...contextLines,
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

/** 方针硬过滤:剔除 avoid 块,首尾空档不回填(快层空档自然空闲);全滤空回落模板 */
function applyAvoid(blocks: PlanBlock[], avoid: readonly string[]): PlanBlock[] {
  if (avoid.length === 0) return blocks;
  return blocks.filter((b) => !avoid.includes(b.activityId));
}

/**
 * 慢层日计划(agent-design §4.3 slow):检索记忆证据(top-6)→ slow 槽 chat
 * 生成当日作息(JSON,白名单活动)→解析失败/调用失败回落通用模板。
 * M4e: ctx 注入方针(原文+编译缓存)与人设;avoid 对 LLM 输出与回落模板都硬过滤。
 * 纯生成器,不写脑状态不落库——装配与时序归调度泵(M4d-C2)。
 */
export async function planDay(
  llm: MemoryLlm,
  handle: DbHandle,
  char: WorldCharacter,
  clock: { day: number; gameMinutes: number },
  ctx?: PlanContext,
): Promise<DayPlan> {
  const evidence = await loadEvidence(llm, handle, char, clock.gameMinutes);
  const avoid = ctx?.compiled?.avoid ?? [];
  try {
    const result = await llm.chat(
      'slow',
      buildPlanMessages(char, evidence, clock.day, ctx),
      { taskType: 'agent.day_plan', characterId: char.id },
    );
    const blocks = parseDayPlan(result.content);
    if (blocks !== null) {
      const kept = applyAvoid(blocks, avoid);
      return kept.length > 0
        ? { day: clock.day, blocks: kept, source: 'llm' }
        : applyAvoidFallback(clock.day, avoid);
    }
    return applyAvoidFallback(clock.day, avoid);
  } catch {
    return applyAvoidFallback(clock.day, avoid);
  }
}

/** 回落模板同样过滤 avoid;全滤空=空计划(方针硬保证优先,角色当日空闲) */
function applyAvoidFallback(day: number, avoid: readonly string[]): DayPlan {
  const plan = fallbackPlan(day);
  return { day, blocks: applyAvoid(plan.blocks, avoid), source: 'fallback' };
}
