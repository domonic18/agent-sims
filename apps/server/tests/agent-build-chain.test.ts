import { getBuildBlueprint, type TileMapDefinition, type WorldEvent } from '@sims/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbHandle } from '../src/db/client.js';
import type { MemoryLlm } from '../src/agents/memory-writer.js';
import { autonomy, innerState } from '../src/agents/cognition.js';
import { AgentScheduler } from '../src/agents/scheduler.js';
import { BALANCE } from '../src/config/balance.js';
import { suggestBuildRect } from '../src/world/build-suggest.js';
import { Simulation } from '../src/world/simulation.js';
import { runIntent } from '../src/intents/execute.js';

/**
 * S2-A 自主建造调度链集成测试(零真 LLM/零 DB):
 * 晨间 want 直接注入 innerState(跳过 composeIntents),AgentScheduler 驱动
 * 真实 Simulation + runIntent——验证「采(chop_tree 工单,建材直入单仓,S2-C N1)
 * →建(build 意图扣料建单→施工→完工落地)」跨块闭环、中断退料销单、
 * growth 世界建造 want 候选期废弃。
 */

const CHAR_ID = 'builder-1';

/** 合成 survival 底图:镇核心居中(单仓格=底边中点 20,17),东南角一棵树 */
const MAP: TileMapDefinition = {
  width: 40,
  height: 30,
  blockedRects: [],
  paths: [],
  places: [],
  resources: [{ kind: 'tree', x: 28, y: 22 }],
  townCore: { x: 16, y: 12, w: 8, h: 6 },
};

const MORNING_WANTS = [
  {
    id: 'w0-0',
    activityId: 'construction',
    origin: 'plan',
    why: '给镇上盖咖啡馆',
    urgency: 0.6,
    status: 'pending',
    createdAtMin: 0,
    blueprintId: 'build_cafe',
  },
  {
    id: 'w0-1',
    activityId: 'chop_tree',
    origin: 'plan',
    why: '攒点木材',
    urgency: 0.5,
    status: 'pending',
    createdAtMin: 0,
  },
];

interface Rig {
  sim: Simulation;
  events: WorldEvent[];
  bubbles: string[];
  intents: Array<Record<string, unknown>>;
  scheduler: AgentScheduler;
}

/** survival 世界+调度器:真 Sim/真 runIntent;handle/llm 全桩(零 DB 零模型) */
function rig(opts: { gameType?: 'growth' | 'survival'; storage?: Record<string, number> } = {}): Rig {
  const sim = new Simulation(() => 0.5);
  sim.setMap(MAP);
  if (opts.gameType !== 'growth') sim.setGameMode('survival');
  Object.assign(sim.storage, opts.storage ?? {});
  const events: WorldEvent[] = [];
  sim.events.subscribe((event) => events.push(event));
  const char = sim.spawnCharacter(CHAR_ID, 20, 19, '阿建');
  char.knowledge = 6; // 蓝图门槛 6 班(采集岗零门槛不受影响)
  char.coins = 50; // 口袋见底会触发 earn 驱力(restorative 高分)恒压过测试 want
  char.housing.paidThroughDay += 30; // 租约临期会触发 rent 续租规则抢跑首个巡检块
  const bubbles: string[] = [];
  const intents: Array<Record<string, unknown>> = [];
  const handle = {
    db: {
      insert: () => ({
        values: () => Promise.resolve(),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
    },
  } as unknown as DbHandle;
  const llm: MemoryLlm = {
    systemOne: () => Promise.reject(new Error('no jev')),
    embed: () => Promise.reject(new Error('unused')),
    chat: () => Promise.reject(new Error('no chat')),
    chatStructured: () => Promise.reject(new Error('no chatStructured')),
  };
  const scheduler = new AgentScheduler({
    sim,
    handle,
    llm,
    onBubble: (m) => bubbles.push(m.text),
    runIntent: (simArg, payload) => {
      intents.push(payload as Record<string, unknown>);
      return runIntent(simArg, payload);
    },
  });
  return { sim, events, bubbles, intents, scheduler };
}

/** 推进 n 游戏分钟:每分钟 1 tick(=1 游戏分)+ 触发一次 2s 巡检定时器 */
function pump(rig: Rig, minutes: number): void {
  for (let i = 0; i < minutes; i += 1) {
    rig.sim.advanceTicks(1);
    vi.advanceTimersByTime(2_000);
  }
}

/** 推进至条件满足(超时即断言失败,给出最后现场) */
function pumpUntil(rig: Rig, cond: () => boolean, maxMinutes = 240): void {
  for (let i = 0; i < maxMinutes; i += 1) {
    if (cond()) return;
    rig.sim.advanceTicks(1);
    vi.advanceTimersByTime(2_000);
  }
  expect(cond(), `推进 ${maxMinutes} 游戏分仍未满足条件`).toBe(true);
}

describe('AgentScheduler×Simulation 自主建造链(S2-A 集成)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autonomy.enable(CHAR_ID);
  });
  afterEach(() => {
    autonomy.disable(CHAR_ID);
    innerState.clear(CHAR_ID);
    vi.useRealTimers();
  });

  it('采→存→建跨块闭环:缺料先伐木入仓,足料后选址施工至完工落地', () => {
    const timeScaleBackup = BALANCE.CONSTRUCTION_TIME_SCALE;
    BALANCE.CONSTRUCTION_TIME_SCALE = 0.05; // 工单时长快照 360→18 分,压缩测试时间线
    const r = rig({ storage: { wood: 8, stone: 6 } }); // 缺 2 木=恰好一次伐木
    const coinsBefore = r.sim.characters.get(CHAR_ID)!.coins;
    const expectedRect = suggestBuildRect(
      r.sim.baseDefinition,
      r.sim.built,
      getBuildBlueprint('build_cafe')!,
    );
    expect(expectedRect).not.toBeNull();
    try {
      innerState.setIntents(CHAR_ID, {
        day: r.sim.clock.day,
        source: 'llm',
        wants: MORNING_WANTS.map((w) => ({ ...w })), // want 对象会被调度器就地结算,须按用例深拷贝
      });

      // 第一段:建造缺料不进池,伐木 want 胜出→去树邻位接工单
      pumpUntil(r, () => r.events.some((e) => e.type === 'work_task.accepted'));
      expect(r.intents[0]).toMatchObject({ type: 'move_to' });

      // 伐木完成直入单仓(S2-C N1,不经背包零 store_item)→足料→建造 want 重入
      pumpUntil(r, () => (r.sim.storage.wood ?? 0) >= 10);
      expect(r.sim.characters.get(CHAR_ID)!.backpack.wood ?? 0).toBe(0);

      // 足料→选址开工→施工→完工落地(N1 后无存仓两段式:全程零 store_item 意图)
      pumpUntil(r, () => r.events.some((e) => e.type === 'construction.placed'));
      pumpUntil(r, () => r.events.some((e) => e.type === 'construction.completed'));
      expect(r.intents.some((i) => i.type === 'store_item')).toBe(false);
      expect(r.bubbles.some((b) => b.includes('开工'))).toBe(true);

      const char = r.sim.characters.get(CHAR_ID)!;
      expect(r.sim.built.places).toHaveLength(1);
      expect(r.sim.built.places[0]).toMatchObject({
        x: expectedRect!.x,
        y: expectedRect!.y,
      });
      expect(r.sim.constructionSites.size).toBe(0);
      expect(r.sim.storage.wood).toBeUndefined(); // 恰好用尽(扣完清键)
      expect(r.sim.storage.stone).toBeUndefined();
      expect(char.activity).toBeNull();
      const completed = r.events.find((e) => e.type === 'construction.completed') as Extract<
        WorldEvent,
        { type: 'construction.completed' }
      >;
      expect(char.coins).toBe(coinsBefore + completed.pay); // 无缺觉系数按单入账
      expect(r.events.some((e) => e.type === 'world.map_changed')).toBe(true);
      const wants = innerState.get(CHAR_ID)?.intents?.wants ?? [];
      expect(wants.find((w) => w.id === 'w0-0')?.status).toBe('done'); // 建造收口
      expect(wants.find((w) => w.id === 'w0-1')?.status).toBe('done'); // 伐木收口
    } finally {
      BALANCE.CONSTRUCTION_TIME_SCALE = timeScaleBackup;
      r.scheduler.dispose();
    }
  }, 20_000);

  it('中断路径:施工中停止活动→材料退回单仓+工单撤销+want 回 pending', () => {
    const timeScaleBackup = BALANCE.CONSTRUCTION_TIME_SCALE;
    BALANCE.CONSTRUCTION_TIME_SCALE = 0.05;
    const r = rig({ storage: { wood: 10, stone: 6 } }); // 足料直建
    try {
      innerState.setIntents(CHAR_ID, {
        day: r.sim.clock.day,
        source: 'llm',
        wants: [{ ...MORNING_WANTS[0]! }],
      });

      pumpUntil(r, () => r.events.some((e) => e.type === 'construction.placed'));
      const char = r.sim.characters.get(CHAR_ID)!;
      expect(char.activity?.activityId).toBe('construction');
      expect(r.sim.storage.wood).toBeUndefined(); // 已扣料

      runIntent(r.sim, { type: 'stop_activity', characterId: CHAR_ID });

      expect(r.events.some((e) => e.type === 'construction.cancelled')).toBe(true);
      expect(r.sim.constructionSites.size).toBe(0);
      expect(r.sim.built.places).toHaveLength(0);
      expect(r.sim.storage.wood).toBe(10); // 按挂单快照足额退回
      expect(r.sim.storage.stone).toBe(6);
      expect(char.activity).toBeNull();
      expect(innerState.get(CHAR_ID)?.intents?.wants[0]?.status).toBe('pending');
    } finally {
      BALANCE.CONSTRUCTION_TIME_SCALE = timeScaleBackup;
      r.scheduler.dispose();
    }
  }, 20_000);

  it('growth 世界:建造 want 候选期废弃(蓝图未开放),零意图出执行口', () => {
    const r = rig({ gameType: 'growth', storage: { wood: 99, stone: 99 } });
    try {
      innerState.setIntents(CHAR_ID, {
        day: r.sim.clock.day,
        source: 'llm',
        wants: [{ ...MORNING_WANTS[0]! }],
      });

      pump(r, 2);

      expect(r.intents).toEqual([]);
      expect(innerState.get(CHAR_ID)?.intents?.wants[0]?.status).toBe('abandoned');
      expect(r.sim.built.places).toHaveLength(0);
    } finally {
      r.scheduler.dispose();
    }
  });
});
