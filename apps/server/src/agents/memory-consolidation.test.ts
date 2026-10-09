import { describe, expect, it } from 'vitest';
import type { StructuredParse } from '../llm/types.js';
import {
  extractPartners,
  parseConsolidation,
  resolveSourceIds,
  type ConsolidationDraft,
} from './memory-consolidation.js';

const PARTNERS = new Set(['苏晚', '阿泽']);

const valid = {
  dreams: [{ content: '走廊很长', importance: 3 }],
  insights: [{ content: '累倒的代价是一天干不了活', importance: 7, sources: ['我忙碌了'] }],
  relations: [{ about: '苏晚', content: '可以信任' }],
};

function unwrap(parsed: StructuredParse<ConsolidationDraft>): ConsolidationDraft {
  if (!parsed.ok) throw new Error(`应为合法草稿: ${parsed.reason}`);
  return parsed.value;
}

describe('parseConsolidation(工具入参→固化草稿)', () => {
  it('解析合法工具入参并钳重要度/截条数(坏条目丢弃不整组否决)', () => {
    const input = {
      dreams: [
        { content: 'a', importance: 99 },
        { content: 'b', importance: 2 },
        { content: 'c', importance: 1 },
        { content: 'd', importance: 1 },
      ],
      insights: [
        { content: 'i1', importance: 0, sources: ['s'] },
        { content: 'i2', importance: 5, sources: ['s'] },
        { content: 'i3', importance: 5, sources: ['s'] },
        { content: 'i4', importance: 5, sources: ['s'] },
      ],
      relations: [
        { about: '苏晚', content: 'r1' },
        { about: '阿泽', content: 'r2' },
        { about: '苏晚', content: 'r3' },
        { about: '苏晚', content: 'r4' },
      ],
    };
    const draft = unwrap(parseConsolidation(input, { withDreams: true, partners: PARTNERS }));
    expect(draft.dreams).toHaveLength(3);
    expect(draft.dreams[0]?.importance).toBe(10);
    expect(draft.insights).toHaveLength(3);
    expect(draft.insights[0]?.importance).toBe(1);
    expect(draft.relations).toHaveLength(3);
  });

  it('白天反思(withDreams=false)忽略 dreams 段', () => {
    const draft = unwrap(parseConsolidation(valid, { withDreams: false, partners: PARTNERS }));
    expect(draft.dreams).toHaveLength(0);
    expect(draft.insights).toHaveLength(1);
    expect(draft.relations).toHaveLength(1);
  });

  it('无 sources 或空 sources 的 insight 丢弃(设计红线)', () => {
    const input = {
      insights: [
        { content: '有引用', importance: 5, sources: [' 证据 '] },
        { content: '没引用', importance: 5 },
        { content: '空引用', importance: 5, sources: [] },
        { content: '有空串引用', importance: 5, sources: ['  '] },
      ],
    };
    const draft = unwrap(parseConsolidation(input, { withDreams: true, partners: PARTNERS }));
    expect(draft.insights).toHaveLength(1);
    expect(draft.insights[0]?.content).toBe('有引用');
    expect(draft.insights[0]?.sources).toEqual(['证据']);
  });

  it('about 不在互动者白名单的 relation 丢弃(防编造关系)', () => {
    const input = {
      relations: [
        { about: '苏晚', content: 'r1' },
        { about: '路人甲', content: 'r2' },
      ],
    };
    const draft = unwrap(parseConsolidation(input, { withDreams: true, partners: PARTNERS }));
    expect(draft.relations).toHaveLength(1);
    expect(draft.relations[0]?.about).toBe('苏晚');
  });

  it('非对象输入返回 fail(触发 router 带错重试一次)', () => {
    expect(parseConsolidation('不是 JSON', { withDreams: true, partners: PARTNERS }).ok).toBe(false);
    expect(parseConsolidation([1, 2, 3], { withDreams: true, partners: PARTNERS }).ok).toBe(false);
    expect(parseConsolidation(null, { withDreams: true, partners: PARTNERS }).ok).toBe(false);
  });

  it('字段类型不符的条目丢弃(content 缺失/重要度非数值),段缺失视为空', () => {
    const draft = unwrap(
      parseConsolidation(
        {
          dreams: [{ content: '只有正文' }, { importance: 3 }, '纯字符串'],
          insights: [{ content: '好认知', importance: '高', sources: ['s'] }],
        },
        { withDreams: true, partners: PARTNERS },
      ),
    );
    expect(draft.dreams).toHaveLength(0);
    expect(draft.insights).toHaveLength(0);
    expect(draft.relations).toHaveLength(0);
  });
});

describe('resolveSourceIds(溯源引用→情景记忆 id)', () => {
  const rows = [
    { id: 'm1', content: '我忙碌了 480 分钟' },
    { id: 'm2', content: '我对苏晚说:"今天天气不错"' },
  ];

  it('精确匹配与双向包含匹配', () => {
    expect(resolveSourceIds(['我忙碌了 480 分钟'], rows)).toEqual(['m1']);
    expect(resolveSourceIds(['对苏晚说'], rows)).toEqual(['m2']); // 片段⊂原文
    expect(resolveSourceIds(['今晚我对苏晚说:"今天天气不错"而且很开心'], rows)).toEqual(['m2']); // 原文⊂引用
  });

  it('无命中返回空数组(调用方丢弃该 insight)', () => {
    expect(resolveSourceIds(['完全编造的内容'], rows)).toEqual([]);
  });

  it('去重且条目数有上限', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, content: `记忆${i}` }));
    const sources = Array.from({ length: 12 }, (_, i) => `记忆${i}`);
    expect(resolveSourceIds(sources, many)).toHaveLength(8);
  });
});

describe('extractPartners(源记忆正文→互动者白名单)', () => {
  const characters = new Map([
    ['self', { name: '林一' }],
    ['p1', { name: '苏晚' }],
    ['p2', { name: '阿泽' }],
    ['p3', { name: '赵四' }],
  ]);

  it('正文出现过的居民入选,自己与他人不入选', () => {
    const rows = [
      { id: 'a', content: '我对苏晚说:"早"' },
      { id: 'b', content: '我看到阿泽在砍树' },
    ];
    const partners = extractPartners(rows, 'self', characters);
    expect([...partners.keys()].sort()).toEqual(['苏晚', '阿泽'].sort());
    expect(partners.get('苏晚')).toBe('p1');
    expect(partners.has('赵四')).toBe(false);
    expect(partners.has('林一')).toBe(false);
  });

  it('无互动记忆返回空名单', () => {
    expect(extractPartners([{ id: 'a', content: '我做了木工' }], 'self', characters).size).toBe(0);
  });
});
