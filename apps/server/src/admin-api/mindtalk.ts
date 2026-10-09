import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { retrieveMemories } from '../agents/memory-retrieval.js';
import type { MemoryLlm } from '../agents/memory-writer.js';
import { describeMood, readMood } from '../agents/mood.js';
import { loadPersonaContext } from '../agents/slow-layer.js';
import type { DbHandle } from '../db/client.js';
import { cognitionTrace } from '../db/schema/agent.js';
import { memories } from '../db/schema/memory.js';
import { renderPrompt } from '../prompts/registry.js';
import type { Simulation } from '../world/simulation.js';
import type { MindTalkMessage, MindTalkView } from '@sims/shared';

const bodySchema = z.object({ text: z.string().trim().min(1, '问题不能为空').max(500) });

const SESSION_TTL_MS = 15 * 60 * 1000;

interface MindSession {
  messages: MindTalkMessage[];
  updatedAt: number;
}

/** 内存会话(重连恢复);每请求惰性过期,不用定时器保测试可控 */
export const mindSessions = new Map<string, MindSession>();

function expireStale(now: number): void {
  for (const [id, session] of mindSessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) mindSessions.delete(id);
  }
}

/** cognition_trace 最近决策(气泡/结论)= TA 最近在想的事;查询失败静默降级 */
async function loadRecentThoughts(handle: DbHandle, id: string, limit = 3): Promise<string[]> {
  try {
    const rows = await handle.db
      .select({ decision: cognitionTrace.decision })
      .from(cognitionTrace)
      .where(eq(cognitionTrace.characterId, id))
      .orderBy(desc(cognitionTrace.seq))
      .limit(limit);
    return rows
      .map(({ decision }) => {
        const d = (decision ?? {}) as Record<string, unknown>;
        return typeof d.bubble === 'string' && d.bubble !== '' ? d.bubble : typeof d.conclusion === 'string' ? d.conclusion : '';
      })
      .filter((text) => text !== '');
  } catch {
    return [];
  }
}

/** 与问题相关的记忆(top-6);embed 失败退双因子,检索失败退空(绝不阻塞对话) */
async function loadRelevantMemories(
  llm: MemoryLlm,
  handle: DbHandle,
  id: string,
  question: string,
  gameMinutes: number,
): Promise<string[]> {
  try {
    const emb = await llm.embed('embedding', [question], { taskType: 'agent.mind_talk', characterId: id });
    const scored = await retrieveMemories(handle, {
      characterId: id,
      currentGameMinutes: gameMinutes,
      queryVector: emb.vector,
      limit: 6,
    });
    return scored.map((m) => m.content);
  } catch {
    try {
      const scored = await retrieveMemories(handle, { characterId: id, currentGameMinutes: gameMinutes, limit: 6 });
      return scored.map((m) => m.content);
    } catch {
      return [];
    }
  }
}

/**
 * 意识访谈(观察者定位): 与 agent 对话,TA 基于自身记忆/最近念头/人设第一人称回答;
 * 每轮问答写回一条 dialogue 记忆——访谈本身成为 TA 的经历,影响后续行为。
 */
export function registerMindTalkRoutes(
  app: FastifyInstance,
  handle: DbHandle,
  sim: Simulation,
): void {
  app.get('/api/admin/characters/:id/mindtalk', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    expireStale(Date.now());
    return await reply.send(view(id));
  });

  app.post('/api/admin/characters/:id/mindtalk', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
    }
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    expireStale(Date.now());
    const session = ensureSession(id);
    const question = parsed.data.text;
    session.messages.push({ role: 'player', text: question });
    session.updatedAt = Date.now();

    const char = sim.characters.get(id)!;
    const llm = app.llm as MemoryLlm;
    try {
      const [memoriesLines, thoughts, persona, moodLine] = await Promise.all([
        loadRelevantMemories(llm, handle, id, question, sim.clock.gameMinutes),
        loadRecentThoughts(handle, id),
        loadPersonaContext(handle, id),
        readMood(handle, id, sim.clock.gameMinutes)
          .then(describeMood)
          .catch(() => null),
      ]);
      const status = char.activity !== null
        ? `正在「${char.activity.activityId}」,体力 ${Math.round(char.energy)},金币 ${Math.round(char.coins)}`
        : `空闲中,体力 ${Math.round(char.energy)},金币 ${Math.round(char.coins)}`;
      const context = [
        `[你的近况] ${status}${char.alive ? '' : '(你已倒下,正等待恢复)'}`,
        memoriesLines.length > 0 ? `[与这个问题相关的记忆]\n${memoriesLines.map((m) => `- ${m}`).join('\n')}` : '',
        thoughts.length > 0 ? `[你最近心里想的]\n${thoughts.map((m) => `- ${m}`).join('\n')}` : '',
        persona !== undefined ? `[你的人设]\n${persona}` : '',
        moodLine !== null ? `[你当前的情绪] ${moodLine}。回答的语气自然带出这份情绪,不必直接点破。` : '',
      ]
        .filter((block) => block !== '')
        .join('\n\n');
      const result = await llm.chat(
        'light',
        [
          {
            role: 'system',
            content: renderPrompt('mindtalk.system', { name: char.name, context }),
          },
          ...session.messages.slice(0, -1).map((message) => ({
            role: message.role === 'agent' ? ('assistant' as const) : ('user' as const),
            content: message.text,
          })),
          { role: 'user', content: question },
        ],
        { taskType: 'agent.mind_talk', characterId: id },
      );
      const answer = result.content.trim();
      session.messages.push({ role: 'agent', text: answer });
      session.updatedAt = Date.now();
      // 写回记忆:访谈成为 TA 的经历(无向量,recency+importance 双因子可检索)
      await handle.db.insert(memories).values({
        characterId: id,
        type: 'dialogue',
        content: `观察者问我:"${question}" 我回答:"${answer}"`,
        importance: 4,
        gameMinutes: sim.clock.gameMinutes,
      });
      return await reply.send(view(id));
    } catch (error) {
      session.messages.pop(); // 撤回本轮提问,重试不留残影
      return await reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : 'TA 没能回答,请重试' });
    }
  });
}

function ensureSession(id: string): MindSession {
  let session = mindSessions.get(id);
  if (session === undefined) {
    session = { messages: [], updatedAt: Date.now() };
    mindSessions.set(id, session);
  }
  return session;
}

function view(id: string): MindTalkView {
  return { characterId: id, messages: mindSessions.get(id)?.messages ?? [] };
}
