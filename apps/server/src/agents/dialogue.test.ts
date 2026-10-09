import { describe, expect, it } from 'vitest';
import type { DbHandle } from '../db/client.js';
import { BALANCE } from '../config/balance.js';
import type { WorldCharacter } from '../world/character.js';
import { generateConversation, parseTurn, type DialogueSession, type DialogueTurn } from './dialogue.js';
import type { MemoryLlm } from './memory-writer.js';

function person(id: string, name: string): WorldCharacter {
  return {
    id,
    name,
    x: 8,
    y: 12,
    traits: { ambition: 0.5, hedonism: 0.5, homebody: 0.5, sociability: 0.5, frugality: 0.5 },
  } as WorldCharacter;
}

const relation = { familiarity: 40, affinity: 60 };

/** 定点查询桩:印象/共同记忆均为空(prompt 走无印象分支) */
function dbHandle(): DbHandle {
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
    },
  } as unknown as DbHandle;
}

interface ScriptedTurn {
  line: string;
  wantsMore: boolean;
  invitation?: DialogueTurn['invitation'];
  /** 台词落地后的副作用(模拟生成期间对方被拽走) */
  move?: { who: 'a' | 'b'; x: number; y: number };
}

/** 依序播放台词脚本:记录每轮发起者(经 task.characterId),越界/标 fail 即抛错 */
function scriptedLlm(
  turns: Array<ScriptedTurn | { fail: true }>,
): { llm: MemoryLlm; speakers: string[] } {
  const speakers: string[] = [];
  const llm = {
    systemOne: () => Promise.reject(new Error('unused')),
    embed: () => Promise.reject(new Error('unused')),
    chat: () => Promise.reject(new Error('unused')),
    chatStructured: (
      _slot: unknown,
      _messages: unknown,
      _tool: unknown,
      task: { characterId?: string | null },
      parse: (raw: unknown) => { ok: true; value: DialogueTurn } | { ok: false; reason: string },
    ) => {
      const step = turns[speakers.length];
      speakers.push(task.characterId ?? '');
      if (step === undefined || 'fail' in step) {
        return Promise.reject(new Error('桩: 本轮失败'));
      }
      if (step.move !== undefined) {
        const moved = step.move.who === 'a' ? from : to;
        moved.x = step.move.x;
        moved.y = step.move.y;
      }
      const parsed = parse({
        line: step.line,
        wantsMore: step.wantsMore,
        ...(step.invitation !== undefined ? { invitation: step.invitation } : {}),
      });
      if (!parsed.ok) return Promise.reject(new Error(`桩: 校验失败 ${parsed.reason}`));
      return Promise.resolve(parsed.value);
    },
  } as unknown as MemoryLlm;
  return { llm, speakers };
}

const from = person('a', '甲');
const to = person('b', '乙');

function converse(llm: MemoryLlm): Promise<DialogueSession | null> {
  return generateConversation(llm, dbHandle(), from, to, relation);
}

describe('generateConversation 自然终止多轮(E3)', () => {
  it('终止信号收束: A 开场想聊 B 不想→两句收束,发起者先说', async () => {
    const { llm, speakers } = scriptedLlm([
      { line: '早啊,吃了吗', wantsMore: true },
      { line: '吃了,你呢', wantsMore: false },
    ]);
    const session = await converse(llm);
    expect(session).not.toBeNull();
    expect(session!.lines).toEqual(['早啊,吃了吗', '吃了,你呢']);
    expect(session!.invitation).toBeNull();
    expect(speakers).toEqual(['a', 'b']); // 奇数轮发起者/偶数轮对方
  });

  it('双方都想聊则顶到 CHAT_MAX_ROUNDS 硬上限', async () => {
    const turn: ScriptedTurn = { line: '聊', wantsMore: true };
    const { llm, speakers } = scriptedLlm(Array.from({ length: 8 }, () => ({ ...turn })));
    const session = await converse(llm);
    expect(session!.lines).toHaveLength(BALANCE.CHAT_MAX_ROUNDS);
    expect(speakers).toEqual(['a', 'b', 'a', 'b']);
  });

  it('邀约: 发起方台词顺带 invitation 被采纳;听者轮的邀约被忽略', async () => {
    const { llm } = scriptedLlm([
      { line: '改天去公园坐坐?', wantsMore: false, invitation: { placeId: 'park', note: '天气好想晒太阳' } },
      { line: '好啊', wantsMore: false, invitation: { placeId: 'gym', note: '不该出现' } },
    ]);
    const session = await converse(llm);
    expect(session!.invitation).toEqual({ placeId: 'park', note: '天气好想晒太阳' });
  });

  it('轮间复查距离: 生成期间对方被拽走→以已生成句收束(不丢句不续轮)', async () => {
    const { llm, speakers } = scriptedLlm([
      { line: '嗨', wantsMore: true, move: { who: 'b', x: 40, y: 40 } },
      { line: '不该发生', wantsMore: false },
    ]);
    const session = await converse(llm);
    expect(session!.lines).toEqual(['嗨']);
    expect(speakers).toEqual(['a']); // 走散即收束,听者轮不烧调用
  });

  it('中途失败保句: 已生成句照发,失败轮起回落(调用方补模板)', async () => {
    const { llm } = scriptedLlm([
      { line: '第一句', wantsMore: true },
      { fail: true },
    ]);
    const session = await converse(llm);
    expect(session!.lines).toEqual(['第一句']);
  });

  it('上下文加载失败→整场 null(调用方整体回落模板池)', async () => {
    const broken = {
      db: {
        select: () => {
          throw new Error('db down');
        },
      },
    } as unknown as DbHandle;
    const { llm } = scriptedLlm([{ line: '嗨', wantsMore: false }]);
    const session = await generateConversation(llm, broken, from, to, relation);
    expect(session).toBeNull();
  });
});

describe('parseTurn 台词轮解析', () => {
  it('合法台词+终止信号;邀约字段不全视为无邀约', () => {
    const plain = parseTurn({ line: '「你好呀」', wantsMore: true });
    expect(plain).toMatchObject({ ok: true, value: { line: '你好呀', wantsMore: true, invitation: null } });
    const partial = parseTurn({ line: '你好', wantsMore: false, invitation: { placeId: 'park' } });
    expect(partial).toMatchObject({ ok: true, value: { invitation: null } });
    const full = parseTurn({ line: '走?', wantsMore: false, invitation: { placeId: ' park ', note: '晒太阳' } });
    expect(full).toMatchObject({ ok: true, value: { invitation: { placeId: 'park', note: '晒太阳' } } });
  });

  it('line 缺失/空白/整体非对象判失败(触发带错重试)', () => {
    expect(parseTurn({ wantsMore: true }).ok).toBe(false);
    expect(parseTurn({ line: '   ', wantsMore: true }).ok).toBe(false);
    expect(parseTurn('聊天').ok).toBe(false);
  });
});
