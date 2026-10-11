/**
 * AI 改图运行时防腐层:集中 assistant-ui 与自建 SSE 端点的全部集成点
 * (threadListAdapter / load / stream / eventHandlers)。Fastify 非 langgraph
 * server,不经官方 SDK——stream 用 fetch POST 解析 text/event-stream,
 * 帧协议(shared MapAgentRunRequest + 服务端 serialize)在此收敛。
 * 编辑器文档在发送瞬间经 useEditor.getState() 快照(零订阅,避免
 * Provider 随编辑器状态重渲染——ai-invest 的教训)。
 */
import { InMemoryThreadListAdapter } from '@assistant-ui/react';
import type {
  LangChainMessage,
  LangGraphStreamCallback,
  OnCustomEventCallback,
  OnUpdatesEventCallback,
} from '@assistant-ui/react-langgraph';
import type { TileMapDefinition } from '@sims/shared';
import {
  createMapAgentThread,
  fetchMapAgentThread,
  streamMapAgentRun,
} from '../api';
import { useEditor } from '../map-editor/editorStore';
import { dispatchAgentCustomEvent, dispatchAgentUpdates } from './eventDispatcher';

/** LangChainMessage 内容 → 纯文本(string 或 text 分片数组) */
function extractText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' ? String((part as { text?: unknown }).text ?? '') : ''))
      .join('');
  }
  return '';
}

/** 解析一段 SSE 帧(event:/data: 行;心跳注释行返回 null) */
function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (event === 'message' && data === '') return null;
  try {
    return { event, data: data === '' ? {} : (JSON.parse(data) as unknown) };
  } catch {
    return null;
  }
}

/** SSE 正文 → {event,data} 流(帧以空行分隔) */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf('\n\n');
      while (sep >= 0) {
        const frame = parseSseBlock(buffer.slice(0, sep));
        if (frame !== null) yield frame;
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');
      }
    }
    const tail = parseSseBlock(buffer.trim());
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export interface MapAgentRuntimeAdapter {
  threadListAdapter: InMemoryThreadListAdapter;
  load: (threadId: string, config?: { signal: AbortSignal }) => Promise<{ messages: LangChainMessage[] }>;
  stream: LangGraphStreamCallback<LangChainMessage>;
  eventHandlers: {
    onUpdates: OnUpdatesEventCallback;
    onCustomEvent: OnCustomEventCallback;
  };
}

export function createMapAgentRuntimeAdapter(): MapAgentRuntimeAdapter {
  // 覆写 initialize(新会话真实建线程,携带编辑器当前 mapId)与
  // fetch(历史线程直接采用传入 id)——默认 adapter 不认识列表外线程
  const threadListAdapter = new InMemoryThreadListAdapter();
  threadListAdapter.initialize = async () => {
    const thread = await createMapAgentThread(useEditor.getState().mapId);
    return { remoteId: thread.threadId, externalId: thread.threadId };
  };
  threadListAdapter.fetch = async (threadId: string) => ({
    status: 'regular' as const,
    remoteId: threadId,
    externalId: threadId,
  });

  return {
    threadListAdapter,
    load: async (threadId) => {
      const detail = await fetchMapAgentThread(threadId);
      return { messages: detail.messages as never };
    },
    stream: async function* (messages, config) {
      const { externalId } = await config.initialize();
      if (!externalId) throw new Error('会话尚未初始化');
      const last = messages[messages.length - 1];
      const message = extractText(last).trim();
      if (message === '') throw new Error('消息为空,无法发送');
      const editor = useEditor.getState();
      const payload = {
        message,
        mapId: editor.mapId,
        definition: editor.doc as unknown as TileMapDefinition,
      };
      const res = await streamMapAgentRun(externalId, payload, config.abortSignal);
      if (res.body === null) throw new Error('响应无正文流');
      for await (const frame of readSse(res.body)) {
        if (frame.event === 'open' || frame.event === 'end') continue;
        yield { event: frame.event, data: frame.data };
      }
    },
    eventHandlers: {
      onUpdates: dispatchAgentUpdates,
      onCustomEvent: dispatchAgentCustomEvent,
    },
  };
}
