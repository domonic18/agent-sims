import { and, eq } from 'drizzle-orm';
import type { MindTalkView } from '@sims/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { mindSessions } from '../src/admin-api/mindtalk.js';
import { setupIntegrationDb } from './helpers/integration.js';
import { characters, worlds } from '../src/db/schema/index.js';
import { cognitionTrace } from '../src/db/schema/agent.js';
import { characterMoods } from '../src/db/schema/memory.js';
import { memories } from '../src/db/schema/memory.js';

const WORLD_ID = '00000000-0000-4000-8000-00000000c501';
const CHAR_ID = '00000000-0000-4000-8000-00000000c502';

const { handle, up: dbUp, authHeader } = await setupIntegrationDb();

interface ChatReply {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

interface RecordedChat {
  slot: string;
  system: string;
  history: Array<{ role: string; content: string }>;
}

function chatLlm(replies: Array<string | Error>): { llm: MemoryLlm; chats: RecordedChat[] } {
  const queue = [...replies];
  const chats: RecordedChat[] = [];
  const llm: MemoryLlm = {
    systemOne: () => Promise.reject(new Error('unused')) as never,
    embed: () => Promise.reject(new Error('unused')),
    chat: (slot, messages) => {
      const list = messages as Array<{ role: string; content: string }>;
      chats.push({
        slot: String(slot),
        system: list[0]?.role === 'system' ? list[0].content : '',
        history: list.slice(1),
      });
      const next = queue.shift();
      if (next === undefined || next instanceof Error) return Promise.reject(new Error('桩耗尽'));
      return Promise.resolve({ content: next, promptTokens: 1, completionTokens: 1 } satisfies ChatReply);
    },
  };
  return { llm, chats };
}

describe.skipIf(!dbUp)('意识访谈 API(观察者与 agent 对话,写回记忆)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const get = async (id = CHAR_ID): Promise<{ statusCode: number; body: MindTalkView }> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${id}/mindtalk`,
      headers: { authorization: authHeader() },
    });
    return { statusCode: res.statusCode, body: res.json() };
  };

  const post = async (
    body: Record<string, unknown>,
    id = CHAR_ID,
  ): Promise<{ statusCode: number; body: MindTalkView & { error?: string } }> => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${id}/mindtalk`,
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
      .values({ id: WORLD_ID, name: 'vitest-意识镇', status: 'active', config: {} })
      .onConflictDoNothing();
    await handle.db.insert(characters).values({
      id: CHAR_ID,
      worldId: WORLD_ID,
      tier: 'resident',
      name: '访谈者',
      gender: 'male',
      persona: {
        traits: { homebody: 0.6 },
        modelSlot: 'light',
        bio: '镇上沉默的钓鱼人,账本记得很细',
        card: {
          性格: '节俭惜财',
          兴趣: '钓鱼',
          目标: '攒钱开一家小店',
          说话风格: '言简意赅',
          bio: '小传',
        },
      },
      position: { x: 0, y: 0 },
      stats: {},
    });
    await handle.db.insert(memories).values({
      characterId: CHAR_ID,
      type: 'event',
      content: '上周在河边钓到一条大鲤鱼',
      importance: 8,
      gameMinutes: 0,
    });
    await handle.db.insert(cognitionTrace).values({
      characterId: CHAR_ID,
      seq: 1,
      gameMinutes: 0,
      triggerType: 'reflection',
      decision: { bubble: '想去河边钓鱼' },
    });
    app = buildApp();
    app.simulation.spawnCharacter(CHAR_ID, 8, 12, '访谈者');
  }, 30_000);

  beforeEach(() => {
    mindSessions.delete(CHAR_ID);
  });

  afterAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.client.end();
    await app.close();
  });

  it('POST: 注入记忆/最近念头/人设与近况,回答写回 dialogue 记忆', async () => {
    const stub = chatLlm(['河边可以去钓钓鱼,顺便攒点本钱。']);
    app.llm = stub.llm;
    const res = await post({ text: '镇上有什么值得去的去处?' });
    expect(res.statusCode).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0]).toEqual({ role: 'player', text: '镇上有什么值得去的去处?' });
    expect(res.body.messages[1]?.role).toBe('agent');

    expect(stub.chats).toHaveLength(1);
    expect(stub.chats[0]!.slot).toBe('light');
    const system = stub.chats[0]!.system;
    expect(system).toContain('访谈者'); // 居民名
    expect(system).toContain('上周在河边钓到一条大鲤鱼'); // 相关记忆
    expect(system).toContain('想去河边钓鱼'); // cognition_trace 最近念头
    expect(system).toContain('言简意赅'); // 人设说话风格
    expect(system).toContain('镇上沉默的钓鱼人'); // persona bio
    expect(system).toContain('空闲中'); // 近况(spawn 后无活动)

    const [row] = await handle.db
      .select({ content: memories.content, importance: memories.importance })
      .from(memories)
      .where(and(eq(memories.characterId, CHAR_ID), eq(memories.type, 'dialogue')))
      .limit(1);
    expect(row!.content).toBe(
      '观察者问我:"镇上有什么值得去的去处?" 我回答:"河边可以去钓钓鱼,顺便攒点本钱。"',
    );
    expect(row!.importance).toBe(4);
  });

  it('多轮会话: 历史问答进入后续请求上下文', async () => {
    const stub = chatLlm(['嗯。', '还是河边。']);
    app.llm = stub.llm;
    await post({ text: '晚上一般做什么?' });
    const second = await post({ text: '那白天呢?' });
    expect(second.statusCode).toBe(200);
    expect(second.body.messages).toHaveLength(4);
    expect(stub.chats[1]!.history).toHaveLength(3); // q1 + a1 + q2
    expect(stub.chats[1]!.history[0]!.content).toBe('晚上一般做什么?');
    expect(stub.chats[1]!.history[1]).toEqual({
      role: 'assistant',
      content: '嗯。',
    });
  });

  it('模型失败 502 且撤回本轮提问;会话可重试', async () => {
    const fail = chatLlm([new Error('light 挂了')]);
    app.llm = fail.llm;
    const bad = await post({ text: '这次会失败' });
    expect(bad.statusCode).toBe(502);
    expect((await get()).body.messages).toHaveLength(0); // 提问已撤回

    const retry = chatLlm(['好啦。']);
    app.llm = retry.llm;
    const ok = await post({ text: '重试一次' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.messages).toHaveLength(2);
    // 失败轮无残影: 历史里只有本轮提问,没有上一次失败的问答
    expect(retry.chats[0]!.history).toEqual([{ role: 'user', content: '重试一次' }]);
  });

  it('15 分钟过期: 超时后 GET/POST 均为全新会话', async () => {
    const stub = chatLlm(['第一轮。', '过期后重来。']);
    app.llm = stub.llm;
    await post({ text: '开场白' });
    const session = mindSessions.get(CHAR_ID)!;
    session.updatedAt = Date.now() - 16 * 60 * 1000;
    expect((await get()).body.messages).toHaveLength(0); // GET 惰性过期
    const fresh = await post({ text: '还在吗?' });
    expect(fresh.body.messages).toHaveLength(2); // POST 重建
    expect(stub.chats[1]!.history[0]!.content).toBe('还在吗?');
  });

  it('校验: 空 text 400;角色不在世界 404;未登录 401', async () => {
    expect((await post({ text: '   ' })).statusCode).toBe(400);
    expect((await post({})).statusCode).toBe(400);
    const ghost = '00000000-0000-4000-8000-00000000cfff';
    expect((await get(ghost)).statusCode).toBe(404);
    expect((await post({ text: '在吗' }, ghost)).statusCode).toBe(404);
    const anon = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/mindtalk`,
      payload: { text: '在吗' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('情绪注入(C2): 有非平静情绪时 system 带情绪块,平静时不注入', async () => {
    await handle.db.insert(characterMoods).values({
      characterId: CHAR_ID,
      delta: -0.6,
      labels: ['倒下了'],
      gameMinutes: app.simulation.clock.gameMinutes,
    });
    const stub = chatLlm(['唉,还躺着呢。']);
    app.llm = stub.llm;
    const res = await post({ text: '你现在感觉怎么样?' });
    expect(res.statusCode).toBe(200);
    expect(stub.chats[0]!.system).toContain('[你当前的情绪]');
    expect(stub.chats[0]!.system).toContain('倒下了');
  });
});
