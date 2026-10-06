import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AssetManifestSchema } from '@sims/shared';
import { buildImportPlan } from './import-plan.js';
import { pngSize } from './png.js';

describe('pngSize', () => {
  it('解析真实 PNG 的 IHDR 尺寸', () => {
    // 库内真实产物(1x1 透明 PNG 由测试内联生成,避免依赖外部文件)
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d494844520000000a0000000608060000e2f679',
      'hex',
    );
    expect(pngSize(png)).toEqual({ width: 10, height: 6 });
  });

  it('拒绝非 PNG 与缺失 IHDR', () => {
    expect(() => pngSize(Buffer.from('not a png at all'))).toThrow();
    const broken = Buffer.alloc(32);
    broken.writeUInt32BE(0x89504e47, 0);
    expect(() => pngSize(broken)).toThrow('IHDR');
  });
});

describe('buildImportPlan 首批清单', () => {
  const plan = buildImportPlan('/src');

  it('清单非空且 slug 全局唯一', () => {
    expect(plan.length).toBeGreaterThan(50);
    const slugs = plan.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('源路径全部指向清单根且为 png', () => {
    for (const item of plan) {
      expect(item.sourcePath.startsWith('/src/')).toBe(true);
      expect(item.sourcePath.endsWith('.png')).toBe(true);
    }
  });

  it('tile 归属 indoor/outdoor 与主题一致', () => {
    const floor = plan.find((i) => i.slug === 'tile-floorWood')!;
    expect(floor.domain).toBe('indoor');
    expect(floor.theme).toBe('floor');
    expect(floor.anchor).toBe('top-left');
    const grass = plan.find((i) => i.slug === 'tile-grass')!;
    expect(grass.domain).toBe('outdoor');
  });

  it('家具带占地与 kind,角色带动画契约', () => {
    const bed = plan.find((i) => i.slug === 'bed')!;
    expect(bed.kind).toBe('bed');
    expect(bed.gridW).toBe(2);
    expect(bed.gridH).toBe(3);
    const char = plan.find((i) => i.slug === 'char-green')!;
    expect(char.anim?.groups).toEqual({ walk: 0, idle: 4, lie: 8, sit: 12 });
    expect(char.anchor).toBe('char-082');
  });

  it('变体默认 draft,存量迁移件 active', () => {
    const variant = plan.find((i) => i.slug === 'bed-blue')!;
    expect(variant.status).toBe('draft');
    expect(plan.find((i) => i.slug === 'bed')!.status).toBe('active');
  });
});

describe('AssetManifestSchema', () => {
  it('已发布 manifest 通过协议校验(存在时)', async () => {
    // 发布产物被 gitignore,仅在本机存在;不存在时跳过(不阻塞 CI)
    let raw: string;
    try {
      raw = readFileSync(
        fileURLToPath(new URL('../../../web/public/assets/manifest.json', import.meta.url)),
        'utf8',
      );
    } catch {
      return;
    }
    const parsed = AssetManifestSchema.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toMatch(/^[0-9a-f]{8}$/);
      expect(parsed.data.assets.length).toBeGreaterThan(50);
      expect(parsed.data.assets.every((a) => a.url.startsWith('library/'))).toBe(true);
      // 产物完整性:每条 manifest 记录对应文件实际存在(防"只写清单不拷文件"回归)
      const { readdirSync } = await import('node:fs');
      const libDir = fileURLToPath(
        new URL('../../../web/public/assets/library', import.meta.url),
      );
      const files = new Set(readdirSync(libDir));
      for (const asset of parsed.data.assets) {
        expect(files.has(`${asset.slug}.png`)).toBe(true);
      }
    }
  });
});
