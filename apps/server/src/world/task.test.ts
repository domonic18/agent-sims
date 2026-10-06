import { describe, expect, it } from 'vitest';
import { BUSH_MAX_CHARGES, type WorldEvent } from '@sims/shared';
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

describe('work_task 采集两岗(M-G.6)', () => {
  function simWithGatherer(): { sim: Simulation; events: WorldEvent[] } {
    const sim = new Simulation();
    const events: WorldEvent[] = [];
    sim.events.subscribe((event) => events.push(event));
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').knowledge = 3; // 采集类门槛 3 班
    return { sim, events };
  }

  it('直发 start_activity 拒绝;门槛/枯竭/背包满 逐环拒绝', () => {
    const { sim } = simWithGatherer();
    expect(() => sim.requestStartActivity('mow', 'gather_berry')).toThrow(/work_task/);
    expect(() => sim.requestStartActivity('mow', 'scavenge')).toThrow(/work_task/);
    sim.character('mow').knowledge = 0;
    expect(() => sim.requestWorkTask('mow', 'berry_bush:5:27')).toThrow(/知识不足/);
    sim.character('mow').knowledge = 3;
    sim.resourceNodes.get('berry_bush:5:27')!.charges = 0;
    expect(() => sim.requestWorkTask('mow', 'berry_bush:5:27')).toThrow(/已采完/);
    sim.resourceNodes.get('berry_bush:5:27')!.charges = BUSH_MAX_CHARGES;
    sim.character('mow').backpack = { berry: 7 }; // 最坏产出 2 体积,7+2>8 放不下
    expect(() => sim.requestWorkTask('mow', 'berry_bush:5:27')).toThrow(/背包/);
  });

  it('采集浆果闭环: 寻路在途不计时,作业 20 分浆果×2 入包,丛存量递减,以物代薪不发币', () => {
    const { sim, events } = simWithGatherer();
    const node = sim.resourceNodes.get('berry_bush:5:27')!;
    sim.requestWorkTask('mow', 'berry_bush:5:27');
    expect(sim.character('mow').path.length).toBeGreaterThan(0);
    sim.advanceTicks(60);
    const mow = sim.character('mow');
    expect(mow.activity).toBeNull();
    expect(mow.backpack.berry).toBe(2);
    expect(mow.coins).toBe(0);
    expect(node.charges).toBe(2);
    expect(node.respawnAtDay).toBeNull();
    expect(events.some((e) => e.type === 'work_task.completed')).toBe(true);
  });

  it('存量采竭与跨日重生: 3 次采完记 respawnAtDay,次日 00:00 翻滚回满', () => {
    const { sim } = simWithGatherer();
    const node = sim.resourceNodes.get('berry_bush:5:27')!;
    for (let round = BUSH_MAX_CHARGES; round > 0; round -= 1) {
      expect(node.charges).toBe(round);
      sim.requestWorkTask('mow', 'berry_bush:5:27');
      sim.advanceTicks(60);
    }
    expect(node.charges).toBe(0);
    expect(node.respawnAtDay).toBe(sim.clock.day + 1);
    sim.advanceTicks(1440); // 跨过次日 00:00
    expect(node.charges).toBe(BUSH_MAX_CHARGES);
    expect(node.respawnAtDay).toBeNull();
  });

  it('拾荒: 废料必得;30% 树枝由 rng 决定;拾荒堆存量 null 永不枯竭', () => {
    const lucky = new Simulation(() => 0.1); // roll < 0.3 → 树枝必出
    lucky.spawnCharacter('sca', 8, 12, '鲁大');
    lucky.character('sca').knowledge = 3;
    lucky.requestWorkTask('sca', 'junk_pile:25:20');
    lucky.advanceTicks(60);
    expect(lucky.character('sca').backpack.scrap).toBe(1);
    expect(lucky.character('sca').backpack.twig).toBe(1);
    expect(lucky.resourceNodes.get('junk_pile:25:20')!.charges).toBeNull();

    const unlucky = new Simulation(() => 0.9); // roll ≥ 0.3 → 树枝不出
    unlucky.spawnCharacter('sca', 8, 12, '鲁大');
    unlucky.character('sca').knowledge = 3;
    unlucky.requestWorkTask('sca', 'junk_pile:25:20');
    unlucky.advanceTicks(60);
    expect(unlucky.character('sca').backpack.scrap).toBe(1);
    expect(unlucky.character('sca').backpack.twig).toBeUndefined();
  });

  it('竞态-节点被采空: 作业中存量归零→cancelled 无产出', () => {
    const { sim, events } = simWithGatherer();
    sim.requestWorkTask('mow', 'berry_bush:5:27');
    sim.advanceTicks(20); // 到位作业中(约 10 tick 到位+作业 10 分,未满 20 分)
    sim.resourceNodes.get('berry_bush:5:27')!.charges = 0;
    sim.advanceTicks(2);
    expect(sim.character('mow').activity).toBeNull();
    expect(sim.character('mow').backpack.berry).toBeUndefined();
    expect(events.some((e) => e.type === 'work_task.cancelled')).toBe(true);
  });

  it('reset 从地图种子重建节点,存量回满', () => {
    const { sim } = simWithGatherer();
    const node = sim.resourceNodes.get('berry_bush:5:27')!;
    node.charges = 0;
    node.respawnAtDay = 5;
    sim.reset();
    expect(sim.resourceNodes.get('berry_bush:5:27')).toEqual({
      id: 'berry_bush:5:27',
      kind: 'berry_bush',
      x: 5,
      y: 27,
      charges: BUSH_MAX_CHARGES,
      respawnAtDay: null,
    });
  });

  it('快照透传 resources 全集', () => {
    const { sim } = simWithGatherer();
    expect(sim.snapshot().resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'berry_bush:5:27',
          kind: 'berry_bush',
          charges: BUSH_MAX_CHARGES,
          respawnAtDay: null,
        }),
        expect.objectContaining({ id: 'junk_pile:55:30', kind: 'junk_pile', charges: null }),
      ]),
    );
  });
});
