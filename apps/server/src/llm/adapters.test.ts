import { describe, expect, it, vi } from 'vitest';
import {
  chatViaAnthropic,
  chatViaOpenAi,
  chatViaSystemOne,
  embedViaOpenAi,
  type FetchImpl,
} from './adapters.js';
import { LlmError } from './types.js';
import type { SlotRuntimeConfig } from './types.js';

const cfg = (protocol: SlotRuntimeConfig['protocol']): SlotRuntimeConfig => ({
  slot: 'slow',
  protocol,
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'sk-test',
});

function mockFetch(status: number, body: unknown): { impl: FetchImpl; calls: Request[] } {
  const calls: Request[] = [];
  const impl = (async (input: Parameters<FetchImpl>[0], init?: Parameters<FetchImpl>[1]) => {
    calls.push(new Request(input, init));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as FetchImpl;
  return { impl, calls };
}

describe('chatViaOpenAi', () => {
  it('POST /chat/completions 带 Bearer 头,解析 content 与 usage', async () => {
    const { impl, calls } = mockFetch(200, {
      choices: [{ message: { content: '你好' } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    });
    const result = await chatViaOpenAi(
      cfg('openai'),
      [
        { role: 'system', content: '背景' },
        { role: 'user', content: '问题' },
      ],
      { maxTokens: 128, temperature: 0.5, timeoutMs: 1000 },
      impl,
    );
    expect(result).toEqual({ content: '你好', promptTokens: 11, completionTokens: 7 });
    const req = calls[0]!;
    expect(req.url).toBe('https://api.example.com/v1/chat/completions');
    expect(req.headers.get('authorization')).toBe('Bearer sk-test');
    const body = (await req.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'test-model',
      max_tokens: 128,
      temperature: 0.5,
      messages: [
        { role: 'system', content: '背景' },
        { role: 'user', content: '问题' },
      ],
    });
  });

  it('HTTP 错误抛 LlmError 带状态码', async () => {
    const { impl } = mockFetch(401, { error: { message: 'bad key' } });
    await expect(
      chatViaOpenAi(cfg('openai'), [{ role: 'user', content: 'x' }], {}, impl),
    ).rejects.toThrow(/401/);
  });

  it('HTTP 200 但正文带 error(one_api 网关形态)显式报错', async () => {
    const { impl } = mockFetch(200, { error: { message: '用户已被封禁', type: 'one_api_error' } });
    await expect(
      chatViaOpenAi(cfg('openai'), [{ role: 'user', content: 'x' }], {}, impl),
    ).rejects.toThrow(/封禁/);
  });
});

describe('chatViaAnthropic', () => {
  it('POST /messages 带 x-api-key+版本头,system 上提顶层,usage 走 input/output', async () => {
    const { impl, calls } = mockFetch(200, {
      content: [
        { type: 'text', text: '回答A' },
        { type: 'tool_use', text: '应被过滤' },
      ],
      usage: { input_tokens: 20, output_tokens: 9 },
    });
    const result = await chatViaAnthropic(
      cfg('anthropic'),
      [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '问题' },
      ],
      { maxTokens: 256, timeoutMs: 1000 },
      impl,
    );
    expect(result).toEqual({ content: '回答A', promptTokens: 20, completionTokens: 9 });
    const req = calls[0]!;
    expect(req.url).toBe('https://api.example.com/v1/messages');
    expect(req.headers.get('x-api-key')).toBe('sk-test');
    expect(req.headers.get('anthropic-version')).toBe('2023-06-01');
    const body = (await req.json()) as {
      system?: string;
      messages: Array<{ role: string }>;
      max_tokens?: number;
    };
    expect(body.system).toBe('你是助手');
    expect(body.messages).toEqual([{ role: 'user', content: '问题' }]);
    expect(body.max_tokens).toBe(256);
  });

  it('max_tokens 缺省 1024(anthropic 必填)', async () => {
    const { impl, calls } = mockFetch(200, { content: [{ type: 'text', text: 'ok' }], usage: {} });
    await chatViaAnthropic(cfg('anthropic'), [{ role: 'user', content: 'x' }], {}, impl);
    const body = (await calls[0]!.json()) as { max_tokens: number };
    expect(body.max_tokens).toBe(1024);
  });
});

describe('chatViaSystemOne', () => {
  it('POST /systemone,body={model,state,questions},answers 原样透传+usage', async () => {
    const answers = {
      go: { type: 'choice', choice: 'A', probabilities: { A: 0.9 }, confidence: 0.8 },
    };
    const { impl, calls } = mockFetch(200, {
      model: 'openjev-0.1',
      answers,
      usage: { input_tokens: 99, output_tokens: 0 },
    });
    const result = await chatViaSystemOne(
      cfg('systemone'),
      '小镇居民,精力充沛',
      { go: { type: 'choice', instructions: '去哪', criteria: { A: '选项A', B: '选项B' } } },
      { timeoutMs: 1000 },
      impl,
    );
    expect(result.model).toBe('openjev-0.1');
    expect(result.answers).toEqual(answers);
    expect(result.promptTokens).toBe(99);
    expect(result.completionTokens).toBe(0);
    const body = (await calls[0]!.json()) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'test-model',
      state: '小镇居民,精力充沛',
      questions: { go: { type: 'choice', instructions: '去哪', criteria: { A: '选项A', B: '选项B' } } },
    });
  });

  it('缺 answers 抛 LlmError', async () => {
    const { impl } = mockFetch(200, { detail: 'weird' });
    await expect(
      chatViaSystemOne(cfg('systemone'), 's', {}, {}, impl),
    ).rejects.toBeInstanceOf(LlmError);
  });
});

describe('embedViaOpenAi', () => {
  it('POST /embeddings,返回向量与 usage', async () => {
    const { impl, calls } = mockFetch(200, {
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 5 },
    });
    const result = await embedViaOpenAi(cfg('openai'), ['ping'], { timeoutMs: 1000 }, impl);
    expect(result).toEqual({ vector: [0.1, 0.2, 0.3], promptTokens: 5 });
    expect(calls[0]!.url).toBe('https://api.example.com/v1/embeddings');
  });

  it('缺向量字段抛 LlmError', async () => {
    const { impl } = mockFetch(200, { data: [] });
    await expect(embedViaOpenAi(cfg('openai'), ['ping'], {}, impl)).rejects.toBeInstanceOf(LlmError);
  });
});

describe('网络异常', () => {
  it('fetch 拒绝 → LlmError 带原因', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as FetchImpl;
    await expect(
      chatViaOpenAi(cfg('openai'), [{ role: 'user', content: 'x' }], {}, impl),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
