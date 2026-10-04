import { describe, expect, it } from 'vitest';
import type { ActivityFinishedEvent, WorldEvent } from '@sims/shared';
import { TOWN_MAP } from '@sims/shared';
import { Simulation } from './simulation.js';

/** 场所内指定活动的首个锚点使用格(M3.6e 内景) */
const anchorUse = (placeId: string, activityId: string): { x: number; y: number } => {
  const furniture = TOWN_MAP.places
    .find((p) => p.id === placeId)
    ?.furniture?.find((f) => f.activityId === activityId && f.use !== undefined);
  if (furniture?.use === undefined) throw new Error(`无锚点: ${placeId}/${activityId}`);
  return furniture.use;
};

/** 场所内指定 kind 锚点的使用格(M3.6g rest 三档) */
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

describe('活动执行(M3.1;M3.6e 锚点;M3.6f 体力区段;M3.6g 净速率+休息三档)', () => {
  it('学习完整 60 分钟(图书馆书桌): 净速率结算无待机叠加,自动完成', () => {
    const desk = anchorUse('library', 'study');
    const { sim, events } = simWith('alice', desk.x, desk.y);
    sim.requestStartActivity('alice', 'study');
    sim.advanceTicks(60);
    const alice = sim.character('alice');
    expect(alice.activity).toBeNull();
    expect(alice.energy).toBeCloseTo(100 - 60 * 0.12, 5); // 仅活动净速率,无叠加待机衰减
    expect(alice.happiness).toBeCloseTo(100 - 60 * 0.02, 5);
    const finished = events.find((e) => e.type === 'activity.finished');
    expect(finished).toMatchObject({
      type: 'activity.finished',
      characterId: 'alice',
      activityId: 'study',
      elapsedMinutes: 60,
      reason: 'completed',
    });
  });

  it('学习支持家中书桌: home-a 锚点同效(placeIds 多场所)', () => {
    const desk = anchorUse('home-a', 'study');
    const { sim } = simWith('bob', desk.x, desk.y);
    sim.requestStartActivity('bob', 'study');
    expect(sim.character('bob').activity).toMatchObject({ activityId: 'study', anchorKind: 'desk' });
  });

  it('打工 120 分钟(办公楼工位): 赚 60 金币,数值净消耗', () => {
    const desk = anchorUse('office', 'work');
    const { sim } = simWith('carl', desk.x, desk.y);
    sim.requestStartActivity('carl', 'work');
    sim.advanceTicks(120);
    const carl = sim.character('carl');
    expect(carl.coins).toBe(60);
    expect(carl.energy).toBeCloseTo(100 - 120 * 0.18, 5);
    expect(carl.happiness).toBeCloseTo(100 - 120 * 0.05, 5);
  });

  it('就餐余额不足(餐厅餐桌): 结算前判定,不透支,提前中断', () => {
    const table = anchorUse('restaurant', 'meal');
    const { sim, events } = simWith('dave', table.x, table.y);
    sim.character('dave').coins = 5;
    sim.requestStartActivity('dave', 'meal');
    sim.advanceTicks(30);
    const dave = sim.character('dave');
    expect(dave.activity).toBeNull();
    // 5 币够 12 分钟(5-0.4*12=0.2),第 13 分钟结算前判定不足;事件 elapsed=已结算分钟
    expect(dave.coins).toBeCloseTo(0.2, 5);
    const finished = events.find((e) => e.type === 'activity.finished');
    expect(finished).toMatchObject({
      type: 'activity.finished',
      activityId: 'meal',
      elapsedMinutes: 12,
      reason: 'insufficient_coins',
    });
  });

  it('散步无锚点: anchorKind 为空,移动打断即时中断', () => {
    const { sim, events } = simWith('erin', 9, 25); // 公园入口
    sim.requestStartActivity('erin', 'stroll');
    expect(sim.character('erin').activity).toMatchObject({ activityId: 'stroll', anchorKind: null });
    sim.advanceTicks(5);
    sim.requestMoveTo('erin', 10, 28); // 公园内部目标
    const erin = sim.character('erin');
    expect(erin.activity).toBeNull();
    expect(erin.path.length).toBeGreaterThan(0); // 路径已重新规划
    const finished = events.at(-1);
    expect(finished).toMatchObject({
      type: 'activity.finished',
      activityId: 'stroll',
      elapsedMinutes: 5,
      reason: 'interrupted',
    });
  });

  it('休息三档速率(M3.6g): 床>沙发>长椅,同起点同 durations 拉开差距', () => {
    const bed = anchorUseKind('home-a', 'bed'); // 首个生成角色 → home-a
    const sofa = anchorUseKind('library', 'sofa'); // 图书馆沙发(非住宅,无权属限制)
    const bench = anchorUseKind('park', 'bench');
    const { sim } = simWith('frank', bed.x, bed.y);
    sim.spawnCharacter('oscar', sofa.x, sofa.y, 'oscar'); // 第二个生成 → home-b,图书馆沙发放行
    sim.spawnCharacter('pete', bench.x, bench.y, 'pete'); // 第三个生成 → home-c,公园长椅放行
    for (const id of ['frank', 'oscar', 'pete']) {
      sim.character(id).energy = 50;
      sim.requestStartActivity(id, 'rest');
    }
    expect(sim.character('frank').activity).toMatchObject({ anchorKind: 'bed' });
    expect(sim.character('oscar').activity).toMatchObject({ anchorKind: 'sofa' });
    expect(sim.character('pete').activity).toMatchObject({ anchorKind: 'bench' });
    sim.advanceTicks(10);
    expect(sim.character('frank').energy).toBeCloseTo(50 + 10 * 0.35, 5);
    expect(sim.character('oscar').energy).toBeCloseTo(50 + 10 * 0.22, 5);
    expect(sim.character('pete').energy).toBeCloseTo(50 + 10 * 0.12, 5);
  });

  it('手动 stop(本人公寓床铺休息): 按床位速率结算已进行部分', () => {
    const bed = anchorUse('home-a', 'rest'); // 首个生成角色分到 home-a
    const { sim, events } = simWith('frank', bed.x, bed.y);
    sim.character('frank').energy = 40;
    sim.requestStartActivity('frank', 'rest');
    sim.advanceTicks(10);
    sim.requestStopActivity('frank');
    const frank = sim.character('frank');
    expect(frank.activity).toBeNull();
    expect(frank.energy).toBeCloseTo(40 + 10 * 0.35, 5); // 床档 +0.35/分
    const finished = events.find((e) => e.type === 'activity.finished') as ActivityFinishedEvent;
    expect(finished).toMatchObject({ reason: 'stopped', elapsedMinutes: 10 });
  });

  it('低体力区段(≤20): 高强度活动拒绝,基础活动(rest)放行', () => {
    const treadmill = anchorUse('gym', 'workout');
    const { sim } = simWith('kate', treadmill.x, treadmill.y);
    sim.character('kate').energy = 15;
    expect(() => sim.requestStartActivity('kate', 'workout')).toThrow(/体力过低/);
    const bed = anchorUse('home-b', 'rest'); // 第二个生成角色分到 home-b
    sim.spawnCharacter('leon', bed.x, bed.y, 'leon');
    sim.character('leon').energy = 15;
    sim.requestStartActivity('leon', 'rest'); // 基础活动不受区段限制
    expect(sim.character('leon').activity).toMatchObject({ activityId: 'rest' });
  });

  it('rest 床权属: 本人公寓放行,他人公寓拒绝,公园长椅放行,租约过期拒绝', () => {
    const bedA = anchorUse('home-a', 'rest');
    const { sim } = simWith('mary', bedA.x, bedA.y); // 首个生成 → home-a
    sim.requestStartActivity('mary', 'rest');
    expect(sim.character('mary').activity).toMatchObject({ activityId: 'rest' });
    sim.requestStopActivity('mary');
    const bedB = anchorUse('home-b', 'rest');
    sim.spawnCharacter('nick', 20, 12, 'nick'); // 第二个生成 → home-b
    sim.spawnCharacter('owen', bedB.x, bedB.y, 'owen'); // 第三个生成 → home-c,却站 home-b 的床
    expect(() => sim.requestStartActivity('owen', 'rest')).toThrow(/不是你的床位/);
    const bench = anchorUse('park', 'rest'); // 户外长椅无权属
    sim.spawnCharacter('paula', bench.x, bench.y, 'paula');
    sim.requestStartActivity('paula', 'rest');
    expect(sim.character('paula').activity).toMatchObject({ activityId: 'rest' });
    sim.character('mary').housing!.paidThroughDay = 0; // 模拟欠租跨日
    expect(() => sim.requestStartActivity('mary', 'rest')).toThrow(/租约已过期/);
  });

  it('锚点放宽(M3.6i): 紧邻家具占地(非声明格)可开始,两机间隙仍拒', () => {
    const { sim } = simWith('tina', 45, 28); // 跑步机(44,27..28)下侧旁,非声明格(45,27)
    sim.requestStartActivity('tina', 'workout');
    expect(sim.character('tina').activity).toMatchObject({
      activityId: 'workout',
      anchorKind: 'treadmill',
    });
    sim.spawnCharacter('uma', 46, 27, 'uma'); // 两台跑步机之间的空隙,不邻任何占地
    expect(() => sim.requestStartActivity('uma', 'workout')).toThrow(/跑步机旁/);
  });

  it('校验: 不在锚点/不在场所/移动中/重复开始/未知活动/无活动停止均拒绝', () => {
    const { sim } = simWith('gina', 8, 12); // 公寓入口(非书桌/床使用格)
    expect(() => sim.requestStartActivity('gina', 'study')).toThrow(/使用格/);
    expect(() => sim.requestStartActivity('gina', 'rest')).toThrow(/使用格/);
    sim.spawnCharacter('henry', 20, 13, 'henry'); // 门前路,不在公园
    expect(() => sim.requestStartActivity('henry', 'stroll')).toThrow(/场所/);
    sim.requestMoveTo('henry', 21, 13);
    expect(() => sim.requestStartActivity('henry', 'stroll')).toThrow(/移动中/);
    const bed = anchorUse('home-c', 'rest'); // iris 是第三个生成 → 轮询分到 home-c
    sim.spawnCharacter('iris', bed.x, bed.y, 'iris');
    sim.requestStartActivity('iris', 'rest');
    expect(() => sim.requestStartActivity('iris', 'rest')).toThrow(/已在进行/);
    expect(() => sim.requestStartActivity('iris', 'unknown')).toThrow(/未知活动/);
    sim.requestStopActivity('iris');
    expect(() => sim.requestStopActivity('iris')).toThrow(/没有进行中的活动/);
  });
});
