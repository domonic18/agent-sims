import { describe, expect, it } from 'vitest';
import type { DbHandle } from '../db/client.js';
import type { WorldCharacter } from '../world/character.js';
import type { MemoryLlm } from './memory-writer.js';
import {
  compilePersonaPolicy,
  DEFAULT_PLAN_TEMPLATE,
  parseDayPlan,
  parsePolicy,
  planBlockAt,
  planDay,
  type DayPlan,
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
    chat: (_slot, messages) => {
      chatMessages.push(...messages);
      if (opts.chatReject === true) return Promise.reject(new Error('slow 槽未配置'));
      return Promise.resolve({
        content: opts.chatContent ?? '',
        promptTokens: 10,
        completionTokens: 10,
      });
    },
  };
  return { llm, handle, chatMessages, get embedCalls() { return embedCalls; } };
}

describe('parseDayPlan(慢槽自由文本→计划块)', () => {
  it('合法 JSON 数组解析成块并按 start 排序', () => {
    const blocks = parseDayPlan('[{"start":14,"end":18,"activity":"work"},{"start":8,"end":12,"activity":"study"}]');
    expect(blocks).toEqual([
      { startMin: 480, endMin: 720, activityId: 'study' },
      { startMin: 840, endMin: 1080, activityId: 'work' },
    ]);
  });

  it('容忍围栏与前后杂讯;非法行剔除(sleep 不在白名单);重叠合法行保留由执行层取首块', () => {
    const fenced = parseDayPlan('好的,计划如下:\n```json\n[{"start":8,"end":12,"activity":"study"},{"start":12,"end":13,"activity":"sleep"},{"start":9,"end":10,"activity":"stroll"}]\n```');
    expect(fenced).toEqual([
      { startMin: 480, endMin: 720, activityId: 'study' },
      { startMin: 540, endMin: 600, activityId: 'stroll' },
    ]);
    expect(parseDayPlan('[]')).toBeNull();
    expect(parseDayPlan('{"start":8}')).toBeNull();
    expect(parseDayPlan('今天想休息')).toBeNull();
    expect(parseDayPlan('[{"start":25,"end":26,"activity":"study"}]')).toBeNull();
    expect(parseDayPlan('[{"start":12,"end":8,"activity":"study"}]')).toBeNull();
  });
});

describe('planBlockAt(分钟→当前块)', () => {
  const plan: DayPlan = { day: 1, blocks: [...DEFAULT_PLAN_TEMPLATE], source: 'fallback' };
  it('命中含头不含尾;空档/越界返回 null', () => {
    expect(planBlockAt(plan, 480)?.activityId).toBe('study');
    expect(planBlockAt(plan, 719)?.activityId).toBe('study');
    expect(planBlockAt(plan, 720)?.activityId).toBe('meal');
    expect(planBlockAt(plan, 100)).toBeNull();
    expect(planBlockAt(plan, 1400)).toBeNull();
  });
});

describe('planDay(慢层日计划生成)', () => {
  it('LLM 正常输出→source llm,记忆证据进 prompt(embed+检索各一次)', async () => {
    const s = llmStub({
      chatContent: '[{"start":8,"end":12,"activity":"study"},{"start":12,"end":13,"activity":"meal"}]',
      memoryRows: [{ content: '我学习了 60 分钟' }, { content: '我和阿泽聊了天' }],
    });
    const plan = await planDay(s.llm, s.handle, char({}), { day: DAY, gameMinutes: 500 });
    expect(plan.day).toBe(DAY);
    expect(plan.source).toBe('llm');
    expect(plan.blocks).toHaveLength(2);
    expect(s.chatMessages).toHaveLength(2);
    expect(s.chatMessages[1]!.content).toContain('我学习了 60 分钟');
    expect(s.chatMessages[1]!.content).toContain('金币 50');
    expect(s.chatMessages[1]!.content).toContain('study');
    expect(s.embedCalls).toBe(1);
  });

  it('LLM 输出垃圾→回落模板(source fallback,计划仍可用)', async () => {
    const { llm, handle } = llmStub({ chatContent: '我想想……说不太清楚' });
    const plan = await planDay(llm, handle, char({}), { day: DAY, gameMinutes: 500 });
    expect(plan.source).toBe('fallback');
    expect(plan.blocks).toEqual([...DEFAULT_PLAN_TEMPLATE]);
  });

  it('slow 槽不可用(chat 拒绝)→回落模板,绝不外抛', async () => {
    const { llm, handle } = llmStub({ chatReject: true });
    const plan = await planDay(llm, handle, char({}), { day: DAY, gameMinutes: 500 });
    expect(plan.source).toBe('fallback');
  });

  it('无住房角色的状态行提示居无定所;租客带房源名', async () => {
    const { llm, handle, chatMessages } = llmStub({ chatContent: '[]' });
    await planDay(llm, handle, char({}), { day: DAY, gameMinutes: 500 });
    expect(chatMessages[1]!.content).toContain('居无定所');
    const renter = llmStub({ chatContent: '[]' });
    await planDay(
      renter.llm,
      renter.handle,
      char({ housing: { propertyId: 'home-a', ownership: 'rent', paidThroughDay: DAY + 5 } }),
      { day: DAY, gameMinutes: 500 },
    );
    expect(renter.chatMessages[1]!.content).toContain('租住公寓 A');
  });
});

describe('parsePolicy(慢槽输出→方针偏好)', () => {
  it('合法 JSON 解析 focus/avoid,非白名单活动逐个丢弃', () => {
    expect(parsePolicy('{"focus":["study","sleep","work"],"avoid":["stroll"]}')).toEqual({
      focus: ['study', 'work'],
      avoid: ['stroll'],
    });
  });
  it('不可解析/形状非法返回 null', () => {
    expect(parsePolicy('我想想')).toBeNull();
    expect(parsePolicy('[1,2]')).toBeNull();
    expect(parsePolicy('{"focus":"study"}')).toEqual({ focus: [], avoid: [] });
  });
});

describe('planDay ctx 注入(M4e 方针+人设)', () => {
  it('方针原文+编译缓存+人设进 prompt;avoid 提示语带白名单活动', async () => {
    const s = llmStub({ chatContent: '[{"start":8,"end":12,"activity":"study"}]' });
    await planDay(
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
    expect(prompt).toContain('禁止安排: stroll');
    expect(prompt).toContain('重点: study、work');
    expect(prompt).toContain('人设: 性格: 内向勤奋');
  });

  it('昨日计划+风味提示进 prompt:对照引导不照搬', async () => {
    const s = llmStub({ chatContent: '[{"start":8,"end":12,"activity":"study"}]' });
    await planDay(s.llm, s.handle, char({}), { day: DAY, gameMinutes: 500 }, {
      previous: {
        day: DAY - 1,
        blocks: [
          { startMin: 480, endMin: 720, activityId: 'work' },
          { startMin: 720, endMin: 780, activityId: 'meal' },
        ],
        source: 'llm',
      },
    });
    const prompt = s.chatMessages[1]!.content;
    expect(prompt).toContain('你昨天的安排');
    expect(prompt).toContain('至少有 1~2 个时间段与昨天不同');
    expect(prompt).toContain('今日风味提示');
  });

  it('LLM 输出含 avoid 活动→硬过滤剔除', async () => {
    const s = llmStub({
      chatContent:
        '[{"start":8,"end":12,"activity":"study"},{"start":12,"end":14,"activity":"stroll"}]',
    });
    const plan = await planDay(
      s.llm,
      s.handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      { policyText: '不散步', compiled: { focus: [], avoid: ['stroll'] } },
    );
    expect(plan.source).toBe('llm');
    expect(plan.blocks).toEqual([{ startMin: 480, endMin: 720, activityId: 'study' }]);
  });

  it('LLM 输出全被滤空→回落模板且模板同样滤 avoid', async () => {
    const s = llmStub({
      chatContent: '[{"start":10,"end":12,"activity":"stroll"}]',
    });
    const plan = await planDay(
      s.llm,
      s.handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      { policyText: '不散步', compiled: { focus: [], avoid: ['stroll'] } },
    );
    expect(plan.source).toBe('fallback');
    expect(plan.blocks.some((b) => b.activityId === 'stroll')).toBe(false);
    expect(plan.blocks.length).toBe(DEFAULT_PLAN_TEMPLATE.length - 1);
  });

  it('slow 槽挂且有方针→回落模板滤 avoid;无方针模板原样', async () => {
    const rejected = llmStub({ chatReject: true });
    const plan = await planDay(
      rejected.llm,
      rejected.handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      { policyText: '不散步', compiled: { focus: [], avoid: ['stroll'] } },
    );
    expect(plan.source).toBe('fallback');
    expect(plan.blocks.some((b) => b.activityId === 'stroll')).toBe(false);
    const plain = llmStub({ chatReject: true });
    const noCtx = await planDay(plain.llm, plain.handle, char({}), { day: DAY, gameMinutes: 500 });
    expect(noCtx.blocks).toEqual([...DEFAULT_PLAN_TEMPLATE]);
  });

  it('full 托管(无方针)有人设→自动编译人格偏好进 prompt;persona 未变走缓存,变了重编', async () => {
    const chats: string[] = [];
    let personaPolicyCalls = 0;
    const llm: MemoryLlm = {
      systemOne: () => Promise.reject(new Error('unused')) as never,
      embed: () => Promise.resolve({ vector: [0.1, 0.2], promptTokens: 3 }),
      chat: (_slot, messages, task) => {
        const isPolicy = task?.taskType === 'agent.persona_policy';
        if (isPolicy) personaPolicyCalls += 1;
        chats.push(messages[messages.length - 1]!.content);
        return Promise.resolve({
          content: isPolicy
            ? '{"focus":["study","sleep"],"avoid":["stroll"]}'
            : '[{"start":8,"end":12,"activity":"study"}]',
          promptTokens: 10,
          completionTokens: 10,
        });
      },
    };
    const handle = {
      db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
    } as unknown as DbHandle;
    const persona = '性格: 内向勤奋;目标: 攒钱买房';
    const plan = await planDay(llm, handle, char({}), { day: DAY, gameMinutes: 500 }, { persona });
    expect(plan.source).toBe('llm');
    expect(personaPolicyCalls).toBe(1);
    expect(chats[chats.length - 1]).toContain('以下活动是人设重点: study,请优先安排');
    expect(chats[chats.length - 1]).toContain('禁止安排: stroll');
    // persona 文本未变→第二次计划直接命中缓存,不再调编译
    await planDay(llm, handle, char({}), { day: DAY, gameMinutes: 500 }, { persona });
    expect(personaPolicyCalls).toBe(1);
    // persona 变了(C5 叙事更新场景)→重编译
    await planDay(llm, handle, char({}), { day: DAY, gameMinutes: 500 }, { persona: '性格: 外向爱热闹' });
    expect(personaPolicyCalls).toBe(2);
  });

  it('有玩家方针时不做人格编译(方针优先,不混入人设偏好)', async () => {
    let personaPolicyCalls = 0;
    const llm: MemoryLlm = {
      systemOne: () => Promise.reject(new Error('unused')) as never,
      embed: () => Promise.resolve({ vector: [0.1, 0.2], promptTokens: 3 }),
      chat: (_slot, _messages, task) => {
        if (task?.taskType === 'agent.persona_policy') personaPolicyCalls += 1;
        return Promise.resolve({
          content: '[{"start":8,"end":12,"activity":"study"}]',
          promptTokens: 10,
          completionTokens: 10,
        });
      },
    };
    const handle = {
      db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
    } as unknown as DbHandle;
    const plan = await planDay(
      llm,
      handle,
      char({}),
      { day: DAY, gameMinutes: 500 },
      { policyText: '专心打工攒钱', persona: '性格: 内向勤奋' },
    );
    expect(plan.source).toBe('llm');
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
