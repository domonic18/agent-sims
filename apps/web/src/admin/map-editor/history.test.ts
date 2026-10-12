import { describe, expect, it } from 'vitest';
import type { TileMapDefinition } from '@sims/shared';
import {
  commit,
  createHistory,
  getAtPath,
  HISTORY_LIMIT,
  popRedo,
  popUndo,
  recordCommand,
  removeAtPath,
  setAtPath,
  type EditorCommand,
} from './history.js';

function baseDoc(): TileMapDefinition {
  return {
    width: 8,
    height: 6,
    blockedRects: [],
    paths: [],
    places: [{ id: 'home-1', name: '家', x: 1, y: 1, w: 3, h: 2, entrance: { x: 2, y: 4 } }],
  };
}

const updateWidth = (from: number, to: number): EditorCommand => ({
  kind: 'update',
  label: '改宽',
  path: ['width'],
  before: from,
  after: to,
});

describe('path 工具', () => {
  it('get/set 对称;set 不可变(原 doc 不动)', () => {
    const doc = baseDoc();
    expect(getAtPath(doc, ['places', 0, 'id'])).toBe('home-1');
    const next = setAtPath(doc, ['places', 0, 'x'], 5);
    expect(next.places[0]!.x).toBe(5);
    expect(doc.places[0]!.x).toBe(1);
    expect(getAtPath(next, ['places', 0, 'x'])).toBe(5);
  });

  it('remove:数组 splice 与对象键删除', () => {
    const doc = baseDoc();
    const noPlace = removeAtPath(doc, ['places', 0]);
    expect(noPlace.places).toHaveLength(0);
    const noKey = removeAtPath(doc, ['places', 0, 'name']);
    expect('name' in noKey.places[0]!).toBe(false);
    // 深层路径中途容器也不变异
    expect(doc.places[0]).toHaveProperty('name');
  });

  it('remove:嵌套数组段删除后仍是数组(场所内家具)', () => {
    const doc = baseDoc();
    const withFurn = setAtPath(doc, ['places', 0, 'furniture'], [
      { kind: 'bed', x: 1, y: 1, w: 1, h: 1 },
      { kind: 'bed', x: 2, y: 1, w: 1, h: 1 },
    ]);
    const removed = removeAtPath(withFurn, ['places', 0, 'furniture', 0]);
    expect(Array.isArray(removed.places[0]!.furniture)).toBe(true);
    expect(removed.places[0]!.furniture).toHaveLength(1);
    // undo 删除=setAtPath 回填,数组形态保持
    const restored = setAtPath(removed, ['places', 0, 'furniture', 0], withFurn.places[0]!.furniture![0]);
    expect(Array.isArray(restored.places[0]!.furniture)).toBe(true);
    expect(restored.places[0]!.furniture![0]).toEqual(withFurn.places[0]!.furniture![0]);
  });
});

describe('commit/record 双栈', () => {
  it('commit 应用 after 并入栈;undo 取 before;redo 取 after(全对称)', () => {
    const doc = baseDoc();
    const r1 = commit(doc, createHistory(), updateWidth(8, 10));
    expect(r1.doc.width).toBe(10);
    expect(r1.history.undo).toHaveLength(1);

    const u1 = popUndo(r1.doc, r1.history)!;
    expect(u1.doc.width).toBe(8);
    expect(u1.history.undo).toHaveLength(0);
    expect(u1.history.redo).toHaveLength(1);

    const r2 = popRedo(u1.doc, u1.history)!;
    expect(r2.doc.width).toBe(10);
    expect(r2.history.redo).toHaveLength(0);
    expect(r2.history.undo).toHaveLength(1);
  });

  it('add 命令 undo=移除,redo=回填;remove 命令对称互逆', () => {
    const doc = baseDoc();
    const extra = { id: 'shop-1', name: '商店', x: 5, y: 1, w: 2, h: 2, entrance: { x: 5, y: 4 } };
    const added = commit(doc, createHistory(), {
      kind: 'add',
      label: '加场所',
      path: ['places', 1],
      before: null,
      after: extra,
    });
    expect(added.doc.places).toHaveLength(2);

    const undone = popUndo(added.doc, added.history)!;
    expect(undone.doc.places).toHaveLength(1);

    const redone = popRedo(undone.doc, undone.history)!;
    expect(redone.doc.places).toEqual(added.doc.places);

    const removed = commit(redone.doc, redone.history, {
      kind: 'remove',
      label: '删场所',
      path: ['places', 1],
      before: extra,
      after: null,
    });
    expect(removed.doc.places).toHaveLength(1);
    const restored = popUndo(removed.doc, removed.history)!;
    expect(restored.doc.places).toEqual([doc.places[0], extra]);
  });

  it('新命令清空 redo 分支;record 只入栈不改 doc', () => {
    const doc = baseDoc();
    const r1 = commit(doc, createHistory(), updateWidth(8, 10));
    const u1 = popUndo(r1.doc, r1.history)!;
    expect(u1.history.redo).toHaveLength(1);
    const r2 = commit(u1.doc, u1.history, updateWidth(8, 12));
    expect(r2.history.redo).toHaveLength(0);

    const rec = recordCommand(r2.history, updateWidth(12, 14));
    expect(rec.undo).toHaveLength(2);
    expect(r2.doc.width).toBe(12);
  });

  it('超过 HISTORY_LIMIT 丢最旧', () => {
    let doc = baseDoc();
    let history = createHistory();
    for (let w = 9; w < 9 + HISTORY_LIMIT + 5; w += 1) {
      const next = commit(doc, history, updateWidth(w - 1, w));
      doc = next.doc;
      history = next.history;
    }
    expect(history.undo).toHaveLength(HISTORY_LIMIT);
    // 205 条命令(8→213)截断后最旧一条是 13→14
    expect(history.undo[0]!.before).toBe(13);
    // 逐级 undo 只能退到被截断栈的最早状态(13),width=8 已随最旧命令丢弃
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      const u = popUndo(doc, history)!;
      doc = u.doc;
      history = u.history;
    }
    expect(doc.width).toBe(13);
    expect(popUndo(doc, history)).toBeNull();
  });

  it('空栈 undo/redo 返回 null', () => {
    const doc = baseDoc();
    expect(popUndo(doc, createHistory())).toBeNull();
    expect(popRedo(doc, createHistory())).toBeNull();
  });
});
