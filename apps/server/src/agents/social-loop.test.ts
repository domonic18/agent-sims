import { afterEach, describe, expect, it } from 'vitest';
import type { WorldEvent } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { relationKey } from '../world/social.js';
import { Simulation } from '../world/simulation.js';
import { innerState } from './cognition.js';
import { SocialLoop } from './social-loop.js';
import type { MemoryLlm } from './memory-writer.js';

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
    executeWants: () => {},
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

/** 关系布景:甲→乙 familiarity 30/affinity 50(基础欲望 0.8 必过点火线) */
function relate(sim: Simulation, aId: string, bId: string): void {
  sim.socials.set(relationKey(aId, bId), {
    fromId: aId,
    toId: bId,
    familiarity: 30,
    affinity: 50,
    chatDay: 0,
    chatCount: 0,
    formedNotified: true,
  });
}

function captureLoop(
  sim: Simulation,
  handle: DbHandle,
  llm: Partial<MemoryLlm> = {},
): { loop: SocialLoop; applied: Array<{ intent: { type: string } & Record<string, unknown>; bubble?: string }>; traces: Array<Record<string, unknown>> } {
  const applied: Array<{ intent: { type: string } & Record<string, unknown>; bubble?: string }> = [];
  const traces: Array<Record<string, unknown>> = [];
  const loop = new SocialLoop({
    sim,
    handle,
    llm: {
      systemOne: () => Promise.reject(new Error('unused')),
      embed: () => Promise.reject(new Error('unused')),
      chat: llm.chat ?? (() => Promise.reject(new Error('no light'))),
      chatStructured:
        llm.chatStructured ??
        (() => Promise.reject(new Error('no structured'))),
    } as MemoryLlm,
    trace: {
      record: (_id: string, _min: number, entry: unknown) =>
        traces.push(entry as Record<string, unknown>),
    } as never,
    apply: (_char, decision, _trigger, perception) => {
      applied.push(decision as never);
      traces.push({ perception });
    },
    executeWants: () => {}, // 调度泵即时择条在单测中不接(fast-layer 测试覆盖)
  });
  return { loop, applied, traces };
}

/** 内心状态写穿桩:update 链直接兑现(不真写库) */
function persistHandle(): DbHandle {
  return {
    db: {
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
  } as unknown as DbHandle;
}

/** 空结果桩:印象/共同记忆均为空(generateConversation 上下文走无印象分支) */
function emptyHandle(): DbHandle {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
  } as unknown as DbHandle;
}

/** 挡门桩:所有 DB 查询挂在 gate 上,release 后放行(控制 generateConversation 期间的世界变化) */
function gatedHandle(): { handle: DbHandle; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = () => ({
    from: () => ({
      where: () => ({
        limit: () => gate.then(() => [] as never[]),
        orderBy: () => ({ limit: () => gate.then(() => [] as never[]) }),
      }),
    }),
  });
  return {
    handle: {
      db: {
        select: () => chain(),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      },
    } as unknown as DbHandle,
    release,
  };
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('SocialLoop.idleSocialStep E6(动机点火写 want/走散不罚/即时印象)', () => {
  afterEach(() => {
    innerState.clear('a');
    innerState.clear('b');
  });

  it('动机点火(E6): 过线候选写 socialize want(origin=drive),不再直执聊天/走近', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 10, '甲'); // 同在 home-a(x3-14/y4-11)内,相距 3 格
    sim.spawnCharacter('b', 5, 10, '乙');
    relate(sim, 'a', 'b');
    const { loop, applied } = captureLoop(sim, persistHandle());
    innerState.setIntents('a', { day: sim.clock.day, source: 'llm', wants: [] });

    const candidates = loop.idleSocialStep(sim.character('a'), 'threshold');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.samePlace).toBe(true);
    expect(applied).toHaveLength(0); // 执行归 wantSelect 唯一执行器,动机只写 want
    const want = innerState.get('a')!.intents!.wants[0]!;
    expect(want).toMatchObject({
      activityId: 'socialize',
      origin: 'drive',
      targetCharacterId: 'b',
      urgency: candidates[0]!.desire > 1 ? 1 : Math.round(candidates[0]!.desire * 100) / 100,
      status: 'pending',
    });
    expect(want.why).toContain('乙');
    expect(loop.lastChatAtBetween('a', 'b')).toBe(Number.NEGATIVE_INFINITY); // 聊天落地才算主动
  });

  it('同目标在途 want 去重:动机重复点火不重复写', () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 10, '甲');
    sim.spawnCharacter('b', 5, 10, '乙');
    relate(sim, 'a', 'b');
    const { loop } = captureLoop(sim, persistHandle());
    innerState.setIntents('a', {
      day: sim.clock.day,
      source: 'llm',
      wants: [
        { id: 'd0', activityId: 'socialize', origin: 'drive', targetCharacterId: 'b', why: '想找乙聊聊', urgency: 0.8, status: 'pending', createdAtMin: 0 },
      ],
    });

    loop.idleSocialStep(sim.character('a'), 'threshold');
    expect(innerState.get('a')!.intents!.wants).toHaveLength(1); // 未追加
  });

  it('走散降级: 生成期间对方被拽走→trace walkedAway+冷却短窗+计数返还+want 回 pending,期满重试成功', async () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲');
    const b = sim.spawnCharacter('b', 9, 12, '乙');
    relate(sim, 'a', 'b');
    const { handle, release } = gatedHandle();
    const { loop, applied, traces } = captureLoop(sim, handle);
    innerState.setIntents('a', {
      day: sim.clock.day,
      source: 'llm',
      wants: [
        { id: 'w0', activityId: 'socialize', origin: 'plan', targetCharacterId: 'b', why: '找乙聊聊', urgency: 0.9, status: 'doing', createdAtMin: 0 },
      ],
    });

    void loop.executeChatWant(sim.character('a'), 'b', 'w0', 'threshold');
    const bookedAt = loop.lastChatAtBetween('a', 'b');
    expect(bookedAt).toBe(sim.clock.gameMinutes); // 簿记先于 await(防双发)

    b.x = 40;
    b.y = 40; // 生成期间走散
    release();
    await flush();
    expect(traces.some((t) => (t.perception as { walkedAway?: boolean }).walkedAway)).toBe(true);
    expect(loop.lastChatAtBetween('a', 'b')).toBe(
      bookedAt - (BALANCE.SOCIAL_PAIR_COOLDOWN_MINUTES - BALANCE.SOCIAL_RETRY_COOLDOWN_MINUTES),
    );
    expect(innerState.get('a')!.intents!.wants[0]!.status).toBe('pending'); // 回 pending 评分可再裁决

    // 期满+对方回来:短窗过后重试成功,聊天落地
    sim.advanceTicks(BALANCE.SOCIAL_RETRY_COOLDOWN_MINUTES);
    b.x = 9;
    b.y = 12;
    innerState.get('a')!.intents!.wants[0]!.status = 'doing';
    await loop.executeChatWant(sim.character('a'), 'b', 'w0', 'threshold');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.intent.type).toBe('chat');
    expect(applied[0]!.intent.targetId).toBe('b');
  });

  it('生成在途护栏: 同对重入不双烧模型(trace chatBusy),在途生成照常收口', async () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲');
    sim.spawnCharacter('b', 9, 12, '乙');
    relate(sim, 'a', 'b');
    const { handle, release } = gatedHandle();
    const { loop, applied, traces } = captureLoop(sim, handle);
    innerState.setIntents('a', { day: sim.clock.day, source: 'llm', wants: [] });

    const first = loop.executeChatWant(sim.character('a'), 'b', null, 'threshold'); // 挂在生成上
    await flush(); // 首次调用进入生成窗口
    await loop.executeChatWant(sim.character('a'), 'b', null, 'threshold'); // 重入:立即返回
    expect(applied).toHaveLength(0); // 重入不落地
    expect(traces.some((t) => (t.perception as { chatBusy?: boolean }).chatBusy === true)).toBe(true);

    release();
    await first;
    await flush();
    expect(applied).toHaveLength(1); // 在途生成照常落地
    expect(applied[0]!.intent.type).toBe('chat');
  });

  it('聊后即时印象: 无印象建浅印象;已有印象只刷新时刻不动文案', async () => {
    const build = (existing: Array<{ content: string }>) => {
      const sim = new Simulation();
      sim.spawnCharacter('a', 8, 12, '甲');
      sim.spawnCharacter('b', 9, 12, '乙');
      relate(sim, 'a', 'b');
      const upserts: Array<{ values: Record<string, unknown>; conflict: unknown }> = [];
      const handle = {
        db: {
          select: () => ({
            from: () => ({ where: () => ({ limit: () => Promise.resolve(existing) }) }),
          }),
          update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
          insert: () => ({
            values: (values: Record<string, unknown>) => ({
              onConflictDoUpdate: (conflict: unknown) => {
                upserts.push({ values, conflict });
                return Promise.resolve();
              },
            }),
          }),
        },
      } as unknown as DbHandle;
      const { loop, applied } = captureLoop(sim, handle);
      return { sim, loop, applied, upserts };
    };

    // 无印象:规则拼接浅印象(零 LLM)
    const fresh = build([]);
    await fresh.loop.executeChatWant(fresh.sim.character('a'), 'b', null, 'threshold');
    expect(fresh.applied.map((d) => d.intent.type)).toEqual(['chat']);
    expect(fresh.upserts).toHaveLength(1);
    expect(String(fresh.upserts[0]!.values.content)).toContain('今天和乙聊了几句');

    // 已有印象:文案保持,仅刷新
    const known = build([{ content: '老朋友,靠得住' }]);
    await known.loop.executeChatWant(known.sim.character('a'), 'b', null, 'threshold');
    expect(known.upserts).toHaveLength(1);
    expect(known.upserts[0]!.values.content).toBe('老朋友,靠得住');
  });
});

describe('SocialLoop.executeChatWant E3(自然终止多轮/聚会邀约)', () => {
  afterEach(() => {
    innerState.clear('a');
    innerState.clear('b');
  });

  it('多轮生成 lines 落 chat 意图:单轮终止补模板保底双句,trace 记 llm', async () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲');
    sim.spawnCharacter('b', 9, 12, '乙');
    relate(sim, 'a', 'b');
    const { loop, applied, traces } = captureLoop(sim, emptyHandle(), {
      chatStructured: (_slot, _messages, _tool, _task, parse) => {
        const parsed = parse({ line: '去公园坐坐?', wantsMore: false });
        if (!parsed.ok) return Promise.reject(new Error('桩: 校验失败'));
        return Promise.resolve(parsed.value);
      },
    });
    await loop.executeChatWant(sim.character('a'), 'b', null, 'threshold');
    expect(applied[0]!.intent.type).toBe('chat');
    const lines = applied[0]!.intent.lines as string[];
    expect(lines[0]).toBe('去公园坐坐?'); // 发起者先说
    expect(lines).toHaveLength(2); // 终止后听者句回落模板保底
    expect(lines[1]).toBeTruthy();
    expect(traces.some((t) => (t.perception as { llm?: boolean }).llm === true)).toBe(true);
  });

  it('发起方邀约:双方脑内各记 pendingInvitation(withId 互换)', async () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲');
    sim.spawnCharacter('b', 9, 12, '乙');
    relate(sim, 'a', 'b');
    const { loop, applied } = captureLoop(sim, emptyHandle(), {
      chatStructured: (_slot, _messages, _tool, _task, parse) => {
        const parsed = parse({
          line: '改天去公园晒太阳?',
          wantsMore: false,
          invitation: { placeId: 'park', note: '天气好想出门' },
        });
        if (!parsed.ok) return Promise.reject(new Error('桩: 校验失败'));
        return Promise.resolve(parsed.value);
      },
    });
    await loop.executeChatWant(sim.character('a'), 'b', null, 'threshold');
    expect(applied).toHaveLength(1);
    expect(innerState.get('a')!.pendingInvitation).toEqual({
      placeId: 'park',
      note: '天气好想出门',
      withId: 'b',
      day: sim.clock.day,
    });
    expect(innerState.get('b')!.pendingInvitation).toMatchObject({ withId: 'a' });
  });

  it('无邀约不写脑内;多轮续聊按 wantsMore 走(AB 交替由 dialogue 桩模拟)', async () => {
    const sim = new Simulation();
    sim.spawnCharacter('a', 8, 12, '甲');
    sim.spawnCharacter('b', 9, 12, '乙');
    relate(sim, 'a', 'b');
    let call = 0;
    const { loop, applied } = captureLoop(sim, emptyHandle(), {
      chatStructured: (_slot, _messages, _tool, _task, parse) => {
        call += 1;
        const parsed = parse(
          call === 1
            ? { line: '早啊', wantsMore: true }
            : { line: '早,吃了吗', wantsMore: false },
        );
        if (!parsed.ok) return Promise.reject(new Error('桩: 校验失败'));
        return Promise.resolve(parsed.value);
      },
    });
    await loop.executeChatWant(sim.character('a'), 'b', null, 'threshold');
    expect(call).toBe(2);
    expect(applied[0]!.intent.lines).toEqual(['早啊', '早,吃了吗']);
    expect(innerState.get('a')?.pendingInvitation ?? null).toBeNull();
    expect(innerState.get('b')?.pendingInvitation ?? null).toBeNull();
  });
});
