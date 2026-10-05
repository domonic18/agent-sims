import type { DbHandle } from './db/client.js';
import { techLogs } from './db/schema/index.js';

export type TechLogLevel = 'info' | 'warn' | 'error';

let handle: DbHandle | null = null;
let chain: Promise<void> = Promise.resolve();

/** 宿主启动时绑定写入目标;未初始化时 logTech 静默丢弃(测试/极早期调用安全) */
export function initTechLog(target: DbHandle): void {
  handle = target;
  chain = Promise.resolve();
}

/**
 * 技术运行日志写入口(M-G.1②):LLM 调用/未捕获异常/慢 tick 等运行事件;
 * 串行链火后不理(同 event-log 模式),写失败仅 console 不影响调用方。
 */
export function logTech(
  level: TechLogLevel,
  source: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  if (!handle) return;
  chain = chain
    .then(async () => {
      await handle!.db.insert(techLogs).values({ level, source, message, detail: detail ?? null });
    })
    .catch((err: unknown) => {
      console.error('[tech-log] 技术日志写入失败', err);
    });
}

/** 等待挂起写入完成(测试断言与进程关停 flush) */
export function whenTechLogIdle(): Promise<void> {
  return chain;
}
