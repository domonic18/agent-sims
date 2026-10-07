import { buildApp } from './app.js';
import { persistAutoArchive } from './admin-api/world-archives.js';
import { restoreActiveWorld } from './admin-api/worlds.js';
import { BALANCE } from './config/balance.js';
import { env } from './config/env.js';
import { tickBroadcast } from './socket/gateway.js';
import { TickDriver } from './world/driver.js';

const app = buildApp({ logger: true });

// 启动恢复(C4):重建 app 后按 active 世界复原地图现场(先于世界循环启动);
// C8 起有档即灌最近一档(关闭时自动存档的现场),无档冻结空场
await restoreActiveWorld(app, app.db);

// 世界循环:accumulator 泵按 DRIVER_SLICE_MS 粒度把真实时间换算为 tick;
// 暂停/倍率经 /debug/* 端点改 Simulation,泵下一拍自动生效;
// 每 tick 增量(当前为全量快照)经驱动器回调向在线客户端广播
const driver = new TickDriver(app.simulation, { onTick: tickBroadcast(app.simulation, app.io) });
const pumpTimer = setInterval(() => {
  driver.pump();
}, BALANCE.DRIVER_SLICE_MS);
pumpTimer.unref();

app.addHook('onClose', async () => {
  clearInterval(pumpTimer);
});

// 退出自动存档(C8):SIGTERM(docker stop)/SIGINT(Ctrl+C)先落一档再退出;
// 存档失败仅记日志仍退出(docker 超时会强杀,不能拖住关闭流程)
let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    const saved = await persistAutoArchive(app, app.db);
    app.log.info(`${signal}: auto archive ${saved ? 'saved' : 'skipped'}`);
  } catch (err) {
    app.log.error({ msg: `${signal}: auto archive failed`, err });
  }
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

app
  .listen({ port: env.GAME_PORT, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`agent-sims server listening at ${address}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
