/**
 * AI 改图助手全局状态(zustand,仅进 admin chunk):抽屉开关/当前线程/
 * ask_user 问题卡/会话索引。事件分派器(eventDispatcher)在 React 外
 * 经 getState() 写入,组件订阅读取——与 ai-invest assistant store 同模式。
 */
import { create } from 'zustand';
import type { MapAgentThreadItem } from '@sims/shared';

export interface AgentQuestionOption {
  value: string;
  label: string;
}

export interface AgentQuestion {
  id: string;
  question: string;
  options: AgentQuestionOption[];
  default: string | null;
}

interface MapAgentState {
  open: boolean;
  threadId: string | undefined;
  question: AgentQuestion | null;
  threads: MapAgentThreadItem[];

  openDrawer(): void;
  closeDrawer(): void;
  switchThread(threadId: string | undefined): void;
  setQuestion(question: AgentQuestion | null): void;
  setThreads(items: MapAgentThreadItem[]): void;
}

export const useMapAgent = create<MapAgentState>((set) => ({
  open: false,
  threadId: undefined,
  question: null,
  threads: [],

  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
  // 切线程/新对话一并清掉残留问题卡与 pending 流(线程上下文变了)
  switchThread: (threadId) => set({ threadId, question: null }),
  setQuestion: (question) => set({ question }),
  setThreads: (threads) => set({ threads }),
}));
