import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { TOWN_MAP } from '@sims/shared';
import { applyBalanceOverrides, applyWorldParams } from '../config/balance.js';
import { Simulation } from './simulation.js';

/** 场所内绑定指定活动的首个锚点使用格 */
const anchorUse = (placeId: string, activityId: string): { x: number; y: number } => {
  const furniture = TOWN_MAP.places
    .find((p) => p.id === placeId)
    ?.furniture?.find((f) => f.activityId === activityId && f.use !== undefined);
  if (furniture?.use === undefined) throw new Error(`无锚点: ${placeId}/${activityId}`);
  return furniture.use;
};

/** 场所内指定 kind 锚点的使用格(床/长椅/跑步机,均绑 rest) */
const anchorUseKind = (placeId: string, kind: string): { x: number; y: number } => {
  const furniture = TOWN_MAP.places
    .find((p) => p.id === placeId)
    ?.furniture?.find((f) => f.kind === kind && f.activityId === 'rest' && f.use !== undefined);
  if (furniture?.use === undefined) throw new Error(`无 ${kind} 锚点: ${placeId}`);
  return furniture.use;
};

function simWith(id: string, x: number, y: number): { sim: Simulation; events: WorldEvent[] } {
  const sim = new Simulation();
  const events: WorldEvent[] = [];
  sim.events.subscribe((event) => events.push(event));
  sim.spawnCharacter(id, x, y, id);
  return { sim, events };
}

/** 纪元(第 1 日 08:00=gameMinutes 480)起的推进步数 */
const TO_2200_D1 = 840; // → 1320
const TO_0400_D2 = 1200; // → 1680
const TO_0600_D2 = 1320; // → 1800
const TO_2200_D2 = 2280; // → 2760

describe('sleep 入睡校验(M-G.2)', () => {
  it('自家床可睡(anchorKind=bed);公园长椅非 sleep 档位不可睡', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim } = simWith('mow', bed.x, bed.y); // 首个生成 → home-a
    sim.requestStartActivity('mow', 'sleep');
    expect(sim.character('mow').activity).toMatchObject({ activityId: 'sleep', anchorKind: 'bed' });
    const bench = anchorUseKind('park', 'bench');
    sim.spawnCharacter('paula', bench.x, bench.y, 'paula'); // 第二个生成 → home-b,站公园长椅
    expect(() => sim.requestStartActivity('paula', 'sleep')).toThrow(/床旁/);
  });

  it('他人公寓床拒绝(床位归属),租约过期拒绝', () => {
    const bedB = anchorUseKind('home-b', 'bed');
    const { sim } = simWith('mary', 9, 12); // 首个 → home-a
    sim.spawnCharacter('nick', 20, 12, 'nick'); // 第二个 → home-b
    sim.spawnCharacter('owen', bedB.x, bedB.y, 'owen'); // 第三个 → home-c,站 home-b 的床
    expect(() => sim.requestStartActivity('owen', 'sleep')).toThrow(/不是你的床位/);
    sim.character('mary').housing = {
      propertyId: 'home-a',
      ownership: 'rent',
      paidThroughDay: 0, // 欠租
    };
    const bedA = anchorUseKind('home-a', 'bed');
    sim.requestMoveTo('mary', bedA.x, bedA.y);
    sim.advanceTicks(60);
    expect(sim.character('mary').path).toHaveLength(0);
    expect(() => sim.requestStartActivity('mary', 'sleep')).toThrow(/租约已过期/);
  });
});

describe('sleep 速率与自然醒', () => {
  it('床档速率 +0.35 体力每分,不叠待机衰减;睡眠零得分(04 §2.5)', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim } = simWith('mow', bed.x, bed.y);
    sim.advanceTicks(TO_2200_D1);
    sim.character('mow').energy = 50;
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(10);
    const mow = sim.character('mow');
    expect(mow.energy).toBeCloseTo(50 + 10 * 0.35, 5);
    expect(mow.score).toBe(0);
  });

  it('480 分自然醒 completed(白天睡同样完成,但不进窗口账本)', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim, events } = simWith('mow', bed.x, bed.y); // 08:00 白天开睡
    sim.character('mow').energy = 20;
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(480);
    const mow = sim.character('mow');
    expect(mow.activity).toBeNull();
    expect(mow.energy).toBe(100); // 20+168 上限夹取
    expect(mow.sleepWindowMinutes).toBe(0); // 08:00~16:00 非窗口,分文不记
    expect(events.some((e) => e.type === 'activity.finished' && e.reason === 'completed')).toBe(
      true,
    );
  });
});

describe('睡眠账本与缺觉结算(M-G.2,数值文档 §2.7)', () => {
  it('22:00 睡至 06:00(≥240 分): 无缺觉事件,06:00 账本清零,480 分自然醒', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim, events } = simWith('mow', bed.x, bed.y);
    sim.advanceTicks(TO_2200_D1);
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(480); // 22:00 → 次日 06:00
    const mow = sim.character('mow');
    expect(events.some((e) => e.type === 'sleep.debt_applied')).toBe(false);
    expect(mow.sleepWindowMinutes).toBe(0); // 结算后无条件清零
    expect(mow.activity).toBeNull(); // 同刻睡满 480 自然醒
    expect(events.some((e) => e.type === 'activity.finished' && e.reason === 'completed')).toBe(
      true,
    );
  });

  it('只睡 239 分: 06:00 结算 debt_applied,快照 sleepDebt=true,次日工时金币 ×0.7', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim, events } = simWith('mow', bed.x, bed.y);
    sim.advanceTicks(TO_2200_D1);
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(239);
    sim.requestStopActivity('mow');
    sim.advanceTicks(TO_0600_D2 - TO_2200_D1 - 239); // 空转到 06:00
    expect(events.some((e) => e.type === 'sleep.debt_applied')).toBe(true);
    expect(sim.character('mow').sleepWindowMinutes).toBe(0);
    expect(sim.snapshot().characters[0]!.sleepDebt).toBe(true);
    // 次日杂工: 0.8 币/分 ×0.7=0.56,120 分 = 67.2
    const work = anchorUse('office', 'work');
    sim.requestMoveTo('mow', work.x, work.y);
    sim.advanceTicks(60);
    expect(sim.character('mow').path).toHaveLength(0);
    sim.requestStartActivity('mow', 'work');
    sim.advanceTicks(120);
    expect(sim.character('mow').coins).toBeCloseTo(96 * 0.7, 5);
  });

  it('缺觉只罚正收益: workout 得分 ×0.7,体力原速不折', () => {
    const treadmill = anchorUse('gym', 'workout');
    const { sim } = simWith('kate', treadmill.x, treadmill.y);
    sim.character('kate').sleepDebtEndGameMinutes = sim.clock.gameMinutes + 10_000; // 注入缺觉
    sim.requestStartActivity('kate', 'workout');
    sim.advanceTicks(40);
    const kate = sim.character('kate');
    expect(kate.score).toBeCloseTo(40 * 0.35 * 0.7, 5); // +0.35/分 → ×0.7
    expect(kate.energy).toBeCloseTo(100 - 40 * 0.4, 5); // -0.4 不动
  });

  it('缺觉日采集 floor(2×0.7)=1 入包', () => {
    const { sim } = simWith('mow', 8, 12);
    sim.character('mow').knowledge = 3;
    sim.character('mow').sleepDebtEndGameMinutes = sim.clock.gameMinutes + 10_000;
    sim.requestWorkTask('mow', 'berry_bush:5:27');
    sim.advanceTicks(60);
    expect(sim.character('mow').backpack.berry).toBe(1);
    expect(sim.resourceNodes.get('berry_bush:5:27')!.charges).toBe(2); // 扣存量照常
  });

  it('缺觉日制作 floor(1×0.7)=0: 派不出(材料已扣不退,有意)', () => {
    const { sim, events } = simWith('chef', 36, 28); // 餐厅灶台使用格
    sim.character('chef').knowledge = 3;
    sim.character('chef').sleepDebtEndGameMinutes = sim.clock.gameMinutes + 10_000;
    sim.character('chef').backpack = { berry: 3 };
    sim.requestCraft('chef', 'craft_berry_pie');
    sim.advanceTicks(40);
    const chef = sim.character('chef');
    expect(chef.activity).toBeNull();
    expect(chef.backpack.berry).toBeUndefined(); // 料已扣
    expect(chef.backpack.berry_pie ?? 0).toBe(0); // floor(0.7)=0 无产出
    expect(events.some((e) => e.type === 'craft.completed')).toBe(true);
  });

  it('中断续睡累计: 100+140=240 分不缺觉', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim, events } = simWith('mow', bed.x, bed.y);
    sim.advanceTicks(TO_2200_D1);
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(100);
    sim.requestStopActivity('mow');
    sim.advanceTicks(1);
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(140);
    sim.requestStopActivity('mow');
    sim.advanceTicks(TO_0600_D2 - TO_2200_D1 - 241); // 空转到 06:00
    expect(events.some((e) => e.type === 'sleep.debt_applied')).toBe(false);
    expect(sim.character('mow').sleepWindowMinutes).toBe(0);
  });

  it('04:00 开睡跨 06:00: 仅窗口内分钟入账,结算清零后续睡不进新账本', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim, events } = simWith('mow', bed.x, bed.y);
    sim.advanceTicks(TO_0400_D2);
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(120); // 04:00 → 06:00
    expect(events.some((e) => e.type === 'sleep.debt_applied')).toBe(true); // 窗口 119<240
    sim.advanceTicks(120); // 续睡至 08:00
    const mow = sim.character('mow');
    expect(mow.sleepWindowMinutes).toBe(0); // 06:00 后的睡眠分钟不计入新账本
    expect(mow.activity).not.toBeNull(); // 仍在睡(未满 480 分)
  });

  it('惩罚次日到期: 补足睡眠后第三日 06:00 系数回 1', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim } = simWith('mow', bed.x, bed.y);
    // 第一夜只睡 239 分 → 缺觉
    sim.advanceTicks(TO_2200_D1);
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(239);
    sim.requestStopActivity('mow');
    sim.advanceTicks(TO_0600_D2 - TO_2200_D1 - 239);
    expect(sim.snapshot().characters[0]!.sleepDebt).toBe(true);
    // 第二夜睡满 → 旧惩罚于第三日 06:00 到期且无新缺觉
    sim.advanceTicks(TO_2200_D2 - TO_0600_D2);
    sim.requestStartActivity('mow', 'sleep');
    sim.advanceTicks(480); // 22:00 → 第三日 06:00
    expect(sim.character('mow').activity).toBeNull(); // 自然醒
    expect(sim.snapshot().characters[0]!.sleepDebt).toBe(false);
    // 白天杂工全额
    const work = anchorUse('office', 'work');
    sim.requestMoveTo('mow', work.x, work.y);
    sim.advanceTicks(60);
    sim.requestStartActivity('mow', 'work');
    sim.advanceTicks(120);
    expect(sim.character('mow').coins).toBeCloseTo(96, 5);
  });

  it('热调 SLEEP_MIN_MINUTES=0: 当夜不睡也不缺觉', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim, events } = simWith('mow', bed.x, bed.y);
    try {
      applyBalanceOverrides({ SLEEP_MIN_MINUTES: 0 });
      sim.advanceTicks(TO_2200_D1);
      sim.requestStartActivity('mow', 'sleep');
      sim.advanceTicks(10);
      sim.requestStopActivity('mow');
      sim.advanceTicks(TO_0600_D2 - TO_2200_D1 - 10);
      expect(events.some((e) => e.type === 'sleep.debt_applied')).toBe(false);
    } finally {
      applyWorldParams(); // 复位出厂默认,防跨用例污染
    }
  });

  it('快照序列化: sleepWindowMinutes/sleepDebt 必下发', () => {
    const bed = anchorUseKind('home-a', 'bed');
    const { sim } = simWith('mow', bed.x, bed.y);
    expect(sim.snapshot().characters[0]!.sleepWindowMinutes).toBe(0);
    expect(sim.snapshot().characters[0]!.sleepDebt).toBe(false);
    sim.character('mow').sleepDebtEndGameMinutes = sim.clock.gameMinutes + 500;
    expect(sim.snapshot().characters[0]!.sleepDebt).toBe(true);
  });
});
