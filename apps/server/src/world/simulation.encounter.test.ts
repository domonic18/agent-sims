import { describe, expect, it } from 'vitest';
import type { SocialEncounterEvent } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { Simulation } from './simulation.js';

/** 确定性 rng(损耗生成器 roll 稳定) */
const rng = (): number => 0.5;

/** 扫描内置地图:水平连续 ≥min 格可行走段(相向而行实验场),返回段起点 */
function straightRun(sim: Simulation, min = 7): { x: number; y: number } {
  for (let y = 0; y < sim.map.height; y += 1) {
    let run = 0;
    for (let x = 0; x < sim.map.width; x += 1) {
      run = sim.map.isWalkable(x, y) ? run + 1 : 0;
      if (run >= min) return { x: x - min + 1, y };
    }
  }
  throw new Error('地图上不存在足够长的水平可行走段');
}

function collectEncounters(sim: Simulation): SocialEncounterEvent[] {
  const seen: SocialEncounterEvent[] = [];
  sim.events.subscribe((event) => {
    if (event.type === 'social.encounter') seen.push(event);
  });
  return seen;
}

describe('路上相遇检测(E8 tick 级连续观测)', () => {
  it('相向而行进入贴身带触发恰好一次,载荷含双方与现场', () => {
    const sim = new Simulation(rng);
    const at = straightRun(sim);
    sim.spawnCharacter('aaaa1111', at.x, at.y, '甲');
    sim.spawnCharacter('bbbb2222', at.x + 6, at.y, '乙');
    const seen = collectEncounters(sim);
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.requestMoveTo('bbbb2222', at.x, at.y);
    sim.advanceTicks(1);
    // 每 tick 各走 2 格:6 格距离一 tick 后距离 2,恰入贴身带
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'social.encounter',
      aId: 'aaaa1111',
      bId: 'bbbb2222',
      tick: 1,
    });
    // 继续交错穿越不再重复发(同对边沿触发)
    sim.advanceTicks(3);
    expect(seen).toHaveLength(1);
  });

  it('同对冷却内(15 游戏分)不重复触发,冷却过期后可再发', () => {
    const sim = new Simulation(rng);
    const at = straightRun(sim);
    sim.spawnCharacter('aaaa1111', at.x, at.y, '甲');
    sim.spawnCharacter('bbbb2222', at.x + 6, at.y, '乙');
    const seen = collectEncounters(sim);
    // 第一轮相向
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.requestMoveTo('bbbb2222', at.x, at.y);
    sim.advanceTicks(1);
    expect(seen).toHaveLength(1);
    // 冷却内对穿再遇:不重复
    sim.requestMoveTo('aaaa1111', at.x, at.y);
    sim.requestMoveTo('bbbb2222', at.x + 6, at.y);
    sim.advanceTicks(1);
    expect(seen).toHaveLength(1);
    // 冷却过期后再相遇:重新触发
    sim.advanceTicks(BALANCE.ENCOUNTER_COOLDOWN_MINUTES);
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.requestMoveTo('bbbb2222', at.x, at.y);
    sim.advanceTicks(1);
    expect(seen).toHaveLength(2);
  });

  it('双方静止不触发(静止共处是生活常态);单方移动路过贴身带触发', () => {
    const sim = new Simulation(rng);
    const at = straightRun(sim);
    sim.spawnCharacter('aaaa1111', at.x, at.y, '甲');
    sim.spawnCharacter('bbbb2222', at.x + 2, at.y, '乙');
    const seen = collectEncounters(sim);
    sim.advanceTicks(5);
    expect(seen).toHaveLength(0);
    // 甲动身离开:至少一方在移动即相遇
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.advanceTicks(1);
    expect(seen).toHaveLength(1);
  });

  it('死亡角色不参与检测', () => {
    const sim = new Simulation(rng);
    const at = straightRun(sim);
    sim.spawnCharacter('aaaa1111', at.x, at.y, '甲');
    sim.spawnCharacter('bbbb2222', at.x + 6, at.y, '乙');
    const seen = collectEncounters(sim);
    sim.character('bbbb2222').alive = false;
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.advanceTicks(3);
    expect(seen).toHaveLength(0);
  });
});
