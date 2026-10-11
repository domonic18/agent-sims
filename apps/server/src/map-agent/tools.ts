/**
 * AI 改图工具集(批C):read/write/edit/generate/validate/ask_user。
 * 文档经 doc-store 按线程存取;变更先过 shared validateMapDefinition,
 * 不合规回滚并返回中文错误供模型自纠;推送走 runtime.writer(custom 通道)。
 */
import { randomUUID } from 'node:crypto';
import { tool, type ToolRuntime } from '@langchain/core/tools';
import { z } from 'zod';
import {
  GAME_TYPES,
  WORLDGEN_DENSITIES,
  WORLDGEN_SIZES,
  validateMapDefinition,
  type DecorDefinition,
  type PlaceDefinition,
  type ResourceNodeSeed,
  type TileMapDefinition,
} from '@sims/shared';
import { readManifestVersion } from '../assets/paths.js';
import { generateTownMap } from '../world/worldgen/generate.js';
import { loadAssetInput } from '../admin-api/worlds-create.js';
import { getThreadDoc, replaceThreadDoc } from './doc-store.js';

type ToolCtx = ToolRuntime<unknown, unknown>;

function requireThread(runtime: ToolCtx): string {
  // langgraph ToolNode 注入 {...config, config}(两层均带 configurable);直连 invoke 只有顶层
  const threadId = runtime.config?.configurable?.thread_id ?? runtime.configurable?.thread_id;
  if (typeof threadId !== 'string' || threadId === '') throw new Error('缺少线程上下文');
  return threadId;
}

function pushEvent(runtime: ToolCtx, event: Record<string, unknown>): void {
  runtime.writer?.(event);
}

const NO_WALL_KINDS = new Set(['park', 'plaza', 'beach', 'camping', 'graveyard', 'ruins']);
const DECOR_GROUPS = ['trees', 'lamps', 'flowers', 'bushes'] as const;
type DecorGroup = (typeof DECOR_GROUPS)[number];

/** DecorDefinition 四数组为 ReadonlyArray;structuredClone 产物本身可变,仅抹平类型层只读 */
type MutableDecor = { -readonly [K in keyof DecorDefinition]: DecorDefinition[K] extends readonly (infer item)[] ? item[] : DecorDefinition[K] };

const RESOURCE_KINDS: ReadonlySet<ResourceNodeSeed['kind']> = new Set(['berry_bush', 'junk_pile', 'tree', 'rock', 'metal_pile', 'apple_tree', 'wheat_patch']);

type FullDoc = TileMapDefinition & Required<Pick<TileMapDefinition, 'blockedRects' | 'paths' | 'fences' | 'resources' | 'decor'>>;

const point = z.object({ x: z.number(), y: z.number() });
const furnitureInput = z.object({
  kind: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  activityId: z.string().optional(),
  use: point.optional(),
});

/** write_map 载荷校验(与 shared 类型同构,最小结构面;passthrough 保留扩展字段) */
const TileMapDefinitionShape = z.object({
  width: z.number().int().min(8).max(200),
  height: z.number().int().min(8).max(200),
  blockedRects: z.array(z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().min(1), h: z.number().int().min(1) })),
  paths: z.array(z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().min(1), h: z.number().int().min(1) })),
  places: z.array(z.object({
    id: z.string(),
    name: z.string(),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
    entrance: point,
    door: point.optional(),
    furniture: z.array(furnitureInput).optional(),
  })),
}).passthrough() as unknown as z.ZodType<TileMapDefinition>;

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** 关键布局警告(编辑器全量体检的简版):入口间距<6 与入口→最近资源>25 */
export function layoutWarnings(definition: TileMapDefinition): { code: string; message: string }[] {
  const findings: { code: string; message: string }[] = [];
  const entrances = definition.places.map((p) => p.entrance);
  let closePairs = 0;
  let minPair = Number.POSITIVE_INFINITY;
  for (let i = 0; i < entrances.length; i++) {
    for (let j = i + 1; j < entrances.length; j++) {
      const a = entrances[i];
      const b = entrances[j];
      if (a === undefined || b === undefined) continue;
      const d = manhattan(a.x, a.y, b.x, b.y);
      minPair = Math.min(minPair, d);
      if (d < 6) closePairs++;
    }
  }
  if (closePairs > 0) {
    findings.push({ code: 'spacing', message: `${closePairs} 对入口间距 < 6(最近 ${Number.isFinite(minPair) ? minPair : '?'} 格):过度密集推高旁观感知与 LLM 调用` });
  }
  if ((definition.resources ?? []).length > 0) {
    const far = definition.places.filter((p) => {
      const best = Math.min(...(definition.resources ?? []).map((r) => manhattan(p.entrance.x, p.entrance.y, r.x, r.y)));
      return best > 25;
    });
    for (const p of far.slice(0, 3)) {
      findings.push({ code: 'resource', message: `场所「${p.name}」入口到最近资源节点 > 25 格:采集往返耗时` });
    }
  }
  return findings;
}

/** 底边中点门洞+外侧入口;底边出界回退顶边 */
export function autoEntranceFor(place: Pick<PlaceDefinition, 'x' | 'y' | 'w' | 'h'>, definition: TileMapDefinition): Pick<PlaceDefinition, 'entrance' | 'door'> {
  const cx = place.x + Math.floor((place.w - 1) / 2);
  if (place.y + place.h < definition.height) {
    return { entrance: { x: cx, y: place.y + place.h }, door: { x: cx, y: place.y + place.h - 1 } };
  }
  return { entrance: { x: cx, y: place.y - 1 }, door: { x: cx, y: place.y } };
}

function nextPlaceId(definition: TileMapDefinition, kind: string): string {
  let max = 0;
  for (const p of definition.places) {
    const m = /^([a-z_]+)-(\d+)$/.exec(p.id);
    if (m !== null && m[1] === kind) max = Math.max(max, Number(m[2]));
  }
  return `${kind}-${max + 1}`;
}

function clone(definition: TileMapDefinition): TileMapDefinition {
  return structuredClone(definition);
}

const readMapSchema = z.object({});

const writeMapSchema = z.object({
  definition: z.unknown(),
  label: z.string().max(60).optional(),
});

const editMapSchema = z.object({
  op: z.enum(['add', 'update', 'remove']),
  target: z.enum(['place', 'path', 'fence', 'blocked', 'resource', 'decor']),
  id: z.string().optional(),
  index: z.number().int().min(0).optional(),
  group: z.enum(DECOR_GROUPS).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const generateMapSchema = z.object({
  seed: z.number().int().min(0).max(9_999_999_999).optional(),
  gameType: z.enum(GAME_TYPES),
  size: z.enum(WORLDGEN_SIZES).default('small'),
  density: z.enum(WORLDGEN_DENSITIES).default('normal'),
});

const validateMapSchema = z.object({});

const askUserSchema = z.object({
  question: z.string().min(1).max(200),
  options: z.array(z.object({ value: z.string().min(1).max(40), label: z.string().min(1).max(40) })).min(2).max(4),
  default: z.string().optional(),
});

function requireDoc(threadId: string): TileMapDefinition {
  const doc = getThreadDoc(threadId);
  if (doc === null) throw new Error('当前线程没有装载地图文档');
  return doc;
}

function commit(threadId: string, runtime: ToolCtx, next: TileMapDefinition, label: string): string {
  const issues = validateMapDefinition(next);
  if (issues.length > 0) {
    return JSON.stringify({ ok: false, error: '校验未通过,已回滚本次改动', issues: issues.slice(0, 8) });
  }
  replaceThreadDoc(threadId, next);
  pushEvent(runtime, { type: 'map_updated', definition: next, label });
  return JSON.stringify({ ok: true, label });
}

/** 编辑前归一化可缺省数组(编辑器与生成器产物均带全,防御外部 write_map 载荷) */
function normalize(next: TileMapDefinition): FullDoc {
  next.blockedRects ??= [];
  next.paths ??= [];
  next.fences ??= [];
  next.resources ??= [];
  next.decor ??= { trees: [], lamps: [], flowers: [], bushes: [] };
  return next as FullDoc;
}

/** 组装全部工具(threadId 从每次调用的 runtime 解析,agent 单例安全) */
export function createMapTools() {
  const readMap = tool(
    (_input, runtime: ToolCtx) => {
      const doc = normalize(requireDoc(requireThread(runtime)));
      const places = doc.places.map((p) => ({ id: p.id, name: p.name, rect: `${p.x},${p.y} ${p.w}×${p.h}`, entrance: p.entrance, furniture: p.furniture?.length ?? 0 }));
      return JSON.stringify({
        width: doc.width,
        height: doc.height,
        counts: {
          places: doc.places.length,
          paths: doc.paths.length,
          fences: doc.fences.length,
          resources: doc.resources.length,
          decor: Object.values(doc.decor).flat().length,
          blockedRects: doc.blockedRects.length,
        },
        places,
      });
    },
    { name: 'read_map', description: '查看当前地图:尺寸、各类对象计数与场所清单(不含完整 JSON)', schema: readMapSchema },
  );

  const readMapFull = tool(
    (_input, runtime: ToolCtx) => {
      const doc = requireDoc(requireThread(runtime));
      return JSON.stringify(doc);
    },
    { name: 'read_map_full', description: '导出当前地图完整 JSON(仅在小范围精修坐标时使用)', schema: readMapSchema },
  );

  const writeMap = tool(
    (input, runtime: ToolCtx) => {
      const threadId = requireThread(runtime);
      const parsed = TileMapDefinitionShape.safeParse(input.definition);
      if (!parsed.success) {
        return JSON.stringify({ ok: false, error: `definition 结构不合法: ${parsed.error.issues[0]?.message ?? '未知'}` });
      }
      return commit(threadId, runtime, normalize(clone(parsed.data)), input.label ?? '整体重写地图');
    },
    { name: 'write_map', description: '用完整 JSON 整体替换地图(先过硬校验,坏图被拒绝);仅整图重排时使用', schema: writeMapSchema },
  );

  const editMap = tool(
    (input, runtime: ToolCtx) => {
      const threadId = requireThread(runtime);
      const next = normalize(clone(requireDoc(threadId)));
      const data = input.data ?? {};

      if (input.target === 'place') {
        if (input.op === 'add') {
          const kind = typeof data.kind === 'string' ? data.kind : (/^([a-z_]+)-/.exec(typeof input.id === 'string' ? input.id : '')?.[1] ?? '');
          if (kind === '') return JSON.stringify({ ok: false, error: 'add place 需要提供 data.kind(场所语义类型)' });
          const w = typeof data.w === 'number' ? data.w : 9;
          const h = typeof data.h === 'number' ? data.h : 8;
          const x = typeof data.x === 'number' ? data.x : Math.floor(next.width / 2 - w / 2);
          const y = typeof data.y === 'number' ? data.y : Math.floor(next.height / 2 - h / 2);
          const id = nextPlaceId(next, kind);
          const base: PlaceDefinition = {
            id,
            name: typeof data.name === 'string' ? data.name : id,
            x, y, w, h,
            entrance: { x: x + Math.floor((w - 1) / 2), y: y + h },
          };
          if (!NO_WALL_KINDS.has(kind)) {
            const auto = autoEntranceFor(base, next);
            base.entrance = auto.entrance;
            base.door = auto.door;
          }
          if (Array.isArray(data.furniture)) base.furniture = data.furniture as PlaceDefinition['furniture'];
          if (data.entrance !== undefined) base.entrance = data.entrance as PlaceDefinition['entrance'];
          if (data.door !== undefined) base.door = data.door as PlaceDefinition['door'];
          next.places.push(base);
          return commit(threadId, runtime, next, `新增场所 ${base.name}(${id})`);
        }
        const idx = next.places.findIndex((p) => p.id === input.id);
        if (idx < 0) return JSON.stringify({ ok: false, error: `找不到场所 id=${input.id ?? '(未提供)'};先 read_map 查看清单` });
        if (input.op === 'remove') {
          const [removed] = next.places.splice(idx, 1);
          return commit(threadId, runtime, next, `删除场所 ${removed?.name ?? input.id ?? '未知'}`);
        }
        const before = next.places[idx]!;
        const after = structuredClone(before);
        const dx = typeof data.x === 'number' ? data.x - before.x : 0;
        const dy = typeof data.y === 'number' ? data.y - before.y : 0;
        if (typeof data.name === 'string') after.name = data.name;
        if (typeof data.w === 'number') after.w = data.w;
        if (typeof data.h === 'number') after.h = data.h;
        if (Array.isArray(data.furniture)) after.furniture = data.furniture as PlaceDefinition['furniture'];
        if (data.entrance !== undefined) after.entrance = data.entrance as PlaceDefinition['entrance'];
        if (data.door !== undefined) after.door = data.door as PlaceDefinition['door'];
        if (dx !== 0 || dy !== 0) {
          after.x += dx;
          after.y += dy;
          after.entrance = { x: after.entrance.x + dx, y: after.entrance.y + dy };
          if (after.door !== undefined) after.door = { x: after.door.x + dx, y: after.door.y + dy };
          if (after.furniture !== undefined) {
            after.furniture = after.furniture.map((f) => ({
              ...f,
              x: f.x + dx,
              y: f.y + dy,
              ...(f.use !== undefined ? { use: { x: f.use.x + dx, y: f.use.y + dy } } : {}),
            }));
          }
        }
        next.places[idx] = after;
        return commit(threadId, runtime, next, `修改场所 ${after.name}${dx !== 0 || dy !== 0 ? '(整体平移)' : ''}`);
      }

      if (input.target === 'resource') {
        if (input.op === 'add') {
          if (typeof data.kind !== 'string' || typeof data.x !== 'number' || typeof data.y !== 'number') {
            return JSON.stringify({ ok: false, error: 'add resource 需要 data.kind/data.x/data.y' });
          }
          if (!RESOURCE_KINDS.has(data.kind as ResourceNodeSeed['kind'])) {
            return JSON.stringify({ ok: false, error: `未知资源 kind=${data.kind};可选: ${[...RESOURCE_KINDS].join('/')}` });
          }
          next.resources.push({ kind: data.kind as ResourceNodeSeed['kind'], x: data.x, y: data.y });
          return commit(threadId, runtime, next, `新增资源 ${data.kind}@${data.x},${data.y}`);
        }
        const idx = input.index ?? -1;
        if (idx < 0 || idx >= next.resources.length) return JSON.stringify({ ok: false, error: '需要 data 之外的 index(resources 下标)定位资源' });
        if (input.op === 'remove') {
          next.resources.splice(idx, 1);
          return commit(threadId, runtime, next, `删除资源 #${idx}`);
        }
        const r = next.resources[idx]!;
        if (typeof data.x === 'number') r.x = data.x;
        if (typeof data.y === 'number') r.y = data.y;
        return commit(threadId, runtime, next, `移动资源 #${idx}`);
      }

      if (input.target === 'decor') {
        const group: DecorGroup = input.group ?? 'trees';
        const decor = structuredClone(next.decor) as MutableDecor;
        const list = decor[group];
        if (input.op === 'add') {
          if (typeof data.x !== 'number' || typeof data.y !== 'number') return JSON.stringify({ ok: false, error: 'add decor 需要 data.x/data.y' });
          list.push([data.x, data.y]);
          next.decor = decor;
          return commit(threadId, runtime, next, `新增装饰 ${group}@${data.x},${data.y}`);
        }
        const idx = input.index ?? -1;
        if (idx < 0 || idx >= list.length) return JSON.stringify({ ok: false, error: `需要 index(${group} 下标)定位装饰,并传 group` });
        if (input.op === 'remove') {
          list.splice(idx, 1);
          next.decor = decor;
          return commit(threadId, runtime, next, `删除装饰 ${group}#${idx}`);
        }
        list[idx] = [typeof data.x === 'number' ? data.x : list[idx]![0], typeof data.y === 'number' ? data.y : list[idx]![1]];
        next.decor = decor;
        return commit(threadId, runtime, next, `移动装饰 ${group}#${idx}`);
      }

      const key = input.target === 'path' ? 'paths' : input.target === 'fence' ? 'fences' : 'blockedRects';
      const list = next[key];
      if (input.op === 'add') {
        const w = typeof data.w === 'number' ? data.w : 1;
        const h = typeof data.h === 'number' ? data.h : 1;
        if (typeof data.x !== 'number' || typeof data.y !== 'number') return JSON.stringify({ ok: false, error: `add ${input.target} 需要 data.x/data.y(可带 w/h,缺省 1)` });
        list.push({ x: data.x, y: data.y, w, h });
        return commit(threadId, runtime, next, `新增${input.target} ${data.x},${data.y} ${w}×${h}`);
      }
      const idx = input.index ?? -1;
      if (idx < 0 || idx >= list.length) return JSON.stringify({ ok: false, error: `需要 index(${key} 下标)定位` });
      if (input.op === 'remove') {
        list.splice(idx, 1);
        return commit(threadId, runtime, next, `删除${input.target} #${idx}`);
      }
      const rect = list[idx]!;
      if (typeof data.x === 'number') rect.x = data.x;
      if (typeof data.y === 'number') rect.y = data.y;
      if (typeof data.w === 'number') rect.w = data.w;
      if (typeof data.h === 'number') rect.h = data.h;
      return commit(threadId, runtime, next, `修改${input.target} #${idx}`);
    },
    { name: 'edit_map', description: '结构化增删改:place/path/fence/blocked/resource/decor;place 平移自动带动家具与门入口;add place 自动补门洞入口', schema: editMapSchema },
  );

  const generateMap = tool(
    (input, runtime: ToolCtx) => {
      const threadId = requireThread(runtime);
      const seed = input.seed !== undefined ? String(input.seed) : String(Math.floor(Math.random() * 2 ** 31));
      const result = generateTownMap({
        seed,
        gameType: input.gameType,
        params: { size: input.size, density: input.density },
        manifestVersion: readManifestVersion(),
        ...loadAssetInput(),
      });
      const committed = commit(threadId, runtime, result.map, `随机生成(${input.gameType}/${input.size}/seed ${seed})`);
      return `${committed}\nseed: ${seed},尺寸: ${result.map.width}×${result.map.height}`;
    },
    { name: 'generate_map', description: '按种子随机生成整张起步图并替换当前地图(可复现)', schema: generateMapSchema },
  );

  const validateMap = tool(
    (_input, runtime: ToolCtx) => {
      const doc = normalize(requireDoc(requireThread(runtime)));
      const issues = validateMapDefinition(doc);
      const warnings = layoutWarnings(doc);
      return JSON.stringify({ ok: issues.length === 0, issues: issues.slice(0, 12), warnings });
    },
    { name: 'validate_map', description: '对当前地图跑结构与布局体检(硬错误 issues + 优化警告 warnings)', schema: validateMapSchema },
  );

  const askUser = tool(
    (input, runtime: ToolCtx) => {
      pushEvent(runtime, {
        type: 'question',
        id: runtime.toolCallId ?? randomUUID(),
        question: input.question,
        options: input.options,
        default: input.default ?? null,
      });
      return '已向用户展示问题与选项。请结束本轮回复,等待用户选择后继续。';
    },
    { name: 'ask_user', description: '向用户提中文选择题(2-4 个选项);意图含糊(风格/密度/取舍)时使用,不自作主张', schema: askUserSchema },
  );

  return [readMap, readMapFull, editMap, writeMap, generateMap, validateMap, askUser];
}
