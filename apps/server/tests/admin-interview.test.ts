import { eq } from 'drizzle-orm';
import type { InterviewView } from '@sims/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { env } from '../src/config/env.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { characters, worlds } from '../src/db/schema/index.js';
import { interviewSessions } from '../src/admin-api/interview.js';
import { issueAdminToken } from '../src/utils/token.js';

const WORLD_ID = '00000000-0000-4000-8000-00000000c301';
const CHAR_ID = '00000000-0000-4000-8000-00000000c302';

let handle: DbHandle;

const dbUp = await (async () => {
  handle = createDb(env.DATABASE_URL);
  try {
    await handle.client`SELECT 1`;
    return true;
  } catch {
    await handle.client.end().catch(() => {});
    return false;
  }
})();

interface ChatReply {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

/** 按 taskType 分流的 chat 桩:ask/card 各走脚本队列,耗尽即拒绝 */
function interviewLlm(opts: {
  ask?: Array<string | Error>;
  card?: Array<string | Error>;
}): { llm: MemoryLlm; askCalls: () => number; cardCalls: () => number } {
  const ask = [...(opts.ask ?? [])];
  const card = [...(opts.card ?? [])];
  let askCount = 0;
  let cardCount = 0;
  const llm: MemoryLlm = {
    systemOne: () => Promise.reject(new Error('unused')) as never,
    embed: () => Promise.reject(new Error('unused')),
    chat: (_slot, _messages, task) => {
      if (task?.taskType === 'agent.interview_card') {
        cardCount += 1;
        const next = card.shift();
        if (next === undefined || next instanceof Error) return Promise.reject(new Error('card 桩耗尽'));
        return Promise.resolve({ content: next, promptTokens: 1, completionTokens: 1 } satisfies ChatReply);
      }
      askCount += 1;
      const next = ask.shift();
      if (next === undefined || next instanceof Error) return Promise.reject(new Error('ask 桩耗尽'));
      return Promise.resolve({ content: next, promptTokens: 1, completionTokens: 1 } satisfies ChatReply);
    },
  };
  return { llm, askCalls: () => askCount, cardCalls: () => cardCount };
}

function authHeader(): string {
  const issued = issueAdminToken({
    username: 'vitest',
    masterKey: env.MASTER_KEY,
    ttlMs: 3_600_000,
  });
  return `Bearer ${issued.token}`;
}

const nextAsk = (question: string): string => JSON.stringify({ done: false, question });
const doneAsk = (): string => JSON.stringify({ done: true });
const CARD_JSON =
  '{"性格":"沉静坚韧","兴趣":"天文学与旧书","目标":"攒钱开一间书店","说话风格":"语速慢,爱用比喻","bio":"镇上爱书人,话不多但可靠"}';

describe.skipIf(!dbUp)('人设访谈(M4e LLM 动态追问)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const answer = async (
    body: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: InterviewView }> => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/interview/answer`,
      headers: { authorization: authHeader() },
      payload: body,
    });
    return { statusCode: res.statusCode, body: res.json() };
  };

  beforeAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.db
      .insert(worlds)
      .values({ id: WORLD_ID, name: 'vitest-访谈镇', status: 'active', config: {} })
      .onConflictDoNothing();
    await handle.db.insert(characters).values({
      id: CHAR_ID,
      worldId: WORLD_ID,
      tier: 'resident',
      name: '访人公',
      gender: 'female',
      persona: { traits: { homebody: 0.8 }, modelSlot: 'light' },
      position: { x: 0, y: 0 },
      stats: {},
    });
    app = buildApp();
    app.simulation.spawnCharacter(CHAR_ID, 8, 12, '访人公');
  }, 30_000);

  beforeEach(() => {
    interviewSessions.clear();
  });

  afterAll(async () => {
    if (!dbUp) return;
    interviewSessions.clear();
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.client.end();
    await app.close();
  });

  it('无会话 POST {}: 固定首问零 LLM;GET 可恢复会话;未开启 GET 为 idle', async () => {
    const stub = interviewLlm({ ask: [] });
    app.llm = stub.llm;
    const res = await answer({});
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body.status).toBe('asking');
    expect(body.questionCount).toBe(1);
    expect(body.question).toContain('先聊聊你自己吧');
    expect(body.messages).toHaveLength(1);
    expect(stub.askCalls()).toBe(0);
    const restored = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/interview`,
      headers: { authorization: authHeader() },
    });
    expect(restored.json().questionCount).toBe(1);
    interviewSessions.clear();
    const idle = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/interview`,
      headers: { authorization: authHeader() },
    });
    expect(idle.json().status).toBe('idle');
  });

  it('追问流转: done=false 出下一问计数递增;done<5 被拒;非法 JSON 重发上一问', async () => {
    const stub = interviewLlm({ ask: [nextAsk('你平时喜欢做什么?'), doneAsk(), '不是JSON'] });
    app.llm = stub.llm;
    await answer({});
    const r2 = await answer({ answer: '安静,喜欢看书' });
    expect(r2.body.questionCount).toBe(2);
    expect(r2.body.question).toBe('你平时喜欢做什么?');
    // 第 2 轮就收尾:拒绝(不足 5),重发上一问计数不加
    const r3 = await answer({ answer: '天文和旧书' });
    expect(r3.body.status).toBe('asking');
    expect(r3.body.questionCount).toBe(2);
    expect(r3.body.question).toBe('你平时喜欢做什么?');
    expect(stub.cardCalls()).toBe(0);
    // 非法 JSON:同样重发不计数
    const r4 = await answer({ answer: '随便逛逛' });
    expect(r4.body.questionCount).toBe(2);
    expect(r4.body.question).toBe('你平时喜欢做什么?');
  });

  it('满 5 问收尾: slow 编译人设卡落库合并(traits/modelSlot 保留,bio 补空)', async () => {
    const stub = interviewLlm({
      ask: [nextAsk('q2'), nextAsk('q3'), nextAsk('q4'), nextAsk('q5'), doneAsk()],
      card: [CARD_JSON],
    });
    app.llm = stub.llm;
    await answer({});
    for (const text of ['答1', '答2', '答3', '答4']) {
      await answer({ answer: text });
    }
    const last = await answer({ answer: '答5' });
    expect(last.body.status).toBe('compiling');
    await vi.waitFor(() => expect(interviewSessions.get(CHAR_ID)?.status).toBe('done'));
    const done = await answer({});
    expect(done.body.status).toBe('done');
    expect(done.body.card).toEqual({
      性格: '沉静坚韧',
      兴趣: '天文学与旧书',
      目标: '攒钱开一间书店',
      说话风格: '语速慢,爱用比喻',
      bio: '镇上爱书人,话不多但可靠',
    });
    expect(stub.cardCalls()).toBe(1);
    const [row] = await handle.db
      .select({ persona: characters.persona })
      .from(characters)
      .where(eq(characters.id, CHAR_ID))
      .limit(1);
    const persona = row!.persona as Record<string, unknown>;
    expect(persona.traits).toEqual({ homebody: 0.8 });
    expect(persona.modelSlot).toBe('light');
    expect((persona.card as Record<string, string>)['性格']).toBe('沉静坚韧');
    expect(persona.bio).toBe('镇上爱书人,话不多但可靠');
  });

  it('8 问硬上限: 不再询问强制收尾;done 幂等;会话闲置过期重建', async () => {
    const stub = interviewLlm({
      ask: [nextAsk('q2'), nextAsk('q3'), nextAsk('q4'), nextAsk('q5'), nextAsk('q6'), nextAsk('q7'), nextAsk('q8')],
      card: [CARD_JSON],
    });
    app.llm = stub.llm;
    await answer({});
    for (let i = 2; i <= 8; i += 1) {
      const res = await answer({ answer: `答${i}` });
      if (i < 8) expect(res.body.status).toBe('asking');
    }
    const forced = await answer({ answer: '答9' });
    expect(forced.body.status).toBe('compiling');
    expect(stub.askCalls()).toBe(7); // 第 8 问后不再调用 light
    await vi.waitFor(() => expect(interviewSessions.get(CHAR_ID)?.status).toBe('done'));
    const done = await answer({});
    expect(done.body.status).toBe('done');
    // done 幂等:再 POST 原样返回,不再触发编译
    const again = await answer({ answer: '还答' });
    expect(again.body.status).toBe('done');
    expect(stub.cardCalls()).toBe(1);
    // 闲置过期:直接篡改 updatedAt 触发惰性清理,重建为新首问会话
    const session = interviewSessions.get(CHAR_ID)!;
    session.updatedAt = Date.now() - 16 * 60 * 1000;
    const fresh = await answer({});
    expect(fresh.body.status).toBe('asking');
    expect(fresh.body.questionCount).toBe(1);
    expect(fresh.body.messages).toHaveLength(1);
  });

  it('编译失败: 回 asking 带错误回执;再答一句可重试成功', async () => {
    const stub = interviewLlm({
      ask: [nextAsk('q2'), nextAsk('q3'), nextAsk('q4'), nextAsk('q5'), doneAsk(), doneAsk()],
      card: [new Error('slow 挂'), CARD_JSON],
    });
    app.llm = stub.llm;
    await answer({});
    for (const text of ['答1', '答2', '答3', '答4']) {
      await answer({ answer: text });
    }
    await answer({ answer: '答5' });
    await vi.waitFor(() => expect(interviewSessions.get(CHAR_ID)?.status).toBe('asking'));
    const failed = await answer({});
    expect(failed.body.status).toBe('asking');
    expect(failed.body.error).toContain('重试');
    const retry = await answer({ answer: '再补充一点' });
    expect(retry.body.status).toBe('compiling');
    await vi.waitFor(() => expect(interviewSessions.get(CHAR_ID)?.status).toBe('done'));
    const done = await answer({});
    expect(done.body.status).toBe('done');
    expect(stub.cardCalls()).toBe(2);
  });

  it('无凭证 401;未知角色 404;body 非法 400', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/interview/answer`,
      payload: {},
    });
    expect(anon.statusCode).toBe(401);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/admin/characters/00000000-0000-4000-8000-00000000cfff/interview/answer',
      headers: { authorization: authHeader() },
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/interview/answer`,
      headers: { authorization: authHeader() },
      payload: { answer: 42 },
    });
    expect(bad.statusCode).toBe(400);
  });
});
