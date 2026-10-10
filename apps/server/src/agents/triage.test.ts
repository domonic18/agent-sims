import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { PERCEPTION_RADIUS } from './perception.js';
import { isTriagedEvent, triageEvent, type ResponseAction, type ResponseResolver, type TriageContext } from './triage.js';

const ME = 'me-1';
const OTHER = 'other-1';

function ctx(overrides: Partial<TriageContext> = {}): TriageContext {
  return {
    characterId: ME,
    x: 30,
    y: 30,
    alive: true,
    collapsed: false,
    activityId: null,
    onPath: false,
    positionOf: (id) => (id === OTHER ? { x: 32, y: 30 } : null),
    isAcquaintance: () => false,
    nameOf: (id) => (id === OTHER ? '苏晚' : '某居民'),
    budget: { day: -1, assessedToday: 0, lastAssessAt: Number.NEGATIVE_INFINITY, assessedKeys: new Set() },
    nowGameMinutes: 480,
    gameDay: 0,
    ...overrides,
  };
}

const diedNear = (tick = 480): WorldEvent =>
  ({ type: 'character.died', characterId: OTHER, tick, revivable: true }) as WorldEvent;

const chatSelf = (tick = 480): WorldEvent =>
  ({ type: 'social.chat', fromId: ME, toId: OTHER, tick, content: '你好', affinityDelta: 0 }) as WorldEvent;

const goLook: ResponseAction = {
  kind: 'move',
  label: '过去看看苏晚',
  semantic: '苏晚倒下了,情况危急',
  subjectId: OTHER,
  want: { activityId: 'rescue', targetCharacterId: OTHER, urgency: 0.85 },
};

const instant: ResponseAction = {
  kind: 'instant',
  label: '感谢相救',
  semantic: '我刚被救醒',
  want: { activityId: 'socialize', targetCharacterId: OTHER, urgency: 0.9 },
};

const resolveAlways = (action: ResponseAction): ResponseResolver => () => action;

/** 忙碌漫步(died near 强度 8):过了①②④,直达容忍度/预算各闸 */
const busyStrollDied = (overrides: Partial<TriageContext> = {}) =>
  triageEvent(diedNear(), ctx({ activityId: 'stroll', ...overrides }), resolveAlways(goLook));

describe('isTriagedEvent(管理面事件零惊动)', () => {
  it('控制/参数/规则/配方/重置/托管/睡眠结算不进分级,叙事事件进', () => {
    for (const type of [
      'world.control',
      'world.params',
      'world.rules',
      'world.recipes',
      'world.reset',
      'character.hosting_changed',
      'sleep.settled',
    ] as const) {
      expect(isTriagedEvent({ type, tick: 1 } as WorldEvent)).toBe(false);
    }
    expect(isTriagedEvent(diedNear())).toBe(true);
    expect(isTriagedEvent(chatSelf())).toBe(true);
  });
});

describe('triageEvent 四关分级(10-cognition §7.1)', () => {
  it('①相关性门: 远处陌生人事件忽略;感知半径内 near 放行;near 零强度=环境噪音', () => {
    const far = triageEvent(
      diedNear(),
      ctx({ positionOf: () => ({ x: 100, y: 100 }) }),
      resolveAlways(goLook),
    );
    expect(far.disposition).toBe('ignore');
    expect(far.gate).toBe('g1_irrelevant');
    const near = triageEvent(
      diedNear(),
      ctx({ positionOf: () => ({ x: 30 + PERCEPTION_RADIUS, y: 30 }) }),
      resolveAlways(goLook),
    );
    expect(near.relevance).toBe('near');
    expect(near.importance).toBe(8);
    const noise = triageEvent(
      { type: 'activity.started', characterId: OTHER, activityId: 'stroll', tick: 1 } as WorldEvent,
      ctx({ positionOf: () => ({ x: 31, y: 30 }) }),
      resolveAlways(goLook),
    );
    expect(noise.disposition).toBe('ignore');
    expect(noise.gate).toBe('g1_irrelevant');
  });

  it('①熟人通道: 非同处一地的熟人事件按 near 取强度', () => {
    const verdict = triageEvent(
      diedNear(),
      ctx({ isAcquaintance: (id) => id === OTHER }),
      resolveAlways(goLook),
    );
    expect(verdict.relevance).toBe('near');
    expect(verdict.importance).toBe(8);
  });

  it('②强度门: 空闲低强度放行既有管线(idle),忙碌低强度忽略(g2)', () => {
    const idle = triageEvent(chatSelf(), ctx(), resolveAlways(goLook));
    expect(idle.disposition).toBe('idle');
    expect(idle.gate).toBe('pass_idle');
    const busy = triageEvent(
      chatSelf(),
      ctx({ activityId: 'stroll' }),
      resolveAlways(goLook),
    );
    expect(busy.disposition).toBe('ignore');
    expect(busy.gate).toBe('g2_low_strength');
  });

  it('①失能先于强度: 我倒下(alive=false)时自身死亡事件忽略', () => {
    const verdict = triageEvent(
      { type: 'character.died', characterId: ME, tick: 1, revivable: true } as WorldEvent,
      ctx({ alive: false }),
      resolveAlways(goLook),
    );
    expect(verdict.gate).toBe('g1_incapacitated');
  });

  it('④注册表直执: 空闲 move 响应 respond(pass_idle_respond),instant 忙碌也不打断(pass_instant)', () => {
    const idleMove = triageEvent(diedNear(), ctx(), resolveAlways(goLook));
    expect(idleMove.disposition).toBe('respond');
    expect(idleMove.gate).toBe('pass_idle_respond');
    const busyInstant = triageEvent(
      diedNear(),
      ctx({ activityId: 'stroll' }),
      resolveAlways(instant),
    );
    expect(busyInstant.disposition).toBe('respond');
    expect(busyInstant.gate).toBe('pass_instant');
  });

  it('④无动作兜底: 高强度事件注册表无响应→g4_no_action 忽略', () => {
    const verdict = triageEvent(diedNear(), ctx({ activityId: 'stroll' }), () => null);
    expect(verdict.disposition).toBe('ignore');
    expect(verdict.gate).toBe('g4_no_action');
  });

  it('③容忍度矩阵: sleep(none)一律 defer;study(low)强度≥8 才评估;stroll(缺省 high)≥6 即评估', () => {
    const sleeping = triageEvent(
      diedNear(),
      ctx({ activityId: 'sleep' }),
      resolveAlways(goLook),
    );
    expect(sleeping.disposition).toBe('defer');
    expect(sleeping.gate).toBe('g3_uninterruptible');
    const studyingStrong = busyStrollDied({ activityId: 'study' }); // died near 强度 8,恰达 DECISIVE
    expect(studyingStrong.disposition).toBe('assess');
    expect(studyingStrong.gate).toBe('pass_assess');
    const strolling = busyStrollDied();
    expect(strolling.disposition).toBe('assess');
    expect(strolling.gate).toBe('pass_assess');
  });

  it('③low 容忍度边界: 强度 7(自身复活)defer,强度 8(倒下 near)评估', () => {
    const revivedSelf = triageEvent(
      { type: 'character.revived', characterId: ME, tick: 1 } as WorldEvent,
      ctx({ activityId: 'study' }),
      resolveAlways(goLook),
    );
    expect(revivedSelf.gate).toBe('g3_strong_only');
    const diedNearStudy = busyStrollDied({ activityId: 'study' });
    expect(diedNearStudy.importance).toBe(8);
    expect(diedNearStudy.gate).toBe('pass_assess');
  });

  it('⑤预算三闸: 去重先于冷却,冷却先于日预算;全新预算直通评估', () => {
    const deduped = busyStrollDied({
      budget: { day: 0, assessedToday: 1, lastAssessAt: Number.NEGATIVE_INFINITY, assessedKeys: new Set(['character.died:other-1:480:near']) },
    });
    expect(deduped.gate).toBe('g5_dedup');
    const cooled = busyStrollDied({
      budget: { day: 0, assessedToday: 1, lastAssessAt: 470, assessedKeys: new Set() },
    });
    expect(cooled.gate).toBe('g5_cooldown');
    const exhausted = busyStrollDied({
      budget: { day: 0, assessedToday: 4, lastAssessAt: Number.NEGATIVE_INFINITY, assessedKeys: new Set() },
    });
    expect(exhausted.gate).toBe('g5_budget');
    const fresh = busyStrollDied({
      budget: { day: 0, assessedToday: 1, lastAssessAt: 400, assessedKeys: new Set() },
    });
    expect(fresh.disposition).toBe('assess');
    expect(fresh.gate).toBe('pass_assess');
  });

  it('⑤预算跨日复位: 非当日快照(day≠gameDay)视为零消耗,冷却与日预算不生效', () => {
    const yesterday = busyStrollDied({
      budget: { day: 0, assessedToday: 4, lastAssessAt: 100, assessedKeys: new Set() },
      nowGameMinutes: 1920,
      gameDay: 1,
    });
    expect(yesterday.disposition).toBe('assess');
  });

  it('eventKey 唯一键: type+主体+tick+视角,同事件同人重复评估可去重', () => {
    const first = busyStrollDied();
    const second = busyStrollDied({
      budget: { day: 0, assessedToday: 1, lastAssessAt: Number.NEGATIVE_INFINITY, assessedKeys: new Set([first.eventKey]) },
    });
    expect(first.eventKey).toBe('character.died:other-1:480:near');
    expect(second.gate).toBe('g5_dedup');
  });
});
