import { afterEach, describe, expect, it } from 'vitest';
import { autonomy, hosting } from './cognition.js';

afterEach(() => {
  hosting.delete('char-1');
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
