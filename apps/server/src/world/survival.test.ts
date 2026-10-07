import { describe, expect, it } from 'vitest';
import { REVIVE_WINDOW_MINUTES, TOWN_MAP, type WorldEvent } from '@sims/shared';
import { Simulation } from './simulation.js';

/** 场所内指定 kind 锚点的使用格(虚脱矩阵用公园长椅) */
const anchorUseKind = (placeId: string, kind: string): { x: number; y: number } => {
  const furniture = TOWN_MAP.places
    .find((p) => p.id === placeId)
    ?.furniture?.find((f) => f.kind === kind && f.activityId === 'rest' && f.use !== undefined);
  if (furniture?.use === undefined) throw new Error(`无 ${kind} 锚点: ${placeId}`);
  return furniture.use;
};

function survivalSim(): { sim: Simulation; events: WorldEvent[] } {
  const sim = new Simulation();
  sim.gameType = 'survival';
  const events: WorldEvent[] = [];
  sim.events.subscribe((event) => events.push(event));
  return { sim, events };
}

describe('生存健康数值(M-S/S1)', () => {
  it('growth 模式健康恒满: 饥饿线以下不结算(growth 零回归)', () => {
    const sim = new Simulation();
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').energy = 10; // < 饥饿线 20
    sim.advanceTicks(100);
    const mow = sim.character('mow');
    expect(mow.alive).toBe(true);
    expect(mow.health).toBe(100);
  });

  it('survival 饥饿损耗: 体力低于饥饿线,健康 -0.03/分线性流失', () => {
    const { sim } = survivalSim();
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').energy = 10;
    sim.advanceTicks(100);
    const mow = sim.character('mow');
    expect(mow.alive).toBe(true); // 体力尚足,未入重伤
    expect(mow.health).toBeCloseTo(97, 5); // 100 - 100 × 0.03
    expect(mow.energy).toBeCloseTo(8, 5); // 待机衰减 0.02/分
  });

  it('survival 康复与区间: 体力达康复线 +0.02/分;饥饿线~康复线之间冻结', () => {
    const { sim } = survivalSim();
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').energy = 80;
    sim.character('mow').health = 50;
    sim.advanceTicks(100);
    expect(sim.character('mow').health).toBeCloseTo(52, 5); // 50 + 100 × 0.02
    sim.character('mow').energy = 40; // 饥饿线~康复线之间: 无压力也无回复
    sim.advanceTicks(100);
    expect(sim.character('mow').health).toBeCloseTo(52, 5);
  });

  it('健康归零入重伤休整(唯一死亡闸门): 幽灵态挂起+死亡事件', () => {
    const { sim, events } = survivalSim();
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').health = 0.05; // 下一分钟饥饿损耗归零
    sim.character('mow').energy = 10;
    sim.advanceTicks(3);
    const mow = sim.character('mow');
    expect(mow.alive).toBe(false);
    expect(mow.diedAtGameMinutes).not.toBeNull();
    expect(events.some((e) => e.type === 'character.died')).toBe(true);
  });

  it('体力归零=虚脱倒地不死亡(numerical §2.3): 存活置位,无死亡事件', () => {
    const { sim, events } = survivalSim();
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').energy = 0.05;
    sim.advanceTicks(6);
    const mow = sim.character('mow');
    expect(mow.alive).toBe(true); // 体力不再是死亡闸门
    expect(mow.collapsed).toBe(true);
    expect(mow.diedAtGameMinutes).toBeNull();
    expect(events.some((e) => e.type === 'character.died')).toBe(false);
  });

  it('虚脱中健康照跑饥饿线: 能量 0 持续扣健康,归零滑向重伤(重伤优先,清虚脱标)', () => {
    const { sim, events } = survivalSim();
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').energy = 0.05;
    sim.character('mow').health = 0.05; // 虚脱+健康临界: 当 tick 双双触底
    sim.advanceTicks(6);
    const mow = sim.character('mow');
    expect(mow.alive).toBe(false); // 重伤休整优先于虚脱
    expect(mow.collapsed).toBe(false);
    expect(events.some((e) => e.type === 'character.died')).toBe(true);
  });

  it('虚脱门禁矩阵: 移动/购买/闲聊拒绝,就地休息与喂食放行,进食爬起', () => {
    const { sim } = survivalSim();
    const bench = anchorUseKind('park', 'bench');
    sim.spawnCharacter('mow', bench.x, bench.y, '小满');
    sim.character('mow').energy = 0.05;
    sim.advanceTicks(6);
    expect(sim.character('mow').collapsed).toBe(true);
    expect(() => sim.requestMoveTo('mow', bench.x + 1, bench.y)).toThrow(/虚脱/);
    expect(() => sim.requestBuyItem('mow', 'bread')).toThrow(/虚脱/);
    expect(() => sim.requestStartActivity('mow', 'stroll')).toThrow(/虚脱/);
    // 放行: 就地长椅休息(基础档 +0.12/分,恢复即解除)
    sim.requestStartActivity('mow', 'rest');
    expect(sim.character('mow').activity).toMatchObject({ activityId: 'rest' });
    sim.requestStopActivity('mow');
    sim.character('mow').energy = 0;
    // 放行: 喂食(任意地点可吃),体力回升立即解除
    sim.character('mow').backpack = { apple: 1 };
    sim.requestEatItem('mow', 'apple');
    const mow = sim.character('mow');
    expect(mow.collapsed).toBe(false);
    expect(mow.energy).toBeCloseTo(4, 5); // 苹果 +4
    sim.requestMoveTo('mow', bench.x + 1, bench.y);
    expect(mow.path.length).toBeGreaterThan(0);
  });

  it('超时苏醒: 健康/体力回恢复线 30,得分保留不扣(growth 才 ×0.8,04 §2.5)', () => {
    const { sim, events } = survivalSim();
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').score = 500;
    sim.character('mow').health = 0.05;
    sim.character('mow').energy = 10;
    sim.advanceTicks(3);
    expect(sim.character('mow').alive).toBe(false);
    const scoreAtDeath = sim.character('mow').score;
    sim.character('mow').diedAtGameMinutes = sim.clock.gameMinutes - REVIVE_WINDOW_MINUTES;
    sim.advanceTicks(2);
    const mow = sim.character('mow');
    expect(mow.alive).toBe(true);
    expect(mow.health).toBe(30);
    expect(mow.energy).toBeCloseTo(30, 1); // 复苏后下一分钟待机衰减 0.02
    expect(mow.score).toBe(scoreAtDeath); // survival 超时苏醒不扣,得分单调
    expect(events.some((e) => e.type === 'character.auto_revived')).toBe(true);
  });

  it('医生救治: 窗口内救援重伤者满血复活(health=100,survival 仍有价值)', () => {
    const { sim, events } = survivalSim();
    sim.spawnCharacter('mort', 10, 12, '莫特');
    sim.spawnCharacter('doc', 8, 14, '杜克');
    sim.character('doc').knowledge = 9;
    sim.character('mort').health = 0.05; // 饥饿损耗归零入重伤(体力虚脱不经救治,喂食自愈)
    sim.character('mort').energy = 10;
    sim.advanceTicks(3);
    expect(sim.character('mort').alive).toBe(false);
    sim.requestWorkTask('doc', 'mort');
    sim.advanceTicks(90);
    const mort = sim.character('mort');
    expect(mort.alive).toBe(true);
    expect(mort.health).toBe(100);
    expect(mort.energy).toBeGreaterThan(95);
    expect(events.some((e) => e.type === 'character.revived')).toBe(true);
  });

  it('allowDeath=false: 健康卡 1 不入重伤(与关闭死亡语义一致)', () => {
    const { sim } = survivalSim();
    sim.setRules({ allowDeath: false });
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').health = 0.05;
    sim.character('mow').energy = 10;
    sim.advanceTicks(100);
    const mow = sim.character('mow');
    expect(mow.alive).toBe(true);
    expect(mow.health).toBeGreaterThan(0);
    expect(mow.health).toBeLessThanOrEqual(1);
  });

  it('快照透传 gameType 与 health(前端健康条按此分流)', () => {
    const { sim } = survivalSim();
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').health = 73.4;
    const snap = sim.snapshot();
    expect(snap.gameType).toBe('survival');
    expect(snap.characters[0]?.health).toBe(73.4);
    const growth = new Simulation();
    growth.spawnCharacter('mow', 8, 12, '小满');
    expect(growth.snapshot().gameType).toBe('growth');
  });
});
