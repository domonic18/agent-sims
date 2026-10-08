import { describe, expect, it } from 'vitest';
import type { DbHandle } from '../db/client.js';
import type { WorldCharacter } from '../world/character.js';
import type { MemoryLlm } from './memory-writer.js';
import {
  DEFAULT_PLAN_TEMPLATE,
  parseDayPlan,
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
