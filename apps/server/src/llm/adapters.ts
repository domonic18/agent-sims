import {
  type LlmCallOptions,
  type LlmChatResult,
  type LlmEmbedResult,
  type LlmMessage,
  type SlotRuntimeConfig,
  type SystemOneQuestion,
  type SystemOneResult,
  LlmError,
} from './types.js';

export type FetchImpl = typeof fetch;

interface RawUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Anthropic Messages 版本头(2026-10 官方稳定版) */
const ANTHROPIC_VERSION = '2023-06-01';

async function postJson(
  slot: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number | undefined,
  fetchImpl: FetchImpl,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? 60_000),
    });
  } catch (err) {
    throw new LlmError(slot, `请求失败: ${String(err).slice(0, 200)} @ ${url}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new LlmError(slot, `HTTP ${res.status} @ ${url}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LlmError(slot, `响应非 JSON: ${text.slice(0, 200)}`);
  }
}

function readOpenAiUsage(data: unknown): RawUsage {
  const usage = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  };
}

/** OpenAI 兼容 /chat/completions(deepseek/zhipu/minimax-openai/codiv 双轨之兼容轨) */
export async function chatViaOpenAi(
  cfg: SlotRuntimeConfig,
  messages: LlmMessage[],
  opts: LlmCallOptions,
  fetchImpl: FetchImpl,
): Promise<LlmChatResult> {
  const data = (await postJson(
    cfg.slot,
    `${cfg.baseUrl}/chat/completions`,
    { authorization: `Bearer ${cfg.apiKey}` },
    {
      model: cfg.model,
      messages,
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    },
    opts.timeoutMs,
    fetchImpl,
  )) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  const usage = readOpenAiUsage(data);
  return { content, ...usage };
}

/** Anthropic Messages /messages:x-api-key+版本头;system 角色上提为顶层 system 参数 */
export async function chatViaAnthropic(
  cfg: SlotRuntimeConfig,
  messages: LlmMessage[],
  opts: LlmCallOptions,
  fetchImpl: FetchImpl,
): Promise<LlmChatResult> {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const data = (await postJson(
    cfg.slot,
    `${cfg.baseUrl}/messages`,
    {
      'x-api-key': cfg.apiKey,
      authorization: `Bearer ${cfg.apiKey}`,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    {
      model: cfg.model,
      max_tokens: opts.maxTokens ?? 1024,
      ...(system !== '' ? { system } : {}),
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    },
    opts.timeoutMs,
    fetchImpl,
  )) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  return {
    content,
    promptTokens: data.usage?.input_tokens ?? 0,
    completionTokens: data.usage?.output_tokens ?? 0,
  };
}

/** Jev 原生 /systemone:一次批量问多个类型化问题(自由生成不支持,调研实测) */
export async function chatViaSystemOne(
  cfg: SlotRuntimeConfig,
  state: string,
  questions: Record<string, SystemOneQuestion>,
  opts: LlmCallOptions,
  fetchImpl: FetchImpl,
): Promise<SystemOneResult> {
  const data = (await postJson(
    cfg.slot,
    `${cfg.baseUrl}/systemone`,
    { authorization: `Bearer ${cfg.apiKey}` },
    { model: cfg.model, state, questions },
    opts.timeoutMs,
    fetchImpl,
  )) as {
    model?: string;
    answers?: Record<string, SystemOneResult['answers'][string]>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (!data.answers) {
    throw new LlmError(cfg.slot, `SystemOne 响应缺少 answers: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    model: data.model ?? cfg.model,
    answers: data.answers,
    promptTokens: data.usage?.input_tokens ?? 0,
    completionTokens: data.usage?.output_tokens ?? 0,
  };
}

/** OpenAI 兼容 /embeddings(zhipu/minimax 等) */
export async function embedViaOpenAi(
  cfg: SlotRuntimeConfig,
  inputs: string[],
  opts: LlmCallOptions,
  fetchImpl: FetchImpl,
): Promise<LlmEmbedResult> {
  const data = (await postJson(
    cfg.slot,
    `${cfg.baseUrl}/embeddings`,
    { authorization: `Bearer ${cfg.apiKey}` },
    { model: cfg.model, input: inputs },
    opts.timeoutMs,
    fetchImpl,
  )) as { data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number } };
  const vector = data.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new LlmError(cfg.slot, '响应缺少向量字段');
  }
  return { vector, promptTokens: data.usage?.prompt_tokens ?? 0 };
}
