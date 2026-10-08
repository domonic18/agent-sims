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
