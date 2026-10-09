import { describe, expect, it } from 'vitest';
import { socialMotive, type SocialMotiveInput } from './social-motive.js';

const NEVER = Number.NEGATIVE_INFINITY;

function input(overrides: Partial<SocialMotiveInput> = {}): SocialMotiveInput {
  return {
    targetId: 'ta',
    name: '她',
    affinity: 50,
    familiarity: 50,
    chatCountToday: 0,
    lastChatAt: NEVER,
    initiatedToday: 0,
    chatReady: false,
    samePlace: false,
    ...overrides,
  };
}

/** 贴身+高好感+从未聊 = 1.1 满欲望的模板候选 */
const hot = input({ chatReady: true });

describe('socialMotive 护栏三闸(10-cognition §7.2/§9,零模型)', () => {
  it('负面关系剔除(affinity ≤ -30),-29 保留但基础分不足以点火', () => {
    expect(socialMotive([input({ affinity: -30 })], { valence: 0, nowGameMinutes: 0 })).toEqual([]);
    const kept = socialMotive(
      [input({ affinity: -29, chatReady: true })],
      { valence: 0, nowGameMinutes: 0 },
    );
    expect(kept).toEqual([]); // -0.29+0.3(从未聊)+0.3(贴身) = 0.31 < 0.35
  });

  it('同对冷却:30 游戏分内剔除,恰好 30 放行(E2 冷却 60→30)', () => {
    const now = 10_000;
    expect(
      socialMotive([input({ lastChatAt: now - 29, chatReady: true })], { valence: 0, nowGameMinutes: now }),
    ).toEqual([]);
    const cooled = socialMotive(
      [input({ lastChatAt: now - 30, chatReady: true })],
      { valence: 0, nowGameMinutes: now },
    );
    expect(cooled).toHaveLength(1);
  });

  it('每日主动上限:达 SOCIAL_DAILY_INITIATE_CAP 剔除,未达放行(E2 上限 6→8)', () => {
    expect(
      socialMotive([input({ initiatedToday: 8 })], { valence: 0, nowGameMinutes: 0 }),
    ).toEqual([]);
    expect(socialMotive([input({ initiatedToday: 7 })], { valence: 0, nowGameMinutes: 0 })).toHaveLength(1);
  });

  it('收益封顶:当日同对聊满 CHAT_DAILY_GAINED 次剔除(增益归零档不再点火)', () => {
    expect(
      socialMotive([input({ chatCountToday: 6 })], { valence: 0, nowGameMinutes: 0 }),
    ).toEqual([]);
    expect(socialMotive([input({ chatCountToday: 5 })], { valence: 0, nowGameMinutes: 0 })).toHaveLength(1);
  });
});

describe('socialMotive 欲望打分(基础+久未聊+面熟+贴身+情绪,点火线 0.35)', () => {
  it('基础欲望:好感≥50 封 0.5;低好感线性(20→0.2);异地候选照常入池(jev 决定专程)', () => {
    const full = socialMotive([hot], { valence: 0, nowGameMinutes: 0 });
    expect(full[0]!.desire).toBeCloseTo(1.1, 10); // 0.5+0.3(从未聊)+0.3(贴身)
    const low = socialMotive(
      [input({ affinity: 20, chatReady: true })],
      { valence: 0, nowGameMinutes: 0 },
    );
    expect(low[0]!.desire).toBeCloseTo(0.2 + 0.3 + 0.3, 10);
    const remote = socialMotive(
      [input({ affinity: 20 })],
      { valence: 0, nowGameMinutes: 0 },
    );
    expect(remote).toHaveLength(1); // 0.5 过线但不贴身:不直执,入 jev 池决定是否专程去找
    expect(remote[0]!.chatReady).toBe(false);
    expect(remote[0]!.samePlace).toBe(false);
  });

  it('久未聊:整日计每天 +0.1 封顶 0.3;异地候选照常返回', () => {
    const now = 5 * 1440;
    const yesterday = socialMotive(
      [input({ lastChatAt: now - 1440 })],
      { valence: 0, nowGameMinutes: now },
    );
    expect(yesterday).toHaveLength(1); // 0.5+0.1 = 0.6 过线,异地入池
    const threeDays = socialMotive(
      [input({ lastChatAt: now - 3 * 1440 })],
      { valence: 0, nowGameMinutes: now },
    );
    expect(threeDays[0]!.desire).toBeCloseTo(0.5 + 0.3, 10);
    const sameDay = socialMotive(
      [input({ lastChatAt: now - 720 })],
      { valence: 0, nowGameMinutes: now },
    );
    expect(sameDay).toHaveLength(1); // 0.5+0 = 0.5 过线,异地入池
  });

  it('面熟加成:初识(familiarity<20)+0.15,共处破冰后第一场对话可达点火线', () => {
    const novice = input({ affinity: 0, familiarity: 5, chatReady: true });
    const met = socialMotive([novice], { valence: 0, nowGameMinutes: 0 });
    expect(met[0]!.desire).toBeCloseTo(0 + 0.3 + 0.15 + 0.3, 10); // 0.75 点火
    const stranger = input({ affinity: 0, familiarity: 30, chatReady: true });
    const noNovice = socialMotive([stranger], { valence: 0, nowGameMinutes: 0 });
    expect(noNovice[0]!.desire).toBeCloseTo(0 + 0.3 + 0.3, 10); // 0.6 无面熟加成
  });

  it('情境加成(E2 口径拆分):贴身可达 +0.3;同场未近不给分(只促走近行为)', () => {
    const ready = socialMotive(
      [input({ lastChatAt: 4 * 1440, chatReady: true })],
      { valence: 0, nowGameMinutes: 5 * 1440 },
    );
    expect(ready[0]!.desire).toBeCloseTo(0.5 + 0.1 + 0.3, 10); // 0.9 点火
    const nearBy = socialMotive(
      [input({ lastChatAt: 4 * 1440, samePlace: true })],
      { valence: 0, nowGameMinutes: 5 * 1440 },
    );
    expect(nearBy[0]!.desire).toBeCloseTo(0.5 + 0.1, 10); // 0.6:同场不加分
  });

  it('情绪加成:valence 1.0 → +0.1,负情绪不加;情绪决定临界候选是否点火', () => {
    const now = 5 * 1440;
    // 低好感+贴身+今天刚聊过(无久未聊加成): 0.2+0.3 = 0.5 过线,情绪只动分值
    const base = input({ affinity: 20, familiarity: 30, chatReady: true, lastChatAt: now - 720 });
    const happy = socialMotive([base], { valence: 1, nowGameMinutes: now });
    expect(happy[0]!.desire).toBeCloseTo(0.6, 10);
    const sad = socialMotive([base], { valence: -0.8, nowGameMinutes: now });
    expect(sad[0]!.desire).toBeCloseTo(0.5, 10);
    // 临界候选(异地无贴身 0.25):情绪推一把才过 0.35 点火线
    const edge = input({ affinity: 25, familiarity: 30, lastChatAt: now - 720 });
    expect(socialMotive([edge], { valence: -1, nowGameMinutes: now })).toEqual([]); // 0.25 < 0.35
    expect(socialMotive([edge], { valence: 1, nowGameMinutes: now })).toHaveLength(1); // 0.25+0.1 = 0.35
  });

  it('多候选按欲望降序排序', () => {
    const ranked = socialMotive(
      [input({ targetId: 'low', affinity: 20, chatReady: true }), hot],
      { valence: 0, nowGameMinutes: 0 },
    );
    expect(ranked.map((c) => c.targetId)).toEqual(['ta', 'low']);
    expect(ranked[0]!.desire).toBeGreaterThan(ranked[1]!.desire);
  });
});
