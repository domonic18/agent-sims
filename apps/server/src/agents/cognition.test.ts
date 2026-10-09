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

describe('innerState 统一内心状态(D2 地基,D3 intents)', () => {
  it('ensure 默认中性情绪+无意图+无邀约,同实例复用', () => {
    const state = innerState.ensure('char-1');
    expect(state).toEqual({
      mood: { valence: 0, labels: [], since: null },
      focus: null,
      intents: null,
      lastEvaluation: null,
      pendingInvitation: null,
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

  it('setIntents 整体替换,clearIntents 归 null', () => {
    innerState.setIntents('char-1', {
      day: 3,
      source: 'llm',
      wants: [{ id: 'w1', activityId: 'work', why: '挣钱', urgency: 0.7, status: 'pending', createdAtMin: 100 }],
    });
    expect(innerState.get('char-1')!.intents?.day).toBe(3);
    innerState.clearIntents('char-1');
    expect(innerState.get('char-1')!.intents).toBeNull();
  });

  it('persistedOf 只含持久化四字段(focus/intents/lastEvaluation/pendingInvitation)且为深拷贝', () => {
    const state = innerState.ensure('char-1');
    state.focus = { text: '想去做工', sinceMin: 50 };
    innerState.setIntents('char-1', {
      day: 2,
      source: 'fallback',
      wants: [
        { id: 'w1', activityId: 'work', why: '挣钱', urgency: 0.7, status: 'pending', createdAtMin: 50 },
        { id: 'w2', activityId: 'stroll', why: '散步', urgency: 0.3, status: 'done', createdAtMin: 40 },
      ],
    });
    const saved = innerState.persistedOf('char-1');
    expect(saved).toEqual({
      focus: { text: '想去做工', sinceMin: 50 },
      intents: {
        day: 2,
        source: 'fallback',
        wants: [
          expect.objectContaining({ id: 'w1' }),
          expect.objectContaining({ id: 'w2', status: 'done' }),
        ],
      },
      lastEvaluation: null,
      pendingInvitation: null,
    });
    expect(saved).not.toHaveProperty('mood'); // mood 真源 character_moods,不落此列
    saved!.intents!.wants.pop();
    saved!.intents!.wants[0]!.status = 'abandoned';
    expect(state.intents!.wants).toHaveLength(2);
    expect(state.intents!.wants[0]!.status).toBe('pending');
  });

  it('persistedOf 无记录返回 null', () => {
    expect(innerState.persistedOf('char-none')).toBeNull();
  });

  it('restore 形状校验:合法载荷灌回,脏值兜默认,不覆盖 mood 镜像', () => {
    innerState.setMood('char-1', { valence: -0.5, labels: ['被打断'], since: 10 });
    innerState.restore('char-1', {
      focus: { text: '想休息', sinceMin: 30 },
      intents: {
        day: 1,
        source: 'llm',
        wants: [
          { id: 'w2', activityId: 'rest', why: '累了', urgency: 0.5, status: 'pending', createdAtMin: 30 },
          { id: 'bad', activityId: 42, why: '坏了', urgency: 0.5, status: 'pending', createdAtMin: 30 }, // 脏条目剔除
        ],
      },
      lastEvaluation: { activityId: 'work', verdict: 'bad', reason: '太累', atMin: 40 },
      mood: { valence: 1, labels: [], since: 0 }, // 库值若含 mood 一律忽略
    });
    const state = innerState.get('char-1')!;
    expect(state.focus).toEqual({ text: '想休息', sinceMin: 30 });
    expect(state.intents!.day).toBe(1);
    expect(state.intents!.wants).toHaveLength(1);
    expect(state.intents!.wants[0]!.id).toBe('w2');
    expect(state.lastEvaluation).toEqual({ activityId: 'work', verdict: 'bad', reason: '太累', atMin: 40 });
    expect(state.mood.valence).toBe(-0.5);
    innerState.restore('char-1', {
      focus: { text: 42, sinceMin: 'x' },
      intents: { day: 'x', source: 'llm', wants: [] },
    });
    expect(innerState.get('char-1')!.focus).toBeNull();
    expect(innerState.get('char-1')!.intents).toBeNull();
  });
});
