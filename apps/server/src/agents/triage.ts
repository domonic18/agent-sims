import {
  getActivityDefinition,
  type Intent,
  type WorldEvent,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { PERCEPTION_RADIUS, eventSubjects } from './perception.js';

/**
 * 事件分级门(10-cognition §7.1,C3):感知与决策之间的 triage 管道——
 * ①相关性门(主体是我/熟人/发生在附近)→ ②强度门(importance≥6 才可能打断)
 * → ③可打断性(活动声明容忍度)→ ④分级处置。①②③④全规则零模型,
 * 只有歧义案(忙碌+可打断+注册了响应)进入 ⑤中断评估(LLM 一词判定,预算护栏内)。
 * 纯函数:预算快照由调用方传入,簿记(计数/冷却/去重)归 scheduler。
 */

export type TriageDisposition =
  | 'ignore' // 不惊动任何判定层(含预算耗尽/冷却/重复评估)
  | 'idle' // 空闲角色+相关事件:放行既有 rule→plan→jev 管线
  | 'respond' // 注册表有明确响应,直接执行(instant 不打断;move 打断当前块)
  | 'assess' // 歧义案:⑤中断评估(预算内 systemOne)
  | 'defer'; // 当前活动不可打断:排「事后处理」,空闲且新鲜时补执行

/** 响应动作(注册表产出):instant=即时反应(chat,不打断活动);move=移动响应(打断活动) */
export interface ResponseAction {
  kind: 'instant' | 'move';
  /** 动作描述(⑤ criteria 与决策气泡用),如「过去看看苏晚」 */
  label: string;
  /** 事件语义中文(⑤ 题面用),如「苏晚倒下了,情况危急」 */
  semantic: string;
  /** 响应指向的对象(证据检索:对 TA 的印象/相关洞察);无主体响应可缺省 */
  subjectId?: string;
  intent: Intent;
}

export interface TriageVerdict {
  disposition: TriageDisposition;
  /** 命中关卡(可审计:trace 可答「为何理会/不理会」) */
  gate: string;
  importance: number;
  relevance: 'self' | 'near' | 'none';
  /** 事件唯一键(type+主体+tick),⑤ 去重防同一事件重复评估 */
  eventKey: string;
  action?: ResponseAction;
}

/** 分级上下文:调用方从 sim/char 现场拼装,triage 保持纯函数 */
export interface TriageContext {
  characterId: string;
  x: number;
  y: number;
  alive: boolean;
  collapsed: boolean;
  /** 进行中活动 id(空闲为 null);容忍度查活动定义(缺省 high) */
  activityId: string | null;
  onPath: boolean;
  positionOf(id: string): { x: number; y: number } | null;
  isAcquaintance(id: string): boolean;
  nameOf(id: string): string;
  /** 预算快照(scheduler 簿记的只读视图;day 非当日视为零消耗) */
  budget: {
    day: number;
    assessedToday: number;
    lastAssessAt: number;
    assessedKeys: ReadonlySet<string>;
  };
  nowGameMinutes: number;
  gameDay: number;
}

/** 响应注册表查询(triage 与注册表解耦,避免循环依赖;实现在 responses.ts) */
export type ResponseResolver = (
  event: WorldEvent,
  ctx: TriageContext,
) => ResponseAction | null;

/** 非叙事事件(控制/参数/规则/配方/重置/托管切换/睡眠结算)不进分级——
 * 连 trace 都不惊动;睡眠结算由固化器消费,hosting/控制属管理面 */
export function isTriagedEvent(event: WorldEvent): boolean {
  switch (event.type) {
    case 'world.control':
    case 'world.params':
    case 'world.rules':
    case 'world.recipes':
    case 'world.reset':
    case 'character.hosting_changed':
    case 'sleep.settled':
      return false;
    default:
      return true;
  }
}

/** 零模型事件强度表(10-cognition §7.1 ②):按视角取值;
 * near 档 <3 视为环境噪音(相关性门直接忽略,如路人走动) */
const EVENT_STRENGTH: Partial<
  Record<WorldEvent['type'], { self: number | null; near: number }>
> = {
  'character.died': { self: 9, near: 8 },
  'character.revived': { self: 7, near: 4 },
  'character.auto_revived': { self: 5, near: 3 },
  'friendship.formed': { self: 6, near: 3 },
  'first.met': { self: 4, near: 2 },
  'social.chat': { self: 4, near: 2 },
  'activity.started': { self: 2, near: 0 },
  'activity.finished': { self: 2, near: 0 },
  'work_task.accepted': { self: 2, near: 0 },
  'work_task.cancelled': { self: 4, near: 0 },
  'work_task.completed': { self: 3, near: 2 },
  'craft.completed': { self: 3, near: 0 },
  'maintenance.spawned': { self: null, near: 2 },
  'sleep.debt_applied': { self: 4, near: 0 },
  'character.arrived': { self: 3, near: 0 }, // E2: 到达重燃空闲管线(走近社交/继续择 want),忙时不打断(g2)
};

/** ①相关性门:主体是我 / 涉及我的熟人 / 主体发生在感知半径内 */
function relevanceOf(event: WorldEvent, ctx: TriageContext): 'self' | 'near' | 'none' {
  const subjects = eventSubjects(event);
  if (subjects.length === 0) return 'none';
  if (subjects.includes(ctx.characterId)) return 'self';
  if (subjects.some((id) => ctx.isAcquaintance(id))) return 'near';
  const subject = ctx.positionOf(subjects[0]!);
  if (subject === null) return 'none';
  const distance = Math.abs(subject.x - ctx.x) + Math.abs(subject.y - ctx.y);
  return distance <= PERCEPTION_RADIUS ? 'near' : 'none';
}

function strengthOf(
  event: WorldEvent,
  relevance: 'self' | 'near' | 'none',
): number {
  if (relevance === 'none') return 0;
  const row = EVENT_STRENGTH[event.type];
  if (row === undefined) return 0;
  return (relevance === 'self' ? row.self : row.near) ?? 0;
}

/** 活动可打断性声明(10-cognition §7.1 ③):shared 活动定义携带,缺省 high */
function interruptibilityOf(activityId: string | null): 'none' | 'low' | 'high' {
  if (activityId === null) return 'high';
  return getActivityDefinition(activityId)?.interruptibility ?? 'high';
}

function eventKeyOf(event: WorldEvent, ctx: TriageContext): string {
  const subjects = eventSubjects(event);
  return `${event.type}:${subjects.join('|')}:${event.tick}:${ctx.characterId === subjects[0] ? 'self' : 'near'}`;
}

/**
 * 分级主管道:返回处置裁决与命中关卡。预算三闸(去重/冷却/日预算)只在
 * disposition=assess 前检查,命中即降级 ignore(gate 记录原因,trace 可审计)。
 */
export function triageEvent(
  event: WorldEvent,
  ctx: TriageContext,
  resolve: ResponseResolver,
): TriageVerdict {
  const relevance = relevanceOf(event, ctx);
  const importance = strengthOf(event, relevance);
  const eventKey = eventKeyOf(event, ctx);
  const base = { importance, relevance, eventKey };
  if (relevance === 'none' || importance < 3) {
    return { disposition: 'ignore', gate: 'g1_irrelevant', ...base };
  }
  if (!ctx.alive || ctx.collapsed) {
    return { disposition: 'ignore', gate: 'g1_incapacitated', ...base };
  }
  const busy = ctx.activityId !== null || ctx.onPath;
  if (importance < BALANCE.EVENT_RESPONSE_STRONG) {
    return busy
      ? { disposition: 'ignore', gate: 'g2_low_strength', ...base }
      : { disposition: 'idle', gate: 'pass_idle', ...base };
  }
  const action = resolve(event, ctx);
  if (action === null) {
    return { disposition: 'ignore', gate: 'g4_no_action', ...base };
  }
  if (action.kind === 'instant' || !busy) {
    return {
      disposition: 'respond',
      gate: action.kind === 'instant' ? 'pass_instant' : 'pass_idle_respond',
      ...base,
      action,
    };
  }
  const tolerance = interruptibilityOf(ctx.activityId);
  if (tolerance === 'none') {
    return { disposition: 'defer', gate: 'g3_uninterruptible', ...base, action };
  }
  if (tolerance === 'low' && importance < BALANCE.EVENT_RESPONSE_DECISIVE) {
    return { disposition: 'defer', gate: 'g3_strong_only', ...base, action };
  }
  if (ctx.budget.assessedKeys.has(eventKey)) {
    return { disposition: 'ignore', gate: 'g5_dedup', ...base, action };
  }
  if (
    ctx.budget.day === ctx.gameDay &&
    ctx.nowGameMinutes - ctx.budget.lastAssessAt <
      BALANCE.EVENT_RESPONSE_COOLDOWN_MINUTES
  ) {
    return { disposition: 'ignore', gate: 'g5_cooldown', ...base, action };
  }
  if (
    ctx.budget.day === ctx.gameDay &&
    ctx.budget.assessedToday >= BALANCE.EVENT_RESPONSE_DAILY_BUDGET
  ) {
    return { disposition: 'ignore', gate: 'g5_budget', ...base, action };
  }
  return { disposition: 'assess', gate: 'pass_assess', ...base, action };
}
