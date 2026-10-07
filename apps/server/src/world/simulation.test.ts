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
      gameType: 'growth',
      clock: { gameMinutes: 540, day: 1, time: '09:00', isNight: false },
      characters: [],
      socials: [],
      maintenance: expect.any(Array), // 60 tick 恰逢杂物周期界,内容随默认 rng 不定
      resources: expect.any(Array), // M-G.6 资源节点从 TOWN_MAP 种子重建
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

  it('体力耗尽累倒送医(growth): 转幽灵态挂救治窗口,清路径,发出 character.died', () => {
    const { sim, events } = simWithMort();
    sim.character('mort').energy = 0.5;
    sim.requestMoveTo('mort', 12, 12); // 挂一条路径验证累倒清空
    sim.advanceTicks(30); // 0.5 - 30*0.02 < 0 → 途中累倒(待机代谢 0.02/分)
    const mort = sim.character('mort');
    expect(mort.alive).toBe(false);
    expect(mort.collapsed).toBe(false); // 送医走幽灵态,非原地虚脱
    expect(mort.path).toHaveLength(0);
    expect(mort.diedAtGameMinutes).not.toBeNull();
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

  it('待机代谢不产生得分(得分仅事件直加,04 §2.5)', () => {
    const sim = new Simulation();
    sim.spawnCharacter('mort', 8, 12, '莫特');
    sim.advanceTicks(10);
    expect(sim.character('mort').score).toBe(0);
    // 快照透传(取整)
    expect(sim.snapshot().characters[0]!.score).toBe(0);
  });

  it('死亡不即扣得分(M-G.5): 幽灵停计,救治免扣', () => {
    const sim = new Simulation();
    sim.spawnCharacter('mort', 8, 12, '莫特');
    sim.character('mort').score = 100;
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6); // 途中死亡
    const mort = sim.character('mort');
    expect(mort.alive).toBe(false);
    expect(mort.diedAtGameMinutes).not.toBeNull();
    expect(mort.score).toBeCloseTo(100, 5); // 挂起未扣
    sim.advanceTicks(10); // 幽灵期间无事件,得分单调不动
    expect(sim.character('mort').score).toBeCloseTo(100, 5);
    sim.debugRevive('mort'); // 救治视同免扣
    expect(sim.character('mort').score).toBeCloseTo(100, 5);
    expect(sim.character('mort').diedAtGameMinutes).toBeNull();
  });

  it('救治窗口超时: 得分 ×0.8 生效,自动复活发 auto_revived', () => {
    const { sim, events } = simWithMort();
    sim.character('mort').score = 100;
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6); // 死亡(扣减挂起)
    expect(sim.character('mort').score).toBeCloseTo(100, 5);
    // 锚定实际死亡时刻推到届满前 1 分钟,隔离复活后剩余 tick 的待机代谢
    const elapsed = sim.clock.gameMinutes - sim.character('mort').diedAtGameMinutes!;
    sim.advanceTicks(REVIVE_WINDOW_MINUTES - elapsed - 1);
    expect(sim.character('mort').alive).toBe(false); // 窗口内仍挂起
    sim.advanceTicks(1); // 届满:自动复活+扣分生效
    const mort = sim.character('mort');
    expect(mort.alive).toBe(true);
    expect(mort.energy).toBe(100);
    expect(mort.score).toBeCloseTo(80, 5); // ×(1-0.2) 生效
    expect(mort.diedAtGameMinutes).toBeNull();
    expect(events.some((e) => e.type === 'character.auto_revived')).toBe(true);
    expect(() => sim.debugRevive('mort')).toThrow(/尚存活/);
  });

  it('世界规则关闭死亡(M5): 体力归 0 原地虚脱,不转幽灵不扣得分', () => {
    const { sim, events } = simWithMort();
    sim.rules.allowDeath = false;
    sim.character('mort').score = 100;
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6); // 0.1 - 6*0.02 < 0,若未关规则此刻已送医
    const mort = sim.character('mort');
    expect(mort.alive).toBe(true); // 虚脱但存活
    expect(mort.collapsed).toBe(true); // 原地倒地,不挂救治窗口
    expect(mort.diedAtGameMinutes).toBeNull();
    expect(mort.score).toBeCloseTo(100, 5); // 未扣减
    expect(events.some((e) => e.type === 'character.died')).toBe(false);
  });

  it('虚脱门禁(numerical §2.3): 移动/接单/购房拒绝,体力回升即爬起', () => {
    const { sim } = simWithMort();
    sim.rules.allowDeath = false; // relaxed: 原地虚脱便于隔离验证
    sim.character('mort').energy = 0.1;
    sim.advanceTicks(6);
    expect(sim.character('mort').collapsed).toBe(true);
    expect(() => sim.requestMoveTo('mort', 9, 12)).toThrow(/虚脱/);
    expect(() => sim.requestBuyItem('mort', 'bread')).toThrow(/虚脱/);
    expect(() => sim.requestStartActivity('mort', 'stroll')).toThrow(/虚脱/);
    sim.maintenanceSpots.set('litter:10:14', {
      id: 'litter:10:14',
      kind: 'litter',
      x: 10,
      y: 14,
      variant: 0,
    });
    expect(() => sim.requestWorkTask('mort', 'litter:10:14')).toThrow(/虚脱/);
    // 喂食(numerical §2.3): 体力回升立即解除
    sim.character('mort').backpack = { apple: 1 };
    sim.requestEatItem('mort', 'apple'); // +4 体力
    const mort = sim.character('mort');
    expect(mort.collapsed).toBe(false);
    expect(mort.energy).toBeCloseTo(4, 5);
    sim.requestMoveTo('mort', 9, 12); // 爬起后可行动
    expect(mort.path.length).toBeGreaterThan(0);
  });
});
