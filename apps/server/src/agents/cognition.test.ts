import { afterEach, describe, expect, it } from 'vitest';
import { autonomy, hosting, innerState } from './cognition.js';

afterEach(() => {
  hosting.delete('char-1');
  innerState.clear('char-1');
});

describe('托管注册表(M4e 单一事实源)', () => {
  it('autonomy.enable 委托 hosting:全托管视图,重复 enable 不覆盖已有方针', () => {
    autonomy.enable('char-1');
    expect(hosting.get('char-1')).toEqual({ mode: 'full', policyText: null, compiled: null });
    expect(autonomy.has('char-1')).toBe(true);
    hosting.set('char-1', { mode: 'policy', policyText: '多学习', compiled: null });
    autonomy.enable('char-1');
    expect(hosting.get('char-1')?.mode).toBe('policy');
  });

  it('hosting.set policy 后 autonomy 视图同步可见;双通道删除等价', () => {
    hosting.set('char-1', { mode: 'policy', policyText: '不散步', compiled: null });
    expect(autonomy.has('char-1')).toBe(true);
    expect(autonomy.list()).toContain('char-1');
    autonomy.disable('char-1');
    expect(hosting.get('char-1')).toBeUndefined();
    hosting.set('char-1', { mode: 'full', policyText: null, compiled: null });
    hosting.delete('char-1');
    expect(autonomy.has('char-1')).toBe(false);
  });
});

describe('innerState 统一内心状态(D2 地基)', () => {
  it('ensure 默认中性情绪+空意图,同实例复用', () => {
    const state = innerState.ensure('char-1');
    expect(state).toEqual({
      mood: { valence: 0, labels: [], since: null },
      focus: null,
      wants: [],
      lastEvaluation: null,
    });
    expect(innerState.ensure('char-1')).toBe(state);
  });

  it('setMood 镜像可读,moodOf 无记录 undefined,clear 移除', () => {
    expect(innerState.moodOf('char-1')).toBeUndefined();
    innerState.setMood('char-1', { valence: 0.6, labels: ['完成工作'], since: 100 });
    expect(innerState.moodOf('char-1')?.valence).toBe(0.6);
    innerState.clear('char-1');
    expect(innerState.get('char-1')).toBeUndefined();
  });

  it('persistedOf 只含 focus/wants/lastEvaluation 且为数组拷贝', () => {
    const state = innerState.ensure('char-1');
    state.focus = { text: '想去做工', sinceMin: 50 };
    state.wants.push({
      id: 'w1',
      activityId: 'work',
      why: '挣钱',
      urgency: 0.7,
      status: 'pending',
      createdAtMin: 50,
    });
    const saved = innerState.persistedOf('char-1');
    expect(saved).toEqual({
      focus: { text: '想去做工', sinceMin: 50 },
      wants: [expect.objectContaining({ id: 'w1' })],
      lastEvaluation: null,
    });
    expect(saved).not.toHaveProperty('mood'); // mood 真源 character_moods,不落此列
    saved!.wants.pop();
    expect(state.wants).toHaveLength(1);
  });

  it('persistedOf 无记录返回 null', () => {
    expect(innerState.persistedOf('char-none')).toBeNull();
  });

  it('restore 形状校验:合法载荷灌回,脏值兜默认,不覆盖 mood 镜像', () => {
    innerState.setMood('char-1', { valence: -0.5, labels: ['被打断'], since: 10 });
    innerState.restore('char-1', {
      focus: { text: '想休息', sinceMin: 30 },
      wants: [
        { id: 'w2', activityId: 'rest', why: '累了', urgency: 0.5, status: 'pending', createdAtMin: 30 },
      ],
      lastEvaluation: { activityId: 'work', verdict: 'bad', reason: '太累', atMin: 40 },
      mood: { valence: 1, labels: [], since: 0 }, // 库值若含 mood 一律忽略
    });
    const state = innerState.get('char-1')!;
    expect(state.focus).toEqual({ text: '想休息', sinceMin: 30 });
    expect(state.wants).toHaveLength(1);
    expect(state.lastEvaluation).toEqual({ activityId: 'work', verdict: 'bad', reason: '太累', atMin: 40 });
    expect(state.mood.valence).toBe(-0.5);
    innerState.restore('char-1', { focus: { text: 42, sinceMin: 'x' }, wants: 'nope' });
    expect(innerState.get('char-1')!.focus).toBeNull();
    expect(innerState.get('char-1')!.wants).toEqual([]);
  });
});
