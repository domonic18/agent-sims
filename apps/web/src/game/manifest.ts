import { AssetManifestSchema, type AssetAnimConfig, type AssetEntry, type AssetManifest } from '@sims/shared';

/**
 * 游戏侧素材 registry(M-L.3,design/05 §4):React 宿主 fetch manifest 经
 * Phaser registry 注入场景;场景 preload 按 anim 形态分流 image/spritesheet,
 * 纹理 key 一律 = 素材 slug。素材库「发布」产物是游戏运行前提。
 */
export interface GameAssetRegistry {
  manifest: AssetManifest;
  bySlug: Map<string, AssetEntry>;
  /** tile 类素材 slug 集(terrain 铺装用,anchor=top-left) */
  tileSlugs: Set<string>;
  /** 角色表素材 slug(char-green 形态) */
  characterSlugs: string[];
}

export function buildRegistry(manifest: AssetManifest): GameAssetRegistry {
  const bySlug = new Map(manifest.assets.map((asset) => [asset.slug, asset]));
  return {
    manifest,
    bySlug,
    tileSlugs: new Set(
      manifest.assets.filter((asset) => asset.slug.startsWith('tile-')).map((asset) => asset.slug),
    ),
    characterSlugs: manifest.assets
      .filter((asset) => asset.domain === 'character')
      .map((asset) => asset.slug),
  };
}

export async function fetchGameAssetRegistry(): Promise<GameAssetRegistry> {
  const res = await fetch('/assets/manifest.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`素材清单加载失败(HTTP ${res.status})——请先在后台素材管理「发布到游戏」`);
  }
  const parsed = AssetManifestSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`素材清单协议不合法: ${parsed.error.issues[0]?.message ?? ''}`);
  }
  return buildRegistry(parsed.data);
}

/** 场景内取 registry(宿主已注入;缺失即启动流程错误) */
export function registryOf(scene: Phaser.Scene): GameAssetRegistry {
  const registry = scene.registry.get('assets') as GameAssetRegistry | undefined;
  if (registry === undefined) {
    throw new Error('素材 registry 未注入(WorldCanvas 启动流程错误)');
  }
  return registry;
}

/** 角色表动画配置(素材库 anim 契约:groups/fps;方向行偏移是渲染层约定) */
export function characterAnim(registry: GameAssetRegistry, slug: string): AssetAnimConfig {
  const anim = registry.bySlug.get(slug)?.anim;
  if (anim === null || anim === undefined) {
    throw new Error(`角色素材 ${slug} 缺少动画配置`);
  }
  return anim;
}
