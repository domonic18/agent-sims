import { env } from '../../src/config/env.js';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { issueAdminToken } from '../../src/utils/token.js';

/**
 * 集成测试连接样板: 探测 dev compose 的 postgres 可达性(需已 migrate;不可达时配合
 * describe.skipIf 整组跳过)。skipIf 在收集期求值,故须在测试文件模块顶层 await。
 * authHeader 签发 username=vitest 的管理 token(verifyAdminToken 是 HMAC 校验,无需建号)。
 */
export async function setupIntegrationDb(): Promise<{
  handle: DbHandle;
  up: boolean;
  authHeader: () => string;
}> {
  const handle = createDb(env.DATABASE_URL);
  let up = false;
  try {
    await handle.client`SELECT 1`;
    up = true;
  } catch {
    await handle.client.end().catch(() => {});
  }
  const authHeader = (): string => {
    const issued = issueAdminToken({
      username: 'vitest',
      masterKey: env.MASTER_KEY,
      ttlMs: 3_600_000,
    });
    return `Bearer ${issued.token}`;
  };
  return { handle, up, authHeader };
}
