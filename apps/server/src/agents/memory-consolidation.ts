import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characterImpressions, memories } from '../db/schema/memory.js';
import type { LlmMessage, StructuredParse, StructuredToolSpec } from '../llm/types.js';
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

/** 重要度统一四舍五入钳 1~10 */
const importanceScore = z
  .number()
  .finite()
  .transform((n) => Math.min(10, Math.max(1, Math.round(n))));

/** 条目列表: 缺失/非数组视为空,逐条校验坏条目丢弃(非整组失败),留前 max 条有效。
 * 第三泛型固定 unknown: transform 型 schema 的 Input≠Output,不放开会把输入侧类型推成 T */
function entryList<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, max: number) {
  return z
    .unknown()
    .transform((v) => (Array.isArray(v) ? v : []))
    .transform((rows) => {
      const out: T[] = [];
      for (const row of rows) {
        const parsed = schema.safeParse(row);
        if (parsed.success) out.push(parsed.data);
        if (out.length >= max) break;
      }
      return out;
    });
}

const dreamEntry = z.object({
  content: z.string().trim().min(1),
  importance: importanceScore,
});

const insightEntry = z.object({
  content: z.string().trim().min(1),
  importance: importanceScore,
  sources: z
    .array(z.unknown())
    .transform((items): string[] =>
      items
        .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        .map((s) => s.trim()),
    )
    .refine((list) => list.length > 0, 'sources 为空'),
});

const relationEntry = z.object({
  about: z.string().trim().min(1),
  content: z.string().trim().min(1),
});

const draftSchema = z.object({
  dreams: entryList(dreamEntry, DREAM_MAX),
  insights: entryList(insightEntry, INSIGHT_MAX),
  relations: entryList(relationEntry, RELATION_MAX),
});

/** 认知沉淀工具规格(结构化输出):provider 层 schema 约束字段名,格式契约不再写在 prompt 里祈祷 */
function consolidationTool(withDreams: boolean): StructuredToolSpec {
  const integer = { type: 'integer', minimum: 1, maximum: 10 };
  return {
    name: 'submit_consolidation',
    description: '提交认知沉淀结果(梦境/洞察/关系印象)',
    inputSchema: {
      type: 'object',
      required: withDreams ? ['dreams', 'insights', 'relations'] : ['insights', 'relations'],
      properties: {
        ...(withDreams
          ? {
              dreams: {
                type: 'array',
                maxItems: DREAM_MAX,
                items: {
                  type: 'object',
                  required: ['content', 'importance'],
                  properties: { content: { type: 'string' }, importance: integer },
                },
              },
            }
          : {}),
        insights: {
          type: 'array',
          maxItems: INSIGHT_MAX,
          items: {
            type: 'object',
            required: ['content', 'importance', 'sources'],
            properties: {
              content: { type: 'string' },
              importance: integer,
              sources: { type: 'array', items: { type: 'string' }, minItems: 1 },
            },
          },
        },
        relations: {
          type: 'array',
          maxItems: RELATION_MAX,
          items: {
            type: 'object',
            required: ['about', 'content'],
            properties: { about: { type: 'string' }, content: { type: 'string' } },
          },
        },
      },
    },
  };
}

/**
 * 工具入参→固化草稿(10-cognition §5): zod 逐条校验(文本非空/重要度钳 1~10/条数上限),
 * 坏条目丢弃不整组否决。insight 无 sources 或 sources 全空则丢弃(设计红线: 无 source
 * 支持的认知不落库);relation 的 about 不在互动者白名单内则丢弃(防编造关系)。
 * withDreams=false(白天反思)时忽略 dreams 段。整体非对象返回 fail(触发带错重试一次)。
 */
export function parseConsolidation(
  input: unknown,
  opts: { withDreams: boolean; partners: ReadonlySet<string> },
): StructuredParse<ConsolidationDraft> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(';') };
  }
  return {
    ok: true,
    value: {
      dreams: opts.withDreams ? parsed.data.dreams : [],
      insights: parsed.data.insights,
      relations: parsed.data.relations
        .filter((r) => opts.partners.has(r.about))
        .slice(0, RELATION_MAX),
    },
  };
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
    ? `- dreams: 1~${DREAM_MAX} 条梦境片段(把今天重放、变形,可怪诞但素材只来自上文)`
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
        `今天接触过的人(印象只能写给这个名单里的人): ${[...partners.keys()].join('、') || '无'}`,
        '请调用 submit_consolidation 工具提交认知沉淀:',
        dreamReq,
        `- insights: 0~${INSIGHT_MAX} 条我总结出的认知(看法/教训/规律);sources 填支持该认知的经历原文,从上文逐字截取(可截片段);没有足够支持的认知不要写`,
        `- relations: 0~${RELATION_MAX} 条对名单里的人的印象(是什么样的人、发生过什么、值不值得信任)`,
        '只通过工具提交,不要输出其他内容。',
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
      const draft = await this.llm.chatStructured(
        'slow',
        buildConsolidationMessages(name, rows, partners, opts.withDreams),
        consolidationTool(opts.withDreams),
        { taskType: opts.withDreams ? 'agent.dream' : 'agent.reflect', characterId },
        (raw) =>
          parseConsolidation(raw, {
            withDreams: opts.withDreams,
            partners: new Set(partners.keys()),
          }),
      );
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
