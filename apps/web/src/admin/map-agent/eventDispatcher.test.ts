import { beforeEach, describe, expect, it } from 'vitest';
import type { TileMapDefinition } from '@sims/shared';
import { useEditor } from '../map-editor/editorStore';
import { useMapAgent } from './mapAgentStore';
import { applyAgentDoc, dispatchAgentCustomEvent, dispatchAgentUpdates, parseAgentQuestion } from './eventDispatcher.js';

function baseDoc(): TileMapDefinition {
  return {
    width: 8,
    height: 6,
    blockedRects: [],
    paths: [],
    places: [{ id: 'home-1', name: '家', x: 1, y: 1, w: 3, h: 2, entrance: { x: 2, y: 4 } }],
  };
}

function baseLaunch(): void {
  useEditor.getState().loadMap({ mapId: null, name: '测试图', definition: baseDoc() });
}

const questionEvent = {
  type: 'question',
  id: 'q-1',
  question: '选哪个方向?',
  options: [
    { value: 'west', label: '向西' },
    { value: 'east', label: '向东' },
  ],
  default: 'west',
};

beforeEach(() => {
  baseLaunch();
  useMapAgent.setState({ open: false, threadId: undefined, question: null, threads: [] });
});

describe('parseAgentQuestion', () => {
  it('合法事件解析出问题卡,default 缺省为 null', () => {
    const q = parseAgentQuestion(questionEvent);
    expect(q).toMatchObject({ id: 'q-1', question: '选哪个方向?', default: 'west' });
    expect(q?.options).toHaveLength(2);
    expect(parseAgentQuestion({ ...questionEvent, default: undefined })).toMatchObject({ default: null });
  });

  it('选项不足两个/问题为空/非对象均不渲染', () => {
    expect(parseAgentQuestion({ ...questionEvent, options: [{ value: 'a', label: '甲' }] })).toBeNull();
    expect(parseAgentQuestion({ ...questionEvent, question: '' })).toBeNull();
    expect(parseAgentQuestion(null)).toBeNull();
    expect(parseAgentQuestion('question')).toBeNull();
  });

  it('畸形选项被过滤,过滤后不足两个整体拒绝', () => {
    const q = parseAgentQuestion({
      ...questionEvent,
      options: [{ value: 'west', label: '向西' }, { value: '', label: '坏' }, null, { value: 'east' }],
    });
    expect(q).toBeNull();
  });
});

describe('applyAgentDoc', () => {
  it('合法新图以单条 update 命令入撤销栈,label 带 AI: 前缀', () => {
    const next = baseDoc();
    next.places[0]!.x = 4;
    expect(applyAgentDoc(next, '平移场所')).toBe(true);
    const s = useEditor.getState();
    expect(s.doc.places[0]!.x).toBe(4);
    expect(s.dirty).toBe(true);
    expect(s.history.undo).toHaveLength(1);
    expect(s.history.undo[0]!.label).toBe('AI:平移场所');
    s.undo();
    expect(useEditor.getState().doc.places[0]!.x).toBe(1);
  });

  it('结构不合法返回 false 且文档不变;与当前文档相同跳过', () => {
    expect(applyAgentDoc({ width: 8 }, 'x')).toBe(false);
    expect(useEditor.getState().doc.places).toHaveLength(1);
    expect(applyAgentDoc(useEditor.getState().doc, '重复')).toBe(false);
    expect(useEditor.getState().history.undo).toHaveLength(0);
  });
});

describe('dispatchAgentCustomEvent', () => {
  it('question 事件写入问题卡 store', () => {
    dispatchAgentCustomEvent('custom', questionEvent);
    expect(useMapAgent.getState().question?.id).toBe('q-1');
  });

  it('map_updated 事件整图替换进编辑器;无关类型忽略', () => {
    const next = baseDoc();
    next.width = 16;
    dispatchAgentCustomEvent('custom', { type: 'map_updated', definition: next, label: '生成' });
    expect(useEditor.getState().doc.width).toBe(16);
    dispatchAgentCustomEvent('custom', { type: 'unknown' });
    dispatchAgentCustomEvent('custom', 'text');
    expect(useMapAgent.getState().question).toBeNull();
  });
});

describe('dispatchAgentUpdates', () => {
  it('updates 里 ask_user 工具调用兜底出问题卡', () => {
    dispatchAgentUpdates({
      model: {
        messages: [
          {
            type: 'ai',
            tool_calls: [{ name: 'ask_user', args: questionEvent }],
          },
        ],
      },
    });
    expect(useMapAgent.getState().question?.question).toBe('选哪个方向?');
  });

  it('无 ask_user 时不动 store;畸形补丁不炸', () => {
    dispatchAgentUpdates({ tools: { messages: [{ type: 'tool', tool_call_id: 'x' }] } });
    dispatchAgentUpdates(null);
    dispatchAgentUpdates({ tools: { messages: 'bad' } });
    expect(useMapAgent.getState().question).toBeNull();
  });
});
