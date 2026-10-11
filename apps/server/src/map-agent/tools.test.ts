import { describe, expect, it } from 'vitest';
import { type TileMapDefinition } from '@sims/shared';
import { beginThreadDoc, endThreadDoc, getThreadDoc } from './doc-store.js';
import { autoEntranceFor, createMapTools, layoutWarnings } from './tools.js';

/** 基准图:一栋带家具的屋子 + 资源 + 装饰(全部通过 validateMapDefinition) */
function baseDoc(): TileMapDefinition {
  return {
    width: 48,
    height: 40,
    blockedRects: [],
    paths: [],
    places: [
      {
        id: 'house-1',
        name: '小屋',
        x: 4,
        y: 4,
        w: 9,
        h: 8,
        entrance: { x: 8, y: 12 },
        door: { x: 8, y: 11 },
        furniture: [{ kind: 'bed', x: 6, y: 6, w: 2, h: 2, activityId: 'sleep', use: { x: 6, y: 5 } }],
      },
    ],
    resources: [{ kind: 'berry_bush', x: 20, y: 20 }],
    decor: { trees: [[30, 30]], lamps: [], flowers: [], bushes: [] },
  };
}

const tools = createMapTools();
/** 各工具 invoke 联合签名互不兼容,测试只走最小调用面 */
const tool = (name: string): { invoke: (input: unknown, config?: unknown) => Promise<unknown> } => {
  const t = tools.find((x) => x.name === name);
  if (t === undefined) throw new Error(`工具不存在: ${name}`);
  return t as unknown as { invoke: (input: unknown, config?: unknown) => Promise<unknown> };
};

async function edit(threadId: string, input: Record<string, unknown>): Promise<{ ok: boolean; [k: string]: unknown }> {
  const raw = await tool('edit_map').invoke(input, { configurable: { thread_id: threadId } });
  return JSON.parse(String(raw));
}

describe('layoutWarnings', () => {
  it('入口间距 < 6 报 spacing;入口到最近资源 > 25 报 resource', () => {
    const doc = baseDoc();
    doc.places.push({ id: 'shed-1', name: '棚屋', x: 20, y: 4, w: 5, h: 4, entrance: { x: 11, y: 12 } });
    doc.resources = [{ kind: 'berry_bush', x: 40, y: 38 }];
    const warnings = layoutWarnings(doc);
    expect(warnings.some((w) => w.code === 'spacing')).toBe(true);
    expect(warnings.some((w) => w.code === 'resource' && w.message.includes('小屋'))).toBe(true);
  });

  it('布局合理时无警告', () => {
    const doc = baseDoc();
    doc.places[0]!.entrance = { x: 8, y: 12 };
    doc.resources = [{ kind: 'berry_bush', x: 10, y: 14 }];
    expect(layoutWarnings(doc)).toEqual([]);
  });
});

describe('autoEntranceFor', () => {
  it('底边中点门洞+外侧入口', () => {
    const doc = baseDoc();
    const auto = autoEntranceFor({ x: 4, y: 4, w: 9, h: 8 }, doc);
    expect(auto.entrance).toEqual({ x: 8, y: 12 });
    expect(auto.door).toEqual({ x: 8, y: 11 });
  });

  it('贴底边时回退顶边', () => {
    const doc = baseDoc();
    const auto = autoEntranceFor({ x: 4, y: 32, w: 9, h: 8 }, doc);
    expect(auto.entrance).toEqual({ x: 8, y: 31 });
    expect(auto.door).toEqual({ x: 8, y: 32 });
  });
});

describe('edit_map', () => {
  it('add place(带墙)自动补门洞入口,id 按 kind 递增', async () => {
    beginThreadDoc('t-add', { mapId: null, doc: baseDoc() });
    const res = await edit('t-add', { op: 'add', target: 'place', data: { kind: 'house', name: '新屋', x: 30, y: 6, w: 9, h: 8 } });
    expect(res.ok).toBe(true);
    const doc = getThreadDoc('t-add')!;
    expect(doc.places).toHaveLength(2);
    const added = doc.places[1]!;
    expect(added.id).toBe('house-2');
    expect(added.entrance).toEqual({ x: 34, y: 14 });
    expect(added.door).toEqual({ x: 34, y: 13 });
  });

  it('add place 缺坐标时居中兜底;无墙 kind 只补入口', async () => {
    beginThreadDoc('t-center', { mapId: null, doc: baseDoc() });
    const res = await edit('t-center', { op: 'add', target: 'place', data: { kind: 'park', name: '小公园', w: 6, h: 6 } });
    expect(res.ok).toBe(true);
    const doc = getThreadDoc('t-center')!;
    const park = doc.places[1]!;
    expect(park.id).toBe('park-1');
    expect(park.x).toBe(21);
    expect(park.y).toBe(17);
    expect(park.door).toBeUndefined();
    expect(park.entrance).toEqual({ x: 23, y: 23 });
  });

  it('update place 平移带动家具/门/入口', async () => {
    beginThreadDoc('t-move', { mapId: null, doc: baseDoc() });
    const res = await edit('t-move', { op: 'update', target: 'place', id: 'house-1', data: { x: 10, y: 8 } });
    expect(res.ok).toBe(true);
    const doc = getThreadDoc('t-move')!;
    const moved = doc.places[0]!;
    expect(moved.x).toBe(10);
    expect(moved.y).toBe(8);
    expect(moved.entrance).toEqual({ x: 14, y: 16 });
    expect(moved.door).toEqual({ x: 14, y: 15 });
    expect(moved.furniture![0]).toMatchObject({ x: 12, y: 10, use: { x: 12, y: 9 } });
  });

  it('decor add/update/remove 走可变副本', async () => {
    beginThreadDoc('t-decor', { mapId: null, doc: baseDoc() });
    expect((await edit('t-decor', { op: 'add', target: 'decor', group: 'flowers', data: { x: 12, y: 20 } })).ok).toBe(true);
    expect(getThreadDoc('t-decor')!.decor?.flowers).toEqual([[12, 20]]);

    expect((await edit('t-decor', { op: 'update', target: 'decor', group: 'trees', index: 0, data: { x: 31 } })).ok).toBe(true);
    expect(getThreadDoc('t-decor')!.decor?.trees).toEqual([[31, 30]]);

    expect((await edit('t-decor', { op: 'remove', target: 'decor', group: 'trees', index: 0 })).ok).toBe(true);
    expect(getThreadDoc('t-decor')!.decor?.trees).toEqual([]);
  });

  it('坏图回滚:压住既有室内连通的改动被拒绝且文档不变', async () => {
    const original = baseDoc();
    beginThreadDoc('t-rollback', { mapId: null, doc: structuredClone(original) });
    const res = await edit('t-rollback', { op: 'add', target: 'place', data: { kind: 'house', x: 4, y: 10, w: 10, h: 6 } });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('校验未通过');
    expect(getThreadDoc('t-rollback')).toEqual(original);
  });

  it('未知资源 kind 被拒;place id 不存在报中文错误', async () => {
    beginThreadDoc('t-errs', { mapId: null, doc: baseDoc() });
    const badKind = await edit('t-errs', { op: 'add', target: 'resource', data: { kind: 'gold', x: 5, y: 5 } });
    expect(badKind.ok).toBe(false);
    expect(badKind.error).toContain('未知资源');
    const badId = await edit('t-errs', { op: 'remove', target: 'place', id: 'nope-1' });
    expect(badId.ok).toBe(false);
    expect(badId.error).toContain('找不到场所');
  });
});

describe('write_map / validate_map', () => {
  it('结构不合法的 definition 被拒', async () => {
    beginThreadDoc('t-write', { mapId: null, doc: baseDoc() });
    const raw = await tool('write_map').invoke({ definition: { width: 40 } }, { configurable: { thread_id: 't-write' } });
    const res = JSON.parse(String(raw));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('结构不合法');
  });

  it('validate_map 汇报硬错误与布局警告', async () => {
    beginThreadDoc('t-validate', { mapId: null, doc: baseDoc() });
    const raw = await tool('validate_map').invoke({}, { configurable: { thread_id: 't-validate' } });
    const res = JSON.parse(String(raw));
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
    expect(Array.isArray(res.warnings)).toBe(true);
  });

  it('read_map 输出摘要而非完整 JSON', async () => {
    beginThreadDoc('t-read', { mapId: null, doc: baseDoc() });
    const raw = await tool('read_map').invoke({}, { configurable: { thread_id: 't-read' } });
    const res = JSON.parse(String(raw));
    expect(res.width).toBe(48);
    expect(res.counts.places).toBe(1);
    expect(res.counts.resources).toBe(1);
    expect(res.places[0]).toMatchObject({ id: 'house-1', furniture: 1 });
  });

  it('endThreadDoc 反映 mutated;无文档线程报错', async () => {
    beginThreadDoc('t-mutate', { mapId: '00000000-0000-0000-0000-000000000001', doc: baseDoc() });
    await edit('t-mutate', { op: 'add', target: 'resource', data: { kind: 'rock', x: 33, y: 22 } });
    const ended = endThreadDoc('t-mutate');
    expect(ended?.mutated).toBe(true);
    expect(ended?.mapId).toBe('00000000-0000-0000-0000-000000000001');
    await expect(edit('t-missing', { op: 'add', target: 'resource', data: { kind: 'rock', x: 1, y: 1 } })).rejects.toThrow('没有装载地图文档');
  });
});
