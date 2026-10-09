import { getActivityDefinition, getPropertyDefinition } from '@sims/shared';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { characters } from '../db/schema/index.js';
import type { LlmMessage, StructuredParse, StructuredToolSpec } from '../llm/types.js';
import { renderPrompt } from '../prompts/registry.js';
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
 * (sleep 由执行层按夜强制,不进计划;带 category 岗位与工单须接单,不排程;
 * socialize 为 C4 闲聚类块,聊天本身由动机引擎驱动) */
export const PLAN_ACTIVITY_IDS = ['study', 'work', 'workout', 'stroll', 'socialize', 'explore', 'meal', 'rest'] as const;

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

/** 每日随机抽一条的风味提示:给计划注入变化方向,避免逐日雷同(执行器与校验链兜底,提示只影响倾向) */
const PLAN_FLAVORS: readonly string[] = [
  '今天至少安排一段平时不常做的活动,给日子添点新意',
  '今天可以去个平时少去的地方走走,公园/餐馆/商店/健身房都行',
  '状态允许的话留一段轻松随性的时间,别把日程排太满',
  '结合你的兴趣,今天安排一点你真正喜欢的小事',
  '昨天怎么过的今天不必照搬,按今天的心情微调时段',
];

function pickFlavor(): string {
  return PLAN_FLAVORS[Math.floor(Math.random() * PLAN_FLAVORS.length)]!;
}

/** 计划生成上下文(M4e):生活方针(原文+编译缓存)与人设卡,均可缺省
 * (full 托管无玩家方针时,planDay 会从人设自动编译 focus/avoid 偏好并缓存) */
export interface PlanContext {
  policyText?: string;
  compiled?: CompiledPolicy | null;
  persona?: string;
  /** 昨日计划:注入 prompt 做对照,避免逐日复制粘贴(缺省=首日/无旧计划) */
  previous?: DayPlan | null;
}

/** 方针偏好工具规格(结构化输出):provider 层 schema 约束字段名与活动白名单 */
export function policyTool(): StructuredToolSpec {
  const ids = { type: 'string', enum: [...PLAN_ACTIVITY_IDS] };
  return {
    name: 'submit_policy',
    description: '提交活动偏好编译结果(focus=鼓励,avoid=排斥)',
    inputSchema: {
      type: 'object',
      required: ['focus', 'avoid'],
      properties: { focus: { type: 'array', items: ids }, avoid: { type: 'array', items: ids } },
    },
  };
}

/** 方针编译(slow 槽):文本→白名单活动偏好集;调用/校验失败(两次)返回 null,
 * 调用方回落「只用原文」(方针缓存,文本变更才重编译,agent-design §4.5) */
export async function compilePolicy(
  llm: MemoryLlm,
  text: string,
): Promise<CompiledPolicy | null> {
  try {
    return await llm.chatStructured(
      'slow',
      [
        { role: 'system', content: renderPrompt('policy.compile.system') },
        {
          role: 'user',
          content: renderPrompt('policy.compile.user', {
            policy_text: text,
            activity_menu: ACTIVITY_MENU,
            rule_line: 'focus=方针鼓励的活动,avoid=方针排斥的活动;都可为空数组,只准用可选活动里的 id。',
            submit_line: '请调用 submit_policy 工具提交编译结果。',
          }),
        },
      ],
      policyTool(),
      { taskType: 'agent.policy_compile' },
      parsePolicy,
    );
  } catch {
    return null;
  }
}

/** 人设偏好缓存(full 托管):persona 文本为键,文本未变不重编;编译失败不缓存(次日计划再试) */
const personaPolicies = new Map<string, { key: string; compiled: CompiledPolicy }>();

/** 人设偏好编译(slow 槽):人格卡→活动偏好集,full 托管(无玩家方针)时提供差异化计划倾向。
 * 调用/校验失败返回 null(当天只用原文人设,不缓存) */
export async function compilePersonaPolicy(
  llm: MemoryLlm,
  persona: string,
  characterId?: string,
): Promise<CompiledPolicy | null> {
  try {
    return await llm.chatStructured(
      'slow',
      [
        { role: 'system', content: renderPrompt('persona.policy.system') },
        {
          role: 'user',
          content: renderPrompt('persona.policy.user', {
            persona,
            activity_menu: ACTIVITY_MENU,
            rule_line: 'focus=这个人设会喜欢/常做的活动,avoid=这个人设不爱做/会回避的活动;都可为空数组,只准用可选活动里的 id,没有把握就留空。',
            submit_line: '请调用 submit_policy 工具提交编译结果。',
          }),
        },
      ],
      policyTool(),
      { taskType: 'agent.persona_policy', characterId },
      parsePolicy,
    );
  } catch {
    return null;
  }
}

/** 工具入参→方针偏好:活动逐个过白名单,非字符串丢弃(宽松);整体非对象判失败(触发带错重试) */
export function parsePolicy(raw: unknown): StructuredParse<CompiledPolicy> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: '输出须为 JSON 对象' };
  }
  const record = raw as Record<string, unknown>;
  const pick = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && (PLAN_ACTIVITY_IDS as readonly string[]).includes(id))
      : [];
  return { ok: true, value: { focus: pick(record.focus), avoid: pick(record.avoid) } };
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
    // L4 自我叙事(C5)已初始化时顶替 bio 位置;未初始化维持 bio 回落
    const narrative = record.selfNarrative;
    const narrativeText =
      narrative !== null && typeof narrative === 'object'
        ? (narrative as Record<string, unknown>).text
        : undefined;
    if (typeof narrativeText === 'string' && narrativeText.trim() !== '') {
      parts.push(narrativeText.trim());
    } else if (typeof record.bio === 'string' && record.bio.trim() !== '') {
      parts.push(record.bio.trim());
    }
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

/** 日计划工具规格(结构化输出):start/end 为小时(0~24),activity 白名单 */
function dayPlanTool(): StructuredToolSpec {
  const hour = { type: 'number', minimum: 0, maximum: 24 };
  return {
    name: 'submit_day_plan',
    description: '提交当日日程(blocks 时间段首尾相接)',
    inputSchema: {
      type: 'object',
      required: ['blocks'],
      properties: {
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['start', 'end', 'activity'],
            properties: { start: hour, end: hour, activity: { type: 'string', enum: [...PLAN_ACTIVITY_IDS] } },
          },
        },
      },
    },
  };
}

/** 工具入参→计划块:剔除非法行(活动不在白名单/区间越界/倒挂),按 start 排序;
 * 非数组或无有效行判失败(触发带错重试,调用方回落模板)。 */
export function parseDayPlan(raw: unknown): StructuredParse<PlanBlock[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: '输出须为 JSON 数组(blocks)' };
  }
  const blocks: PlanBlock[] = [];
  for (const row of raw) {
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
  if (blocks.length === 0) {
    return { ok: false, reason: '无合法计划块(start/end 须 0~24 且 end>start,activity 须在可选活动内)' };
  }
  blocks.sort((a, b) => a.startMin - b.startMin);
  return { ok: true, value: blocks };
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
  if (ctx?.previous !== null && ctx?.previous !== undefined) {
    contextLines.push(
      `你昨天的安排: ${describePlan(ctx.previous)}——今天别照搬,至少有 1~2 个时间段与昨天不同。`,
    );
  }
  contextLines.push(`今日风味提示: ${pickFlavor()}。`);
  if (typeof ctx?.policyText === 'string' && ctx.policyText.trim() !== '') {
    contextLines.push(`玩家给你的生活方针: ${ctx.policyText.trim()}`);
  }
  if (ctx?.compiled !== null && ctx?.compiled !== undefined) {
    // compiled 来源两途:玩家方针编译,或 full 托管下的人设偏好
    const basis = typeof ctx.policyText === 'string' && ctx.policyText.trim() !== '' ? '方针' : '人设';
    if (ctx.compiled.avoid.length > 0) {
      contextLines.push(`以下活动被${basis}明确排斥,禁止安排: ${ctx.compiled.avoid.join('、')}。`);
    }
    if (ctx.compiled.focus.length > 0) {
      contextLines.push(`以下活动是${basis}重点: ${ctx.compiled.focus.join('、')},请优先安排。`);
    }
  }
  return [
    {
      role: 'system',
      content: renderPrompt('plan.system', { name: char.name, day }),
    },
    {
      role: 'user',
      content: renderPrompt('plan.user', {
        status_line: `状态: 金币 ${char.coins},体力 ${char.energy},健康 ${char.health},知识 ${char.knowledge},${housingLine(char)}。`,
        context_lines: contextLines.join('\n'),
        memory_lines: memoryLines,
        activity_menu: ACTIVITY_MENU,
        submit_line: '请调用 submit_day_plan 工具提交今天的日程(start/end 用小时)。',
      }),
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
 * full 托管(无玩家方针)有人设时,先经慢槽编译人格偏好(按 persona 文本缓存)注入。
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
  let compiled = ctx?.compiled ?? null;
  if (compiled === null && (ctx?.policyText === undefined || ctx.policyText.trim() === '')) {
    const persona = ctx?.persona;
    if (typeof persona === 'string' && persona.trim() !== '') {
      const cached = personaPolicies.get(char.id);
      compiled = cached !== undefined && cached.key === persona
        ? cached.compiled
        : await compilePersonaPolicy(llm, persona, char.id);
      if (compiled !== null) personaPolicies.set(char.id, { key: persona, compiled });
    }
  }
  const avoid = compiled?.avoid ?? [];
  try {
    const blocks = await llm.chatStructured(
      'slow',
      buildPlanMessages(char, evidence, clock.day, { ...ctx, compiled }),
      dayPlanTool(),
      { taskType: 'agent.day_plan', characterId: char.id, temperature: 0.9 },
      parseDayPlan,
    );
    const kept = applyAvoid(blocks, avoid);
    return kept.length > 0
      ? { day: clock.day, blocks: kept, source: 'llm' }
      : applyAvoidFallback(clock.day, avoid);
  } catch {
    return applyAvoidFallback(clock.day, avoid);
  }
}

/** 回落模板同样过滤 avoid;全滤空=空计划(方针硬保证优先,角色当日空闲) */
function applyAvoidFallback(day: number, avoid: readonly string[]): DayPlan {
  const plan = fallbackPlan(day);
  return { day, blocks: applyAvoid(plan.blocks, avoid), source: 'fallback' };
}
