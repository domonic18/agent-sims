/**
 * AI 助手运行时装配(瘦 Provider):线程态走 mapAgentStore(抽屉是唯一宿主),
 * adapter 引用 useMemo 稳定。禁止订阅业务 store 或内联配置对象——
 * Provider 重渲染 = 侧边栏全树重渲染(ai-invest 教训)。
 */
import type { ReactNode } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useLangGraphRuntime } from '@assistant-ui/react-langgraph';
import { useMemo } from 'react';
import { useMapAgent } from './mapAgentStore';
import { createMapAgentRuntimeAdapter } from './runtimeAdapter';

export function MapAgentRuntimeProvider({ children }: { children: ReactNode }) {
  const threadId = useMapAgent((s) => s.threadId);
  const switchThread = useMapAgent((s) => s.switchThread);
  const adapter = useMemo(() => createMapAgentRuntimeAdapter(), []);

  const runtime = useLangGraphRuntime({
    threadId,
    onThreadIdChange: switchThread,
    unstable_threadListAdapter: adapter.threadListAdapter,
    eventHandlers: adapter.eventHandlers,
    load: adapter.load,
    stream: adapter.stream,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
