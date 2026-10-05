/**
 * 素材库 CLI(M-L.1):`pnpm --filter server assets:import` 按内置清单导入(幂等);
 * `pnpm --filter server assets:publish` 发布 active 集 → web public/assets
 * (library/ + manifest.json)。源目录可用 ASSET_IMPORT_SOURCE 覆盖(默认 /tmp/asset-import)。
 */
import { fileURLToPath } from 'node:url';
import { createDb } from '../db/client.js';
import { env } from '../config/env.js';
import { buildImportPlan } from './import-plan.js';
import { importAssets, publishManifest } from './library.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const libraryRoot = `${repoRoot}/workspace/asset-library`;
const publishTarget = `${repoRoot}/apps/web/public/assets`;
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
