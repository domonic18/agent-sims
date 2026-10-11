/**
 * LangChain 消息 ↔ 前端 assistant-ui(LangChainMessage 协议)序列化(批C)。
 * 自建 SSE 不经 langgraph-server,帧形状在此收敛并被 serialize.test 钉死。
 */

interface LangchainLike {
  id?: string;
  getType?: () => string;
  content?: unknown;
  tool_call_chunks?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
  name?: unknown;
  status?: unknown;
  usage_metadata?: unknown;
  response_metadata?: unknown;
}

function pickType(m: LangchainLike): string {
  const t = m.getType?.();
  if (t === 'human' || t === 'ai' || t === 'tool') return t;
  return 'ai';
}

/** 流式 chunk / 完整消息统一投影:assistant-ui 按 type/content/tool_calls 累积 */
export function serializeMessage(m: unknown): Record<string, unknown> {
  const msg = (m ?? {}) as LangchainLike;
  return {
    id: msg.id,
    type: pickType(msg),
    content: msg.content ?? '',
    additional_kwargs: {},
    response_metadata: msg.response_metadata ?? {},
    tool_calls: Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 ? msg.tool_calls : undefined,
    tool_call_chunks: msg.tool_call_chunks,
    tool_call_id: msg.tool_call_id,
    name: msg.name,
    status: msg.status,
    usage_metadata: msg.usage_metadata,
  };
}

export interface CollectedUsage {
  promptTokens: number;
  completionTokens: number;
}

/** updates 帧载荷({node: {messages: [...]}})提取 usage 并投影为可转发 JSON */
export function serializeUpdates(updates: unknown, usage: CollectedUsage): Record<string, unknown> {
  if (typeof updates !== 'object' || updates === null) return {};
  const out: Record<string, unknown> = {};
  for (const [node, patch] of Object.entries(updates as Record<string, unknown>)) {
    if (typeof patch === 'object' && patch !== null && Array.isArray((patch as { messages?: unknown[] }).messages)) {
      const messages = (patch as { messages: unknown[] }).messages;
      out[node] = { ...((patch as Record<string, unknown>)), messages: messages.map(serializeMessage) };
      for (const m of messages) {
        const meta = (m as LangchainLike).usage_metadata;
        if (typeof meta === 'object' && meta !== null) {
          const u = meta as { input_tokens?: number; output_tokens?: number };
          usage.promptTokens += u.input_tokens ?? 0;
          usage.completionTokens += u.output_tokens ?? 0;
        }
      }
      continue;
    }
    out[node] = patch;
  }
  return out;
}
