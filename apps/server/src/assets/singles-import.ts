import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImportItem } from './library.js';
import { trimPng } from './library.js';
import { pngSize as pngSizeOf } from './png.js';

/**
 * LimeZu Singles 批量导入清单构建(M-G.0 专项):
 * - 户外(Exteriors Complete Singles):语义文件名 `NN_Theme_16x16_Name[_variant].png`
 *   → theme/kind 自动归类,直接 active
 * - 室内(Theme_Sorter_Singles/NN_Theme_Singles):目录名建 theme;尺寸指纹匹配
 *   已验证 kind 的自动挂 kind 并 active,其余挂 theme 层 draft 待后台校验
 */

/** 已验证 kind 的 trim 尺寸指纹(与首批在用素材一致;命中即自动归类+active) */
const KIND_SIZE_FINGERPRINTS: ReadonlyArray<{ kind: string; w: number; h: number; tol?: number }> = [
  { kind: 'bed', w: 32, h: 38 },
  { kind: 'fridge', w: 16, h: 38 },
  { kind: 'bookshelf', w: 32, h: 34 },
  { kind: 'treadmill', w: 20, h: 36 },
  { kind: 'desk', w: 32, h: 19 },
  { kind: 'shelf', w: 14, h: 40 },
  { kind: 'counter', w: 30, h: 26 },
  { kind: 'wardrobe', w: 31, h: 32 },
  { kind: 'tv', w: 36, h: 25 },
  { kind: 'plant', w: 16, h: 20 },
  { kind: 'bench', w: 26, h: 15 },
  { kind: 'table', w: 32, h: 30 },
  { kind: 'sofa', w: 32, h: 30 },
];

export interface SinglesImportOptions {
  /** 目录:户外 Singles 根 或 室内某个 *_Singles 目录 */
  sourceDir: string;
  /** outdoor=语义文件名模式;indoor=目录 theme+尺寸指纹 */
  mode: 'outdoor' | 'indoor';
  /** 试点限量(全量省略) */
  limit?: number;
  /** 室内目录对应的 theme slug(如 gym/bedroom;缺省从目录名推) */
  theme?: string;
}

const kebab = (raw: string): string =>
  raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export interface OutdoorParseResult {
  theme: string;
  kindSlug: string;
  name: string;
  /** 形态 B 自带占地格数(NxN) */
  grid?: { w: number; h: number };
}

/** 户外语义文件名解析,两种形态:
 *  A: NN_Theme_16x16_Name[_variant]  B: ME_Singles_Group_NxN_Name[_N][_variant] */
export function parseOutdoorFilename(file: string): OutdoorParseResult | null {
  const base = path.basename(file, '.png');
  const matchA = /^(\d+)_([A-Za-z_]+?)_16x16_(.+)$/.exec(base);
  if (matchA !== null) {
    const theme = kebab(matchA[2]!);
    const rest = matchA[3]!;
    // 尾部 `_数字` / `_Sand` / `_数字_Sand` 等变体并入素材名,kind 去变体
    const kindSource = rest.replace(/(_\d+)?(_Sand|_Stone|_Wood)?$/, '');
    return { theme, kindSlug: kebab(kindSource) || theme, name: rest.replace(/_/g, ' ').trim() };
  }
  const matchB = /^ME_Singles_([A-Za-z_]+?)_(\d+)x(\d+)_(.+)$/.exec(base);
  if (matchB !== null) {
    const theme = kebab(matchB[1]!);
    const rest = matchB[4]!;
    const kindSource = rest.replace(/((_\d+)+)?(_Sand|_Stone|_Wood)?$/, '');
    // 16x16 是 tile 尺寸标记(LimeZu 统一 16px 格),非占地格数——占地组用小值 NxN
    const gw = Number(matchB[2]);
    const gh = Number(matchB[3]);
    const grid = gw === 16 && gh === 16 ? undefined : { w: gw, h: gh };
    return {
      theme,
      kindSlug: kebab(kindSource) || theme,
      name: rest.replace(/_/g, ' ').trim(),
      ...(grid !== undefined ? { grid } : {}),
    };
  }
  return null;
}

/** 室内目录名(如 8_Gym_Singles) → theme slug */
export function parseIndoorTheme(dirName: string): string {
  const match = /^(\d+)_(.+?)_Singles$/.exec(dirName);
  return kebab(match?.[2] ?? dirName);
}

/** 尺寸指纹匹配已验证 kind(命中即自动归类) */
export function matchKindBySize(
  w: number,
  h: number,
): string | null {
  const hit = KIND_SIZE_FINGERPRINTS.find(
    (f) => Math.abs(f.w - w) <= (f.tol ?? 0) && Math.abs(f.h - h) <= (f.tol ?? 0),
  );
  return hit?.kind ?? null;
}

/** 扫描目录构建导入清单(不读图片;尺寸由导入器落库时解析后无法回填 kind——
 * 故室内模式按文件名无法判尺寸的挂 theme draft,尺寸指纹在导入器内二次归类) */
export async function buildSinglesImportList(options: SinglesImportOptions): Promise<{
  items: ImportItem[];
  counts: { outdoor: number; indoorDraft: number };
}> {
  const files = (await readdir(options.sourceDir)).filter((f) => f.endsWith('.png'));
  const picked = options.limit !== undefined ? files.slice(0, options.limit) : files;
  const items: ImportItem[] = [];
  if (options.mode === 'outdoor') {
    for (const file of picked) {
      const parsed = parseOutdoorFilename(file);
      if (parsed === null) continue;
      // kind 已含 theme 前缀(如 beach-towel)不再重复拼接
      const base =
        parsed.kindSlug === parsed.theme || parsed.kindSlug.startsWith(`${parsed.theme}-`)
          ? parsed.kindSlug
          : `${parsed.theme}-${parsed.kindSlug}`;
      items.push({
        slug: `${base}-${items.length + 1}`,
        name: parsed.name,
        domain: 'outdoor',
        theme: parsed.theme,
        kind: parsed.kindSlug,
        ...(parsed.grid !== undefined
          ? { gridW: parsed.grid.w, gridH: parsed.grid.h }
          : {}),
        sourcePath: path.join(options.sourceDir, file),
        source: `limezu-exterior-singles(${path.basename(file)})`,
        status: 'active',
        trim: true,
      });
    }
    return { items, counts: { outdoor: items.length, indoorDraft: 0 } };
  }
  const theme = options.theme ?? parseIndoorTheme(path.basename(options.sourceDir));
  let classified = 0;
  for (const file of picked) {
    const base = path.basename(file, '.png');
    // 编号命名无语义:尺寸指纹命中已验证 kind → 自动归类+active;否则 theme 层 draft
    let kind: string | undefined;
    let status: ImportItem['status'] = 'draft';
    try {
      // 指纹按 trim 后(规范)尺寸:源文件带边距,先 trim 再量
      const trimmed = trimPng(await readFile(path.join(options.sourceDir, file)));
      const { width, height } = pngSizeOf(trimmed);
      const matched = matchKindBySize(width, height);
      if (matched !== null) {
        kind = matched;
        status = 'active';
        classified += 1;
      }
    } catch {
      // 非法 PNG 保持 draft
    }
    items.push({
      // 编号命名(Theme_Singles_N)取尾部编号,避免 theme 前缀冗余(gym-gym-singles-115 → gym-115)
      slug: `${theme}-${/(\d+)$/.exec(base)?.[1] ?? kebab(base)}`,
      name: base.replace(/_/g, ' '),
      domain: 'indoor',
      theme,
      kind,
      sourcePath: path.join(options.sourceDir, file),
      source: `limezu-singles(${path.basename(options.sourceDir)}/${file})`,
      status,
      trim: true,
    });
  }
  return { items, counts: { outdoor: 0, indoorDraft: items.length - classified } };
}
