import { describe, expect, it } from 'vitest';
import type { NarrativeHistoryEntry, SelfNarrative } from '@sims/shared';
import {
  applyRevision,
  buildEvolveMessages,
  fallbackNarrative,
  parseNarrativeDraft,
} from './narrator.js';

describe('parseNarrativeDraft(慢槽输出→叙事草稿)', () => {
  it('解析含杂质 JSON,text 截 200,traits 过滤截断,change 保留', () => {
    const raw = `好的,这是修订:\n${JSON.stringify({
      text: `  ${'我'.repeat(220)}  `,
      traits: ['节俭', '', '   ', 'x'.repeat(30), 42, '热心', '多愁善感', '慢性子'],
      change: '我开始在意别人了',
    })}\n以上。`;
    const draft = parseNarrativeDraft(raw);
    expect(draft?.text).toBe('我'.repeat(200));
    expect(draft?.traits).toEqual(['节俭', 'x'.repeat(20), '热心', '多愁善感', '慢性子']);
    expect(draft?.change).toBe('我开始在意别人了');
  });

  it('change 无效用兜底文案(避免整次失败循环)', () => {
    const draft = parseNarrativeDraft(
      JSON.stringify({ text: '我还是我', traits: ['沉稳'], change: '   ' }),
    );
    expect(draft?.change).toBe('我对自己的看法有些更新');
  });

  it('无 JSON/坏 JSON/空 text 返回 null(整次放弃,次轮重试)', () => {
    expect(parseNarrativeDraft('昨夜无事可记。')).toBeNull();
    expect(parseNarrativeDraft('{不是 JSON}')).toBeNull();
    expect(parseNarrativeDraft(JSON.stringify({ text: '   ', traits: [] }))).toBeNull();
  });
});

describe('fallbackNarrative(bio 回落,version 1 不烧模型)', () => {
  it('bio 优先原文截断', () => {
    const view = fallbackNarrative({ bio: `我是木匠,${'爱琢磨'.repeat(200)}` }, 100);
    expect(view).toEqual({
      text: `我是木匠,${'爱琢磨'.repeat(200)}`.slice(0, 200),
      traits: [],
      version: 1,
      updatedAtGameMinutes: 100,
    });
  });

  it('无 bio 用人设卡 性格/目标 拼句', () => {
    const view = fallbackNarrative(
      { card: { 性格: '慢性子', 目标: '攒钱开店' } },
      50,
    );
    expect(view.text).toBe('我是个慢性子、攒钱开店的人,刚来到这座小镇。');
  });

  it('全空兜底通用句', () => {
    expect(fallbackNarrative({}, 10).text).toBe('我刚来到这座小镇,日子还长。');
  });
});

describe('applyRevision(版本链写回)', () => {
  it('旧版入史(archivedAt=旧 updatedAt),version+1,环形保留 10 版', () => {
    const current: SelfNarrative = {
      text: '现任 v3',
      traits: ['a'],
      version: 3,
      updatedAtGameMinutes: 100,
    };
    const history: NarrativeHistoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
      text: `h${i}`,
      traits: [],
      version: i + 1,
      updatedAtGameMinutes: i,
      archivedAtGameMinutes: i,
    }));
    const next = applyRevision(
      { selfNarrative: current, narrativeHistory: history },
      { text: '新任 v4', traits: ['b'] },
      200,
    );
    expect(next.selfNarrative).toEqual({
      text: '新任 v4',
      traits: ['b'],
      version: 4,
      updatedAtGameMinutes: 200,
    });
    const kept = next.narrativeHistory as NarrativeHistoryEntry[];
    expect(kept).toHaveLength(10);
    expect(kept[0]?.text).toBe('h1'); // 最旧 h0 被环形挤掉
    expect(kept[9]).toEqual({ ...current, archivedAtGameMinutes: 100 });
  });

  it('未初始化: 旧版取 bio 回落(v1),新版本 2', () => {
    const next = applyRevision({ bio: '我是木匠' }, { text: '修订版', traits: [] }, 50);
    expect((next.selfNarrative as SelfNarrative).version).toBe(2);
    const kept = next.narrativeHistory as NarrativeHistoryEntry[];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ text: '我是木匠', version: 1, archivedAtGameMinutes: 50 });
  });
});

describe('buildEvolveMessages(修订 prompt 防漂移)', () => {
  it('明令微调+版本号/特质/素材白名单全入 prompt', () => {
    const msgs = buildEvolveMessages(
      '阿泽',
      { text: '我是木匠', traits: ['手巧'], version: 2, updatedAtGameMinutes: 0 },
      ['我发现钓鱼让我平静'],
      ['对苏晚: 靠谱'],
    );
    expect(msgs[0]?.content).toContain('阿泽');
    expect(msgs[0]?.content).toContain('不得推翻');
    const user = msgs[1]?.content ?? '';
    expect(user).toContain('v2');
    expect(user).toContain('手巧');
    expect(user).toContain('我发现钓鱼让我平静');
    expect(user).toContain('对苏晚: 靠谱');
  });
});
