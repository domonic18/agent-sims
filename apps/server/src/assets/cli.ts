/**
 * 素材库 CLI(M-L.1):`pnpm --filter server assets:import` 按内置清单导入(幂等);
 * `pnpm --filter server assets:publish` 发布 active 集 → web public/assets
 * (library/ + manifest.json)。源目录可用 ASSET_IMPORT_SOURCE 覆盖(默认 /tmp/asset-import)。
 * `check` 为容器启动链自检: 素材表空告警+发布产物缺失补发布,永不阻塞启动。
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { count } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { env } from '../config/env.js';
import { assetCategories, assets } from '../db/schema/asset.js';
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
  } else if (command === 'check') {
    // 启动链自检(Dockerfile CMD 消费): 素材表空→告警提示恢复路径;
    // 发布产物 manifest 缺失且有存量→自动补发布。任何异常只告警,不阻塞服务启动。
    try {
      const [assetRow] = await db.select({ n: count() }).from(assets);
      const [categoryRow] = await db.select({ n: count() }).from(assetCategories);
      const assetCount = assetRow?.n ?? 0;
      if (assetCount === 0) {
        console.error(
          `[assets] ⚠ 素材表为空(分类 ${categoryRow?.n ?? 0} 条)——游戏内容与后台素材管理将不可用。` +
            `恢复: 取 workspace/backups 最新备份经 docker/restore-db.sh 灌回`,
        );
      } else {
        console.log(`[assets] 自检通过: 素材 ${assetCount} 条 / 分类 ${categoryRow?.n ?? 0} 条`);
      }
      try {
        await access(join(publishTarget, 'manifest.json'));
      } catch {
        if (assetCount > 0) {
          const result = await publishManifest(db, libraryRoot, publishTarget);
          console.log(
            `[assets] 发布产物缺失,已自动补发布 ${result.assetCount} 件 (version=${result.version})`,
          );
        } else {
          console.error('[assets] 发布产物缺失且素材表为空,跳过补发布');
        }
      }
    } catch (err) {
      console.error(`[assets] 自检异常(不阻塞启动): ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.error(`未知命令: ${command}(可用: import | import-singles | publish | check)`);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
