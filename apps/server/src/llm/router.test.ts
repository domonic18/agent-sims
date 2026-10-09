import { describe, expect, it, vi } from 'vitest';
import type { ModelSlot } from '@sims/shared';
import { ModelRouter } from './router.js';
import type { FetchImpl } from './adapters.js';
import type { SlotRuntimeConfig } from './types.js';
import type { TokenUsageEntry } from './usage.js';

const cfg = (
  protocol: SlotRuntimeConfig['protocol'],
  slot: ModelSlot = 'slow',
  maxTokens: number | null = null,
): SlotRuntimeConfig => ({
  slot,
  protocol,
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'sk-test',
  maxTokens,
});

function mockFetch(status: number, body: unknown): FetchImpl {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as FetchImpl;
}

function buildRouter(
  protocol: SlotRuntimeConfig['protocol'],
  fetchBody: unknown,
  slot: ModelSlot = 'slow',
  maxTokens: number | null = null,
) {
  const persisted: TokenUsageEntry[] = [];
  const router = new ModelRouter({} as never, {
    fetchImpl: mockFetch(200, fetchBody),
    loadConfig: async () => cfg(protocol, slot, maxTokens),
    persistUsage: async (entry) => {
      persisted.push(entry);
    },
  });
  return { router, persisted };
}

describe('ModelRouter.chat', () => {
  it('anthropic 槽位走 /messages,记账一行 taskType/双 token', async () => {
    const { router, persisted } = buildRouter('anthropic', {
      content: [{ type: 'text', text: '答' }],
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    const result = await router.chat(
      'slow',
      [{ role: 'user', content: 'q' }],
      { taskType: 'unit_test', characterId: 'c1' },
    );
    expect(result.content).toBe('答');
    expect(persisted).toEqual([
      { slot: 'slow', characterId: 'c1', taskType: 'unit_test', promptTokens: 12, completionTokens: 3 },
    ]);
  });

  it('openai 槽位走 /chat/completions', async () => {
    const { router, persisted } = buildRouter('openai', {
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 8, completion_tokens: 2 },
    });
    const result = await router.chat('light', [{ role: 'user', content: 'q' }], {
      taskType: 'unit_test',
    });
    expect(result.content).toBe('hi');
    expect(persisted[0]).toMatchObject({ slot: 'light', promptTokens: 8, completionTokens: 2 });
  });

  it('systemone 槽位拒绝 chat(systemone 无对话形态)', async () => {
    const { router, persisted } = buildRouter('systemone', {}, 'jev');
    await expect(
      router.chat('jev', [{ role: 'user', content: 'q' }], { taskType: 'unit_test' }),
    ).rejects.toThrow(/systemOne/);
    expect(persisted).toEqual([]);
  });

  it('适配器抛错时不记账', async () => {
    const persisted: TokenUsageEntry[] = [];
    const router = new ModelRouter({} as never, {
      fetchImpl: mockFetch(500, { error: 'boom' }),
      loadConfig: async () => cfg('openai'),
      persistUsage: async (entry) => {
        persisted.push(entry);
      },
    });
    await expect(
      router.chat('slow', [{ role: 'user', content: 'q' }], { taskType: 'unit_test' }),
    ).rejects.toThrow(/500/);
    expect(persisted).toEqual([]);
  });

  it('maxTokens:槽位设置值覆盖任务值,null 时任务值透传', async () => {
    const bodies: Array<{ max_tokens?: number }> = [];
    const echoFetch = (async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '答' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as FetchImpl;
    const persisted: TokenUsageEntry[] = [];
    const router = new ModelRouter({} as never, {
      fetchImpl: echoFetch,
      loadConfig: async () => cfg('anthropic', 'light', 2048),
      persistUsage: async (entry) => {
        persisted.push(entry);
      },
    });
    await router.chat('light', [{ role: 'user', content: 'q' }], { taskType: 'unit_test', maxTokens: 512 });
    const fallback = new ModelRouter({} as never, {
      fetchImpl: echoFetch,
      loadConfig: async () => cfg('anthropic', 'light'),
      persistUsage: async (entry) => {
        persisted.push(entry);
      },
    });
    await fallback.chat('light', [{ role: 'user', content: 'q' }], { taskType: 'unit_test', maxTokens: 512 });
    expect(bodies.map((b) => b.max_tokens)).toEqual([2048, 512]);
  });

  it('槽位与任务都没设时落 MODEL_SLOT_MAX_TOKENS 内置默认', async () => {
    const bodies: Array<{ max_tokens?: number }> = [];
    const echoFetch = (async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '答' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as FetchImpl;
    const mk = (slot: ModelSlot) =>
      new ModelRouter({} as never, {
        fetchImpl: echoFetch,
        loadConfig: async () => cfg('anthropic', slot),
        persistUsage: async () => {},
      });
    await mk('slow').chat('slow', [{ role: 'user', content: 'q' }], { taskType: 'unit_test' });
    await mk('light').chat('light', [{ role: 'user', content: 'q' }], { taskType: 'unit_test' });
    expect(bodies.map((b) => b.max_tokens)).toEqual([8192, 4096]);
  });

  it('正文为空且输出撞上限:加倍上限重试一次,两次均记账', async () => {
    const bodies: Array<{ max_tokens?: number }> = [];
    const responses = [
      { content: [{ type: 'text', text: '' }], usage: { input_tokens: 10, output_tokens: 8192 } },
      { content: [{ type: 'text', text: '重试后出正文' }], usage: { input_tokens: 10, output_tokens: 100 } },
    ];
    let i = 0;
    const seqFetch = (async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responses[Math.min(i++, responses.length - 1)]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as FetchImpl;
    const persisted: TokenUsageEntry[] = [];
    const router = new ModelRouter({} as never, {
      fetchImpl: seqFetch,
      loadConfig: async () => cfg('anthropic', 'slow'),
      persistUsage: async (entry) => {
        persisted.push(entry);
      },
    });
    const result = await router.chat('slow', [{ role: 'user', content: 'q' }], { taskType: 'unit_test' });
    expect(bodies.map((b) => b.max_tokens)).toEqual([8192, 16384]);
    expect(result.content).toBe('重试后出正文');
    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toMatchObject({ completionTokens: 100 });
  });

  it('正文为空但未撞上限:不重试', async () => {
    let calls = 0;
    const seqFetch = (async () => {
      calls++;
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: '' }], usage: { input_tokens: 5, output_tokens: 50 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as FetchImpl;
    const router = new ModelRouter({} as never, {
      fetchImpl: seqFetch,
      loadConfig: async () => cfg('anthropic', 'slow'),
      persistUsage: async () => {},
    });
    const result = await router.chat('slow', [{ role: 'user', content: 'q' }], { taskType: 'unit_test' });
    expect(calls).toBe(1);
    expect(result.content).toBe('');
  });
});

describe('ModelRouter.chatStructured', () => {
  const tool = {
    name: 'submit_thing',
    description: '提交结果',
    inputSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
  };
  const parseOk = (raw: unknown): { ok: true; value: string } | { ok: false; reason: string } => {
    const answer = (raw as { answer?: unknown }).answer;
    return answer === 'ok'
      ? { ok: true, value: answer as string }
      : { ok: false, reason: `answer=${String(answer)} 不合规` };
  };

  function seqRouter(
    protocol: SlotRuntimeConfig['protocol'],
    responses: unknown[],
    persisted: TokenUsageEntry[],
  ) {
    const bodies: Array<Record<string, unknown>> = [];
    let i = 0;
    const fetchImpl = (async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responses[Math.min(i++, responses.length - 1)]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as FetchImpl;
    const router = new ModelRouter({} as never, {
      fetchImpl,
      loadConfig: async () => cfg(protocol),
      persistUsage: async (entry) => {
        persisted.push(entry);
      },
    });
    return { router, bodies };
  }

  it('anthropic 轨:强制 tool_use+关 thinking,校验通过返回 value 并记账', async () => {
    const persisted: TokenUsageEntry[] = [];
    const { router, bodies } = seqRouter(
      'anthropic',
      [{ content: [{ type: 'tool_use', input: { answer: 'ok' } }], usage: { input_tokens: 20, output_tokens: 6 } }],
      persisted,
    );
    const value = await router.chatStructured(
      'slow',
      [{ role: 'user', content: 'q' }],
      tool,
      { taskType: 'unit_test', characterId: 'c1' },
      parseOk,
    );
    expect(value).toBe('ok');
    expect(bodies[0]).toMatchObject({
      thinking: { type: 'disabled' },
      tool_choice: { type: 'tool', name: 'submit_thing' },
      tools: [{ name: 'submit_thing', description: '提交结果', input_schema: tool.inputSchema }],
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ slot: 'slow', characterId: 'c1', promptTokens: 20, completionTokens: 6 });
  });

  it('校验失败→带错误消息重试一次,两次均记账,二次成功返回 value', async () => {
    const persisted: TokenUsageEntry[] = [];
    const { router, bodies } = seqRouter(
      'anthropic',
      [
        { content: [{ type: 'tool_use', input: { answer: 'bad' } }], usage: { input_tokens: 10, output_tokens: 5 } },
        { content: [{ type: 'tool_use', input: { answer: 'ok' } }], usage: { input_tokens: 10, output_tokens: 5 } },
      ],
      persisted,
    );
    const value = await router.chatStructured(
      'slow',
      [{ role: 'user', content: 'q' }],
      tool,
      { taskType: 'unit_test' },
      parseOk,
    );
    expect(value).toBe('ok');
    expect(persisted).toHaveLength(2);
    const retryMsgs = bodies[1]!.messages as Array<{ role: string; content: string }>;
    const last = retryMsgs[retryMsgs.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('未通过校验');
    expect(last.content).toContain('answer=bad 不合规');
  });

  it('两次校验均失败→抛错(调用方走回落),两次记账', async () => {
    const persisted: TokenUsageEntry[] = [];
    const bad = {
      choices: [{ message: { tool_calls: [{ function: { arguments: '{"answer":"bad"}' } }] } }],
      usage: { prompt_tokens: 7, completion_tokens: 2 },
    };
    const { router } = seqRouter('openai', [bad, bad], persisted);
    await expect(
      router.chatStructured(
        'slow',
        [{ role: 'user', content: 'q' }],
        tool,
        { taskType: 'unit_test' },
        () => ({ ok: false as const, reason: '永远不行' }),
      ),
    ).rejects.toThrow(/两次校验失败/);
    expect(persisted).toHaveLength(2);
  });

  it('openai 轨:强制 function call,arguments JSON 串解析为入参', async () => {
    const persisted: TokenUsageEntry[] = [];
    const { router, bodies } = seqRouter(
      'openai',
      [
        {
          choices: [{ message: { tool_calls: [{ function: { arguments: '{"answer":"ok"}' } }] } }],
          usage: { prompt_tokens: 9, completion_tokens: 4 },
        },
      ],
      persisted,
    );
    const value = await router.chatStructured(
      'slow',
      [{ role: 'user', content: 'q' }],
      tool,
      { taskType: 'unit_test' },
      parseOk,
    );
    expect(value).toBe('ok');
    expect(bodies[0]!.tool_choice).toEqual({ type: 'function', function: { name: 'submit_thing' } });
    expect(persisted[0]).toMatchObject({ slot: 'slow', promptTokens: 9, completionTokens: 4 });
  });

  it('systemone 槽位拒绝结构化对话', async () => {
    const persisted: TokenUsageEntry[] = [];
    const { router } = seqRouter('systemone', [{}], persisted);
    await expect(
      router.chatStructured(
        'jev',
        [{ role: 'user', content: 'q' }],
        tool,
        { taskType: 'unit_test' },
        () => ({ ok: true as const, value: 1 }),
      ),
    ).rejects.toThrow(/systemone/);
    expect(persisted).toEqual([]);
  });
});

describe('ModelRouter.systemOne', () => {
  it('systemone 槽位走 /systemone 并记账', async () => {
    const { router, persisted } = buildRouter(
      'systemone',
      { model: 'openjev-0.1', answers: { q: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: 50, output_tokens: 0 } },
      'jev',
    );
    const result = await router.systemOne(
      'jev',
      'state',
      { q: { type: 'noul', instructions: '闲置?' } },
      { taskType: 'unit_test' },
    );
    expect(result.answers.q).toEqual({ type: 'noul', noul: 0.7 });
    expect(persisted).toEqual([
      { slot: 'jev', characterId: null, taskType: 'unit_test', promptTokens: 50, completionTokens: 0 },
    ]);
  });

  it('非 systemone 协议拒绝', async () => {
    const { router } = buildRouter('openai', {}, 'jev');
    await expect(
      router.systemOne('jev', 's', {}, { taskType: 'unit_test' }),
    ).rejects.toThrow(/chat/);
  });
});

describe('ModelRouter.embed', () => {
  it('embedding 槽位返回向量并记账(completion 恒 0)', async () => {
    const { router, persisted } = buildRouter('openai', {
      data: [{ embedding: [1, 2] }],
      usage: { prompt_tokens: 4 },
    }, 'embedding');
    const result = await router.embed('embedding', ['text'], { taskType: 'unit_test' });
    expect(result.vector).toEqual([1, 2]);
    expect(persisted).toEqual([
      { slot: 'embedding', characterId: null, taskType: 'unit_test', promptTokens: 4, completionTokens: 0 },
    ]);
  });
});

describe('默认 loadConfig', () => {
  it('db 无行/未启用时抛带槽位的错误(loadConfig 可注入,默认实现联测走容器)', async () => {
    const spy = vi.fn().mockRejectedValue(new Error('槽位 slow 未启用'));
    const router = new ModelRouter({} as never, { loadConfig: spy });
    await expect(
      router.chat('slow', [{ role: 'user', content: 'q' }], { taskType: 'x' }),
    ).rejects.toThrow(/未启用/);
    expect(spy).toHaveBeenCalledWith('slow');
  });
});
