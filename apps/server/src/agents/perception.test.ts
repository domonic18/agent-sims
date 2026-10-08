import { describe, expect, it } from 'vitest';
import type { WorldCharacter } from '../world/character.js';
import { PERCEPTION_RADIUS, perceiveTasks } from './perception.js';

function char(id: string, x: number, y: number, name = id): { id: string; x: number; y: number; name: string } {
  return { id, x, y, name };
}

function charMap(...list: Array<{ id: string; x: number; y: number; name: string }>): Map<string, WorldCharacter> {
  return new Map(list.map((c) => [c.id, c as unknown as WorldCharacter]));
}

describe('perceiveTasks(旁观感知,空间过滤+主观模板)', () => {
  it('半径内才感知;当事人走主线不重复写;半径外不产生任务', () => {
    const characters = charMap(
      char('alice', 10, 10, '阿丽'),
      char('near', 14, 10, '近邻'), // 曼哈顿距离 4
      char('far', 10, 30, '远客'), // 距离 20
      char('beside', 11, 10, '贴身'), // 当事人同位置的非当事人,照常感知
    );
    const event = {
      type: 'activity.finished',
      characterId: 'alice',
      activityId: 'study',
      tick: 100,
      elapsedMinutes: 60,
      reason: 'completed',
    } as const;
    const tasks = perceiveTasks(event, characters, ['near', 'far', 'beside', 'alice']);
    expect(tasks.map((t) => t.characterId)).toEqual(['near', 'beside']);
    expect(tasks[0]!.content).toBe('我看到阿丽做完了一次学习');
  });

  it('social.chat:旁观者第三方转述,听者补"对我说"视角', () => {
    const characters = charMap(
      char('a', 0, 0, '阿发起'),
      char('b', 1, 0, '柏听者'),
      char('c', 2, 0, '池旁观'),
    );
    const event = {
      type: 'social.chat',
      fromId: 'a',
      toId: 'b',
      tick: 100,
      content: '今天天气不错',
      affinityDelta: 6,
    } as const;
    const tasks = perceiveTasks(event, characters, ['b', 'c']);
    expect(tasks.map((t) => [t.characterId, t.content])).toEqual([
      ['b', '我听到阿发起对我说:"今天天气不错"'],
      ['c', '我看到阿发起和柏听者在聊天'],
    ]);
  });

  it('感知半径=8:贴边 8 格在内,9 格在外', () => {
    const characters = charMap(char('a', 0, 0, '甲'), char('w8', 8, 0, '乙'), char('w9', 9, 0, '丙'));
    const event = {
      type: 'character.died',
      characterId: 'a',
      tick: 100,
      revivable: true,
    } as const;
    const tasks = perceiveTasks(event, characters, ['w8', 'w9']);
    expect(PERCEPTION_RADIUS).toBe(8);
    expect(tasks.map((t) => t.characterId)).toEqual(['w8']);
  });

  it('无当事位置/无关事件型/未知 watcher 均安静返回空', () => {
    const characters = charMap(char('w', 0, 0, '望'));
    expect(perceiveTasks({ type: 'world.reset', tick: 1 }, characters, ['w'])).toEqual([]);
    const died = {
      type: 'character.died',
      characterId: 'ghost',
      tick: 1,
      revivable: false,
    } as const;
    expect(perceiveTasks(died, characters, ['w'])).toEqual([]); // 当事人不在世界(已移除)
    expect(perceiveTasks(died, charMap(), ['ghost'])).toEqual([]);
  });
});
