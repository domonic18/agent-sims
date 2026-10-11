import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SocialEncounterEvent } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { autonomy, innerState, type Want } from './cognition.js';
import { SocialLoop, type SocialLoopDeps } from './social-loop.js';
import type { TraceRecorder } from './trace.js';
import { Simulation } from '../world/simulation.js';

const rng = (): number => 0.5;

/** 假 DB 句柄:链式调用即弃(写穿 fire-and-forget,catch 兜底) */
const fakeHandle = {
  db: {
    insert: () => fakeChain,
    update: () => fakeChain,
  },
  client: {},
} as unknown as DbHandle;
const fakeChain = {
  values: () => fakeChain,
  set: () => fakeChain,
  where: () => fakeChain,
  catch: () => Promise.resolve(),
};

/** 扫描内置地图:水平连续 ≥min 格可行走段,返回段起点 */
function straightRun(sim: Simulation, min = 7): { x: number; y: number } {
  for (let y = 0; y < sim.map.height; y += 1) {
    let run = 0;
    for (let x = 0; x < sim.map.width; x += 1) {
      run = sim.map.isWalkable(x, y) ? run + 1 : 0;
      if (run >= min) return { x: x - min + 1, y };
    }
  }
  throw new Error('地图上不存在足够长的水平可行走段');
}

interface Harness {
  sim: Simulation;
  loop: SocialLoop;
  executeWants: ReturnType<typeof vi.fn>;
  traceCalls: Array<{ characterId: string; entry: { decision: { conclusion: string; intent?: string } } }>;
  /** 直线段起点(甲乙出生/移动基准) */
  at: { x: number; y: number };
}

/** 相遇实验场:甲(x0) 与 乙(x0+6) 同在一条直线段上,双方均注册自治 */
function harness(): Harness {
  const sim = new Simulation(rng);
  const at = straightRun(sim);
  sim.spawnCharacter('aaaa1111', at.x, at.y, '甲');
  sim.spawnCharacter('bbbb2222', at.x + 6, at.y, '乙');
  autonomy.enable('aaaa1111');
  autonomy.enable('bbbb2222');
  const traceCalls: Array<{ characterId: string; entry: { decision: { conclusion: string; intent?: string } } }> = [];
  const trace = { record: (characterId: string, _m: number, entry: never) => traceCalls.push({ characterId, entry }) };
  const executeWants = vi.fn();
  const loop = new SocialLoop({
    sim,
    handle: fakeHandle,
    llm: {} as SocialLoopDeps['llm'],
    trace: trace as unknown as TraceRecorder,
    apply: vi.fn(),
    executeWants,
  });
  return { sim, loop, executeWants, traceCalls, at };
}

function socializeWant(targetId: string, createdAtMin: number): Want {
  return {
    id: `w-${targetId}`,
    activityId: 'socialize',
    origin: 'drive',
    targetCharacterId: targetId,
    why: '想找对方聊聊',
    urgency: 0.5,
    status: 'pending',
    createdAtMin,
  };
}

function encounter(aId: string, bId: string): SocialEncounterEvent {
  return { type: 'social.encounter', aId, bId, tick: 1, x: 0, y: 0 };
}

afterEach(() => {
  for (const id of ['aaaa1111', 'bbbb2222']) {
    autonomy.disable(id);
    innerState.clear(id);
  }
});

describe('路上相遇消化(E8 意愿分流)', () => {
  it('双方无社交意愿=擦肩而过:不停步、不点火、零 trace', () => {
    const { sim, loop, executeWants, traceCalls, at } = harness();
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.requestMoveTo('bbbb2222', at.x, at.y);
    loop.onEncounter(encounter('aaaa1111', 'bbbb2222'));
    expect(sim.character('aaaa1111').path.length).toBeGreaterThan(0);
    expect(sim.character('bbbb2222').path.length).toBeGreaterThan(0);
    expect(executeWants).not.toHaveBeenCalled();
    expect(traceCalls).toHaveLength(0);
  });

  it('单向意愿:双方停步进会合,发起方=有愿方,对方收到应答 event want', () => {
    const { sim, loop, executeWants, traceCalls, at } = harness();
    const day = sim.clock.day;
    const now = sim.clock.gameMinutes;
    innerState.setIntents('aaaa1111', {
      day,
      source: 'llm',
      wants: [socializeWant('bbbb2222', now)],
    });
    innerState.setIntents('bbbb2222', { day, source: 'llm', wants: [] });
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.requestMoveTo('bbbb2222', at.x, at.y);
    loop.onEncounter(encounter('aaaa1111', 'bbbb2222'));
    // 停步:见面停下来说话
    expect(sim.character('aaaa1111').path).toHaveLength(0);
    expect(sim.character('bbbb2222').path).toHaveLength(0);
    // 会合台账建立,发起方=甲
    expect(loop.summonAwaiting('aaaa1111', 'bbbb2222')).toBe(true);
    expect(loop.summonAwaiting('bbbb2222', 'aaaa1111')).toBe(false);
    // 乙收到应答 want(origin=event),乙被即时重评
    const wants = innerState.get('bbbb2222')!.intents!.wants;
    const reply = wants.find((w) => w.origin === 'event' && w.targetCharacterId === 'aaaa1111');
    expect(reply).toBeDefined();
    expect(executeWants).toHaveBeenCalledWith(sim.character('bbbb2222'), 'eventbus');
    // trace 留痕:react 决策记在发起方
    expect(traceCalls.some((c) => c.characterId === 'aaaa1111' && c.entry.decision.conclusion === 'react')).toBe(true);
  });

  it('双向意愿:双方都想聊,发起方=id 字典序小者(仲裁只定协议角色)', () => {
    const { sim, loop, executeWants, at } = harness();
    const day = sim.clock.day;
    const now = sim.clock.gameMinutes;
    innerState.setIntents('aaaa1111', {
      day,
      source: 'llm',
      wants: [socializeWant('bbbb2222', now)],
    });
    innerState.setIntents('bbbb2222', {
      day,
      source: 'llm',
      wants: [socializeWant('aaaa1111', now)],
    });
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.requestMoveTo('bbbb2222', at.x, at.y);
    loop.onEncounter(encounter('bbbb2222', 'aaaa1111'));
    expect(sim.character('aaaa1111').path).toHaveLength(0);
    expect(sim.character('bbbb2222').path).toHaveLength(0);
    // 甲字典序小 → 发起方;乙不再重复写念头(已有在途社交 want)
    expect(loop.summonAwaiting('aaaa1111', 'bbbb2222')).toBe(true);
    const wants = innerState.get('bbbb2222')!.intents!.wants;
    expect(wants.filter((w) => w.origin === 'event')).toHaveLength(0);
    expect(executeWants).toHaveBeenCalledTimes(1);
  });

  it('不可打断活动(睡觉):相遇不打扰,双方各走各路', () => {
    const { sim, loop, executeWants, at } = harness();
    const day = sim.clock.day;
    innerState.setIntents('aaaa1111', {
      day,
      source: 'llm',
      wants: [socializeWant('bbbb2222', sim.clock.gameMinutes)],
    });
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.requestMoveTo('bbbb2222', at.x, at.y);
    // 先摆路径再入睡:移动请求会打断进行中活动,顺序反了睡觉就被清了
    sim.character('bbbb2222').activity = {
      activityId: 'sleep',
      elapsed: 10,
      anchorKind: 'bed',
      targetId: null,
    };
    loop.onEncounter(encounter('aaaa1111', 'bbbb2222'));
    expect(sim.character('aaaa1111').path.length).toBeGreaterThan(0);
    expect(sim.character('bbbb2222').path.length).toBeGreaterThan(0);
    expect(executeWants).not.toHaveBeenCalled();
  });

  it('非自治角色:不消化', () => {
    const { sim, loop, executeWants, at } = harness();
    const day = sim.clock.day;
    innerState.setIntents('aaaa1111', {
      day,
      source: 'llm',
      wants: [socializeWant('bbbb2222', sim.clock.gameMinutes)],
    });
    autonomy.disable('bbbb2222');
    sim.requestMoveTo('aaaa1111', at.x + 6, at.y);
    sim.requestMoveTo('bbbb2222', at.x, at.y);
    loop.onEncounter(encounter('aaaa1111', 'bbbb2222'));
    expect(sim.character('aaaa1111').path.length).toBeGreaterThan(0);
    expect(executeWants).not.toHaveBeenCalled();
  });

  it('会合窗口内重复相遇不重入:台账已开,不重复召唤', () => {
    const { sim, loop, executeWants } = harness();
    const day = sim.clock.day;
    const now = sim.clock.gameMinutes;
    innerState.setIntents('aaaa1111', {
      day,
      source: 'llm',
      wants: [socializeWant('bbbb2222', now)],
    });
    innerState.setIntents('bbbb2222', { day, source: 'llm', wants: [] });
    loop.onEncounter(encounter('aaaa1111', 'bbbb2222'));
    expect(executeWants).toHaveBeenCalledTimes(1);
    // 同拍世界层再报一次(冷却外的理论边界):会合已开,不重复
    loop.onEncounter(encounter('aaaa1111', 'bbbb2222'));
    expect(executeWants).toHaveBeenCalledTimes(1);
    expect(innerState.get('bbbb2222')!.intents!.wants.filter((w) => w.origin === 'event')).toHaveLength(1);
  });
});
