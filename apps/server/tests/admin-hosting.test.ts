import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueAdminToken } from '../src/utils/token.js';
import { env } from '../src/config/env.js';
import { autonomy, hosting, innerState } from '../src/agents/cognition.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { adminGuard } from '../src/admin-api/auth.js';
import { registerHostingRoutes } from '../src/admin-api/hosting.js';
import type { DbHandle } from '../src/db/client.js';
import type { Simulation } from '../src/world/simulation.js';

const CHAR_ID = 'char-1';
const POLICY = '专注学习攒钱,不要到处闲逛';

interface Harness {
  app: Awaited<ReturnType<typeof Fastify>>;
  events: Array<Record<string, unknown>>;
  readonly chatCalls: number;
}

function harness(chatContent: string | Error): Harness {
  const events: Array<Record<string, unknown>> = [];
  let chatCalls = 0;
  const app = Fastify();
  const llm: MemoryLlm = {
    systemOne: () => Promise.reject(new Error('unused')) as never,
    embed: () => Promise.reject(new Error('unused')),
    chat: () => Promise.reject(new Error('unused')) as never,
    // 桩语义=chatContent 即模型要提交的工具入参;非 JSON 原样交 parse 判定(校验失败同走异常)
    chatStructured: (_slot, _messages, _tool, _task, parse) => {
      chatCalls += 1;
      if (chatContent instanceof Error) return Promise.reject(chatContent);
      let raw: unknown;
      try {
        raw = JSON.parse(chatContent);
      } catch {
        raw = chatContent;
      }
      const parsed = parse(raw);
      if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
      return Promise.resolve(parsed.value);
    },
  };
  app.decorate('llm', llm);
  // 与生产 scoped 装配同款守卫(registerHostingRoutes 自身不再内联鉴权)
  app.addHook('preHandler', adminGuard());
  const sim = {
    characters: new Map([[CHAR_ID, { id: CHAR_ID }]]),
    tick: 7,
    events: { emit: (event: Record<string, unknown>) => events.push(event) },
  } as unknown as Simulation;
  // 写穿桩(M10):空转链,不落库也不观测——持久化语义由容器走查覆盖
  const handle = {
    db: {
      update: () => ({ set: () => ({ where: () => ({ catch: () => {} }) }) }),
    },
  } as unknown as DbHandle;
  registerHostingRoutes(app, handle, sim);
  return { app, events, get chatCalls() { return chatCalls; } };
}

function authHeader(): string {
  const issued = issueAdminToken({
    username: 'vitest',
    masterKey: env.MASTER_KEY,
    ttlMs: 3_600_000,
  });
  return `Bearer ${issued.token}`;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('GET/POST /api/admin/characters/:id/hosting(M4e 托管切换)', () => {
  let h: Harness;

  beforeEach(() => {
    hosting.delete(CHAR_ID);
    innerState.clear(CHAR_ID);
    h = harness('{"focus":["study"],"avoid":["stroll"]}');
  });

  afterEach(async () => {
    hosting.delete(CHAR_ID);
    innerState.clear(CHAR_ID);
    await h.app.close();
  });

  it('未托管 GET: hosted=false/mode=null;未知角色 404;无凭证 401', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ characterId: CHAR_ID, hosted: false, mode: null, policyText: null });
    const missing = await h.app.inject({
      method: 'GET',
      url: '/api/admin/characters/char-404/hosting',
      headers: { authorization: authHeader() },
    });
    expect(missing.statusCode).toBe(404);
    const anon = await h.app.inject({ method: 'GET', url: `/api/admin/characters/${CHAR_ID}/hosting` });
    expect(anon.statusCode).toBe(401);
  });

  it('开全托管: 状态立即可见+自治视图同步+广播 hosted 事件', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
      payload: { enabled: true, mode: 'full' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ characterId: CHAR_ID, hosted: true, mode: 'full', policyText: null });
    expect(autonomy.has(CHAR_ID)).toBe(true);
    expect(h.events).toEqual([
      {
        type: 'character.hosting_changed',
        characterId: CHAR_ID,
        hosted: true,
        mode: 'full',
        tick: 7,
      },
    ]);
  });

  it('开方针托管: 先落状态(编译异步),编译完成后写缓存;意图清空触发重规划', async () => {
    innerState.setIntents(CHAR_ID, { day: 1, source: 'fallback', wants: [] });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
      payload: { enabled: true, mode: 'policy', policyText: POLICY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ characterId: CHAR_ID, hosted: true, mode: 'policy', policyText: POLICY });
    expect(innerState.get(CHAR_ID)?.intents ?? null).toBeNull();
    expect(h.chatCalls).toBe(1);
    await flush();
    expect(hosting.get(CHAR_ID)?.compiled).toEqual({ focus: ['study'], avoid: ['stroll'] });
  });

  it('同方针重复提交: 不重编译不清计划;方针变更才重编译', async () => {
    const post = (): Promise<{ statusCode: number }> =>
      h.app.inject({
        method: 'POST',
        url: `/api/admin/characters/${CHAR_ID}/hosting`,
        headers: { authorization: authHeader() },
        payload: { enabled: true, mode: 'policy', policyText: POLICY },
      });
    await post();
    await flush();
    innerState.setIntents(CHAR_ID, { day: 1, source: 'fallback', wants: [] });
    await post();
    await flush();
    expect(h.chatCalls).toBe(1);
    expect(innerState.get(CHAR_ID)?.intents).not.toBeNull();
    await h.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
      payload: { enabled: true, mode: 'policy', policyText: '改成多锻炼' },
    });
    await flush();
    expect(h.chatCalls).toBe(2);
    expect(innerState.get(CHAR_ID)?.intents ?? null).toBeNull();
    expect(hosting.get(CHAR_ID)?.policyText).toBe('改成多锻炼');
  });

  it('编译失败: compiled 保持 null(只用原文兜底),托管状态不受影响', async () => {
    await h.app.close();
    h = harness(new Error('slow 槽未配置'));
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
      payload: { enabled: true, mode: 'policy', policyText: POLICY },
    });
    expect(res.statusCode).toBe(200);
    await flush();
    expect(hosting.get(CHAR_ID)?.compiled).toBeNull();
    expect(hosting.get(CHAR_ID)?.policyText).toBe(POLICY);
  });

  it('方针模式缺 policyText → 400;body 非法 → 400', async () => {
    const noText = await h.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
      payload: { enabled: true, mode: 'policy' },
    });
    expect(noText.statusCode).toBe(400);
    const bad = await h.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
      payload: { enabled: 'yes' },
    });
    expect(bad.statusCode).toBe(400);
    expect(hosting.has(CHAR_ID)).toBe(false);
  });

  it('接管(disable): 状态删除+广播 hosted=false 事件,当日意图保留', async () => {
    hosting.set(CHAR_ID, { mode: 'policy', policyText: POLICY, compiled: null });
    innerState.setIntents(CHAR_ID, {
      day: 1,
      source: 'fallback',
      wants: [
        { id: 'w1-0', activityId: 'study', why: '想学点东西', urgency: 0.8, status: 'pending', createdAtMin: 480 },
      ],
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ characterId: CHAR_ID, hosted: false, mode: null, policyText: null });
    expect(innerState.get(CHAR_ID)?.intents).not.toBeNull();
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ type: 'character.hosting_changed', hosted: false, mode: null });
    const again = await h.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${CHAR_ID}/hosting`,
      headers: { authorization: authHeader() },
      payload: { enabled: false },
    });
    expect(again.statusCode).toBe(200);
    expect(h.events).toHaveLength(1);
  });
});
