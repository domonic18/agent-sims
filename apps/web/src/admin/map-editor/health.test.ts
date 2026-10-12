import { describe, expect, it } from 'vitest';
import type { TileMapDefinition } from '@sims/shared';
import { checkLayout, issueOverlays, type HealthFinding } from './health.js';

/** 合法基准图:一住宅(带门)一咖啡馆(带门),两入口相距 5 格 */
function baseDoc(): TileMapDefinition {
  return {
    width: 24,
    height: 18,
    blockedRects: [],
    paths: [],
    places: [
      {
        id: 'home-1',
        name: '家',
        x: 3,
        y: 2,
        w: 5,
        h: 4,
        entrance: { x: 5, y: 6 },
        door: { x: 5, y: 5 },
        furniture: [{ kind: 'bed', x: 4, y: 3, w: 1, h: 1, activityId: 'rest', use: { x: 4, y: 4 } }],
      },
      {
        id: 'cafe-1',
        name: '咖啡馆',
        x: 8,
        y: 2,
        w: 4,
        h: 3,
        entrance: { x: 9, y: 5 },
        door: { x: 9, y: 4 },
      },
    ],
  };
}

const findingsOf = (code: string, doc: TileMapDefinition) =>
  checkLayout(doc).findings.filter((f) => f.code === code);

describe('布局体检', () => {
  it('基准图零硬错误(ok=true);配额警告:缺商店+无 townCore', () => {
    const result = checkLayout(baseDoc());
    expect(result.ok).toBe(true);
    expect(result.structure).toHaveLength(0);
    const quota = findingsOf('quota', baseDoc());
    expect(quota.some((f) => f.message.includes('商店'))).toBe(true);
    expect(quota.some((f) => f.message.includes('townCore'))).toBe(true);
  });

  it('结构错误:入口压在占地内 → structure 硬错误且 ok=false', () => {
    const doc = baseDoc();
    doc.places[0]!.entrance = { x: 4, y: 3 };
    const result = checkLayout(doc);
    expect(result.ok).toBe(false);
    expect(result.structure.length).toBeGreaterThan(0);
    expect(findingsOf('structure', doc).length).toBeGreaterThan(0);
  });

  it('连通性:入口被围栏圈死 → connectivity 硬错误', () => {
    const doc = baseDoc();
    doc.fences = [
      { x: 7, y: 0, w: 10, h: 1 },
      { x: 7, y: 7, w: 10, h: 1 },
      { x: 7, y: 0, w: 1, h: 8 },
      { x: 16, y: 0, w: 1, h: 8 },
    ];
    const conn = findingsOf('connectivity', doc);
    expect(conn).toHaveLength(1);
    expect(conn[0]!.placeIds).toEqual(['cafe-1']);
    expect(checkLayout(doc).ok).toBe(false);
  });

  it('间距:入口曼哈顿<6 → spacing 警告;≤8 对数进密度统计', () => {
    const doc = baseDoc(); // (5,6)-(9,5) = 5 格
    const result = checkLayout(doc);
    const spacing = result.findings.filter((f) => f.code === 'spacing');
    expect(spacing).toHaveLength(1);
    expect(spacing[0]!.placeIds).toEqual(['home-1', 'cafe-1']);
    expect(result.density.closePairs).toBe(1);
    expect(result.density.minPairDistance).toBe(5);
    expect(result.density.tier).toBe('sparse');
  });

  it('密度:近邻对≥8 → dense 档警告', () => {
    // 3×3 网格 9 馆:横向入口距 6、纵向距 4,近邻对=6+6=12
    const doc: TileMapDefinition = {
      width: 40,
      height: 30,
      blockedRects: [],
      paths: [],
      places: Array.from({ length: 9 }, (_, i) => ({
        id: `cafe-${i + 1}`,
        name: `馆${i + 1}`,
        x: 2 + (i % 3) * 6,
        y: 2 + Math.floor(i / 3) * 4,
        w: 3,
        h: 2,
        entrance: { x: 3 + (i % 3) * 6, y: 4 + Math.floor(i / 3) * 4 },
      })),
    };
    const result = checkLayout(doc);
    expect(result.density.closePairs).toBeGreaterThanOrEqual(8);
    expect(result.density.tier).toBe('dense');
    expect(findingsOf('density', doc)).toHaveLength(1);
  });

  it('资源覆盖:入口到最近资源>25 → resource 警告', () => {
    const doc = baseDoc();
    doc.resources = [{ kind: 'berry_bush', x: 23, y: 16 }];
    const res = findingsOf('resource', doc);
    expect(res).toHaveLength(1);
    expect(res[0]!.placeIds).toEqual(['home-1']); // (5,6)→(23,16)=28;(9,5)→(23,16)=25
  });

  it('issueOverlays:cell 单格/家具占地/场所矩形/资源格各归位,同格同级去重', () => {
    const doc = baseDoc();
    doc.resources = [{ kind: 'rock', x: 20, y: 15 }];
    const findings: HealthFinding[] = [
      { level: 'error', code: 'structure', message: '入口', placeIds: ['home-1'], cell: { x: 5, y: 6 } },
      { level: 'error', code: 'structure', message: '家具', placeIds: ['home-1'], furnitureIndex: 0 },
      { level: 'warning', code: 'spacing', message: '间距', placeIds: ['cafe-1'] },
      { level: 'error', code: 'structure', message: '资源', resourceIndex: 0 },
      // 与第一条同格同级 → 去重;同格异级 → 保留
      { level: 'error', code: 'structure', message: '入口重复', placeIds: ['home-1'], cell: { x: 5, y: 6 } },
      { level: 'warning', code: 'structure', message: '入口异级', placeIds: ['home-1'], cell: { x: 5, y: 6 } },
    ];
    const overlays = issueOverlays(doc, findings);
    expect(overlays).toContainEqual({ x: 5, y: 6, w: 1, h: 1, level: 'error' });
    expect(overlays).toContainEqual({ x: 5, y: 6, w: 1, h: 1, level: 'warning' });
    expect(overlays).toContainEqual({ x: 4, y: 3, w: 1, h: 1, level: 'error' }); // 家具占地
    expect(overlays).toContainEqual({ x: 8, y: 2, w: 4, h: 3, level: 'warning' }); // cafe-1 场所矩形
    expect(overlays).toContainEqual({ x: 20, y: 15, w: 1, h: 1, level: 'error' }); // 资源格
    expect(overlays.filter((o) => o.x === 5 && o.y === 6)).toHaveLength(2);
  });

  it('issueOverlays:越界格与未知 placeId 丢弃', () => {
    const doc = baseDoc();
    const findings: HealthFinding[] = [
      { level: 'error', code: 'structure', message: '越界', cell: { x: -1, y: 0 } },
      { level: 'error', code: 'structure', message: '未知场所', placeIds: ['ghost'] },
    ];
    expect(issueOverlays(doc, findings)).toHaveLength(0);
  });
});
