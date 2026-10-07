import { describe, expect, it } from 'vitest';
import type { MaintenanceSpot } from '@sims/shared';
import { applyWorldParams, currentWorldParams } from '../src/config/balance.js';
import { GameClock } from '../src/world/clock.js';
import type { SocialRelation } from '../src/world/social.js';
import { Simulation } from '../src/world/simulation.js';

/** 确定性 rng(损耗生成器 roll 稳定) */
const rng = (): number => 0.5;

/** 扫描内置地图:一对左右相邻的可行走格(出生+移动目标) */
function adjacentWalkable(sim: Simulation): [{ x: number; y: number }, { x: number; y: number }] {
  for (let y = 0; y < sim.map.height; y += 1) {
    for (let x = 0; x < sim.map.width - 1; x += 1) {
      if (sim.map.isWalkable(x, y) && sim.map.isWalkable(x + 1, y)) {
        return [
          { x, y },
          { x: x + 1, y },
        ];
      }
    }
  }
  throw new Error('地图上不存在相邻可行走格');
}

describe('世界存档 serialize/restoreArchive roundtrip(C6)', () => {
  it('序列化→JSON 往返→恢复,关键状态块逐块一致', () => {
    const sim = new Simulation(rng);
    const [a, b] = adjacentWalkable(sim);
    sim.spawnCharacter('aaaa1111', a.x, a.y, '甲', { sociability: 0.8 });
    sim.spawnCharacter('bbbb2222', b.x, b.y, '乙');
    // 制造现场:移动路径+数值变更+跨块状态
    sim.requestMoveTo('aaaa1111', b.x, b.y);
    sim.advanceTicks(37);
    const jia = sim.character('aaaa1111');
    jia.coins = 42;
    jia.backpack['bread'] = 2;
    jia.score = 7;
    const social: SocialRelation = {
      fromId: 'aaaa1111',
      toId: 'bbbb2222',
      familiarity: 3,
      affinity: 0.6,
      chatDay: 1,
      chatCount: 1,
      formedNotified: false,
    };
    sim.socials.set('aaaa1111|bbbb2222', social);
    const [nodeId, node] = [...sim.resourceNodes.entries()][0]!;
    node.charges = 1;
    const litter: MaintenanceSpot = { id: 'litter:2:2', kind: 'litter', x: 2, y: 2, variant: 1 };
    sim.maintenanceSpots.set(litter.id, litter);
    sim.shopStock.set('bread', 3);
    sim.setPaused(true);
    sim.setTimeScale(4);
    sim.rules = { ...sim.rules, allowDeath: false, allowChat: false };

    const archive = JSON.parse(JSON.stringify(sim.serialize()));

    // 恢复到全新实例(同内置地图;模拟 load 流程 reset+灌档)
    const restored = new Simulation(rng);
    restored.reset();
    restored.restoreArchive(archive);

    expect(restored.tick).toBe(sim.tick);
    expect(restored.clock.gameMinutes).toBe(sim.clock.gameMinutes);
    expect(restored.paused).toBe(true);
    expect(restored.timeScale).toBe(4);
    expect(restored.gameType).toBe('growth');
    expect(restored.rules.allowDeath).toBe(false);
    expect(restored.rules.allowChat).toBe(false);
    expect(restored.recipes).toEqual(sim.recipes);
    expect(restored.characters.size).toBe(2);
    expect(restored.character('aaaa1111')).toEqual(sim.character('aaaa1111'));
    expect(restored.character('bbbb2222')).toEqual(sim.character('bbbb2222'));
    expect(restored.socials.get('aaaa1111|bbbb2222')).toEqual(social);
    expect(restored.resourceNodes.get(nodeId)).toEqual(node);
    expect(restored.maintenanceSpots.get(litter.id)).toEqual(litter);
    expect([...restored.shopStock.entries()]).toEqual([...sim.shopStock.entries()]);
    // 恢复后继续 tick 不炸(路径/活动快照自洽)
    expect(() => restored.advanceTicks(3)).not.toThrow();
  });

  it('参数现场入档:热调后存档,恢复到新实例时 BALANCE 整体灌回', () => {
    const sim = new Simulation(rng);
    const [a] = adjacentWalkable(sim);
    sim.spawnCharacter('cccc3333', a.x, a.y, '丙');
    sim.setParams({ SHOP_INITIAL_FOOD_STOCK: 77 });
    const archive = JSON.parse(JSON.stringify(sim.serialize()));
    expect(archive.params.SHOP_INITIAL_FOOD_STOCK).toBe(77);

    // 新实例复位出厂(模拟进程重启后的干净态;BALANCE 是进程单例须显式复位),
    // load 灌回存档参数
    const restored = new Simulation(rng);
    restored.reset();
    applyWorldParams();
    expect(currentWorldParams().SHOP_INITIAL_FOOD_STOCK).not.toBe(77);
    restored.restoreArchive(archive);
    expect(currentWorldParams().SHOP_INITIAL_FOOD_STOCK).toBe(77);
  });

  it('时钟恢复:restore 后 day/minuteOfDay/isNight 与存档时刻一致', () => {
    const clock = new GameClock(0);
    clock.advance(3 * 1440 + 13 * 60 + 25);
    const restored = new GameClock(0);
    restored.restore(clock.gameMinutes);
    expect(restored.gameMinutes).toBe(clock.gameMinutes);
    expect(restored.day).toBe(clock.day);
    expect(restored.formatTime()).toBe('13:25');
  });
});
