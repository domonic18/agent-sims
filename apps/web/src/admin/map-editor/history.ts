/**
 * 编辑器历史(批B):通用 patch command {kind,path,before,after}+双栈。
 * 非快照 diff——语义化 kind/label 可作操作日志供批C agent 叙述;
 * path 为结构化段(对象键+数组下标),undo/redo 对称互逆。
 */
import type { TileMapDefinition } from '@sims/shared';

export type PathSegment = string | number;
export type Path = PathSegment[];

/** 编辑命令:kind=语义标签(add/update/remove/move/resize),label=中文操作叙述 */
export interface EditorCommand {
  kind: 'add' | 'update' | 'remove' | 'move' | 'resize';
  label: string;
  path: Path;
  before: unknown;
  after: unknown;
  /** 连续编辑合并键(属性面板逐键输入合并为一条命令;缺省不合并) */
  coalesce?: string;
}

export function getAtPath(doc: unknown, path: Path): unknown {
  let cur: unknown = doc;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<PathSegment, unknown>)[seg];
  }
  return cur;
}

/** 结构化替换(不可变拷贝路径上的容器),返回新 doc */
export function setAtPath<T>(doc: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const head = path[0]!;
  const rest = path.slice(1);
  if (Array.isArray(doc)) {
    const next = doc.slice();
    next[head as number] = setAtPath(doc[head as number], rest, value);
    return next as T;
  }
  const record = doc as Record<PathSegment, unknown>;
  return { ...record, [head]: setAtPath(record[head], rest, value) } as T;
}

/** 删除数组元素/对象键(与 setAtPath 对称) */
export function removeAtPath<T>(doc: T, path: Path): T {
  if (path.length === 0) return doc;
  const head = path[0]!;
  const rest = path.slice(1);
  if (rest.length === 0) {
    if (Array.isArray(doc)) {
      const next = doc.slice();
      next.splice(head as number, 1);
      return next as T;
    }
    const record = { ...(doc as Record<PathSegment, unknown>) };
    delete record[head];
    return record as T;
  }
  const record = doc as Record<PathSegment, unknown>;
  return { ...record, [head]: removeAtPath(record[head], rest) } as T;
}

export const HISTORY_LIMIT = 200;

export interface History {
  undo: EditorCommand[];
  redo: EditorCommand[];
}

export function createHistory(): History {
  return { undo: [], redo: [] };
}

/** 入栈并执行(after 落到 doc):返回新 doc+新历史(redo 清空);超过上限丢最旧 */
export function commit(
  doc: TileMapDefinition,
  history: History,
  command: EditorCommand,
): { doc: TileMapDefinition; history: History } {
  const undo = [...history.undo, command];
  if (undo.length > HISTORY_LIMIT) undo.splice(0, undo.length - HISTORY_LIMIT);
  return {
    doc: command.kind === 'remove' ? removeAtPath(doc, command.path) : setAtPath(doc, command.path, command.after),
    history: { undo, redo: [] },
  };
}

/** 仅入栈不应用(拖拽松手:doc 已就地更新);超过上限丢最旧 */
export function recordCommand(history: History, command: EditorCommand): History {
  const undo = [...history.undo, command];
  if (undo.length > HISTORY_LIMIT) undo.splice(0, undo.length - HISTORY_LIMIT);
  return { undo, redo: [] };
}

/** undo:返回 [新doc, 命令(供 redo 入栈)];栈空返回 null */
export function popUndo(
  doc: TileMapDefinition,
  history: History,
): { doc: TileMapDefinition; command: EditorCommand; history: History } | null {
  const command = history.undo[history.undo.length - 1];
  if (command === undefined) return null;
  return {
    doc: command.kind === 'add' ? removeAtPath(doc, command.path) : setAtPath(doc, command.path, command.before),
    command,
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, command] },
  };
}

/** redo:返回 [新doc, 命令(供 undo 入栈)];栈空返回 null */
export function popRedo(
  doc: TileMapDefinition,
  history: History,
): { doc: TileMapDefinition; command: EditorCommand; history: History } | null {
  const command = history.redo[history.redo.length - 1];
  if (command === undefined) return null;
  return {
    doc: command.kind === 'remove' ? removeAtPath(doc, command.path) : setAtPath(doc, command.path, command.after),
    command,
    history: { undo: [...history.undo, command], redo: history.redo.slice(0, -1) },
  };
}
