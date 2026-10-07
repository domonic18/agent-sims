import { BALANCE } from '../config/balance.js';
import { Simulation } from './simulation.js';

/**
 * headless 批跑入口(纯逻辑,不依赖 DB/HTTP):
 *   pnpm --filter @sims/server sim:run -- --ticks=N
 * 每跨一个游戏日输出一行摘要,结束输出最终状态。
 */
function parseArgs(argv: readonly string[]): { ticks: number } {
  let ticks: number = BALANCE.DAY_MINUTES; // 默认跑完整 1 游戏日
  for (const arg of argv) {
    const match = /^--ticks=(\d+)$/.exec(arg);
    if (match) ticks = Number(match[1]);
  }
  return { ticks };
}

const { ticks } = parseArgs(process.argv.slice(2));
const sim = new Simulation();
sim.spawnCharacter('demo', 8, 12, '演示'); // home 门口,随模拟自然衰减

let lastDay = sim.clock.day;
const VITALS_EVERY_TICKS = 240; // 每 4 游戏小时输出一行数值曲线
console.log(
  `[start] tick=0 第 ${lastDay} 日 ${sim.clock.formatTime()} 夜=${sim.clock.isNight}`,
);
for (let i = 0; i < ticks; i += 1) {
  sim.advanceTicks(1);
  if (sim.tick % VITALS_EVERY_TICKS === 0) {
    const c = sim.character('demo');
    console.log(
      `[vitals] tick=${sim.tick} ${sim.clock.formatTime()} ` +
        `体力=${c.energy.toFixed(1)} 金币=${c.coins} 得分=${c.score.toFixed(1)}`,
    );
  }
  if (sim.clock.day !== lastDay) {
    lastDay = sim.clock.day;
    console.log(`[day] tick=${sim.tick} 进入第 ${lastDay} 日 00:00`);
  }
}
const snap = sim.snapshot();
const demo = snap.characters[0];
console.log(
  `[final] tick=${snap.tick} 第 ${snap.clock.day} 日 ${snap.clock.time} ` +
    `夜=${snap.clock.isNight} paused=${snap.paused} scale=${snap.timeScale}x`,
);
if (demo) {
  console.log(
    `[final] ${demo.name} @(${demo.x},${demo.y}) 体力=${demo.energy} 金币=${demo.coins} 得分=${demo.score}`,
  );
}
