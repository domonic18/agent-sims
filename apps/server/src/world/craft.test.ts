import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { Simulation } from './simulation.js';

const STOVE_USE = { x: 36, y: 28 }; // 餐厅灶台使用格(TOWN_MAP)
const BENCH_USE = { x: 51, y: 7 }; // 办公楼木工台使用格

function simWithChef(): { sim: Simulation; events: WorldEvent[] } {
  const sim = new Simulation();
  const events: WorldEvent[] = [];
  sim.events.subscribe((event) => events.push(event));
  sim.spawnCharacter('chef', 8, 12, '小满');
  sim.character('chef').knowledge = 3; // 采集类门槛(浆果派)
  return { sim, events };
}

/** 走到灶台使用格并就位 */
function arriveAt(sim: Simulation, x: number, y: number): void {
  sim.requestMoveTo('chef', x, y);
  sim.advanceTicks(60);
  expect(sim.character('chef').path).toHaveLength(0);
}

describe('craft 配方制作(M-G.6)', () => {
  it('未知配方/材料不足/直发 start_activity 逐环拒绝', () => {
    const { sim } = simWithChef();
    expect(() => sim.requestCraft('chef', 'craft_nope')).toThrow(/未知配方/);
    sim.character('chef').backpack = { berry: 2 }; // 差 1 浆果
    expect(() => sim.requestCraft('chef', 'craft_berry_pie')).toThrow(/材料不足/);
    expect(() => sim.requestStartActivity('chef', 'craft_berry_pie')).toThrow(/craft 意图/);
  });

  it('不在灶台旁拒绝(锚点判定沿用活动框架)', () => {
    const { sim } = simWithChef();
    sim.character('chef').backpack = { berry: 3 };
    expect(() => sim.requestCraft('chef', 'craft_berry_pie')).toThrow(/浆果派|使用格|站立/);
  });

  it('制作闭环: 开始扣料,作业 25 分浆果派入包+craft.completed,不退料', () => {
    const { sim, events } = simWithChef();
    sim.character('chef').backpack = { berry: 3 };
    arriveAt(sim, STOVE_USE.x, STOVE_USE.y);
    const chef = sim.requestCraft('chef', 'craft_berry_pie');
    expect(chef.backpack.berry).toBeUndefined(); // 开始即扣料
    expect(chef.activity).toMatchObject({
      activityId: 'craft_berry_pie',
      craftRecipeId: 'craft_berry_pie',
    });
    sim.advanceTicks(40);
    const done = sim.character('chef');
    expect(done.activity).toBeNull();
    expect(done.backpack.berry_pie).toBe(1);
    expect(events.some((e) => e.type === 'craft.completed')).toBe(true);
    expect(
      events.some((e) => e.type === 'activity.finished' && e.reason === 'completed'),
    ).toBe(true);
  });

  it('主动停止退料: 浆果全额退回,无产出', () => {
    const { sim, events } = simWithChef();
    sim.character('chef').backpack = { berry: 4 }; // 多带 1 个,验证只退投入
    arriveAt(sim, STOVE_USE.x, STOVE_USE.y);
    sim.requestCraft('chef', 'craft_berry_pie');
    sim.advanceTicks(5);
    sim.requestStopActivity('chef');
    const chef = sim.character('chef');
    expect(chef.activity).toBeNull();
    expect(chef.backpack.berry).toBe(4);
    expect(chef.backpack.berry_pie).toBeUndefined();
    expect(events.some((e) => e.type === 'craft.completed')).toBe(false);
  });

  it('移动打断退料: 半路改道,材料回包', () => {
    const { sim } = simWithChef();
    sim.character('chef').backpack = { berry: 3 };
    arriveAt(sim, STOVE_USE.x, STOVE_USE.y);
    sim.requestCraft('chef', 'craft_berry_pie');
    sim.advanceTicks(5);
    sim.requestMoveTo('chef', 35, 28); // 走位打断
    expect(sim.character('chef').backpack.berry).toBe(3);
    expect(sim.character('chef').backpack.berry_pie).toBeUndefined();
  });

  it('修补钉门槛: 知识不足 6 班拒制钉;快照不泄露内存态 craftRecipeId', () => {
    const { sim } = simWithChef();
    sim.character('chef').backpack = { scrap: 2 };
    arriveAt(sim, BENCH_USE.x, BENCH_USE.y);
    expect(() => sim.requestCraft('chef', 'craft_repair_kit')).toThrow(/知识不足/);
    sim.character('chef').knowledge = 6;
    sim.requestCraft('chef', 'craft_repair_kit');
    const activity = sim.snapshot().characters[0]!.activity;
    expect(activity).not.toBeNull();
    expect(Object.keys(activity!)).toEqual(['activityId', 'elapsedMinutes', 'anchorKind']);
  });
});

describe('食物链制作两配方(2026-10-07 食物经济)', () => {
  it('craft_bread 闭环: 缺料拒,灶台旁开始扣料 20 分面包入包;中断退料', () => {
    const { sim, events } = simWithChef();
    sim.character('chef').backpack = { wheat: 1 };
    expect(() => sim.requestCraft('chef', 'craft_bread')).toThrow(/材料不足/);
    sim.character('chef').backpack = { wheat: 3 };
    arriveAt(sim, STOVE_USE.x, STOVE_USE.y); // 站点泛化: 灶台锚点服务同 stationKind 配方
    const chef = sim.requestCraft('chef', 'craft_bread');
    expect(chef.backpack.wheat).toBe(1); // 开始扣 2 留 1
    expect(chef.activity).toMatchObject({ craftRecipeId: 'craft_bread' });
    sim.advanceTicks(5);
    sim.requestStopActivity('chef'); // 中断全额退料
    expect(sim.character('chef').backpack.wheat).toBe(3);
    expect(events.some((e) => e.type === 'craft.completed')).toBe(false);
    sim.requestCraft('chef', 'craft_bread');
    sim.advanceTicks(40); // 20 分作业
    const done = sim.character('chef');
    expect(done.activity).toBeNull();
    expect(done.backpack.wheat).toBe(1);
    expect(done.backpack.bread).toBe(1);
    expect(events.some((e) => e.type === 'craft.completed')).toBe(true);
  });

  it('craft_sandwich 闭环: bread+apple 双料扣验,25 分三明治入包', () => {
    const { sim, events } = simWithChef();
    sim.character('chef').backpack = { bread: 1 }; // 缺苹果
    expect(() => sim.requestCraft('chef', 'craft_sandwich')).toThrow(/材料不足/);
    sim.character('chef').backpack = { bread: 1, apple: 2 };
    arriveAt(sim, STOVE_USE.x, STOVE_USE.y);
    sim.requestCraft('chef', 'craft_sandwich');
    const chef = sim.character('chef');
    expect(chef.backpack.bread).toBeUndefined(); // 双料全扣
    expect(chef.backpack.apple).toBe(1);
    sim.advanceTicks(45); // 25 分作业
    const done = sim.character('chef');
    expect(done.activity).toBeNull();
    expect(done.backpack.sandwich).toBe(1);
    expect(events.some((e) => e.type === 'craft.completed')).toBe(true);
  });

  it('缺觉 floor: 单件产出 ×0.7 取整为 0,材料已扣不退(有意)', () => {
    const { sim, events } = simWithChef();
    sim.character('chef').backpack = { wheat: 2 };
    arriveAt(sim, STOVE_USE.x, STOVE_USE.y);
    sim.character('chef').sleepDebtEndGameMinutes = sim.clock.gameMinutes + 60; // 挂缺觉惩罚
    sim.requestCraft('chef', 'craft_bread');
    sim.advanceTicks(40);
    const done = sim.character('chef');
    expect(done.activity).toBeNull();
    expect(done.backpack.bread ?? 0).toBe(0); // floor(1×0.7)=0
    expect(done.backpack.wheat).toBeUndefined();
    expect(events.some((e) => e.type === 'craft.completed')).toBe(true);
  });
});

describe('修补钉闭环(M-G.6 修理岗消耗品)', () => {
  const FENCE_ID = 'fence:4:26';

  function simWithFixer(): { sim: Simulation; events: WorldEvent[] } {
    const sim = new Simulation();
    const events: WorldEvent[] = [];
    sim.events.subscribe((event) => events.push(event));
    sim.spawnCharacter('fix', 8, 12, '鲁大');
    sim.character('fix').knowledge = 6; // 建造类门槛
    sim.maintenanceSpots.set(FENCE_ID, { id: FENCE_ID, kind: 'fence_damage', x: 4, y: 26, variant: 0 });
    return { sim, events };
  }

  it('无钉接单拒;持钉接单完成 +36 币且扣钉 1', () => {
    const { sim } = simWithFixer();
    expect(() => sim.requestWorkTask('fix', FENCE_ID)).toThrow(/没有修补钉/);
    sim.character('fix').backpack = { repair_kit: 2 };
    sim.requestWorkTask('fix', FENCE_ID);
    sim.advanceTicks(120);
    const fix = sim.character('fix');
    expect(sim.maintenanceSpots.has(FENCE_ID)).toBe(false);
    expect(fix.coins).toBe(36);
    expect(fix.backpack.repair_kit).toBe(1);
  });

  it('作业中钉被转移(存冰箱等): 完成时刻再验→cancelled 无薪', () => {
    const { sim, events } = simWithFixer();
    sim.character('fix').backpack = { repair_kit: 1 };
    sim.requestWorkTask('fix', FENCE_ID);
    sim.advanceTicks(20); // 到位作业中(约 9 tick 到位+作业 11 分,未满 30 分)
    sim.character('fix').backpack = {}; // 中途转移走
    sim.advanceTicks(120);
    const fix = sim.character('fix');
    expect(fix.activity).toBeNull();
    expect(fix.coins).toBe(0);
    expect(sim.maintenanceSpots.has(FENCE_ID)).toBe(true);
    expect(events.some((e) => e.type === 'work_task.cancelled')).toBe(true);
  });
});
