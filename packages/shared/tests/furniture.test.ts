import { describe, expect, it } from 'vitest';
import { TOWN_MAP, findActivityAnchorAt, furnitureServesActivity } from '../src';

describe('furnitureServesActivity(M-G.2 锚点绑定泛化)', () => {
  it('声明绑定直接命中(rest 绑床仍服务 rest)', () => {
    expect(furnitureServesActivity('rest', 'bed', 'rest')).toBe(true);
    expect(furnitureServesActivity('workout', 'treadmill', 'workout')).toBe(true);
  });

  it('sleep 复用绑 rest 的床/长椅(SLEEP_ANCHOR_KINDS 兜底,2026-10-15 死亡悠悠球),不命中沙发', () => {
    expect(furnitureServesActivity('rest', 'bed', 'sleep')).toBe(true);
    expect(furnitureServesActivity('rest', 'bench', 'sleep')).toBe(true);
    expect(furnitureServesActivity('rest', 'sofa', 'sleep')).toBe(false);
  });

  it('rest 不因 sleep 扩展误命中其他绑定,sleep 不命中非 rest 绑定', () => {
    expect(furnitureServesActivity('study', 'desk', 'sleep')).toBe(false);
    expect(furnitureServesActivity('workout', 'treadmill', 'rest')).toBe(false);
  });
});

describe('TOWN_MAP sleep 锚点(床+长椅兜底,沙发除外)', () => {
  it('床格/长椅格命中 sleep 锚点,沙发格不命中', () => {
    const homeA = TOWN_MAP.places.find((p) => p.id === 'home-a')!;
    const bed = homeA.furniture!.find((f) => f.kind === 'bed')!;
    expect(bed.use).toBeDefined();
    const hit = findActivityAnchorAt(TOWN_MAP, 'sleep', bed.use!.x, bed.use!.y);
    expect(hit).toMatchObject({ placeId: 'home-a', kind: 'bed' });
    expect(hit).not.toBeNull();
    // rest 命中不受泛化影响(床双服务)
    expect(findActivityAnchorAt(TOWN_MAP, 'rest', bed.use!.x, bed.use!.y)).toMatchObject({
      kind: 'bed',
    });
    const park = TOWN_MAP.places.find((p) => p.id === 'park')!;
    const bench = park.furniture!.find((f) => f.kind === 'bench')!;
    expect(bench.use).toBeDefined();
    expect(findActivityAnchorAt(TOWN_MAP, 'sleep', bench.use!.x, bench.use!.y)).toMatchObject({
      placeId: 'park',
      kind: 'bench',
    });
  });
});
