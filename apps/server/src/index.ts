import { buildApp } from './app.js';
import { BALANCE } from './config/balance.js';
import { env } from './config/env.js';
import { tickBroadcast } from './socket/gateway.js';
import { TickDriver } from './world/driver.js';

const app = buildApp({ logger: true });

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

app
  .listen({ port: env.GAME_PORT, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`agent-sims server listening at ${address}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
