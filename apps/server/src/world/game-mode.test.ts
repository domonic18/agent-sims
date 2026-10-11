import { GAME_TYPES, type GameType } from '@sims/shared';
import { describe, expect, it } from 'vitest';
import { getGameModeProfile, registerGameModeProfileForTests, type GameModeProfile } from './game-mode.js';
import { Simulation } from './simulation.js';
import { generateTownMap } from './worldgen/generate.js';

/**
 * 注册表契约(plan/02 R1):①完备性——每个 GameType 必有档案,未注册即抛;
 * ②演练——注册第三模式零主干改动:worldgen 出图 + sim 健康结算直接生效
 * (协议层 zod enum 天然拒绝新 gameType 入站,沙箱仅经 worldgen 直调可达)。
 */

describe('GameModeProfile 注册表', () => {
  it('每个 GameType 都有档案(完备性)', () => {
    for (const id of GAME_TYPES) {
      expect(getGameModeProfile(id).id).toBe(id);
    }
  });

  it('未注册模式查询即抛', () => {
    expect(() => getGameModeProfile('mmo' as GameType)).toThrow('未注册的游戏模式');
  });

  it('演练:注册第三模式,worldgen+sim 零主干改动生效', () => {
    const growth = getGameModeProfile('growth');
    const sandbox: GameModeProfile = {
      id: 'sandbox' as GameType,
      worldgen: { ...growth.worldgen, lampGap: [8, 12], flowerSkipChance: 0.2 },
      sim: { ...growth.sim, healthTick: true },
    };
    registerGameModeProfileForTests(sandbox);
    expect(getGameModeProfile('sandbox' as GameType).id).toBe('sandbox');

    // worldgen:沙箱模式直调生成器出图(绕过 zod 协议层)
    const result = generateTownMap({
      seed: 'r1-sandbox',
      gameType: 'sandbox' as GameType,
      params: { size: 'medium', density: 'normal' },
      manifestVersion: 'r1-drill',
    });
    expect(result.report.checks.fallback).toBe(false);
    expect(result.map.places.length).toBeGreaterThan(0);

    // sim:healthTick 开启即有压力源(growth 同种子基准恒满健康)
    const sim = new Simulation();
    sim.setGameMode('sandbox' as GameType);
    sim.spawnCharacter('mow', 8, 12, '小满');
    sim.character('mow').energy = 10; // < 饥饿线 20
    sim.advanceTicks(100);
    expect(sim.character('mow').health).toBeLessThan(100);
  });
});
