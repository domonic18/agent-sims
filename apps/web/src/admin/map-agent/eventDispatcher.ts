/**
 * AI 助手事件分派(唯一入口):custom 通道的 question(问题卡)与
 * map_updated(整图替换)全部经此收敛。map_updated 以单条 update 命令
 * 入编辑器撤销栈(path=[])——人工 Cmd/Ctrl+Z 一键撤销 AI 的整轮修改。
 * 注册表驱动、幂等;Provider 与 runtimeAdapter 不各自接线。
 */
import type { MapAgentTodo, TileMapDefinition } from '@sims/shared';
import { useEditor } from '../map-editor/editorStore';
import { normalizeDefinition } from '../map-editor/normalize';
import { useMapAgent, type AgentQuestion } from './mapAgentStore';

/** write_todos 状态抽取(宽松:非空 {content,status} 才收;空清单视为无计划) */
export function parseAgentTodos(value: unknown): MapAgentTodo[] | null {
  if (!Array.isArray(value)) return null;
  const out: MapAgentTodo[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { content, status } = raw as { content?: unknown; status?: unknown };
    if (typeof content !== 'string' || content === '') continue;
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') continue;
    out.push({ content, status });
  }
  return out.length > 0 ? out : null;
}

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

/** agent 整图替换 → 编辑器单条命令(undo 可整体回退);无变化跳过。
 * 归一化后落库:agent 产物可能缺 decor 组/可选数组,不补齐会让画布交互崩。 */
export function applyAgentDoc(definition: unknown, label: unknown): boolean {
  if (!looksLikeDefinition(definition)) return false;
  const s = useEditor.getState();
  const next = normalizeDefinition(definition);
  if (JSON.stringify(s.doc) === JSON.stringify(next)) return false;
  s.commit({
    kind: 'update',
    label: `AI:${typeof label === 'string' && label !== '' ? label : '修改地图'}`,
    path: [],
    before: s.doc,
    after: next,
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

/** updates 通道兜底:write_todos 状态推进执行计划;ask_user 工具标记出问题卡 */
export function dispatchAgentUpdates(updates: unknown): void {
  if (typeof updates !== 'object' || updates === null) return;
  for (const patch of Object.values(updates as Record<string, unknown>)) {
    const todos = parseAgentTodos((patch as { todos?: unknown } | null)?.todos);
    if (todos !== null) useMapAgent.getState().setTodos(todos);
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
