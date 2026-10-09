import { describe, expect, it } from 'vitest';
import { evaluateActivity, type ActivityEvalInput } from './memory-evaluator.js';

const base: ActivityEvalInput = {
  activityId: 'study',
  elapsedMinutes: 60,
  reason: 'completed',
  bias: 0,
  moodValence: null,
  wantWhy: null,
};

describe('evaluateActivity(记忆评价引擎 D4)', () => {
  it('高偏好如愿完成: good+正合我的心意,重要活动', () => {
    const r = evaluateActivity({ ...base, bias: 1 });
    expect(r.verdict).toBe('good');
    expect(r.sentence).toContain('正合我的心意');
    expect(r.important).toBe(true);
  });

  it('排斥活动中断: bad+半路被打断+本就不爱这一口', () => {
    const r = evaluateActivity({ ...base, bias: -1, reason: 'interrupted', elapsedMinutes: 30 });
    expect(r.verdict).toBe('bad');
    expect(r.sentence).toContain('半路被打断,心里有点堵');
    expect(r.sentence).toContain('本就不爱这一口');
    expect(r.important).toBe(true);
  });

  it('中性平静完成: ok 且非重要(纯模板,不烧轻槽)', () => {
    const r = evaluateActivity({ ...base, activityId: 'rest' });
    expect(r.verdict).toBe('ok');
    expect(r.important).toBe(false);
    expect(['就那样吧,平平常常', '说不上好坏,反正过去了', '没什么特别的感觉']).toContain(r.sentence);
  });

  it('计划如愿: wantWhy 进措辞(「本来想着…算是如愿了」)', () => {
    const r = evaluateActivity({ ...base, activityId: 'rest', wantWhy: '想慢下来喘口气' });
    expect(r.sentence).toContain('本来想着「想慢下来喘口气」,算是如愿了');
  });

  it('社交获得: 措辞带聊天+标记重要(即使判定仍 ok)', () => {
    const r = evaluateActivity({ ...base, activityId: 'stroll', socialGain: 2 });
    expect(r.sentence).toContain('顺道还聊了几句');
    expect(r.important).toBe(true);
  });

  it('体力透支的好评补一句「累得够呛」(健身 40 分钟净耗 16)', () => {
    const r = evaluateActivity({ ...base, activityId: 'workout', bias: 1, elapsedMinutes: 40 });
    expect(r.verdict).toBe('good');
    expect(r.sentence).toContain('就是累得够呛');
  });

  it('囊中羞涩: 措辞带缺钱+判定偏负', () => {
    const r = evaluateActivity({ ...base, bias: -1, reason: 'insufficient_coins', elapsedMinutes: 10 });
    expect(r.verdict).toBe('bad');
    expect(r.sentence).toContain('囊中羞涩没能尽兴');
  });

  it('情绪渲染跨阈值: 低 mood 压 ok→bad,高 mood 抬 ok→good', () => {
    // 排斥+完成+低 mood: -1+0.4-0.2=-0.8 → bad
    const down = evaluateActivity({ ...base, bias: -1, moodValence: -0.5 });
    expect(down.verdict).toBe('bad');
    // 中性完成+社交+高 mood: 0.4+0.3+0.2=0.9 → good
    const up = evaluateActivity({ ...base, activityId: 'stroll', socialGain: 1, moodValence: 0.5 });
    expect(up.verdict).toBe('good');
  });

  it('主动停下小幅扣分但仍 ok;中断一律重要(计划-实际偏差素材)', () => {
    expect(evaluateActivity({ ...base, reason: 'stopped' }).verdict).toBe('ok');
    expect(evaluateActivity({ ...base, reason: 'interrupted' }).important).toBe(true);
  });
});
