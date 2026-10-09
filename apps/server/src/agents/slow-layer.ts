import { getActivityDefinition, getPropertyDefinition } from '@sims/shared';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { characters } from '../db/schema/index.js';
import type { LlmMessage, StructuredParse, StructuredToolSpec } from '../llm/types.js';
import { renderPrompt } from '../prompts/registry.js';
import type { WorldCharacter } from '../world/character.js';
import { retrieveMemories } from './memory-retrieval.js';
import type { CompiledPolicy, DayIntents, Want } from './cognition.js';
import type { MemoryLlm } from './memory-writer.js';

/**
 * 慢层意图生成(D3 弹性意图模型):替代刚性时间表 DayPlan——慢思考产出当日
 * 3~6 条 wants(活动+urgency+第一人称 why),执行时序交快层按数值压力实时择条,
 * 计划-实际偏差自动成为记忆素材。睡眠不进意图,由困倦压力(ruleSleepy)接管。
 */

/** 意图活动白名单:免门槛/无条件可直接 start_activity 的活动
 * (sleep 由困倦压力驱动,不进意图;带 category 岗位与工单须接单,不排程;
 * socialize 为 C4 闲聚类块,聊天本身由动机引擎驱动) */
export const INTENT_ACTIVITY_IDS = ['study', 'work', 'workout', 'stroll', 'socialize', 'explore', 'meal', 'rest'] as const;

const EVIDENCE_LIMIT = 6;

/** 意图生成上下文:方针(原文+编译缓存)/人设/昨日意图/当前关注点,均可缺省 */
export interface IntentsContext {
  policyText?: string;
  compiled?: CompiledPolicy | null;
  persona?: string;
  /** 昨日意图:注入 prompt 做对照,避免逐日复制粘贴(缺省=首日/无旧意图) */
  previous?: DayIntents | null;
  /** 当前关注点(innerState.focus,最近一次决策理由) */
  focus?: string | null;
}

/** 方针偏好工具规格(结构化输出):provider 层 schema 约束字段名与活动白名单 */
export function policyTool(): StructuredToolSpec {
  const ids = { type: 'string', enum: [...INTENT_ACTIVITY_IDS] };
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

/** 人设偏好缓存(full 托管):persona 文本为键,文本未变不重编;编译失败不缓存(次日意图再试) */
const personaPolicies = new Map<string, { key: string; compiled: CompiledPolicy }>();

/** 人设偏好编译(slow 槽):人格卡→活动偏好集,full 托管(无玩家方针)时提供差异化意图倾向。
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
      ? value.filter((id): id is string => typeof id === 'string' && (INTENT_ACTIVITY_IDS as readonly string[]).includes(id))
      : [];
  return { ok: true, value: { focus: pick(record.focus), avoid: pick(record.avoid) } };
}

/** 编译偏好→活动倾向分(D3 评分用):focus=+1,avoid=-1(avoid 压过 focus),
 * 未提及的活动缺 0(中性);快层 wantSelect 与 fallbackIntents 共用同一口径 */
export function biasOf(compiled: CompiledPolicy | null | undefined): Record<string, number> {
  const bias: Record<string, number> = {};
  if (compiled === null || compiled === undefined) return bias;
  for (const id of compiled.focus) bias[id] = 1;
  for (const id of compiled.avoid) bias[id] = -1;
  return bias;
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

const ACTIVITY_MENU = INTENT_ACTIVITY_IDS.map((id) => {
  const def = getActivityDefinition(id);
  return `${def?.name ?? id}(${id})`;
}).join('、');

/** want 状态的人类可读标签(昨日对照/面板共用) */
export const WANT_STATUS_LABEL: Record<Want['status'], string> = {
  pending: '未做',
  doing: '进行中',
  done: '已完成',
  abandoned: '放弃了',
};

/** 意图集人类可读摘要:「工作(已完成):挣钱;学习(未做):想学新东西」 */
export function describeIntents(intents: DayIntents): string {
  return intents.wants
    .map((w) => {
      const name = getActivityDefinition(w.activityId)?.name ?? w.activityId;
      return `${name}(${WANT_STATUS_LABEL[w.status]}): ${w.why}`;
    })
    .join(';');
}

/** 意图工具规格(结构化输出):activity 白名单,urgency 0~1,why 一句第一人称理由 */
function intentsTool(): StructuredToolSpec {
  return {
    name: 'submit_day_intents',
    description: '提交今天真正想做的几件事(3~6 条,不必覆盖全天)',
    inputSchema: {
      type: 'object',
      required: ['wants'],
      properties: {
        wants: {
          type: 'array',
          items: {
            type: 'object',
            required: ['activity', 'urgency', 'why'],
            properties: {
              activity: { type: 'string', enum: [...INTENT_ACTIVITY_IDS] },
              urgency: { type: 'number', minimum: 0, maximum: 1 },
              why: { type: 'string' },
            },
          },
        },
      },
    },
  };
}

/** 工具入参→wants:入参为 {wants:[...]}(chatStructured 交付整个工具入参对象);
 * 剔除非法行(活动不在白名单/urgency 非数字),urgency 截断到 0~1,why 缺省兜「随性而为」;
 * wants 缺失非数组或无有效行判失败(触发带错重试,调用方回落 fallback)。 */
export function parseIntents(raw: unknown, day: number, nowMin: number): StructuredParse<Want[]> {
  const rows =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { wants?: unknown }).wants)
      ? (raw as { wants: unknown[] }).wants
      : null;
  if (rows === null) {
    return { ok: false, reason: 'wants 须为意图的 JSON 数组' };
  }
  const wants: Want[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const activity = r.activity;
    if (typeof activity !== 'string' || !(INTENT_ACTIVITY_IDS as readonly string[]).includes(activity)) continue;
    const urgency = Number(r.urgency);
    if (!Number.isFinite(urgency)) continue;
    const why = typeof r.why === 'string' && r.why.trim() !== '' ? r.why.trim() : '随性而为';
    wants.push({
      id: `w${day}-${wants.length}`,
      activityId: activity,
      why,
      urgency: Math.min(1, Math.max(0, urgency)),
      status: 'pending',
      createdAtMin: nowMin,
    });
  }
  if (wants.length === 0) {
    return { ok: false, reason: '无合法意图(activity 须在可选活动内,urgency 须为 0~1 数字)' };
  }
  return { ok: true, value: wants };
}

/** fallback 意图的 why 池:按活动给第一人称措辞,消灭「同款模板」 */
const FALLBACK_WHY: Record<string, readonly string[]> = {
  study: ['脑子里墨水不够了', '想学点新东西', '静下心读读书挺踏实'],
  work: ['口袋空着心里发慌', '总得挣点金币', '闲太久不是办法'],
  workout: ['出出汗整个人都通了', '身体是本钱', '想活动活动筋骨'],
  stroll: ['出去走走透透气', '天气不错正适合遛弯', '漫无目的逛逛说不定有惊喜'],
  socialize: ['找个人说说话', '凑凑热闹', '人多的地方有人气'],
  explore: ['镇上还有没去过的地方', '想去没走过的角落看看', '好奇心又犯了'],
  meal: ['嘴里有点馋', '肚子在抗议了', '该犒劳一下自己'],
  rest: ['累了歇会儿', '发会儿呆也好', '想慢下来喘口气'],
};

/** 回落意图(LLM 不可用/输出非法):按 bias 分+随机扰动排序取 3~4 条,
 * avoid(bias=-1)活动绝不出现;urgency 随倾向分浮动——个性化替代同款模板 */
export function fallbackIntents(day: number, nowMin: number, bias: Readonly<Record<string, number>>): Want[] {
  const candidates = INTENT_ACTIVITY_IDS
    .filter((id) => (bias[id] ?? 0) > -1)
    .map((id) => ({ id, score: (bias[id] ?? 0) + Math.random() * 0.8 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3 + Math.floor(Math.random() * 2));
  return candidates.map((c, i) => {
    const whys = FALLBACK_WHY[c.id] ?? ['随性而为'];
    return {
      id: `w${day}-f${i}`,
      activityId: c.id,
      why: whys[Math.floor(Math.random() * whys.length)]!,
      urgency: Math.round(Math.min(0.9, Math.max(0.2, 0.4 + c.score * 0.3)) * 100) / 100,
      status: 'pending' as const,
      createdAtMin: nowMin,
    };
  });
}

function housingLine(char: WorldCharacter): string {
  if (char.housing === null) return '居无定所';
  if (char.housing.ownership === 'owned') return '有自有住房';
  const name = getPropertyDefinition(char.housing.propertyId)?.name ?? char.housing.propertyId;
  return `租住${name}`;
}

function buildIntentsMessages(
  char: WorldCharacter,
  evidence: string[],
  day: number,
  ctx?: IntentsContext,
): LlmMessage[] {
  const memoryLines = evidence.length > 0
    ? evidence.map((c) => `- ${c}`).join('\n')
    : '- (暂无记忆)';
  const contextLines: string[] = [];
  if (ctx?.previous !== null && ctx?.previous !== undefined) {
    contextLines.push(
      `你昨天想做的事: ${describeIntents(ctx.previous)}——今天不必照搬,结合昨天的完成情况调整。`,
    );
  }
  if (typeof ctx?.focus === 'string' && ctx.focus.trim() !== '') {
    contextLines.push(`你眼下最挂在心上的事: ${ctx.focus.trim()}。`);
  }
  if (typeof ctx?.policyText === 'string' && ctx.policyText.trim() !== '') {
    contextLines.push(`玩家给你的生活方针: ${ctx.policyText.trim()}`);
  }
  if (ctx?.compiled !== null && ctx?.compiled !== undefined) {
    // compiled 来源两途:玩家方针编译,或 full 托管下的人设偏好
    const basis = typeof ctx.policyText === 'string' && ctx.policyText.trim() !== '' ? '方针' : '人设';
    if (ctx.compiled.avoid.length > 0) {
      contextLines.push(`以下活动被${basis}明确排斥,不要提: ${ctx.compiled.avoid.join('、')}。`);
    }
    if (ctx.compiled.focus.length > 0) {
      contextLines.push(`以下活动是${basis}重点,优先考虑: ${ctx.compiled.focus.join('、')}。`);
    }
  }
  return [
    {
      role: 'system',
      content: renderPrompt('intents.system', {
        name: char.name,
        day,
        persona_line:
          typeof ctx?.persona === 'string' && ctx.persona.trim() !== ''
            ? `你的人设: ${ctx.persona.trim()}`
            : '',
      }),
    },
    {
      role: 'user',
      content: renderPrompt('intents.user', {
        status_line: `状态: 金币 ${char.coins},体力 ${char.energy},健康 ${char.health},知识 ${char.knowledge},${housingLine(char)}。`,
        context_lines: contextLines.join('\n'),
        memory_lines: memoryLines,
        activity_menu: ACTIVITY_MENU,
        submit_line: '请调用 submit_day_intents 工具提交今天想做的事。',
      }),
    },
  ];
}

/** 记忆证据:状态摘要做语义查询,embed 失败退双因子,检索失败退空证据(绝不阻塞意图) */
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
      { taskType: 'agent.day_intents', characterId: char.id },
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

/** 慢层意图生成产物:当日意图集 + 活动倾向分(快层评分/fallback 口径)+
 * 本轮生效的编译偏好(调度泵回填托管缓存) */
export interface ComposedIntents {
  intents: DayIntents;
  bias: Record<string, number>;
  compiled: CompiledPolicy | null;
}

/**
 * 慢层意图生成(D3,agent-design §4.3 slow):检索记忆证据(top-6)→ slow 槽 chat
 * 生成当日 wants(activity/urgency/why)→解析失败/调用失败回落个性化 fallback。
 * avoid(bias=-1)对 LLM 输出硬过滤,全滤空退 fallback。纯生成器,不写脑状态不落库——
 * 装配与时序归调度泵(M4d-C2)。full 托管(无玩家方针)有人设时,先经慢槽编译
 * 人格偏好(按 persona 文本缓存)注入。
 */
export async function composeIntents(
  llm: MemoryLlm,
  handle: DbHandle,
  char: WorldCharacter,
  clock: { day: number; gameMinutes: number },
  ctx?: IntentsContext,
): Promise<ComposedIntents> {
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
  const bias = biasOf(compiled);
  try {
    const wants = await llm.chatStructured(
      'slow',
      buildIntentsMessages(char, evidence, clock.day, { ...ctx, compiled }),
      intentsTool(),
      { taskType: 'agent.day_intents', characterId: char.id, temperature: 0.9 },
      (raw) => parseIntents(raw, clock.day, clock.gameMinutes),
    );
    const kept = wants.filter((w) => (bias[w.activityId] ?? 0) > -1);
    return {
      intents: {
        day: clock.day,
        wants: kept.length > 0 ? kept : fallbackIntents(clock.day, clock.gameMinutes, bias),
        source: kept.length > 0 ? 'llm' : 'fallback',
      },
      bias,
      compiled,
    };
  } catch {
    return {
      intents: { day: clock.day, wants: fallbackIntents(clock.day, clock.gameMinutes, bias), source: 'fallback' },
      bias,
      compiled,
    };
  }
}
