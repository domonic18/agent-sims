/**
 * AI 助手事件分派(唯一入口):custom 通道的 question(问题卡)与
 * map_updated(整图替换)全部经此收敛。map_updated 以单条 update 命令
 * 入编辑器撤销栈(path=[])——人工 Cmd/Ctrl+Z 一键撤销 AI 的整轮修改。
 * 注册表驱动、幂等;Provider 与 runtimeAdapter 不各自接线。
 */
import type { TileMapDefinition } from '@sims/shared';
import { useEditor } from '../map-editor/editorStore';
import { useMapAgent, type AgentQuestion } from './mapAgentStore';

/** ask_user 事件 → 问题卡(宽松 parse:字段畸形不渲染) */
export function parseAgentQuestion(event: unknown): AgentQuestion | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as { id?: unknown; question?: unknown; options?: unknown; default?: unknown };
  const options = Array.isArray(e.options)
    ? e.options
        .map((raw) => {
          const opt = (raw ?? {}) as { value?: unknown; label?: unknown };
          return { value: String(opt.value ?? ''), label: String(opt.label ?? '') };
        })
        .filter((opt) => opt.value !== '' && opt.label !== '')
    : [];
  const question = String(e.question ?? '');
  if (question === '' || options.length < 2) return null;
  return {
    id: String(e.id ?? ''),
    question,
    options,
    default: e.default == null ? null : String(e.default),
  };
}

function looksLikeDefinition(v: unknown): v is TileMapDefinition {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d.width === 'number' && typeof d.height === 'number' && Array.isArray(d.places);
}

/** agent 整图替换 → 编辑器单条命令(undo 可整体回退);无变化跳过 */
export function applyAgentDoc(definition: unknown, label: unknown): boolean {
  if (!looksLikeDefinition(definition)) return false;
  const s = useEditor.getState();
  if (JSON.stringify(s.doc) === JSON.stringify(definition)) return false;
  s.commit({
    kind: 'update',
    label: `AI:${typeof label === 'string' && label !== '' ? label : '修改地图'}`,
    path: [],
    before: s.doc,
    after: definition,
  });
  return true;
}

/** custom SSE 事件(assistant-ui 回调签名 (eventType, data),data 为载荷) */
export function dispatchAgentCustomEvent(_eventType: string, data: unknown): void {
  if (typeof data !== 'object' || data === null) return;
  const type = (data as { type?: unknown }).type;
  if (type === 'question') {
    const question = parseAgentQuestion(data);
    if (question !== null) useMapAgent.getState().setQuestion(question);
    return;
  }
  if (type === 'map_updated') {
    const d = data as { definition?: unknown; label?: unknown };
    applyAgentDoc(d.definition, d.label);
  }
}

/** updates 通道兜底:工具消息的 ask_user 标记(custom 丢失时仍出问题卡) */
export function dispatchAgentUpdates(updates: unknown): void {
  if (typeof updates !== 'object' || updates === null) return;
  for (const patch of Object.values(updates as Record<string, unknown>)) {
    const messages = (patch as { messages?: unknown } | null)?.messages;
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      const calls = (message as { tool_calls?: unknown }).tool_calls;
      if (!Array.isArray(calls)) continue;
      for (const call of calls) {
        const c = call as { name?: unknown; args?: unknown };
        if (c.name === 'ask_user') {
          const question = parseAgentQuestion(c.args);
          if (question !== null) useMapAgent.getState().setQuestion(question);
        }
      }
    }
  }
}
