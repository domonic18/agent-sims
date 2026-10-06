import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { Simulation } from './simulation.js';

const LITTER_ID = 'litter:10:14';
const LITTER_SPOT = { id: LITTER_ID, kind: 'litter' as const, x: 10, y: 14, variant: 0 };

function simWithFixtures(): {
  sim: Simulation;
  events: WorldEvent[];
} {
  const sim = new Simulation();
  const events: WorldEvent[] = [];
  sim.events.subscribe((event) => events.push(event));
  sim.spawnCharacter('mow', 8, 12, '小满');
  expect(sim.map.isWalkable(LITTER_SPOT.x, LITTER_SPOT.y), 'fixture 杂物格须可行走').toBe(true);
  sim.maintenanceSpots.set(LITTER_ID, LITTER_SPOT);
  return { sim, events };
}

describe('work_task 维护工单(M-G.5)', () => {
  it('校验序: 目标不存在/移动中/活动中/低体力/知识不足 逐环拒绝', () => {
    const { sim } = simWithFixtures();
    expect(() => sim.requestWorkTask('mow', 'litter:0:0')).toThrow(/目标不存在/);
    sim.requestMoveTo('mow', 12, 12);
    expect(() => sim.requestWorkTask('mow', LITTER_ID)).toThrow(/移动中/);
    sim.requestStopMove('mow');
    sim.advanceTicks(10); // 走完
    sim.character('mow').activity = { activityId: 'stroll', elapsed: 0, anchorKind: null, targetId: null };
    expect(() => sim.requestWorkTask('mow', LITTER_ID)).toThrow(/已在进行活动/);
    sim.character('mow').activity = null;
    sim.character('mow').energy = 15;
    expect(() => sim.requestWorkTask('mow', LITTER_ID)).toThrow(/体力过低/);
    sim.character('mow').energy = 100;
    sim.maintenanceSpots.set('fence:4:26', { id: 'fence:4:26', kind: 'fence_damage', x: 4, y: 26, variant: 0 });
    expect(() => sim.requestWorkTask('mow', 'fence:4:26')).toThrow(/知识不足/);
  });

  it('接单成功: 挂工单活动+寻路在途+accepted 事件;在途不计时', () => {
    const { sim, events } = simWithFixtures();
    const character = sim.requestWorkTask('mow', LITTER_ID);
    expect(character.activity).toMatchObject({ activityId: 'clean', targetId: LITTER_ID, elapsed: 0 });
    expect(character.path.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'work_task.accepted')).toBe(true);
    sim.advanceTicks(1);
    expect(sim.character('mow').activity?.elapsed).toBe(0); // 在途分钟不计时
  });

  it('清洁单闭环: 作业 15 分完成,spot 消失,+12 币,completed 事件', () => {
    const { sim, events } = simWithFixtures();
    sim.requestWorkTask('mow', LITTER_ID);
    sim.advanceTicks(60);
    const mow = sim.character('mow');
    expect(mow.activity).toBeNull();
    expect(sim.maintenanceSpots.has(LITTER_ID)).toBe(false);
    expect(mow.coins).toBe(12);
    expect(events.some((e) => e.type === 'work_task.completed')).toBe(true);
    expect(mow.activity).toBeNull();
  });

  it('修理单门槛与结算: 知识 6 班修围栏 30 分 +36 币', () => {
    const { sim } = simWithFixtures();
    sim.maintenanceSpots.set('fence:4:26', { id: 'fence:4:26', kind: 'fence_damage', x: 4, y: 26, variant: 0 });
    sim.character('mow').knowledge = 6;
    const character = sim.requestWorkTask('mow', 'fence:4:26');
    expect(character.activity?.activityId).toBe('repair');
    expect(character.path.length).toBeGreaterThan(0); // 围栏格阻塞,站四邻
    sim.advanceTicks(120);
    const mow = sim.character('mow');
    expect(sim.maintenanceSpots.has('fence:4:26')).toBe(false);
    expect(mow.coins).toBe(36);
  });

  it('作业中 move_to 打断: 无薪,spot 保留,活动结束', () => {
    const { sim } = simWithFixtures();
    sim.requestWorkTask('mow', LITTER_ID);
    sim.advanceTicks(80); // 完成已不可,这里先走完到 spot 再重新挂单验证打断
    expect(sim.maintenanceSpots.has(LITTER_ID)).toBe(false);
    sim.maintenanceSpots.set('litter:12:16', { id: 'litter:12:16', kind: 'litter', x: 12, y: 16, variant: 1 });
    sim.requestWorkTask('mow', 'litter:12:16');
    sim.advanceTicks(10); // 到位开始作业
    const coins = sim.character('mow').coins;
    sim.requestMoveTo('mow', 8, 12); // 走位打断=放弃工单
    const mow = sim.character('mow');
    expect(mow.activity).toBeNull();
    expect(mow.coins).toBe(coins); // 无薪
    expect(sim.maintenanceSpots.has('litter:12:16')).toBe(true); // spot 保留
  });

  it('竞态-目标失效: 作业中 spot 被清→cancelled 无薪', () => {
    const { sim, events } = simWithFixtures();
    sim.maintenanceSpots.set('litter:12:16', { id: 'litter:12:16', kind: 'litter', x: 12, y: 16, variant: 1 });
    sim.requestWorkTask('mow', 'litter:12:16');
    sim.advanceTicks(10); // 到位作业中
    sim.maintenanceSpots.delete('litter:12:16'); // 外部消除(如他岗完成)
    sim.advanceTicks(2);
    const mow = sim.character('mow');
    expect(mow.activity).toBeNull();
    expect(mow.coins).toBe(0);
    expect(events.some((e) => e.type === 'work_task.cancelled')).toBe(true);
  });

  it('救治单: 幽灵窗口内接单,30 分满状态免扣复活 +45 币', () => {
    const { sim, events } = simWithFixtures();
    sim.spawnCharacter('mort', 10, 12, '莫特');
    sim.spawnCharacter('doc', 8, 14, '杜克');
    sim.character('doc').knowledge = 9;
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6); // mort 死亡挂起
    expect(sim.character('mort').alive).toBe(false);
    const diedLifeScore = sim.character('mort').lifeScore;
    const doctor = sim.requestWorkTask('doc', 'mort');
    expect(doctor.activity).toMatchObject({ activityId: 'rescue', targetId: 'mort' });
    sim.advanceTicks(90);
    const mort = sim.character('mort');
    expect(mort.alive).toBe(true);
    expect(mort.energy).toBeGreaterThan(95); // 复活满状态,复活后待机代谢缓慢回落
    // 免扣:扣分生效会 ×0.8 (< diedLifeScore);实际不低于死亡时值(复活后质量流继续)
    expect(mort.lifeScore).toBeGreaterThan(diedLifeScore);
    expect(sim.character('doc').coins).toBe(45);
    expect(events.some((e) => e.type === 'character.revived')).toBe(true);
    expect(events.some((e) => e.type === 'work_task.completed')).toBe(true);
  });

  it('救治竞态: 目标被抢先复活→cancelled 无薪;窗口超时接单即拒', () => {
    const { sim } = simWithFixtures();
    sim.spawnCharacter('mort', 10, 12, '莫特');
    sim.spawnCharacter('doc', 8, 14, '杜克');
    sim.character('doc').knowledge = 9;
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6);
    sim.requestWorkTask('doc', 'mort');
    sim.debugRevive('mort'); // 抢先救治
    sim.advanceTicks(10);
    expect(sim.character('doc').activity).toBeNull();
    expect(sim.character('doc').coins).toBe(0);
    // 窗口超时:再死亡并把死亡时刻拨回窗外
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6);
    sim.character('mort').diedAtGameMinutes = sim.clock.gameMinutes - 1441;
    expect(() => sim.requestWorkTask('doc', 'mort')).toThrow(/救治窗口/);
  });

  it('startActivity 直发维护三岗拒绝(须经 work_task)', () => {
    const { sim } = simWithFixtures();
    expect(() => sim.requestStartActivity('mow', 'clean')).toThrow(/work_task/);
    expect(() => sim.requestStartActivity('mow', 'repair')).toThrow(/work_task/);
    expect(() => sim.requestStartActivity('mow', 'rescue')).toThrow(/work_task/);
  });

  it('作业中体力耗尽死亡打断工单', () => {
    const { sim, events } = simWithFixtures();
    sim.requestWorkTask('mow', LITTER_ID);
    sim.advanceTicks(5); // 到位作业中
    sim.character('mow').energy = 0.4;
    sim.advanceTicks(5); // 作业净速率耗尽
    const mow = sim.character('mow');
    expect(mow.alive).toBe(false);
    expect(mow.activity).toBeNull();
    expect(events.some((e) => e.type === 'character.died')).toBe(true);
    expect(sim.maintenanceSpots.has(LITTER_ID)).toBe(true);
  });
});
