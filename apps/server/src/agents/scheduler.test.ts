import { TOWN_MAP } from '@sims/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { autonomy } from './cognition.js';
import type { DbHandle } from '../db/client.js';
import type { runIntent } from '../intents/execute.js';
import type { Simulation } from '../world/simulation.js';
import type { WorldCharacter } from '../world/character.js';
import type { AgentDecisionMessage } from '@sims/shared';
import type { MemoryLlm } from './memory-writer.js';
import { AgentScheduler, AUTONOMY_CHECK_INTERVAL_MINUTES, JEV_COOLDOWN_MINUTES } from './scheduler.js';

const CHAR_ID = 'char-1';

function char(overrides: Partial<WorldCharacter>): WorldCharacter {
  return {
    id: CHAR_ID,
    name: '阿测',
    x: 30,
    y: 30,
    path: [],
    energy: 80,
    health: 100,
    coins: 50,
    activity: null,
    housing: null,
    alive: true,
    collapsed: false,
    backpack: {},
    fridge: {},
    score: 0,
    knowledge: 0,
    sleepWindowMinutes: 0,
    sleepDebtEndGameMinutes: null,
    traits: {},
    ...overrides,
  } as WorldCharacter;
}

interface Harness {
  scheduler: AgentScheduler;
  clock: { gameMinutes: number };
  onEvent: (event: WorldEvent) => void;
  intents: Array<Record<string, unknown>>;
  bubbles: AgentDecisionMessage[];
  traceRows: Array<Record<string, unknown>>;
  jevCalls: number;
}

function harness(startGameMinutes: number, worldChar: WorldCharacter, llm?: Partial<MemoryLlm>): Harness {
  const clock = { gameMinutes: startGameMinutes };
  let eventHandler: ((event: WorldEvent) => void) | null = null;
  const sim = {
    clock,
    map: { definition: TOWN_MAP },
    characters: new Map([[worldChar.id, worldChar]]),
    events: {
      subscribe: (fn: (event: WorldEvent) => void) => {
        eventHandler = fn;
        return () => {
          eventHandler = null;
        };
      },
    },
  } as unknown as Simulation;
  const intents: Array<Record<string, unknown>> = [];
  const runIntentStub = ((simArg: unknown, intent: Record<string, unknown>) => {
    intents.push(intent);
    void simArg;
    return { ok: true, message: 'ok' };
  }) as typeof runIntent;
  const bubbles: AgentDecisionMessage[] = [];
  const traceRows: Array<Record<string, unknown>> = [];
  const handle = {
    db: {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          traceRows.push(v);
          return Promise.resolve();
        },
      }),
    },
  } as unknown as DbHandle;
  let jevCalls = 0;
  const llmStub: MemoryLlm = {
    systemOne: () => {
      jevCalls += 1;
      if (llm?.systemOne === undefined) return Promise.reject(new Error('no jev'));
      return llm.systemOne('jev', '', {}, { taskType: 'agent.jev_micro' });
    },
    embed: () => Promise.reject(new Error('unused')),
    chat: () => Promise.reject(new Error('unused')),
  };
  const scheduler = new AgentScheduler({
    sim,
    handle,
    llm: llmStub,
    onBubble: (m) => bubbles.push(m),
    runIntent: runIntentStub,
  });
  return {
    scheduler,
    clock,
    onEvent: (event) => eventHandler?.(event),
    intents,
    bubbles,
    traceRows,
    get jevCalls() {
      return jevCalls;
    },
  };
}

describe('AgentScheduler(M4c 认知泵)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autonomy.enable(CHAR_ID);
  });
  afterEach(() => {
    autonomy.disable(CHAR_ID);
    vi.useRealTimers();
  });

  it('阈值巡检: 饥饿角色 rule react 吃背包食物,气泡+trace 落库', () => {
    const h = harness(0, char({ energy: 20, backpack: { apple: 1 } }));
    vi.advanceTimersByTime(2_000);
    expect(h.intents).toEqual([{ type: 'eat_item', characterId: CHAR_ID, itemId: 'apple' }]);
    expect(h.bubbles).toHaveLength(1);
    expect(h.bubbles[0]!.text).toContain('苹果');
    const react = h.traceRows.find((r) => r.decision !== null && (r.decision as { conclusion?: string }).conclusion === 'react');
    expect(react).toBeDefined();
    expect(react!.triggerType).toBe('threshold');
    expect(react!.characterId).toBe(CHAR_ID);
    h.scheduler.dispose();
  });

  it('同一 15 分块只巡检一次;continue 采样每 20 次记 1 条 trace', () => {
    const h = harness(0, char({}));
    for (let i = 0; i < 25; i += 1) {
      h.clock.gameMinutes += AUTONOMY_CHECK_INTERVAL_MINUTES;
      vi.advanceTimersByTime(2_000);
    }
    expect(h.intents).toHaveLength(0); // 数值健康全程 continue
    expect(h.jevCalls).toBe(0); // 巡检路径不触发 jev
    expect(h.traceRows).toHaveLength(1); // 25 次 continue 采样 1 条
    expect((h.traceRows[0]!.decision as { conclusion: string }).conclusion).toBe('continue');
    h.scheduler.dispose();
  });

  it('事件驱动: rule react 直接落地不进 jev', () => {
    const h = harness(0, char({ energy: 20, backpack: { apple: 1 } }));
    h.onEvent({ type: 'world.reset', tick: 1 } as WorldEvent);
    expect(h.intents).toEqual([{ type: 'eat_item', characterId: CHAR_ID, itemId: 'apple' }]);
    expect(h.jevCalls).toBe(0);
    const react = h.traceRows.find((r) => (r.decision as { conclusion?: string }).conclusion === 'react');
    expect(react!.triggerType).toBe('eventbus');
    h.scheduler.dispose();
  });

  it('jev 微决策: rule 未命中时选候选去公园;30 分冷却内不重复调用', async () => {
    const park = TOWN_MAP.places.find((p) => p.id === 'park')!;
    const llm: Partial<MemoryLlm> = {
      systemOne: () =>
        Promise.resolve({
          model: 'stub',
          answers: { next: { type: 'choice', choice: '公园', probabilities: {}, confidence: 1 } },
        }) as never,
    };
    const h = harness(0, char({}), llm);
    h.onEvent({ type: 'world.reset', tick: 1 } as WorldEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(1);
    expect(h.intents).toEqual([
      { type: 'move_to', characterId: CHAR_ID, x: park.entrance.x, y: park.entrance.y },
    ]);
    expect(h.bubbles[0]!.text).toContain('公园');
    // 冷却内再来事件:静默(不再调 jev、不再产意图)
    h.clock.gameMinutes += JEV_COOLDOWN_MINUTES - 1;
    h.onEvent({ type: 'world.reset', tick: 2 } as WorldEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.jevCalls).toBe(1);
    expect(h.intents).toHaveLength(1);
    h.scheduler.dispose();
  });

  it('jev 槽不可用: 回落 continue 并记一条 jev trace,不产意图不阻塞', async () => {
    const h = harness(0, char({}));
    h.onEvent({ type: 'world.reset', tick: 1 } as WorldEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.intents).toHaveLength(0);
    expect(h.jevCalls).toBe(1);
    const jevTrace = h.traceRows.find((r) => (r.decision as { layer?: string }).layer === 'jev');
    expect(jevTrace).toBeDefined();
    expect((jevTrace!.decision as { conclusion: string }).conclusion).toBe('continue');
    h.scheduler.dispose();
  });

  it('非自治角色不进泵;dispose 后停摆', () => {
    autonomy.disable(CHAR_ID);
    const h = harness(0, char({ energy: 20, backpack: { apple: 1 } }));
    vi.advanceTimersByTime(4_000);
    h.onEvent({ type: 'world.reset', tick: 1 } as WorldEvent);
    expect(h.intents).toHaveLength(0);
    autonomy.enable(CHAR_ID);
    h.scheduler.dispose();
    h.onEvent({ type: 'world.reset', tick: 2 } as WorldEvent);
    vi.advanceTimersByTime(4_000);
    expect(h.intents).toHaveLength(0);
  });
});
