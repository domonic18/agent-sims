/**
 * 线程地图文档仓库(批C):AI 工具操作的当前布局。每次 run 开始由 SSE 端点
 * 注入(编辑器前端携带最新 definition 优先,maps 表兜底);工具读写此处;
 * run 结束端点按 mutated 异步回写 maps 表草稿。变更推送走工具 runtime 的
 * langgraph stream writer(custom 通道),不在此处注册回调。
 */
import type { TileMapDefinition } from '@sims/shared';

interface ThreadDocState {
  mapId: string | null;
  doc: TileMapDefinition;
  mutated: boolean;
}

const store = new Map<string, ThreadDocState>();

export function beginThreadDoc(threadId: string, init: { mapId: string | null; doc: TileMapDefinition }): void {
  store.set(threadId, { ...init, mutated: false });
}

export function endThreadDoc(threadId: string): { mapId: string | null; doc: TileMapDefinition; mutated: boolean } | null {
  const state = store.get(threadId);
  store.delete(threadId);
  if (state === undefined) return null;
  return { mapId: state.mapId, doc: state.doc, mutated: state.mutated };
}

export function getThreadDoc(threadId: string): TileMapDefinition | null {
  return store.get(threadId)?.doc ?? null;
}

/** 工具替换整图:记录 mutated(推送由调用方经 runtime.writer 完成) */
export function replaceThreadDoc(threadId: string, doc: TileMapDefinition): void {
  const state = store.get(threadId);
  if (state === undefined) return;
  state.doc = doc;
  state.mutated = true;
}
