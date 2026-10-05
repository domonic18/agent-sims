import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** 库根与发布目标:dev 按源码相对推导;容器内经 env 覆盖 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function libraryRoot(): string {
  return process.env.ASSET_LIBRARY_ROOT ?? path.join(repoRoot, 'workspace', 'asset-library');
}

export function publishTarget(): string {
  return process.env.ASSETS_PUBLISH_TARGET ?? path.join(repoRoot, 'apps', 'web', 'public', 'assets');
}

/** 当前发布 manifest 版本(worldgen 种子派生输入;未发布返回 'unpublished') */
export function readManifestVersion(): string {
  try {
    const raw = JSON.parse(readFileSync(path.join(publishTarget(), 'manifest.json'), 'utf8')) as {
      version?: string;
    };
    return typeof raw.version === 'string' ? raw.version : 'unpublished';
  } catch {
    return 'unpublished';
  }
}
