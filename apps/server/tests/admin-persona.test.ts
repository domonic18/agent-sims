import { eq } from 'drizzle-orm';
import type { PersonaDraft, PersonaView } from '@sims/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { hosting, schedule } from '../src/agents/cognition.js';
import { setupIntegrationDb } from './helpers/integration.js';
import { characters, worlds } from '../src/db/schema/index.js';

const WORLD_ID = '00000000-0000-4000-8000-00000000c401';
const CHAR_ID = '00000000-0000-4000-8000-00000000c402';

const { handle, up: dbUp, authHeader } = await setupIntegrationDb();

const DRAFT_JSON =
  '{"性格":"节俭惜财","兴趣":"钓鱼与下棋","目标":"攒钱开一家小店","说话风格":"言简意赅","bio":"镇上沉默的钓鱼人,账本记得很细"}';

function randomLlm(replies: Array<string | Error>): { llm: MemoryLlm; calls: () => number } {
  const queue = [...replies];
  let count = 0;
  const llm: MemoryLlm = {
    systemOne: () => Promise.reject(new Error('unused')) as never,
    embed: () => Promise.reject(new Error('unused')),
    chat: () => Promise.reject(new Error('unused')) as never,
    chatStructured: (_slot, _messages, _tool, _task, parse) => {
      count += 1;
      const next = queue.shift();
      if (next === undefined || next instanceof Error) return Promise.reject(new Error('桩耗尽'));
      let raw: unknown;
      try {
        raw = JSON.parse(next);
      } catch {
        raw = next;
      }
      const parsed = parse(raw);
      if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
      return Promise.resolve(parsed.value);
    },
  };
  return { llm, calls: () => count };
}

describe.skipIf(!dbUp)('预置人设 API(查看/保存/LLM 随机草稿)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const get = async (id = CHAR_ID): Promise<{ statusCode: number; body: PersonaView }> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/characters/${id}/persona`,
      headers: { authorization: authHeader() },
    });
    return { statusCode: res.statusCode, body: res.json() };
  };

  const put = async (body: Record<string, unknown>): Promise<{ statusCode: number; body: PersonaView }> => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/characters/${CHAR_ID}/persona`,
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
      .values({ id: WORLD_ID, name: 'vitest-人设镇', status: 'active', config: {} })
      .onConflictDoNothing();
    await handle.db.insert(characters).values({
      id: CHAR_ID,
      worldId: WORLD_ID,
      tier: 'resident',
      name: '设人公',
      gender: 'male',
      persona: { traits: { homebody: 0.6 }, modelSlot: 'light' },
      position: { x: 0, y: 0 },
      stats: {},
    });
    app = buildApp();
    app.simulation.spawnCharacter(CHAR_ID, 8, 12, '设人公');
  }, 30_000);

  beforeEach(() => {
    hosting.delete(CHAR_ID);
    schedule.clear(CHAR_ID);
  });

  afterAll(async () => {
    if (!dbUp) return;
    await handle.db.delete(worlds).where(eq(worlds.id, WORLD_ID));
    await handle.client.end();
    await app.close();
  });

  it('GET: 未编辑时 bio 空 card null;写入后回显', async () => {
    const fresh = await get();
    expect(fresh.statusCode).toBe(200);
    expect(fresh.body.bio).toBe('');
    expect(fresh.body.card).toBeNull();

    const saved = await put({
      bio: '爱钓鱼的沉默人',
      card: { 性格: '节俭', 兴趣: '钓鱼', 目标: '开小店', 说话风格: '话少', bio: '小传' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.bio).toBe('爱钓鱼的沉默人');
    expect(saved.body.card).toEqual({
      性格: '节俭', 兴趣: '钓鱼', 目标: '开小店', 说话风格: '话少', bio: '小传',
    });
  });

  it('PUT 浅合并: 只改 bio 不动 card;traits/modelSlot 始终保留', async () => {
    await put({
      bio: '旧简介',
      card: { 性格: '沉着', 兴趣: '下棋', 目标: '买防', 说话风格: '慢', bio: '旧卡' },
    });
    const onlyBio = await put({ bio: '新简介' });
    expect(onlyBio.body.bio).toBe('新简介');
    expect(onlyBio.body.card?.['性格']).toBe('沉着');
    const [row] = await handle.db
      .select({ persona: characters.persona })
      .from(characters)
      .where(eq(characters.id, CHAR_ID))
      .limit(1);
    const persona = row!.persona as Record<string, unknown>;
    expect(persona.traits).toEqual({ homebody: 0.6 });
    expect(persona.modelSlot).toBe('light');
  });

  it('托管中保存清日程交泵重规划;未托管不动 schedule', async () => {
    schedule.set(CHAR_ID, { day: 1, blocks: [], source: 'fallback' });
    await put({ bio: '未托管保存' });
    expect(schedule.get(CHAR_ID)).toBeDefined(); // 未托管: 日程保留

    hosting.set(CHAR_ID, { mode: 'policy', policyText: 'x', compiled: null });
    schedule.set(CHAR_ID, { day: 1, blocks: [], source: 'fallback' });
    await put({ bio: '托管中保存' });
    expect(schedule.get(CHAR_ID)).toBeUndefined(); // 清日程,泵按新人设重规划
  });

  it('校验: 空 body 400;card 字段缺失 400;401/404', async () => {
    const empty = await put({});
    expect(empty.statusCode).toBe(400);
    const badCard = await put({ card: { 性格: 'x' } });
    expect(badCard.statusCode).toBe(400);
    const anon = await app.inject({
      method: 'PUT',
      url: `/api/admin/characters/${CHAR_ID}/persona`,
      payload: { bio: 'x' },
    });
    expect(anon.statusCode).toBe(401);
    const missing = await get('00000000-0000-4000-8000-00000000cfff');
    expect(missing.statusCode).toBe(404);
  });

  it('POST random: 草稿仅返回不落库;非法 JSON 502;模型异常 502', async () => {
    const ok = randomLlm([DRAFT_JSON]);
    app.llm = ok.llm;
    const before = (await get()).body;
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/persona/random`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    const draft = res.json() as PersonaDraft;
    expect(draft.card['目标']).toBe('攒钱开一家小店');
    expect(ok.calls()).toBe(1);
    expect((await get()).body).toEqual(before); // 草稿不落库

    const bad = randomLlm(['不是JSON']);
    app.llm = bad.llm;
    const badRes = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/persona/random`,
      headers: { authorization: authHeader() },
    });
    expect(badRes.statusCode).toBe(502);

    const err = randomLlm([new Error('light 挂')]);
    app.llm = err.llm;
    const errRes = await app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/persona/random`,
      headers: { authorization: authHeader() },
    });
    expect(errRes.statusCode).toBe(502);
  });
});
