/**
 * 素材库 CLI(M-L.1):`pnpm --filter server assets:import` 按内置清单导入(幂等);
 * `pnpm --filter server assets:publish` 发布 active 集 → web public/assets
 * (library/ + manifest.json)。源目录可用 ASSET_IMPORT_SOURCE 覆盖(默认 /tmp/asset-import)。
 */
import { fileURLToPath } from 'node:url';
import { createDb } from '../db/client.js';
import { env } from '../config/env.js';
import { buildImportPlan } from './import-plan.js';
import { buildSinglesImportList } from './singles-import.js';
import { importAssets, publishManifest } from './library.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
/** 容器内源码相对推导失效,env 显式覆盖 */
const libraryRoot = process.env.ASSET_LIBRARY_ROOT ?? `${repoRoot}/workspace/asset-library`;
const publishTarget = process.env.ASSETS_PUBLISH_TARGET ?? `${repoRoot}/apps/web/public/assets`;
const sourceDir = process.env.ASSET_IMPORT_SOURCE ?? '/tmp/asset-import';

const command = process.argv[2] ?? 'import';
const { db, client } = createDb(env.DATABASE_URL);
try {
  if (command === 'import') {
    const plan = buildImportPlan(sourceDir);
    console.log(`[assets] 导入清单 ${plan.length} 条, 源=${sourceDir}, 库根=${libraryRoot}`);
    const report = await importAssets(db, plan, libraryRoot);
    console.log(
      `[assets] 完成: 新建 ${report.created} / 跳过 ${report.skipped} / 更新 ${report.updated} / 失败 ${report.errors.length}`,
    );
    for (const err of report.errors) console.error(`  ✗ ${err}`);
    if (report.errors.length > 0) process.exitCode = 1;
  } else if (command === 'import-singles') {
    // 用法: assets:import-singles <dir> <outdoor|indoor> [limit] [theme]
    const [dir, modeArg, limitArg, themeArg] = process.argv.slice(3);
    if (dir === undefined || (modeArg !== 'outdoor' && modeArg !== 'indoor')) {
      console.error('用法: assets:import-singles <目录> <outdoor|indoor> [limit] [theme]');
      process.exitCode = 1;
    } else {
      const limit =
        limitArg !== undefined && limitArg !== '' ? Number(limitArg) : undefined;
      const { items, counts } = await buildSinglesImportList({
        sourceDir: dir,
        mode: modeArg,
        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        ...(themeArg !== undefined ? { theme: themeArg } : {}),
      });
      console.log(`[assets] singles 清单 ${items.length} 条(active ${items.length - counts.indoorDraft} / draft ${counts.indoorDraft})`);
      const report = await importAssets(db, items, libraryRoot);
      console.log(
        `[assets] 完成: 新建 ${report.created} / 跳过 ${report.skipped} / 更新 ${report.updated} / 失败 ${report.errors.length}`,
      );
      for (const err of report.errors) console.error(`  ✗ ${err}`);
      if (report.errors.length > 0) process.exitCode = 1;
    }
  } else if (command === 'publish') {
    const result = await publishManifest(db, libraryRoot, publishTarget);
    console.log(
      `[assets] 发布 ${result.assetCount} 件 → ${result.manifestPath} (version=${result.version})`,
    );
  } else {
    console.error(`未知命令: ${command}(可用: import | publish)`);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
