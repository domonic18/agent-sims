import { describe, expect, it } from 'vitest';
import { serializeMessage, serializeTodos, serializeUpdates, type CollectedUsage } from './serialize.js';

describe('serializeMessage', () => {
  it('投影 human 消息(type/content/id)', () => {
    const out = serializeMessage({ id: 'm1', getType: () => 'human', content: '你好', usage_metadata: { input_tokens: 1 } });
    expect(out).toMatchObject({ id: 'm1', type: 'human', content: '你好' });
    expect(out.additional_kwargs).toEqual({});
  });

  it('未知类型兜底 ai;空消息给缺省', () => {
    expect(serializeMessage({ getType: () => 'function' }).type).toBe('ai');
    const empty = serializeMessage(null);
    expect(empty.type).toBe('ai');
    expect(empty.content).toBe('');
  });

  it('tool_calls 空数组不带,非空保留', () => {
    expect(serializeMessage({ tool_calls: [] }).tool_calls).toBeUndefined();
    const calls = [{ name: 'edit_map', args: {}, id: 'c1' }];
    expect(serializeMessage({ tool_calls: calls }).tool_calls).toEqual(calls);
  });
});

describe('serializeUpdates', () => {
  it('提取 usage_metadata 并投影 messages', () => {
    const usage: CollectedUsage = { promptTokens: 0, completionTokens: 0 };
    const out = serializeUpdates(
      { agent: { messages: [{ id: 'a1', getType: () => 'ai', content: '', usage_metadata: { input_tokens: 12, output_tokens: 7 } }] } },
      usage,
    );
    expect(usage.promptTokens).toBe(12);
    expect(usage.completionTokens).toBe(7);
    const node = out.agent as { messages: Record<string, unknown>[] };
    expect(node.messages[0]).toMatchObject({ id: 'a1', type: 'ai' });
  });

  it('多轮累计;非消息 patch 原样透传;非对象输入为空', () => {
    const usage: CollectedUsage = { promptTokens: 0, completionTokens: 0 };
    serializeUpdates({ agent: { messages: [{ usage_metadata: { input_tokens: 3, output_tokens: 1 } }] } }, usage);
    serializeUpdates({ tools: { messages: [{ usage_metadata: { input_tokens: 4, output_tokens: 2 } }] } }, usage);
    expect(usage.promptTokens).toBe(7);
    expect(usage.completionTokens).toBe(3);
    expect(serializeUpdates({ __end__: undefined } as unknown as Record<string, unknown>, usage).__end__).toBeUndefined();
    expect(serializeUpdates('nope', usage)).toEqual({});
  });

  it('todos 状态随非消息 patch 原样透传(前端执行计划数据源)', () => {
    const usage: CollectedUsage = { promptTokens: 0, completionTokens: 0 };
    const todos = [{ content: '生成地图', status: 'completed' }, { content: '修复体检', status: 'in_progress' }];
    const out = serializeUpdates({ tools: { todos, messages: [{ getType: () => 'tool', content: 'ok' }] } }, usage);
    expect((out.tools as { todos: unknown }).todos).toEqual(todos);
  });
});

describe('serializeTodos', () => {
  it('合法清单投影;空/畸形返回 null', () => {
    expect(
      serializeTodos([
        { content: '生成地图', status: 'completed' },
        { content: '修复体检警告', status: 'in_progress' },
      ]),
    ).toEqual([
      { content: '生成地图', status: 'completed' },
      { content: '修复体检警告', status: 'in_progress' },
    ]);
    expect(serializeTodos([])).toBeNull();
    expect(serializeTodos(null)).toBeNull();
    expect(serializeTodos([{ content: '', status: 'pending' }, { content: '坏', status: 'x' }, 'nope'])).toBeNull();
  });
});
