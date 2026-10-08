import type { InterviewCard, InterviewMessage, InterviewView } from '@sims/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MemoryLlm } from '../agents/memory-writer.js';
import type { DbHandle } from '../db/client.js';
import { characters } from '../db/schema/index.js';
import type { Simulation } from '../world/simulation.js';
import { requireAdmin } from './auth.js';

const bodySchema = z.object({ answer: z.string().trim().max(2000).optional() });

const FIRST_QUESTION = '先聊聊你自己吧——你是个什么样的人?';
/** 至少 5 问才允许收尾,8 问硬上限强制收尾(护栏防无限追问/防浅尝辄止) */
export const INTERVIEW_MIN_QUESTIONS = 5;
export const INTERVIEW_MAX_QUESTIONS = 8;
/** 会话闲置过期(墙钟毫秒):每请求惰性清理,不开定时器保测试可控 */
const SESSION_TTL_MS = 15 * 60 * 1000;
const COMPILE_ERROR = '人设卡生成失败,请再回答一句重试';

interface InterviewSession {
  messages: InterviewMessage[];
  /** 已问出的 agent 问题数(首问=1) */
  questionCount: number;
  status: 'asking' | 'compiling' | 'done';
  lastQuestion: string;
  card: InterviewCard | null;
  error: string | null;
  updatedAt: number;
}

/** 会话注册表(导出供测试直接篡改 updatedAt 验过期) */
export const interviewSessions = new Map<string, InterviewSession>();

function expireStale(now: number): void {
  for (const [id, session] of interviewSessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) interviewSessions.delete(id);
  }
}

function view(id: string): InterviewView {
  const session = interviewSessions.get(id);
  if (session === undefined) {
    return {
      characterId: id,
      status: 'idle',
      questionCount: 0,
      question: null,
      messages: [],
      card: null,
      error: null,
    };
  }
  return {
    characterId: id,
    status: session.status,
    questionCount: session.questionCount,
    question: session.status === 'asking' ? session.lastQuestion : null,
    messages: session.messages,
    card: session.card,
    error: session.error,
  };
}

/** light 槽输出→收尾决策:截取首个 JSON 对象,question 须非空字符串 */
export function parseInterviewDecision(raw: string): { done: boolean; question: string | null } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null) return { done: false, question: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { done: false, question: null };
  }
  if (typeof parsed !== 'object' || parsed === null) return { done: false, question: null };
  const record = parsed as Record<string, unknown>;
  const question =
    typeof record.question === 'string' && record.question.trim() !== ''
      ? record.question.trim()
      : null;
  return { done: record.done === true, question };
}

/** slow 槽输出→人设卡:五字段逐个取字符串,缺省补空串;不可解析返回 null */
export function parseInterviewCard(raw: string): InterviewCard | null {
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
  const pick = (key: string): string => {
    const value = record[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  return { 性格: pick('性格'), 兴趣: pick('兴趣'), 目标: pick('目标'), 说话风格: pick('说话风格'), bio: pick('bio') };
}

function transcriptLines(session: InterviewSession): string[] {
  return session.messages.map((m) => `${m.role === 'agent' ? '访谈者' : '玩家'}: ${m.text}`);
}

/** 人设卡落库:persona jsonb 合并(保留 traits/modelSlot/bio),card 五字段整体覆盖 */
async function savePersonaCard(handle: DbHandle, id: string, card: InterviewCard): Promise<void> {
  const rows = await handle.db
    .select({ persona: characters.persona })
    .from(characters)
    .where(eq(characters.id, id))
    .limit(1);
  const current = (rows[0]?.persona ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current, card: { ...card } };
  const existingBio = typeof current.bio === 'string' ? current.bio.trim() : '';
  if (existingBio === '' && card.bio !== '') merged.bio = card.bio;
  await handle.db.update(characters).set({ persona: merged }).where(eq(characters.id, id));
}

/** slow 槽编译人设卡并落库;失败回 asking 带错误回执(玩家再答一句即重试) */
async function compileCard(
  llm: MemoryLlm,
  handle: DbHandle,
  id: string,
  session: InterviewSession,
): Promise<void> {
  try {
    const result = await llm.chat(
      'slow',
      [
        { role: 'system', content: '你把一段人设访谈记录提炼为角色人设卡。只输出 JSON,不要解释。' },
        {
          role: 'user',
          content: [
            '访谈记录:',
            ...transcriptLines(session),
            '只输出 JSON 对象: {"性格":"...","兴趣":"...","目标":"...","说话风格":"...","bio":"一两句话的整体简介"}。',
          ].join('\n'),
        },
      ],
      { taskType: 'agent.interview_card', characterId: id },
    );
    const card = parseInterviewCard(result.content);
    if (card === null) throw new Error('人设卡解析失败');
    await savePersonaCard(handle, id, card);
    session.card = card;
    session.error = null;
    session.status = 'done';
  } catch {
    session.status = 'asking';
    session.error = COMPILE_ERROR;
  }
}

/**
 * 人设访谈(M4e):内存会话+LLM 动态追问。首问固定(零 LLM);此后每答一轮
 * light 槽判定收尾或出下一问(5 问才许收尾,8 问强制);收尾后 slow 槽编译
 * 人设卡落库(合并 persona)。compiling/done 期间重复 POST 幂等。
 */
export function registerInterviewRoutes(
  app: FastifyInstance,
  handle: DbHandle,
  sim: Simulation,
): void {
  app.get('/api/admin/characters/:id/interview', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    expireStale(Date.now());
    return await reply.send(view(id));
  });

  app.post('/api/admin/characters/:id/interview/answer', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: 'body 须为 { answer?: string }' });
    }
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    expireStale(Date.now());
    const session = interviewSessions.get(id);
    if (session === undefined) {
      const fresh: InterviewSession = {
        messages: [{ role: 'agent', text: FIRST_QUESTION }],
        questionCount: 1,
        status: 'asking',
        lastQuestion: FIRST_QUESTION,
        card: null,
        error: null,
        updatedAt: Date.now(),
      };
      interviewSessions.set(id, fresh);
      return await reply.send(view(id));
    }
    session.updatedAt = Date.now();
    if (session.status !== 'asking') {
      return await reply.send(view(id));
    }
    const answer = parsed.data.answer ?? '';
    if (answer === '') {
      return await reply.send(view(id));
    }
    session.error = null;
    session.messages.push({ role: 'player', text: answer });
    if (session.questionCount >= INTERVIEW_MAX_QUESTIONS) {
      session.status = 'compiling';
      void compileCard(app.llm, handle, id, session);
      return await reply.send(view(id));
    }
    const result = await app.llm.chat(
      'light',
      [
        {
          role: 'system',
          content: '你主持一场人设访谈,通过逐个追问了解玩家设想中的角色。只输出 JSON,不要解释。',
        },
        {
          role: 'user',
          content: [
            `已进行 ${session.questionCount} 轮问答(至少 ${INTERVIEW_MIN_QUESTIONS} 轮才允许收尾,最多 ${INTERVIEW_MAX_QUESTIONS} 轮):`,
            ...transcriptLines(session),
            '信息已覆盖性格/兴趣/目标/说话风格且轮数足够则收尾: {"done":true};',
            '否则继续追问还缺的信息: {"done":false,"question":"<单一追问,口语化>"}。',
          ].join('\n'),
        },
      ],
      { taskType: 'agent.interview_ask', characterId: id },
    );
    const decision = parseInterviewDecision(result.content);
    if (decision.done && session.questionCount >= INTERVIEW_MIN_QUESTIONS) {
      session.status = 'compiling';
      void compileCard(app.llm, handle, id, session);
      return await reply.send(view(id));
    }
    if (!decision.done && decision.question !== null) {
      session.messages.push({ role: 'agent', text: decision.question });
      session.questionCount += 1;
      session.lastQuestion = decision.question;
    }
    // done 但轮数不足/JSON 非法/问题为空:重发上一问,计数不加
    return await reply.send(view(id));
  });
}
