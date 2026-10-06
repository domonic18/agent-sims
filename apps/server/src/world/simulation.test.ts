import { describe, expect, it } from 'vitest';
import { REVIVE_WINDOW_MINUTES } from '@sims/shared';
import { Simulation } from './simulation.js';

describe('Simulation 模拟核心', () => {
  it('advanceTicks 每 tick 推进 1 游戏分钟', () => {
    const sim = new Simulation();
    sim.advanceTicks(90);
    expect(sim.tick).toBe(90);
    expect(sim.clock.formatTime()).toBe('09:30');
    sim.advanceTicks(30);
    expect(sim.tick).toBe(120);
    expect(sim.clock.formatTime()).toBe('10:00');
  });

  it('暂停/恢复只翻转标志,状态不丢', () => {
    const sim = new Simulation();
    sim.advanceTicks(10);
    sim.setPaused(true);
    expect(sim.snapshot().paused).toBe(true);
    sim.setPaused(false);
    expect(sim.snapshot().paused).toBe(false);
    expect(sim.tick).toBe(10);
  });

  it('setTimeScale 合法档位生效,非法档位抛错', () => {
    const sim = new Simulation();
    sim.setTimeScale(4);
    expect(sim.timeScale).toBe(4);
    sim.setTimeScale(16);
    expect(sim.timeScale).toBe(16);
    expect(() => sim.setTimeScale(5)).toThrow(RangeError);
    expect(() => sim.setTimeScale(0)).toThrow(RangeError);
    expect(sim.timeScale).toBe(16); // 抛错后保持原值
  });

  it('snapshot 输出完整对外形态', () => {
    const sim = new Simulation();
    sim.advanceTicks(60);
    sim.setTimeScale(4);
    expect(sim.snapshot()).toEqual({
      tick: 60,
      paused: false,
      timeScale: 4,
      clock: { gameMinutes: 540, day: 1, time: '09:00', isNight: false },
      characters: [],
      socials: [],
      maintenance: expect.any(Array), // 60 tick 恰逢杂物周期界,内容随默认 rng 不定
    });
  });
});

describe('世界重置(M3.6k 后台生命周期)', () => {
  it('reset 清空角色/时钟归零/倍率与暂停复位,并广播 world.reset', () => {
    const sim = new Simulation();
    const events: { type: string }[] = [];
    sim.events.subscribe((event) => events.push(event));
    sim.spawnCharacter('a', 8, 12);
    sim.advanceTicks(90);
    sim.setTimeScale(16);
    sim.setPaused(true);
    sim.rules.allowDeath = false;
    sim.reset();
    expect(sim.characters.size).toBe(0);
    expect(sim.tick).toBe(0);
    expect(sim.clock.formatTime()).toBe('08:00');
    expect(sim.timeScale).toBe(1);
    expect(sim.paused).toBe(false);
    expect(sim.rules).toEqual({ allowDeath: true, allowChat: true, initialTimeScale: 1 });
    expect(events.some((e) => e.type === 'world.reset')).toBe(true);
    // 重置后可正常重建世界
    sim.spawnCharacter('b', 9, 12);
    expect(sim.character('b').housing?.propertyId).toBeTruthy();
  });
});

describe('生死机制(M3.6f 体力区段)', () => {
  function simWithMort(): { sim: Simulation; events: { type: string; characterId?: string }[] } {
    const sim = new Simulation();
    const events: { type: string; characterId?: string }[] = [];
    sim.events.subscribe((event) => events.push(event));
    sim.spawnCharacter('mort', 8, 12, '莫特');
    return { sim, events };
  }

  it('体力耗尽死亡: 转幽灵态,清路径,发出 character.died', () => {
    const { sim, events } = simWithMort();
    sim.character('mort').energy = 0.5;
    sim.requestMoveTo('mort', 12, 12); // 挂一条路径验证死亡清空
    sim.advanceTicks(30); // 0.5 - 30*0.02 < 0 → 途中死亡(待机代谢 0.02/分)
    const mort = sim.character('mort');
    expect(mort.alive).toBe(false);
    expect(mort.path).toHaveLength(0);
    expect(events.some((e) => e.type === 'character.died' && e.characterId === 'mort')).toBe(true);
  });

  it('幽灵态拒绝一切意图,复活恢复满状态并发 character.revived', () => {
    const { sim, events } = simWithMort();
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6); // 0.1 - 6*0.02 < 0 → 死亡
    expect(sim.character('mort').alive).toBe(false);
    expect(() => sim.requestMoveTo('mort', 9, 12)).toThrow(/幽灵态/);
    expect(() => sim.requestStartActivity('mort', 'stroll')).toThrow(/幽灵态/);
    expect(() => sim.requestBuyItem('mort', 'bread')).toThrow(/幽灵态/);
    sim.advanceTicks(3);
    const revived = sim.debugRevive('mort');
    expect(revived.alive).toBe(true);
    expect(revived.energy).toBe(100);
    expect(revived.happiness).toBe(80);
    expect(events.some((e) => e.type === 'character.revived')).toBe(true);
    expect(() => sim.debugRevive('mort')).toThrow(/尚存活/);
    // 复活后可正常行动
    sim.requestMoveTo('mort', 9, 12);
    expect(sim.character('mort').path.length).toBeGreaterThan(0);
  });

  it('净速率模型(M3.6g): 活动期间只走活动速率,待机走基础代谢', () => {
    const sim = new Simulation();
    sim.spawnCharacter('ivy', 9, 25); // 公园入口
    sim.requestStartActivity('ivy', 'stroll'); // 散步 20 分,-0.04/分
    sim.advanceTicks(10);
    expect(sim.character('ivy').energy).toBeCloseTo(100 - 10 * 0.04, 5); // 无叠加待机衰减
    sim.advanceTicks(10); // 散步完成
    expect(sim.character('ivy').activity).toBeNull();
    const idleEnergy = sim.character('ivy').energy;
    sim.advanceTicks(5);
    expect(sim.character('ivy').energy).toBeCloseTo(idleEnergy - 5 * 0.02, 5); // 待机基础代谢
  });

  it('繁荣分(M3.6j): 逐分钟按当分钟幸福累计 ≈ 等效幸福天', () => {
    const sim = new Simulation();
    sim.spawnCharacter('mort', 8, 12, '莫特');
    // 先衰减再累计: 第 k 分钟幸福 = 100 - 0.015k(k=1..10),Σ/1440
    const expected =
      Array.from({ length: 10 }, (_, i) => 100 - 0.015 * (i + 1)).reduce((a, b) => a + b, 0) / 1440;
    sim.advanceTicks(10);
    expect(sim.character('mort').lifeScore).toBeCloseTo(expected, 6);
    // 快照透传(保留 1 位小数)
    expect(sim.snapshot().characters[0]!.lifeScore).toBeCloseTo(expected, 1);
  });

  it('死亡扣减挂起(M-G.5): 死亡不即扣,幽灵停计,救治免扣满状态回归', () => {
    const sim = new Simulation();
    sim.spawnCharacter('mort', 8, 12, '莫特');
    sim.character('mort').lifeScore = 100;
    sim.character('mort').happiness = 0; // 质量流归零,隔离扣减验证
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6); // 途中死亡
    const mort = sim.character('mort');
    expect(mort.alive).toBe(false);
    expect(mort.diedAtGameMinutes).not.toBeNull();
    expect(mort.lifeScore).toBeCloseTo(100, 5); // 挂起未扣
    sim.character('mort').happiness = 50;
    sim.advanceTicks(10); // 幽灵期间质量流停计(不停计会 +50*10/1440)
    expect(sim.character('mort').lifeScore).toBeCloseTo(100, 5);
    sim.debugRevive('mort'); // 救治视同免扣
    expect(sim.character('mort').lifeScore).toBeCloseTo(100, 5);
    expect(sim.character('mort').diedAtGameMinutes).toBeNull();
  });

  it('救治窗口超时: 挂起扣减按现值 ×0.8 生效,自动复活发 auto_revived', () => {
    const { sim, events } = simWithMort();
    sim.character('mort').lifeScore = 100;
    sim.character('mort').happiness = 0;
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6); // 死亡(扣减挂起)
    expect(sim.character('mort').lifeScore).toBeCloseTo(100, 5);
    // 锚定实际死亡时刻推到届满前 1 分钟,隔离复活后剩余 tick 的待机代谢
    const elapsed = sim.clock.gameMinutes - sim.character('mort').diedAtGameMinutes!;
    sim.advanceTicks(REVIVE_WINDOW_MINUTES - elapsed - 1);
    expect(sim.character('mort').alive).toBe(false); // 窗口内仍挂起
    sim.advanceTicks(1); // 届满:自动复活+扣减生效
    const mort = sim.character('mort');
    expect(mort.alive).toBe(true);
    expect(mort.energy).toBe(100);
    expect(mort.happiness).toBe(80);
    expect(mort.lifeScore).toBeCloseTo(80, 5); // 现值 ×0.8 生效
    expect(mort.diedAtGameMinutes).toBeNull();
    expect(events.some((e) => e.type === 'character.auto_revived')).toBe(true);
    expect(() => sim.debugRevive('mort')).toThrow(/尚存活/);
  });

  it('世界规则关闭死亡(M5): 体力归 0 躺平,不转幽灵不扣繁荣分', () => {
    const { sim, events } = simWithMort();
    sim.rules.allowDeath = false;
    sim.character('mort').lifeScore = 100;
    sim.character('mort').happiness = 0; // 隔离质量流,聚焦扣减
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6); // 0.1 - 6*0.02 < 0,若未关规则此刻已死亡
    const mort = sim.character('mort');
    expect(mort.alive).toBe(true); // 躺平但存活
    expect(mort.energy).toBeLessThanOrEqual(0); // 衰减夹取在 0
    expect(mort.lifeScore).toBeCloseTo(100, 5); // 未扣减
    expect(events.some((e) => e.type === 'character.died')).toBe(false);
  });
});
