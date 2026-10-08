import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characterImpressions, memories } from '../db/schema/memory.js';
import type { LlmMessage } from '../llm/types.js';
import { logTech } from '../telemetry.js';
import type { Simulation } from '../world/simulation.js';
import type { MemoryLlm, MemoryWriter } from './memory-writer.js';

/** 单次入 prompt 的未固化记忆上限(importance 降序截断,防长上下文) */
const SOURCE_LIMIT = 16;
/** 梦境条目上限(agent-design §4.5: 1~3 条) */
const DREAM_MAX = 3;
/** 洞察条目上限(10-cognition §5: 0~3 条,认知主产物) */
const INSIGHT_MAX = 3;
/** 关系印象增量上限(对当日互动者) */
const RELATION_MAX = 3;
/** 单条洞察溯源链上限(10-cognition §4.1) */
const SOURCE_IDS_MAX = 8;

export interface DreamDraft {
  content: string;
  importance: number;
}

export interface InsightDraft {
  content: string;
  importance: number;
  sources: string[];
}

export interface RelationDraft {
  about: string;
  content: string;
}

export interface ConsolidationDraft {
  dreams: DreamDraft[];
  insights: InsightDraft[];
  relations: RelationDraft[];
}

interface SourceRow {
  id: string;
  content: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function clampImportance(score: number): number {
  return Math.min(10, Math.max(1, Math.round(score)));
}

/** 截取首个 JSON 对象块并解析;不可解析返回 null */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null) return null;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseEntries(value: unknown, max: number): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const row of value) {
    if (typeof row !== 'object' || row === null) continue;
    rows.push(row as Record<string, unknown>);
    if (rows.length >= max) break;
  }
  return rows;
}

/**
 * 慢槽输出→固化草稿(10-cognition §5): 逐段校验(文本非空/重要度钳 1~10/条数上限)。
 * insight 无 sources 或 sources 全空则丢弃(设计红线: 无 source 支持的认知不落库);
 * relation 的 about 不在互动者白名单内则丢弃(防编造关系)。
 * withDreams=false(白天反思)时忽略 dreams 段。
 */
export function parseConsolidation(
  raw: string,
  opts: { withDreams: boolean; partners: ReadonlySet<string> },
): ConsolidationDraft {
  const parsed = extractJsonObject(raw);
  if (parsed === null) return { dreams: [], insights: [], relations: [] };
  const dreams: DreamDraft[] = [];
  if (opts.withDreams) {
    for (const row of parseEntries(parsed.dreams, DREAM_MAX)) {
      if (typeof row.content !== 'string' || row.content.trim() === '') continue;
      if (typeof row.importance !== 'number' || !Number.isFinite(row.importance)) continue;
      dreams.push({ content: row.content.trim(), importance: clampImportance(row.importance) });
    }
  }
  const insights: InsightDraft[] = [];
  for (const row of parseEntries(parsed.insights, INSIGHT_MAX)) {
    if (typeof row.content !== 'string' || row.content.trim() === '') continue;
    if (typeof row.importance !== 'number' || !Number.isFinite(row.importance)) continue;
    if (!Array.isArray(row.sources)) continue;
    const sources = row.sources
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.trim());
    if (sources.length === 0) continue;
    insights.push({ content: row.content.trim(), importance: clampImportance(row.importance), sources });
  }
  const relations: RelationDraft[] = [];
  for (const row of parseEntries(parsed.relations, RELATION_MAX)) {
    if (typeof row.content !== 'string' || row.content.trim() === '') continue;
    if (typeof row.about !== 'string' || !opts.partners.has(row.about.trim())) continue;
    relations.push({ about: row.about.trim(), content: row.content.trim() });
  }
  return { dreams, insights, relations };
}

/** 溯源引用→情景记忆 id: 精确相等或双向包含(模型可能截取片段);去重,≤SOURCE_IDS_MAX */
export function resolveSourceIds(sources: string[], rows: SourceRow[]): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    const hit = rows.find(
      (row) => row.content === source || row.content.includes(source) || source.includes(row.content),
    );
    if (hit !== undefined) ids.add(hit.id);
    if (ids.size >= SOURCE_IDS_MAX) break;
  }
  return [...ids];
}

/** 互动者白名单: 源记忆正文里出现过的其他居民名(旁观感知补齐了听者视角,双方均可命中) */
export function extractPartners(
  rows: SourceRow[],
  selfId: string,
  characters: ReadonlyMap<string, { name: string }>,
): Map<string, string> {
  const partners = new Map<string, string>();
  for (const [id, character] of characters) {
    if (id === selfId) continue;
    if (rows.some((row) => row.content.includes(character.name))) {
      partners.set(character.name, id);
    }
  }
  return partners;
}

function buildConsolidationMessages(
  name: string,
  rows: Array<SourceRow & { importance: number }>,
  partners: ReadonlyMap<string, string>,
  withDreams: boolean,
): LlmMessage[] {
  const mode = withDreams ? '沉睡' : '走神';
  const dreamReq = withDreams
    ? `\n- "dreams": 1~${DREAM_MAX} 条梦境片段(把今天重放、变形,可怪诞但素材只来自上文)`
    : '';
  return [
    {
      role: 'system',
      content: `你是小镇居民「${name}」${mode}的大脑。基于给定的真实经历做认知沉淀:第一人称;只能使用给定素材,不得编造未发生的事。`,
    },
    {
      role: 'user',
      content: [
        '今天的经历(方括号内为重要度):',
        rows.map((r) => `- [重要度 ${r.importance}] ${r.content}`).join('\n'),
        `今天接触过的人(只能从这个名单里选): ${[...partners.keys()].join('、') || '无'}`,
        '请输出一个 JSON 对象,字段:',
        dreamReq,
        `- "insights": 0~${INSIGHT_MAX} 条我总结出的认知(看法/教训/规律),每条给 "sources": 支持它的经历原文(从上文逐字截取,可截片段);没有足够支持的认知不要写`,
        `- "relations": 0~${RELATION_MAX} 条对名单里的人的印象(是什么样的人、发生过什么、值不值得信任),about 填人名`,
        '只输出 JSON,不要解释。',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    },
  ];
}

/**
 * 认知固化器 v2(10-cognition §5,睡眠=爬梯工厂):订阅 sleep.settled(睡饱),
 * 慢思考一次调用把上一清醒日未固化记忆转化为 dreams(氛围副产品)+insights(语义认知,
 * 带 source_ids 溯源)+relations(关系印象增量,impressions 定点覆盖),全部成功才把
 * 源记忆打 consolidatedAt(失败静默,次夜重试)。白天反思(§5 补线):importance 累计
 * 越阈触发同一管线(去 dream 段),大事件不必等到夜里才沉淀。固化产物写入即标记,
 * 不再进源记忆池(单向爬梯)。离线照常:订阅总线不依赖客户端连接。
 */
export class MemoryConsolidator {
  private readonly inFlight = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly sim: Simulation,
    private readonly handle: DbHandle,
    private readonly llm: MemoryLlm,
    private readonly writer: Pick<MemoryWriter, 'writeManual' | 'setReflectionHook'>,
  ) {
    this.unsubscribe = sim.events.subscribe((event) => {
      if (event.type !== 'sleep.settled') return;
      if (event.sleptMinutes < BALANCE.SLEEP_MIN_MINUTES) return; // 防御:发射侧已互斥
      if (this.inFlight.has(event.characterId)) return; // 同角色单飞,重复事件忽略
      this.consolidateAsync(event.characterId, { settledAt: event.gameMinutes, withDreams: true });
    });
    writer.setReflectionHook((characterId) => {
      if (this.inFlight.has(characterId)) return;
      this.consolidateAsync(characterId, { withDreams: false });
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private consolidateAsync(
    characterId: string,
    opts: { settledAt?: number; withDreams: boolean },
  ): void {
    this.inFlight.add(characterId);
    void this.consolidate(characterId, opts).finally(() => {
      this.inFlight.delete(characterId);
    });
  }

  /** 白天反思入口(importance 累计越阈触发;去 dream 段,窗口=全部未固化记忆) */
  reflect(characterId: string): void {
    if (this.inFlight.has(characterId)) return;
    this.consolidateAsync(characterId, { withDreams: false });
  }

  private async consolidate(
    characterId: string,
    opts: { settledAt?: number; withDreams: boolean },
  ): Promise<void> {
    try {
      const windowFilter =
        opts.settledAt !== undefined
          ? and(
              gte(memories.gameMinutes, opts.settledAt - BALANCE.DAY_MINUTES),
              lt(memories.gameMinutes, opts.settledAt),
            )
          : undefined;
      const rows = await this.handle.db
        .select({
          id: memories.id,
          content: memories.content,
          importance: memories.importance,
        })
        .from(memories)
        .where(
          and(
            eq(memories.characterId, characterId),
            isNull(memories.consolidatedAt),
            windowFilter,
          ),
        )
        .orderBy(desc(memories.importance))
        .limit(SOURCE_LIMIT);
      if (rows.length === 0) return; // 无未固化记忆,本轮无事可沉淀

      const name = this.sim.characters.get(characterId)?.name ?? '无名居民';
      const partners = extractPartners(rows, characterId, this.sim.characters);
      const result = await this.llm.chat(
        'slow',
        buildConsolidationMessages(name, rows, partners, opts.withDreams),
        {
          taskType: opts.withDreams ? 'agent.dream' : 'agent.reflect',
          characterId,
        },
      );
      const draft = parseConsolidation(result.content, {
        withDreams: opts.withDreams,
        partners: new Set(partners.keys()),
      });
      const total = draft.dreams.length + draft.insights.length + draft.relations.length;
      if (total === 0) {
        logTech('info', 'memory', '固化输出无有效条目,源记忆留待下次(次夜/再反思)', {
          characterId,
        });
        return;
      }
      for (const dream of draft.dreams) {
        await this.writer.writeManual(characterId, dream.content, dream.importance, 'dream', {
          consolidated: true,
        });
      }
      for (const insight of draft.insights) {
        const sourceIds = resolveSourceIds(insight.sources, rows);
        if (sourceIds.length === 0) continue; // 无 source 支持的认知丢弃(设计红线)
        await this.writer.writeManual(characterId, insight.content, insight.importance, 'insight', {
          sourceIds,
          consolidated: true,
        });
      }
      for (const relation of draft.relations) {
        const aboutId = partners.get(relation.about);
        if (aboutId === undefined) continue;
        await this.handle.db
          .insert(characterImpressions)
          .values({
            characterId,
            aboutId,
            content: relation.content,
            gameMinutes: this.sim.clock.gameMinutes,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [characterImpressions.characterId, characterImpressions.aboutId],
            set: {
              content: relation.content,
              gameMinutes: this.sim.clock.gameMinutes,
              updatedAt: new Date(),
            },
          });
      }
      await this.handle.db
        .update(memories)
        .set({ consolidatedAt: new Date() })
        .where(inArray(memories.id, rows.map((r) => r.id)));
    } catch (err) {
      logTech('warn', 'memory', '认知固化失败,源记忆留待下次重试', {
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
  writer: MemoryWriter,
): MemoryConsolidator {
  return new MemoryConsolidator(sim, handle, llm, writer);
}
