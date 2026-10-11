import { describe, expect, it } from 'vitest';
import type { TileMapDefinition, WorldgenParams } from '@sims/shared';
import { generateTownMap, type WorldgenInput } from './generate.js';

/**
 * 特征化快照(plan/02 R0):growth/survival 各 10 个固定种子,对完整
 * TileMapDefinition 做键排序规范化+FNV-1a 哈希断言——GameModeProfile/管线化
 * 重构(R1/R2)的防回归保险:同种子地图逐字节一致(rng 消耗流零变化)。
 * 哈希若变:rng 流或构造顺序变了,必须是有意行为变更并同步更新此表。
 */

const PARAMS: WorldgenParams = { size: 'medium', density: 'normal' };

/** 2026-10-12 重构前基线(plan/02 R1 落地前固化);summary 仅供失败时定位 */
const EXPECTED: Record<string, { hash: string; summary: string }> = {
  'growth/r0-01': { hash: 'c3b74974', summary: '80x60/13p/16r' },
  'growth/r0-02': { hash: '6c6a59e1', summary: '80x60/15p/15r' },
  'growth/r0-03': { hash: 'bf644baf', summary: '80x60/15p/14r' },
  'growth/r0-04': { hash: '2bf4d45e', summary: '80x60/15p/16r' },
  'growth/r0-05': { hash: '2aa9a714', summary: '80x60/12p/13r' },
  'growth/r0-06': { hash: 'fa17a51b', summary: '80x60/13p/14r' },
  'growth/r0-07': { hash: '32c1f3c9', summary: '80x60/13p/15r' },
  'growth/r0-08': { hash: 'ee7313cb', summary: '80x60/12p/18r' },
  'growth/r0-09': { hash: 'bb536e42', summary: '80x60/16p/14r' },
  'growth/r0-10': { hash: '37ce1a73', summary: '80x60/16p/13r' },
  'survival/r0-01': { hash: '5bbe05c8', summary: '80x60/10p/43r' },
  'survival/r0-02': { hash: '1790e454', summary: '80x60/9p/41r' },
  'survival/r0-03': { hash: '63000308', summary: '80x60/9p/42r' },
  'survival/r0-04': { hash: '2f68ea00', summary: '80x60/9p/37r' },
  'survival/r0-05': { hash: '196cb54c', summary: '80x60/9p/41r' },
  'survival/r0-06': { hash: '0e78012b', summary: '80x60/10p/43r' },
  'survival/r0-07': { hash: 'c684c397', summary: '80x60/9p/38r' },
  'survival/r0-08': { hash: 'bdf58ed3', summary: '80x60/9p/51r' },
  'survival/r0-09': { hash: 'c80479f5', summary: '80x60/9p/44r' },
  'survival/r0-10': { hash: 'dc01052f', summary: '80x60/10p/35r' },
};

/** 规范化序列化:对象键递归排序(重构改构造顺序不致误报) */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** FNV-1a 32 位 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function snapshot(gameType: WorldgenInput['gameType'], seed: string): { hash: string; summary: string } {
  const result = generateTownMap({ seed, gameType, params: PARAMS, manifestVersion: 'r0-snapshot' });
  // 兜底回退会让快照"保护"一张内置图——显式失败防止假绿
  expect(result.report.checks.fallback, `${gameType}/${seed} 兜底回退`).toBe(false);
  const map: TileMapDefinition = result.map;
  return {
    hash: fnv1a(canonical(map)),
    summary: `${map.width}x${map.height}/${map.places.length}p/${map.resources?.length ?? 0}r`,
  };
}

describe('worldgen 特征化快照(plan/02 R0)', () => {
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const [gameType, seed] = key.split('/') as ['growth' | 'survival', string];
    it(`${key} 同种子逐字节一致(${expected.summary})`, () => {
      expect(snapshot(gameType, seed)).toEqual(expected);
    });
  }
});
