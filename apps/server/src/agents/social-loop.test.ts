import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { relationKey } from '../world/social.js';
import { Simulation } from '../world/simulation.js';
import { SocialLoop } from './social-loop.js';

const flat = (value: number) => ({
  ambition: value,
  hedonism: value,
  homebody: value,
  sociability: value,
  frugality: value,
});

function loopWith(sim: Simulation, events: WorldEvent[] = []): SocialLoop {
  sim.events.subscribe((event) => events.push(event));
  return new SocialLoop({
    sim,
    handle: {} as never,
    llm: {} as never,
    trace: { record: () => {} } as never,
    apply: () => {},
  });
}

/** 15 游戏分一步( acquaintanceStep 的调度拍),共处满阈值需 8 拍 */
function step(loop: SocialLoop, times = 1): void {
  for (let i = 0; i < times; i += 1) loop.acquaintanceStep();
}

describe('SocialLoop.acquaintanceStep 共处破冰(D1)', () => {
  it('同点共处攒满阈值自动相识,发 first.met;攒不满不认识', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲', flat(0.5));
    sim.spawnCharacter('b', 8, 12, '乙', flat(0.5));
    sim.spawnCharacter('c', 13, 15, '丙', flat(0.5));
    const events: WorldEvent[] = [];
    const loop = loopWith(sim, events);

    step(loop, 7); // 105 分钟,差一步
    expect(sim.socials.size).toBe(0);
    step(loop); // 120 分钟达阈值
    expect(sim.socials.get(relationKey('a', 'b'))?.familiarity).toBe(
      BALANCE.ACQUAINTANCE_FAMILIARITY,
    );
    const met = events.filter((event) => event.type === 'first.met');
    expect(met).toHaveLength(1);
    expect(met[0]).toMatchObject({ aId: 'a', bId: 'b' });
    expect(sim.socials.has(relationKey('a', 'c'))).toBe(false); // 远处不相识
  });

  it('已有关系记录的对(聊过天)不再累计共处,不重发 first.met', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲', flat(0.5));
    sim.spawnCharacter('b', 8, 12, '乙', flat(0.5));
    sim.socials.set(relationKey('a', 'b'), {
      fromId: 'a',
      toId: 'b',
      familiarity: 30,
      affinity: 10,
      chatDay: 0,
      chatCount: 0,
      formedNotified: false,
    });
    const events: WorldEvent[] = [];
    const loop = loopWith(sim, events);

    step(loop, 10);
    expect(events.filter((event) => event.type === 'first.met')).toHaveLength(0);
  });

  it('每日建交上限 ACQUAINTANCE_DAILY_CAP:同拍多对达标只建上限对,次日恢复', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲', flat(0.5));
    sim.spawnCharacter('b', 8, 12, '乙', flat(0.5));
    sim.spawnCharacter('c', 8, 12, '丙', flat(0.5));
    sim.spawnCharacter('d', 8, 12, '丁', flat(0.5));
    const events: WorldEvent[] = [];
    const loop = loopWith(sim, events);

    step(loop, 8); // 全体 6 对同时达标
    expect(events.filter((event) => event.type === 'first.met')).toHaveLength(
      BALANCE.ACQUAINTANCE_DAILY_CAP,
    );
    step(loop, 8); // 同日再满一对:上限仍在,不新建
    expect(events.filter((event) => event.type === 'first.met')).toHaveLength(
      BALANCE.ACQUAINTANCE_DAILY_CAP,
    );
  });

  it('幽灵态与虚脱角色不参与共处累计', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲', flat(0.5));
    sim.spawnCharacter('b', 8, 12, '乙', flat(0.5));
    sim.character('b').alive = false;
    const events: WorldEvent[] = [];
    const loop = loopWith(sim, events);

    step(loop, 12);
    expect(sim.socials.size).toBe(0);
    expect(events.filter((event) => event.type === 'first.met')).toHaveLength(0);
  });
});
