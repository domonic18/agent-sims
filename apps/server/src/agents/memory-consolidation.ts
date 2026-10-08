import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { memories } from '../db/schema/memory.js';
import type { LlmMessage } from '../llm/types.js';
import { logTech } from '../telemetry.js';
import type { Simulation } from '../world/simulation.js';
import type { MemoryLlm, MemoryWriter } from './memory-writer.js';

/** 单夜入 prompt 的当日记忆上限(importance 降序截断,防长上下文) */
const SOURCE_LIMIT = 16;
/** 梦境条目上限(agent-design §4.5: 1~3 条) */
const DREAM_MAX = 3;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function clampImportance(score: number): number {
  return Math.min(10, Math.max(1, Math.round(score)));
}

function buildDreamMessages(
  name: string,
  rows: Array<{ content: string; importance: number }>,
): LlmMessage[] {
  return [
    {
      role: 'system',
      content: `你是小镇居民「${name}」沉睡的大脑。请把今天的经历压缩、拼接、变形为梦境片段:第一人称,如梦似幻;只能使用给定经历里的素材,不得编造未发生的事。`,
    },
    {
      role: 'user',
      content: [
        '今天的经历(方括号内为重要度):',
        rows.map((r) => `- [重要度 ${r.importance}] ${r.content}`).join('\n'),
        '要求: 把这些经历重放、变形为梦境记忆(可浓缩合并、可夸张怪诞,但素材只来自上文)。',
        `只输出 JSON 数组,格式: [{"content":"梦境片段","importance":1-10}],给我 1~${DREAM_MAX} 条。`,
      ].join('\n'),
    },
  ];
}

/** 慢槽输出→梦境草稿:截取首个 JSON 数组,逐条校验(文本非空/重要度钳 1~10),
 * 至多 DREAM_MAX 条;不可解析或全非法返回空数组(调用方静默跳过) */
export function parseDreams(
  raw: string,
  max = DREAM_MAX,
): Array<{ content: string; importance: number }> {
  const match = raw.match(/\[[\s\S]*\]/);
  if (match === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const dreams: Array<{ content: string; importance: number }> = [];
  for (const row of parsed) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.content !== 'string' || r.content.trim() === '') continue;
    if (typeof r.importance !== 'number' || !Number.isFinite(r.importance)) continue;
    dreams.push({ content: r.content.trim(), importance: clampImportance(r.importance) });
    if (dreams.length >= max) break;
  }
  return dreams;
}

/**
 * 梦境固化器(M5,agent-design §4.5):订阅 sleep.settled(睡饱,与缺觉互斥),
 * 慢槽把上一清醒日([结算点-1440, 结算点)且未固化)的记忆压缩变形为 1~3 条
 * dream 写回记忆流,并把源记忆打 consolidatedAt(字段预埋于 M4b,此处首个消费方)。
 * 离线照常:与 MemoryWriter 同挂 app 进程订阅总线,不依赖客户端连接。
 * 失败只落技术日志且源记忆不标记(次夜重试);dream 先落库后标记,
 * 标记失败最坏=次夜重复变形(非关键路径可接受)。
 */
export class MemoryConsolidator {
  private readonly inFlight = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly sim: Simulation,
    private readonly handle: DbHandle,
    private readonly llm: MemoryLlm,
    private readonly writer: Pick<MemoryWriter, 'writeManual'>,
  ) {
    this.unsubscribe = sim.events.subscribe((event) => {
      if (event.type !== 'sleep.settled') return;
      if (event.sleptMinutes < BALANCE.SLEEP_MIN_MINUTES) return; // 防御:发射侧已互斥
      if (this.inFlight.has(event.characterId)) return; // 同角色单飞,重复事件忽略
      this.inFlight.add(event.characterId);
      void this.consolidate(event.characterId, event.gameMinutes).finally(() => {
        this.inFlight.delete(event.characterId);
      });
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private async consolidate(characterId: string, settledAt: number): Promise<void> {
    try {
      const rows = await this.handle.db
        .select({ id: memories.id, content: memories.content, importance: memories.importance })
        .from(memories)
        .where(
          and(
            eq(memories.characterId, characterId),
            isNull(memories.consolidatedAt),
            gte(memories.gameMinutes, settledAt - BALANCE.DAY_MINUTES),
            lt(memories.gameMinutes, settledAt),
          ),
        )
        .orderBy(desc(memories.importance))
        .limit(SOURCE_LIMIT);
      if (rows.length === 0) return; // 当日无未固化记忆,该夜无梦

      const name = this.sim.characters.get(characterId)?.name ?? '无名居民';
      const result = await this.llm.chat('slow', buildDreamMessages(name, rows), {
        taskType: 'agent.dream',
        characterId,
      });
      const dreams = parseDreams(result.content);
      if (dreams.length === 0) {
        logTech('info', 'memory', '梦境输出无有效条目,本夜不产梦(源记忆留待次夜)', {
          characterId,
        });
        return;
      }
      for (const dream of dreams) {
        await this.writer.writeManual(characterId, dream.content, dream.importance, 'dream');
      }
      await this.handle.db
        .update(memories)
        .set({ consolidatedAt: new Date() })
        .where(inArray(memories.id, rows.map((r) => r.id)));
    } catch (err) {
      logTech('warn', 'memory', '梦境固化失败,源记忆留待次夜重试', {
        characterId,
        err: errMsg(err),
      });
    }
  }
}

/** app 装配入口(与 attachMemoryWriter 同款);返回实例便于测试观察与 dispose */
export function attachMemoryConsolidator(
  sim: Simulation,
  handle: DbHandle,
  llm: MemoryLlm,
  writer: Pick<MemoryWriter, 'writeManual'>,
): MemoryConsolidator {
  return new MemoryConsolidator(sim, handle, llm, writer);
}
