import { and, desc, eq, gte } from 'drizzle-orm';
import type { NarrativeDraft, NarrativeHistoryEntry, SelfNarrative } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characters } from '../db/schema/agent.js';
import { characterImpressions, memories } from '../db/schema/memory.js';
import type { LlmMessage } from '../llm/types.js';
import { logTech } from '../telemetry.js';
import type { Simulation } from '../world/simulation.js';
import type { MemoryLlm, MemoryWriter } from './memory-writer.js';

/**
 * 自我叙事演化器(10-cognition §4.3/§6,C5,L4 人格本体): 订阅事件总线,
 * 周级(每 7 游戏日,以 settled/debt 每日恰一事件为锚)与里程碑(首次获救/
 * 首次结交/缺觉惩罚满 3 次)先到先修订。慢思考读「当前叙事+近 7 日 insights+
 * 重要关系印象」产出修订版(第一人称 ≤200 字+特质微调),旧版入演化史环形
 * 10 版,并写一条「我对自己的看法变了」insight 记忆——演化本身可审计。
 * 未初始化时以人设卡 bio 建 version 1(不烧模型);防漂移双闸=prompt 微调
 * 明令+版本链留档。
 */

/** 周级修订间隔: 7 游戏日 */
const EVOLVE_INTERVAL_MINUTES = 7 * BALANCE.DAY_MINUTES;
/** 演化史环形保留版本数 */
const HISTORY_MAX = 10;
/** 修订素材上限 */
const INSIGHT_LIMIT = 6;
const RELATION_LIMIT = 5;
/** 修订素材窗口: 近 7 日 insights */
const INSIGHT_WINDOW_MINUTES = 7 * BALANCE.DAY_MINUTES;
/** 叙事文本/特质/变化说明上限 */
export const NARRATIVE_TEXT_MAX = 200;
const TRAIT_MAX = 6;
const TRAIT_LENGTH_MAX = 20;
const CHANGE_MAX = 100;

/** 缺觉惩罚里程碑阈值 */
const SLEEP_DEBT_MILESTONE = 3;

/** 里程碑键→「我对自己的看法变了」变化说明素材 */
const MILESTONE_LABELS: Record<string, string> = {
  first_rescued: '我第一次倒下被人救了回来,原来镇上有人在意我',
  first_friend: '我交到了第一个朋友',
  sleep_debt_3: '我接连缺觉垮了三次,得把睡觉当回事了',
};

/** characters.persona jsonb 的 C5 相关键(浅合并,不碰 bio/card/traits/modelSlot) */
interface PersonaBlob {
  bio?: unknown;
  card?: unknown;
  selfNarrative?: unknown;
  narrativeHistory?: unknown;
  milestones?: unknown;
  sleepDebtCount?: unknown;
}

function readBlob(raw: unknown): PersonaBlob {
  return typeof raw === 'object' && raw !== null ? (raw as PersonaBlob) : {};
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 慢槽修订输出→叙事草稿: text 必须有效(无效返回 null 整次放弃,次轮重试);
 * traits 白名单截断;change 无效用兜底文案(避免永远失败循环) */
export function parseNarrativeDraft(
  raw: string,
): (NarrativeDraft & { change: string }) | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (typeof value.text !== 'string' || value.text.trim() === '') return null;
  const traits = Array.isArray(value.traits)
    ? value.traits
        .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        .map((t) => t.trim().slice(0, TRAIT_LENGTH_MAX))
        .slice(0, TRAIT_MAX)
    : [];
  const change =
    typeof value.change === 'string' && value.change.trim() !== ''
      ? value.change.trim().slice(0, CHANGE_MAX)
      : '我对自己的看法有些更新';
  return { text: value.text.trim().slice(0, NARRATIVE_TEXT_MAX), traits, change };
}

/** 修订 prompt(慢槽): 防漂移明令+素材白名单,10-cognition §6 */
export function buildEvolveMessages(
  name: string,
  current: SelfNarrative,
  insights: string[],
  relations: string[],
): LlmMessage[] {
  return [
    {
      role: 'system',
      content: `你是小镇居民「${name}」的内心。你在复盘「我是谁」——只允许基于给定的近期认知微调自我描述,不得推翻既有核心特质,不得编造未发生的事。只输出 JSON,不要解释。`,
    },
    {
      role: 'user',
      content: [
        `你目前的自我叙事(v${current.version}): ${current.text}`,
        `你现有的自我特质词: ${current.traits.length > 0 ? current.traits.join('、') : '无'}`,
        '你近期的认知(第一人称洞察):',
        insights.length > 0 ? insights.map((s) => `- ${s}`).join('\n') : '- (暂无)',
        '你对别人的印象:',
        relations.length > 0 ? relations.map((s) => `- ${s}`).join('\n') : '- (暂无)',
        '请输出一个 JSON 对象,字段:',
        `- "text": 修订后的自我叙事,第一人称,≤${NARRATIVE_TEXT_MAX} 字,只许依据上述认知微调`,
        `- "traits": 3~${TRAIT_MAX} 个核心特质词(可在原有基础上微调)`,
        '- "change": 一句话说明这次看法哪里变了',
        '只输出 JSON,不要解释。',
      ].join('\n'),
    },
  ];
}

/** 初始叙事生成 prompt(light 槽): 从人设卡提炼第一人称叙事,替代已退役访谈的职责 */
export function buildInitMessages(
  name: string,
  bio: string,
  card: Record<string, unknown>,
): LlmMessage[] {
  const field = (key: string): string =>
    typeof card[key] === 'string' && (card[key] as string).trim() !== ''
      ? (card[key] as string).trim()
      : '';
  return [
    {
      role: 'system',
      content: `你是小镇居民「${name}」的内心。基于你的人设卡,用第一人称写一段「我是谁」的自我叙事。只输出 JSON,不要解释。`,
    },
    {
      role: 'user',
      content: [
        `小传: ${bio !== '' ? bio : '(无)'}`,
        `性格: ${field('性格') || '(未设定)'}`,
        `兴趣: ${field('兴趣') || '(未设定)'}`,
        `目标: ${field('目标') || '(未设定)'}`,
        `说话风格: ${field('说话风格') || '(未设定)'}`,
        '请输出一个 JSON 对象,字段:',
        `- "text": 你的自我叙事,第一人称,≤${NARRATIVE_TEXT_MAX} 字,贴合人设与说话风格,具体、接地气`,
        `- "traits": 3~${TRAIT_MAX} 个核心特质词`,
        '只输出 JSON,不要解释。',
      ].join('\n'),
    },
  ];
}

/** 未初始化时的回落初始叙事(bio→人设卡拼接→兜底句),version 1,不烧模型 */
export function fallbackNarrative(blob: PersonaBlob, now: number): SelfNarrative {
  const bio = typeof blob.bio === 'string' && blob.bio.trim() !== '' ? blob.bio.trim() : '';
  let text = bio;
  if (text === '') {
    const card = typeof blob.card === 'object' && blob.card !== null ? (blob.card as Record<string, unknown>) : {};
    const parts = ['性格', '目标']
      .map((key) => (typeof card[key] === 'string' ? (card[key] as string).trim() : ''))
      .filter((s) => s !== '');
    text = parts.length > 0 ? `我是个${parts.join('、')}的人,刚来到这座小镇。` : '我刚来到这座小镇,日子还长。';
  }
  return { text: text.slice(0, NARRATIVE_TEXT_MAX), traits: [], version: 1, updatedAtGameMinutes: now };
}

/** 版本链写回: 旧版入史(环形 10),新版本 version+1;返回写回后的 persona。
 * 导出独立函数供 persona 人工修订路由复用(与 LLM 修订同款入链) */
export function applyRevision(
  blob: PersonaBlob,
  draft: { text: string; traits: string[] },
  now: number,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(blob as Record<string, unknown>) };
  const current = blob.selfNarrative as SelfNarrative | undefined;
  const previous: SelfNarrative =
    current !== undefined && typeof current.text === 'string'
      ? current
      : fallbackNarrative(blob, now);
  const history: NarrativeHistoryEntry[] = Array.isArray(blob.narrativeHistory)
    ? (blob.narrativeHistory as NarrativeHistoryEntry[]).filter(
        (entry) => entry !== null && typeof entry === 'object' && typeof entry.text === 'string',
      )
    : [];
  history.push({ ...previous, archivedAtGameMinutes: previous.updatedAtGameMinutes });
  const version = previous.version >= 1 ? previous.version + 1 : 2;
  merged.selfNarrative = {
    text: draft.text,
    traits: draft.traits,
    version,
    updatedAtGameMinutes: now,
  };
  merged.narrativeHistory = history.slice(-HISTORY_MAX);
  return merged;
}

/** 事件订阅共用入口:组装 Narrator 时注入 writer,测试可注入桩 */
export class Narrator {
  private readonly inFlight = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly sim: Simulation,
    private readonly handle: DbHandle,
    private readonly llm: MemoryLlm,
    private readonly writer: Pick<MemoryWriter, 'writeManual'>,
  ) {
    this.unsubscribe = sim.events.subscribe((event) => {
      switch (event.type) {
        case 'sleep.settled':
        case 'sleep.debt_applied': {
          // settled/debt 每日恰一互斥事件=周级检查锚点;debt 顺带累加计数判里程碑
          if (event.type === 'sleep.debt_applied') void this.bumpSleepDebt(event.characterId);
          this.evolveAsync(event.characterId, 'weekly');
          break;
        }
        case 'character.revived':
          this.hitMilestone(event.characterId, 'first_rescued');
          break;
        case 'friendship.formed':
          this.hitMilestone(event.aId, 'first_friend');
          this.hitMilestone(event.bId, 'first_friend');
          break;
        default:
          break;
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private evolveAsync(characterId: string, reason: string): void {
    if (this.inFlight.has(characterId)) return;
    this.inFlight.add(characterId);
    void this.evolve(characterId, reason).finally(() => {
      this.inFlight.delete(characterId);
    });
  }

  /** 管理员人工修订入口(persona PUT selfNarrative 走同款入链);返回最新 view 用不到,保持 void */
  async reviseManually(
    characterId: string,
    text: string,
    traits: string[],
  ): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      const rows = await tx
        .select({ persona: characters.persona })
        .from(characters)
        .where(eq(characters.id, characterId))
        .limit(1);
      const blob = readBlob(rows[0]?.persona);
      const now = this.sim.clock.gameMinutes;
      const next = applyRevision(blob, { text, traits }, now);
      await tx.update(characters).set({ persona: next }).where(eq(characters.id, characterId));
    });
  }

  private async loadPersona(characterId: string): Promise<PersonaBlob> {
    const rows = await this.handle.db
      .select({ persona: characters.persona })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return readBlob(rows[0]?.persona);
  }

  private async savePersona(characterId: string, persona: Record<string, unknown>): Promise<void> {
    await this.handle.db.update(characters).set({ persona }).where(eq(characters.id, characterId));
  }

  /** 缺觉计数+1,满阈值触发里程碑(RMW 一体,防计数丢失) */
  private async bumpSleepDebt(characterId: string): Promise<void> {
    try {
      const blob = await this.loadPersona(characterId);
      const count = typeof blob.sleepDebtCount === 'number' ? blob.sleepDebtCount + 1 : 1;
      const merged: Record<string, unknown> = { ...(blob as Record<string, unknown>), sleepDebtCount: count };
      await this.savePersona(characterId, merged);
      if (count >= SLEEP_DEBT_MILESTONE) await this.hitMilestone(characterId, 'sleep_debt_3');
    } catch (err) {
      logTech('warn', 'narrator', '缺觉计数失败', { characterId, err: errMsg(err) });
    }
  }

  /** 里程碑台账去重: 首次命中记账+立即修订(不受周级间隔限制,「二选一先到」) */
  private async hitMilestone(
    characterId: string,
    key: keyof typeof MILESTONE_LABELS,
  ): Promise<void> {
    if (this.inFlight.has(characterId)) return;
    try {
      const blob = await this.loadPersona(characterId);
      const milestones: string[] = Array.isArray(blob.milestones)
        ? (blob.milestones as unknown[]).filter((m): m is string => typeof m === 'string')
        : [];
      if (milestones.includes(key)) return;
      milestones.push(key);
      await this.savePersona(characterId, {
        ...(blob as Record<string, unknown>),
        milestones,
      });
      this.evolveAsync(characterId, `milestone:${key}`);
    } catch (err) {
      logTech('warn', 'narrator', '里程碑记账失败', { characterId, key, err: errMsg(err) });
    }
  }

  private async evolve(characterId: string, reason: string): Promise<void> {
    try {
      const now = this.sim.clock.gameMinutes;
      const blob = await this.loadPersona(characterId);

      // 未初始化: bio 回落建 version 1(不烧模型),留待下个周期修订
      if (typeof blob.selfNarrative !== 'object' || blob.selfNarrative === null) {
        await this.savePersona(characterId, {
          ...(blob as Record<string, unknown>),
          selfNarrative: fallbackNarrative(blob, now),
        });
        logTech('info', 'narrator', '自我叙事已初始化(bio 回落)', { characterId });
        return;
      }

      const current = blob.selfNarrative as SelfNarrative;
      // 周级检查: 未到期不修订(里程碑触发不走此闸——进线前已记账)
      if (reason === 'weekly' && now - current.updatedAtGameMinutes < EVOLVE_INTERVAL_MINUTES) {
        return;
      }

      const name = this.sim.characters.get(characterId)?.name ?? '无名居民';
      const insightRows = await this.handle.db
        .select({ content: memories.content })
        .from(memories)
        .where(
          and(
            eq(memories.characterId, characterId),
            eq(memories.type, 'insight'),
            gte(memories.gameMinutes, now - INSIGHT_WINDOW_MINUTES),
          ),
        )
        .orderBy(desc(memories.importance))
        .limit(INSIGHT_LIMIT);
      const relationRows = await this.handle.db
        .select({ content: characterImpressions.content })
        .from(characterImpressions)
        .where(eq(characterImpressions.characterId, characterId))
        .orderBy(desc(characterImpressions.updatedAt))
        .limit(RELATION_LIMIT);
      // 无新认知与印象时不修订(防纯漂移: 没有素材支撑的变化不写)
      if (insightRows.length === 0 && relationRows.length === 0) return;

      const result = await this.llm.chat(
        'slow',
        buildEvolveMessages(
          name,
          current,
          insightRows.map((r) => r.content),
          relationRows.map((r) => r.content),
        ),
        { taskType: 'agent.narrative_evolve', characterId },
      );
      const draft = parseNarrativeDraft(result.content);
      if (draft === null) {
        logTech('info', 'narrator', '叙事修订输出无效,留待下次', { characterId, reason });
        return;
      }
      const milestoneNote = reason.startsWith('milestone:')
        ? MILESTONE_LABELS[reason.slice('milestone:'.length)] ?? ''
        : '';
      const change = milestoneNote !== '' ? `${draft.change}(起因: ${milestoneNote})` : draft.change;
      await this.savePersona(characterId, applyRevision(blob, draft, now));
      await this.writer.writeManual(
        characterId,
        `我对自己的看法变了: ${change}`,
        5,
        'insight',
        { consolidated: true },
      );
      logTech('info', 'narrator', '自我叙事已修订', {
        characterId,
        reason,
        from: current.version,
        to: current.version + 1,
      });
    } catch (err) {
      logTech('warn', 'narrator', '自我叙事修订失败,留待下次', { characterId, err: errMsg(err) });
    }
  }
}

/** app 装配入口(与 attachMemoryConsolidator 同款);返回实例便于测试观察与 dispose */
export function attachNarrator(
  sim: Simulation,
  handle: DbHandle,
  llm: MemoryLlm,
  writer: MemoryWriter,
): Narrator {
  return new Narrator(sim, handle, llm, writer);
}
