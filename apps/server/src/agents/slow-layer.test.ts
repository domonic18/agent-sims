import { describe, expect, it } from 'vitest';
import { getActivityDefinition } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import type { WorldCharacter } from '../world/character.js';
import type { MemoryLlm } from './memory-writer.js';
import {
  INTENT_ACTIVITY_IDS,
  compilePersonaPolicy,
  composeIntents,
  evidenceQuery,
  fallbackIntents,
  parseIntents,
  parsePolicy,
  biasOf,
  describeIntents,
} from './slow-layer.js';

const DAY = 5;

function char(overrides: Partial<WorldCharacter>): WorldCharacter {
  return {
    id: 'char-1',
    name: '阿测',
    x: 30,
    y: 30,
    path: [],
    energy: 80,
    health: 100,
    coins: 50,
    activity: null,
    housing: null,
    alive: true,
    collapsed: false,
    backpack: {},
    fridge: {},
    score: 0,
    knowledge: 0,
    sleepWindowMinutes: 0,
    sleepDebtEndGameMinutes: null,
    traits: {},
    ...overrides,
  } as WorldCharacter;
}

function llmStub(opts: {
  /** 模型要提交的工具入参:JSON 串自动 parse,parse 失败原样传(垃圾输出场景) */
  chatContent?: string;
  chatReject?: boolean;
  memoryRows?: Array<{ content: string }>;
}): {
  llm: MemoryLlm;
  handle: DbHandle;
  chatMessages: Array<{ role: string; content: string }>;
  readonly embedCalls: number;
} {
  const chatMessages: Array<{ role: string; content: string }> = [];
  let embedCalls = 0;
  const rows = (opts.memoryRows ?? []).map((r, i) => ({
    id: `m-${i}`,
    type: 'event',
    content: r.content,
    importance: 5,
    gameMinutes: 100,
    createdAt: new Date(),
    relevance: 0.9,
  }));
  const handle = {
    db: {
      select: () => ({
        from: () => ({ where: () => Promise.resolve(rows) }),
      }),
    },
  } as unknown as DbHandle;
  const llm: MemoryLlm = {
    systemOne: () => Promise.reject(new Error('unused')) as never,
    embed: () => {
      embedCalls += 1;
      return Promise.resolve({ vector: [0.1, 0.2], promptTokens: 3 });
    },
    chat: () => Promise.reject(new Error('unused')) as never,
    chatStructured: (_slot, messages, _tool, _task, parse) => {
      chatMessages.push(...messages);
      if (opts.chatReject === true) return Promise.reject(new Error('slow 槽未配置'));
      if (opts.chatContent === undefined) return Promise.reject(new Error('桩未配置输出'));
      let raw: unknown;
      try {
        raw = JSON.parse(opts.chatContent);
      } catch {
        raw = opts.chatContent;
      }
      const parsed = parse(raw);
      if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
      return Promise.resolve(parsed.value);
    },
  };
  return { llm, handle, chatMessages, get embedCalls() { return embedCalls; } };
}

describe('parseIntents(工具入参→wants)', () => {
  it('合法行解析成 wants(activity 白名单+urgency 截断 0~1+id 按序生成)', () => {
    expect(
      parseIntents(
        {
          wants: [
            { activity: 'work', urgency: 0.8, why: '挣钱' },
            { activity: 'study', urgency: 2, why: '想学新东西' },
            { activity: 'stroll', urgency: -1, why: '透透气' },
          ],
        },
        DAY,
        500,
      ),
    ).toEqual({
      ok: true,
      value: [
        { id: 'w5-0', activityId: 'work', why: '挣钱', origin: 'plan', urgency: 0.8, status: 'pending', createdAtMin: 500 },
        { id: 'w5-1', activityId: 'study', why: '想学新东西', origin: 'plan', urgency: 1, status: 'pending', createdAtMin: 500 },
        { id: 'w5-2', activityId: 'stroll', why: '透透气', origin: 'plan', urgency: 0, status: 'pending', createdAtMin: 500 },
      ],
    });
  });

  it('非法行剔除(sleep 不在白名单/urgency 非数字/why 缺省兜措辞);wants 缺失或无有效行判失败', () => {
    expect(
      parseIntents(
        {
          wants: [
            { activity: 'sleep', urgency: 1, why: '困' },
            { activity: 'rest', urgency: 'high', why: '累' },
            { activity: 'meal', urgency: 0.5 },
          ],
        },
        DAY,
        500,
      ),
    ).toEqual({
      ok: true,
      value: [
        { id: 'w5-0', activityId: 'meal', why: '随性而为', origin: 'plan', urgency: 0.5, status: 'pending', createdAtMin: 500 },
      ],
    });
    expect(parseIntents({ wants: [] }, DAY, 500).ok).toBe(false);
    expect(parseIntents([{ activity: 'work' }], DAY, 500).ok).toBe(false);
    expect(parseIntents('我想想', DAY, 500).ok).toBe(false);
    expect(parseIntents(null, DAY, 500).ok).toBe(false);
  });

  it('人指向 target(E2):socialize 熟人名解析为 id;解析不了剥 target 保留 want;非 socialize 忽略', () => {
    const resolve = (name: string): string | undefined =>
      name === '铁牛' ? 'npc-9' : undefined;
    const parsed = parseIntents(
      {
        wants: [
          { activity: 'socialize', urgency: 0.9, why: '找铁牛聊聊', target: '铁牛' },
          { activity: 'socialize', urgency: 0.5, why: '找人说话', target: '路人甲' },
          { activity: 'work', urgency: 0.5, why: '挣钱', target: '铁牛' },
        ],
      },
      DAY,
      500,
      resolve,
    );
    if (!parsed.ok) throw new Error(`校验失败 ${parsed.reason}`);
    expect(parsed.value).toEqual([
      {
        id: 'w5-0',
        activityId: 'socialize',
        why: '找铁牛聊聊',
        origin: 'plan',
        urgency: 0.9,
        status: 'pending',
        createdAtMin: 500,
        targetCharacterId: 'npc-9',
      },
      // 「路人甲」解析不了:剥 target 保留 want
      { id: 'w5-1', activityId: 'socialize', why: '找人说话', origin: 'plan', urgency: 0.5, status: 'pending', createdAtMin: 500 },
      // 非 socialize 的 target 一律忽略
      { id: 'w5-2', activityId: 'work', why: '挣钱', origin: 'plan', urgency: 0.5, status: 'pending', createdAtMin: 500 },
    ]);
  });
});

describe('fallbackIntents(个性化回落)', () => {
  it('3~4 条、全在白名单、avoid(bias=-1)绝不出现、id 带 fallback 标记', () => {
    const wants = fallbackIntents(DAY, 500, { study: 1, work: 1, stroll: -1, socialize: -1 });
    expect(wants.length).toBeGreaterThanOrEqual(3);
    expect(wants.length).toBeLessThanOrEqual(4);
    const ids = wants.map((w) => w.activityId);
    expect(ids).not.toContain('stroll');
    expect(ids).not.toContain('socialize');
    for (const w of wants) {
      expect(w.status).toBe('pending');
      expect(w.urgency).toBeGreaterThan(0);
      expect(w.urgency).toBeLessThanOrEqual(0.9);
      expect(w.id).toMatch(/^w5-f\d$/);
      expect(w.why.trim()).not.toBe('');
    }
  });

  it('无 bias 时也能产出(全白名单候选)', () => {
    const wants = fallbackIntents(DAY, 500, {});
    expect(wants.length).toBeGreaterThanOrEqual(3);
  });
});

describe('describeIntents(昨日对照措辞)', () => {
  it('活动名+状态标签+why 拼接', () => {
    expect(
      describeIntents({
        day: 4,
        source: 'llm',
        wants: [
          { id: 'w4-0', activityId: 'work', why: '挣钱', origin: 'plan', urgency: 0.8, status: 'done', createdAtMin: 100 },
          { id: 'w4-1', activityId: 'study', why: '想学新东西', origin: 'plan', urgency: 0.5, status: 'pending', createdAtMin: 100 },
        ],
      }),
    ).toBe('杂工(已完成): 挣钱;学习(未做): 想学新东西');
  });
});

describe('INTENT_ACTIVITY_IDS(词汇表,E4 卖货通路)', () => {
  it('含 sell_goods 且表内每项均为合法活动', () => {
    expect(INTENT_ACTIVITY_IDS).toContain('sell_goods');
    for (const id of INTENT_ACTIVITY_IDS) {
      expect(getActivityDefinition(id)).not.toBeNull();
    }
  });
});

describe('evidenceQuery(记忆检索动态查询,D4)', () => {
  it('关注点+昨日意图拼串,检索跟决策走', () => {
    expect(
      evidenceQuery({ name: '阿测' }, {
        focus: '想把欠的房租挣出来',
        previous: {
          day: 4,
          wants: [
            { id: 'w4-0', activityId: 'work', why: '挣钱', origin: 'plan', urgency: 0.8, status: 'done', createdAtMin: 100 },
          ],
          source: 'llm',
        },
      }),
    ).toBe('阿测: 想把欠的房租挣出来;杂工(已完成): 挣钱');
  });

  it('无上下文回落生平泛查询;空白关注点视为无', () => {
    expect(evidenceQuery({ name: '阿测' })).toBe('阿测的日常生活、工作与人际经历');
    expect(evidenceQuery({ name: '阿测' }, { focus: '   ' })).toBe('阿测的日常生活、工作与人际经历');
  });
});

describe('composeIntents(慢层意图生成)', () => {
  it('LLM 正常输出→source llm,记忆证据进 prompt(embed+检索各一次),bias 随 compiled 返回', async () => {
    const s = llmStub({
      chatContent:
        '{"wants":[{"activity":"work","urgency":0.8,"why":"挣钱"},{"activity":"study","urgency":0.5,"why":"想学新东西"}]}',
      memoryRows: [{ content: '我学习了 60 分钟' }, { content: '我和阿泽聊了天' }],
    });
    const { intents, bias, compiled } = await composeIntents(s.llm, s.handle, char({}), {
      day: DAY,
      gameMinutes: 500,
    });
    expect(intents.day).toBe(DAY);
    expect(intents.source).toBe('llm');
    expect(intents.wants).toHaveLength(2);
    expect(bias).toEqual({});
    expect(compiled).toBeNull();
    expect(s.chatMessages).toHaveLength(2);
    expect(s.chatMessages[1]!.content).toContain('我学习了 60 分钟');
    expect(s.chatMessages[1]!.content).toContain('金币 50');
    expect(s.chatMessages[1]!.content).toContain('work');
    expect(s.embedCalls).toBe(1);
  });

  it('LLM 输出垃圾→个性化回落(source fallback,avoid 不出现)', async () => {
    const { llm, handle } = llmStub({ chatContent: '我想想……说不太清楚' });
    const { intents } = await composeIntents(llm, handle, char({}), { day: DAY, gameMinutes: 500 }, {
      compiled: { focus: ['study'], avoid: ['stroll'] },
    });
    expect(intents.source).toBe('fallback');
    expect(intents.wants.some((w) => w.activityId === 'stroll')).toBe(false);
  });

  it('slow 槽不可用(chat 拒绝)→回落,绝不外抛', async () => {
    const { llm, handle } = llmStub({ chatReject: true });
    const { intents } = await composeIntents(llm, handle, char({}), { day: DAY, gameMinutes: 500 });
    expect(intents.source).toBe('fallback');
    expect(intents.wants.length).toBeGreaterThanOrEqual(3);
  });

  it('无住房角色的状态行提示居无定所;租客带房源名', async () => {
    const { llm, handle, chatMessages } = llmStub({ chatContent: '{"wants":[]}' });
    await composeIntents(llm, handle, char({}), { day: DAY, gameMinutes: 500 });
    expect(chatMessages[1]!.content).toContain('居无定所');
    const renter = llmStub({ chatContent: '{"wants":[]}' });
    await composeIntents(
      renter.llm,
      renter.handle,
      char({ housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 5 } }),
      { day: DAY, gameMinutes: 500 },
    );
    expect(renter.chatMessages[1]!.content).toContain('租住公寓 A');
  });
});

describe('parsePolicy(工具入参→方针偏好)', () => {
  it('合法对象解析 focus/avoid,非白名单活动逐个丢弃', () => {
    expect(parsePolicy({ focus: ['study', 'sleep', 'work'], avoid: ['stroll'] })).toEqual({
      ok: true,
      value: { focus: ['study', 'work'], avoid: ['stroll'] },
    });
  });
  it('非对象判失败;focus 非数组视为空(宽松)', () => {
    expect(parsePolicy('我想想').ok).toBe(false);
    expect(parsePolicy(null).ok).toBe(false);
    expect(parsePolicy({ focus: 'study' })).toEqual({
      ok: true,
      value: { focus: [], avoid: [] },
    });
  });
});

describe('biasOf(编译偏好→活动倾向分)', () => {
  it('focus=+1,avoid=-1 压过 focus,未提及缺 0', () => {
    expect(biasOf({ focus: ['study', 'work'], avoid: ['stroll', 'work'] })).toEqual({
      study: 1,
      work: -1,
      stroll: -1,
    });
    expect(biasOf(null)).toEqual({});
    expect(biasOf(undefined)).toEqual({});
  });
});

describe('composeIntents ctx 注入(M4e 方针+人设)', () => {
  it('方针原文+编译缓存+人设进 prompt;avoid 提示语带白名单活动', async () => {
    const s = llmStub({ chatContent: '{"wants":[{"activity":"study","urgency":0.7,"why":"按方针来"}]}' });
    const { bias } = await composeIntents(
      s.llm,
      s.handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      {
        policyText: '专注学习攒钱,少到处闲逛',
        compiled: { focus: ['study', 'work'], avoid: ['stroll'] },
        persona: '性格: 内向勤奋;目标: 攒钱买房',
      },
    );
    const prompt = s.chatMessages[1]!.content;
    expect(prompt).toContain('生活方针: 专注学习攒钱,少到处闲逛');
    expect(prompt).toContain('不要提: stroll');
    expect(prompt).toContain('优先考虑: study、work');
    expect(s.chatMessages[0]!.content).toContain('你的人设: 性格: 内向勤奋');
    expect(bias).toEqual({ study: 1, work: 1, stroll: -1 });
  });

  it('昨日意图+关注点进 prompt:对照引导不照搬', async () => {
    const s = llmStub({ chatContent: '{"wants":[{"activity":"study","urgency":0.7,"why":"换换口味"}]}' });
    await composeIntents(s.llm, s.handle, char({}), { day: DAY, gameMinutes: 500 }, {
      previous: {
        day: DAY - 1,
        wants: [
          { id: 'w4-0', activityId: 'work', why: '挣钱', origin: 'plan', urgency: 0.8, status: 'done', createdAtMin: 100 },
          { id: 'w4-1', activityId: 'stroll', why: '透气', origin: 'plan', urgency: 0.3, status: 'pending', createdAtMin: 100 },
        ],
        source: 'llm',
      },
      focus: '想把欠的房租挣出来',
    });
    const prompt = s.chatMessages[1]!.content;
    expect(prompt).toContain('你昨天想做的事');
    expect(prompt).toContain('杂工(已完成): 挣钱');
    expect(prompt).toContain('结合昨天的完成情况调整');
    expect(prompt).toContain('想把欠的房租挣出来');
  });

  it('LLM 输出含 avoid 活动→硬过滤剔除', async () => {
    const s = llmStub({
      chatContent:
        '{"wants":[{"activity":"study","urgency":0.7,"why":"学"},{"activity":"stroll","urgency":0.6,"why":"走"}]}',
    });
    const { intents } = await composeIntents(
      s.llm,
      s.handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      { policyText: '不散步', compiled: { focus: [], avoid: ['stroll'] } },
    );
    expect(intents.source).toBe('llm');
    expect(intents.wants).toHaveLength(1);
    expect(intents.wants[0]!.activityId).toBe('study');
  });

  it('LLM 输出全被滤空→个性化回落且回落同样滤 avoid', async () => {
    const s = llmStub({ chatContent: '{"wants":[{"activity":"stroll","urgency":0.6,"why":"走"}]}' });
    const { intents } = await composeIntents(
      s.llm,
      s.handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      { policyText: '不散步', compiled: { focus: [], avoid: ['stroll'] } },
    );
    expect(intents.source).toBe('fallback');
    expect(intents.wants.some((w) => w.activityId === 'stroll')).toBe(false);
    expect(intents.wants.length).toBeGreaterThanOrEqual(3);
  });

  it('slow 槽挂且有方针→回落滤 avoid;无方针回落原样个性化', async () => {
    const rejected = llmStub({ chatReject: true });
    const { intents } = await composeIntents(
      rejected.llm,
      rejected.handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      { policyText: '不散步', compiled: { focus: [], avoid: ['stroll'] } },
    );
    expect(intents.source).toBe('fallback');
    expect(intents.wants.some((w) => w.activityId === 'stroll')).toBe(false);
    const plain = llmStub({ chatReject: true });
    const noCtx = await composeIntents(plain.llm, plain.handle, char({}), { day: DAY, gameMinutes: 500 });
    expect(noCtx.intents.wants.length).toBeGreaterThanOrEqual(3);
  });

  it('full 托管(无方针)有人设→自动编译人格偏好进 prompt 并随产物返回;persona 未变走缓存,变了重编', async () => {
    const chats: string[] = [];
    let personaPolicyCalls = 0;
    const llm: MemoryLlm = {
      systemOne: () => Promise.reject(new Error('unused')) as never,
      embed: () => Promise.resolve({ vector: [0.1, 0.2], promptTokens: 3 }),
      chat: () => Promise.reject(new Error('unused')) as never,
      chatStructured: (_slot, messages, _tool, task, parse) => {
        const isPolicy = task?.taskType === 'agent.persona_policy';
        if (isPolicy) personaPolicyCalls += 1;
        chats.push(messages[messages.length - 1]!.content);
        const parsed = parse(
          isPolicy
            ? { focus: ['study'], avoid: ['stroll'] }
            : { wants: [{ activity: 'study', urgency: 0.7, why: '喜欢读书' }] },
        );
        if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
        return Promise.resolve(parsed.value);
      },
    };
    const handle = {
      db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
    } as unknown as DbHandle;
    const persona = '性格: 内向勤奋;目标: 攒钱买房';
    const first = await composeIntents(llm, handle, char({}), { day: DAY, gameMinutes: 500 }, { persona });
    expect(first.intents.source).toBe('llm');
    expect(first.compiled).toEqual({ focus: ['study'], avoid: ['stroll'] });
    expect(first.bias).toEqual({ study: 1, stroll: -1 });
    expect(personaPolicyCalls).toBe(1);
    expect(chats[chats.length - 1]).toContain('以下活动是人设重点,优先考虑: study');
    expect(chats[chats.length - 1]).toContain('不要提: stroll');
    // persona 文本未变→第二次生成直接命中缓存,不再调编译
    await composeIntents(llm, handle, char({}), { day: DAY, gameMinutes: 500 }, { persona });
    expect(personaPolicyCalls).toBe(1);
    // persona 变了(C5 叙事更新场景)→重编译
    await composeIntents(llm, handle, char({}), { day: DAY, gameMinutes: 500 }, { persona: '性格: 外向爱热闹' });
    expect(personaPolicyCalls).toBe(2);
  });

  it('有玩家方针时不做人格编译(方针优先,不混入人设偏好)', async () => {
    let personaPolicyCalls = 0;
    const llm: MemoryLlm = {
      systemOne: () => Promise.reject(new Error('unused')) as never,
      embed: () => Promise.resolve({ vector: [0.1, 0.2], promptTokens: 3 }),
      chat: () => Promise.reject(new Error('unused')) as never,
      chatStructured: (_slot, _messages, _tool, task, parse) => {
        if (task?.taskType === 'agent.persona_policy') personaPolicyCalls += 1;
        const parsed = parse({ wants: [{ activity: 'work', urgency: 0.8, why: '挣钱' }] });
        if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
        return Promise.resolve(parsed.value);
      },
    };
    const handle = {
      db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
    } as unknown as DbHandle;
    const { intents } = await composeIntents(
      llm,
      handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      { policyText: '专心打工攒钱', persona: '性格: 内向勤奋' },
    );
    expect(intents.source).toBe('llm');
    expect(personaPolicyCalls).toBe(0);
  });
});

describe('compilePersonaPolicy(人设→偏好编译)', () => {
  it('正常输出→过白名单逐个过滤;slow 槽不可用→null 不外抛', async () => {
    const s = llmStub({ chatContent: '{"focus":["study","sleep","bogus"],"avoid":["stroll"]}' });
    expect(await compilePersonaPolicy(s.llm, '性格: 内向,喜欢读书')).toEqual({
      focus: ['study'],
      avoid: ['stroll'],
    });
    expect(s.chatMessages[1]!.content).toContain('人设: 性格: 内向,喜欢读书');
    const bad = llmStub({ chatReject: true });
    expect(await compilePersonaPolicy(bad.llm, '性格: 内向')).toBeNull();
  });
});
