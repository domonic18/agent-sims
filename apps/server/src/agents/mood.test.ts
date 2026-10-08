import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { aggregateMood, describeMood, moodDeltasFor } from './mood.js';

const nameOf = (id: string): string => (id === 'b' ? '苏晚' : '阿泽');

function row(delta: number, gameMinutes: number | null, labels: string[] = ['标签']) {
  return { delta, labels, gameMinutes };
}

describe('moodDeltasFor(事件→情绪冲量规则表)', () => {
  it('负向事件: 倒下/缺觉/被打断/囊中羞涩', () => {
    const died: WorldEvent = { type: 'character.died', characterId: 'a', tick: 1, revivable: true };
    expect(moodDeltasFor(died, nameOf)).toEqual([
      { characterId: 'a', delta: -0.6, labels: ['倒下了'] },
    ]);
    const debt: WorldEvent = { type: 'sleep.debt_applied', characterId: 'a', sleptMinutes: 100, tick: 1 };
    expect(moodDeltasFor(debt, nameOf)[0]?.delta).toBe(-0.3);
    const interrupted: WorldEvent = {
      type: 'activity.finished', characterId: 'a', activityId: 'work', tick: 1,
      elapsedMinutes: 10, reason: 'interrupted',
    };
    expect(moodDeltasFor(interrupted, nameOf)[0]?.labels).toEqual(['被打断']);
    const broke: WorldEvent = {
      type: 'activity.finished', characterId: 'a', activityId: 'meal', tick: 1,
      elapsedMinutes: 10, reason: 'insufficient_coins',
    };
    expect(moodDeltasFor(broke, nameOf)[0]?.labels).toEqual(['囊中羞涩']);
  });

  it('正向事件: 获救/做出成品/完成工作,结交双方各得冲量', () => {
    const revived: WorldEvent = { type: 'character.revived', characterId: 'a', tick: 1 };
    expect(moodDeltasFor(revived, nameOf)[0]?.delta).toBe(0.4);
    const craft: WorldEvent = { type: 'craft.completed', characterId: 'a', recipeId: 'chair', tick: 1 };
    expect(moodDeltasFor(craft, nameOf)[0]?.labels).toEqual(['做出成品']);
    const friend: WorldEvent = { type: 'friendship.formed', aId: 'a', bId: 'b', tick: 1, title: '挚友' };
    expect(moodDeltasFor(friend, nameOf)).toEqual([
      { characterId: 'a', delta: 0.5, labels: ['和苏晚结交了'] },
      { characterId: 'b', delta: 0.5, labels: ['和阿泽结交了'] },
    ]);
  });

  it('白名单外事件与平静收尾零冲量', () => {
    const control: WorldEvent = { type: 'world.control', tick: 1, paused: false, timeScale: 1 };
    expect(moodDeltasFor(control, nameOf)).toEqual([]);
    const completed: WorldEvent = {
      type: 'activity.finished', characterId: 'a', activityId: 'work', tick: 1,
      elapsedMinutes: 60, reason: 'completed',
    };
    expect(moodDeltasFor(completed, nameOf)).toEqual([]);
  });
});

describe('aggregateMood(冲量流水→当前情绪)', () => {
  it('新鲜冲量求和并钳到 [-1,1]', () => {
    const state = aggregateMood([row(0.5, 100), row(0.6, 101)], 110);
    expect(state.valence).toBe(1); // 1.1 钳顶
    expect(state.since).toBe(100);
    const negative = aggregateMood([row(-0.6, 100), row(-0.5, 101)], 110);
    expect(negative.valence).toBe(-1);
  });

  it('半衰期衰减: 一个半衰期后冲量减半,四个半衰期外标签出局', () => {
    const half = aggregateMood([row(0.4, 0)], 240);
    expect(half.valence).toBeCloseTo(0.2, 5);
    expect(half.labels).toEqual(['标签']);
    // 0.2 冲量经 960 分钟(4 个半衰期)衰减到 0.0125 < 0.02,连同标签一起出局
    const gone = aggregateMood([row(0.2, 0)], 960);
    expect(gone.valence).toBe(0);
    expect(gone.labels).toEqual([]);
    expect(gone.since).toBeNull();
  });

  it('标签按新→旧去重截 4 条;乱序输入按游戏分钟重排', () => {
    const rows = [
      row(0.3, 500, ['乙']),
      row(0.3, 100, ['甲']),
      row(0.3, 400, ['乙']),
      row(0.3, 300, ['丙']),
      row(0.3, 200, ['丁']),
      row(0.3, 150, ['戊']),
    ];
    const state = aggregateMood(rows, 510);
    expect(state.labels).toEqual(['乙', '丙', '丁', '戊']);
    expect(state.since).toBe(100);
  });

  it('gameMinutes 为空的行按"现在"计(不衰减)', () => {
    const state = aggregateMood([row(0.4, null)], 99999);
    expect(state.valence).toBeCloseTo(0.4, 5);
  });
});

describe('describeMood(当前情绪→人读措辞)', () => {
  it('平静且无标签返回 null(访谈不注入)', () => {
    expect(describeMood({ valence: 0.05, labels: [], since: null })).toBeNull();
  });

  it('阈值分档与标签拼接', () => {
    expect(describeMood({ valence: -0.5, labels: ['倒下了'], since: 1 })).toBe('很沮丧(倒下了)');
    expect(describeMood({ valence: -0.2, labels: [], since: null })).toBe('有点低落');
    expect(describeMood({ valence: 0.3, labels: ['做出成品'], since: 1 })).toBe('心情不错(做出成品)');
    expect(describeMood({ valence: 0.6, labels: [], since: null })).toBe('很高兴');
    expect(describeMood({ valence: 0, labels: ['被打断'], since: 1 })).toBe('心情平静(被打断)');
  });
});
