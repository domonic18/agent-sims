import { describe, expect, it } from 'vitest';
import {
  compatibility,
  relationTitle,
  type TraitVector,
  type WorldEvent,
} from '@sims/shared';
import {
  applySocialDailyRollover,
  chat,
  ensureRelations,
  relationKey,
} from './social.js';
import { Simulation } from './simulation.js';

const flat = (value: number): TraitVector => ({
  ambition: value,
  hedonism: value,
  homebody: value,
  sociability: value,
  frugality: value,
});

/** 双人同景:甲乙落在相邻出生点(曼哈顿 1),特质全同(相性 1.4)保证数值确定 */
function socialSim(): Simulation {
  const sim = new Simulation();
  sim.spawnCharacter('a', 8, 12, '甲', flat(0.5));
  sim.spawnCharacter('b', 9, 12, '乙', flat(0.5));
  return sim;
}

describe('compatibility 相性系数(social-design §4)', () => {
  it('完全同型 ×1.4(只看差值,与绝对值无关)', () => {
    expect(compatibility(flat(0.5), flat(0.5))).toBeCloseTo(1.4, 10);
    expect(compatibility(flat(0.1), flat(0.1))).toBeCloseTo(1.4, 10);
  });

  it('完全相反 ×-0.4(反感)', () => {
    expect(compatibility(flat(0), flat(1))).toBeCloseTo(-0.4, 10);
  });

  it('折中差 0.5 → 0.5', () => {
    expect(compatibility(flat(0.25), flat(0.75))).toBeCloseTo(0.5, 10);
  });
});

describe('relationTitle 称号派生(阈值:嫌弃/陌生/点头/挚友)', () => {
  it('嫌弃优先于一切(affinity ≤ -30)', () => {
    expect(relationTitle(80, -30)).toBe('嫌弃');
    expect(relationTitle(0, -100)).toBe('嫌弃');
  });
  it('familiarity < 10 陌生人,< 30 点头之交', () => {
    expect(relationTitle(9.9, 0)).toBe('陌生人');
    expect(relationTitle(10, 0)).toBe('点头之交');
    expect(relationTitle(29, 0)).toBe('点头之交');
  });
  it('挚友需 affinity ≥ 65 且熟悉度达标,其余为朋友', () => {
    expect(relationTitle(30, 64.9)).toBe('朋友');
    expect(relationTitle(30, 65)).toBe('挚友');
    expect(relationTitle(29, 90)).toBe('点头之交'); // 熟悉度不够不封挚友
  });
});

describe('chat 闲聊全链', () => {
  it('有向关系:主动方 +6 熟悉,双向 +相性×4 好感,双方 +2×相性 得分,发 social.chat 事件', () => {
    const sim = socialSim();
    const events: WorldEvent[] = [];
    sim.events.subscribe((event) => events.push(event));

    const content = chat(sim, 'a', 'b');
    expect(content).not.toBe('');

    const forward = sim.socials.get(relationKey('a', 'b'))!;
    const backward = sim.socials.get(relationKey('b', 'a'))!;
    expect(forward.familiarity).toBeCloseTo(6, 5); // 熟悉度只涨主动方
    expect(backward.familiarity).toBe(0);
    expect(forward.affinity).toBeCloseTo(5.6, 5); // 4 × 1.4 × 1
    expect(backward.affinity).toBeCloseTo(5.6, 5);
    expect(sim.character('a').score).toBeCloseTo(2 * 1.4, 5); // 事件直加(04 §2.5)
    expect(sim.character('b').score).toBeCloseTo(2 * 1.4, 5);

    const emitted = events.find((event) => event.type === 'social.chat');
    expect(emitted).toMatchObject({
      type: 'social.chat',
      fromId: 'a',
      toId: 'b',
      content,
      affinityDelta: 5.6,
    });
    expect(sim.snapshot().socials).toEqual([
      { fromId: 'a', toId: 'b', familiarity: 6, affinity: 5.6 },
      { fromId: 'b', toId: 'a', familiarity: 0, affinity: 5.6 },
    ]);
  });

  it('收益封顶六档(Σ2.6),第 7 次起不拒绝但增益为 0,跨日重置', () => {
    const sim = socialSim();
    for (let i = 0; i < 6; i += 1) chat(sim, 'a', 'b');
    const forward = sim.socials.get(relationKey('a', 'b'))!;
    expect(forward.familiarity).toBeCloseTo(6 * 2.6, 5); // 递减 1/0.6/0.4/0.3/0.2/0.1
    expect(sim.character('a').score).toBeCloseTo(2 * 1.4 * 2.6, 5); // 得分同乘递减与相性
    chat(sim, 'a', 'b'); // 第 7 次:对话照常,增益全 0
    expect(forward.familiarity).toBeCloseTo(6 * 2.6, 5);
    expect(forward.affinity).toBeCloseTo(4 * 1.4 * 2.6, 5);
    expect(forward.chatCount).toBe(7);
    expect(sim.character('a').score).toBeCloseTo(2 * 1.4 * 2.6, 5);

    sim.advanceTicks(960); // 08:00 → 次日 00:00(日翻转含熟悉度衰减 -1)
    expect(forward.familiarity).toBeCloseTo(6 * 2.6 - 1, 5);
    chat(sim, 'a', 'b'); // 新的一天重新计数,衰减从头
    expect(forward.familiarity).toBeCloseTo(6 * 2.6 - 1 + 6, 5);
  });

  it('负相性不扣分(04 §2.5 单调性): 好感照降,双方得分分文不动', () => {
    const sim = new Simulation();
    sim.spawnCharacter('n', 8, 12, '负', flat(0));
    sim.spawnCharacter('p', 9, 12, '正', flat(1)); // 完全相反 → 相性 -0.4
    chat(sim, 'n', 'p');
    const forward = sim.socials.get(relationKey('n', 'p'))!;
    expect(forward.affinity).toBeCloseTo(4 * -0.4, 5); // 好感真实下降
    expect(sim.character('n').score).toBe(0); // max(0, 2×1×(-0.4)) 不扣
    expect(sim.character('p').score).toBe(0);
  });

  it('距离太远拒绝(曼哈顿 > SOCIAL_CHAT_DISTANCE),不产生关系变化', () => {
    const sim = socialSim();
    sim.spawnCharacter('c', 13, 15, '丙', flat(0.5)); // 距甲 8 格
    expect(() => chat(sim, 'a', 'c')).toThrow(/距离太远/);
    expect(sim.socials.size).toBe(0);
  });

  it('自言自语与幽灵态拒绝', () => {
    const sim = socialSim();
    expect(() => chat(sim, 'a', 'a')).toThrow(/自己/);
    sim.character('b').energy = 0.1;
    sim.advanceTicks(6); // 代谢至 0 死亡
    expect(sim.character('b').alive).toBe(false);
    expect(() => chat(sim, 'a', 'b')).toThrow(/已死亡/);
  });
});

describe('首次结成朋友/挚友发一次性事件', () => {
  it('跨过 30 线发 friendship.formed 一次,formedNotified 后不再发', () => {
    const sim = socialSim();
    const [forward] = ensureRelations(sim, 'a', 'b');
    forward.familiarity = 25; // 预置到临界,一次闲聊跨线
    const events: WorldEvent[] = [];
    sim.events.subscribe((event) => events.push(event));

    chat(sim, 'a', 'b'); // 25 + 6 = 31 ≥ 30 → 朋友
    chat(sim, 'a', 'b'); // 已通知过,不再发
    const formed = events.filter((event) => event.type === 'friendship.formed');
    expect(formed).toHaveLength(1);
    expect(formed[0]).toMatchObject({ type: 'friendship.formed', aId: 'a', bId: 'b', title: '朋友' });
  });
});

describe('同场增益已随得分体系移除(04 §6.3)', () => {
  it('闲聊是唯一社交得分事件,同处一地不再产生被动增益', () => {
    const sim = socialSim();
    sim.character('a').activity = {
      activityId: 'stroll',
      elapsed: 0,
      anchorKind: null,
      targetId: null,
    };
    sim.advanceTicks(10);
    // 散步 0.15/分 ×10,无同场加成(旧 +0.05/人已删,04 §6.3)
    expect(sim.character('a').score).toBeCloseTo(1.5, 5);
  });
});

describe('日翻转衰减与出生特质', () => {
  it('applySocialDailyRollover 全员熟悉度 -1,下界 0', () => {
    const sim = socialSim();
    const [forward] = ensureRelations(sim, 'a', 'b');
    forward.familiarity = 0.5;
    applySocialDailyRollover(sim);
    expect(forward.familiarity).toBe(0);
    forward.familiarity = 50;
    applySocialDailyRollover(sim);
    expect(forward.familiarity).toBe(49);
  });

  it('出生特质:配置覆盖对应维度,其余随机在 0~1;快照透传 traits', () => {
    const sim = new Simulation();
    sim.spawnCharacter('x', 8, 12, '叉', { ambition: 0.9 });
    const x = sim.character('x');
    expect(x.traits.ambition).toBe(0.9);
    for (const value of Object.values(x.traits)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(sim.snapshot().characters.find((c) => c.id === 'x')!.traits.ambition).toBe(0.9);
  });
});
