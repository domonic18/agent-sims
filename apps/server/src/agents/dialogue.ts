import { relationTitle, type TraitVector } from '@sims/shared';
import { and, desc, eq, ilike } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { characterImpressions, memories } from '../db/schema/memory.js';
import { renderPrompt } from '../prompts/registry.js';
import type { WorldCharacter } from '../world/character.js';
import { innerState } from './cognition.js';
import type { MemoryLlm } from './memory-writer.js';
import { describeMood } from './mood.js';
import { loadPersonaContext } from './slow-layer.js';

/**
 * 对话生成(10-cognition §7.2 ③,agent-design §6):动机引擎点火后经 light 槽
 * 一问一答——先以发起者人设生成台词,再以听者人设闻声回一句,双句经 chat 意图
 * 一次结算。上下文=人设卡+双方特质+关系称号+定点印象+共同记忆(姓名匹配)+此刻情绪。
 * 双调用任一失败返回 null,调用方回落模板池双句(收益封顶同款红线:不烧就退模板)。
 */

/** 一轮对话:发起者台词+听者回复 */
export interface DialogueExchange {
  line: string;
  reply: string;
}

/** 关系切片(scheduler 从 sim.socials 取,dialogue 不接触 Simulation) */
export interface DialogueRelation {
  familiarity: number;
  affinity: number;
}

const LINE_MAX = 80;

/** 台词清洗:取首个非空行,掐包裹引号,截 80 字(chat 意图校验上限) */
export function sanitizeLine(raw: string): string | null {
  const first = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  if (first === undefined) return null;
  const stripped = first.replace(/^[「『“"'']*/, '').replace(/[」』”"'']*$/, '');
  const line = (stripped.trim() !== '' ? stripped : first).slice(0, LINE_MAX).trim();
  return line === '' ? null : line;
}

const TRAIT_NOTES: ReadonlyArray<{ key: keyof TraitVector; high: string; low: string }> = [
  { key: 'sociability', high: '外向爱说话', low: '内向寡言' },
  { key: 'ambition', high: '上进心强', low: '随遇而安' },
  { key: 'hedonism', high: '追求享乐', low: '克己朴素' },
  { key: 'homebody', high: '恋家', low: '爱往外跑' },
  { key: 'frugality', high: '节俭', low: '大手大脚' },
];

/** 特质向量→一两句性格白描(只取显著维度,其余归「平和」) */
export function traitLine(traits: TraitVector): string {
  const notes: string[] = [];
  for (const note of TRAIT_NOTES) {
    const value = traits[note.key] ?? 0.5;
    if (value >= 0.65) notes.push(note.high);
    else if (value <= 0.35) notes.push(note.low);
  }
  return notes.length > 0 ? notes.join('、') : '性格平和';
}

interface RelationalContext {
  impression: string | null;
  sharedMemories: string[];
}

/** 定点印象一条+含对方姓名的高重要记忆三条(尽力而为,失败由上层兜底回落) */
async function loadRelationalContext(
  handle: DbHandle,
  fromId: string,
  toId: string,
  toName: string,
): Promise<RelationalContext> {
  const impressions = await handle.db
    .select({ content: characterImpressions.content })
    .from(characterImpressions)
    .where(
      and(
        eq(characterImpressions.characterId, fromId),
        eq(characterImpressions.aboutId, toId),
      ),
    )
    .limit(1);
  const shared = await handle.db
    .select({ content: memories.content })
    .from(memories)
    .where(and(eq(memories.characterId, fromId), ilike(memories.content, `%${toName}%`)))
    .orderBy(desc(memories.importance))
    .limit(3);
  return {
    impression: impressions[0]?.content ?? null,
    sharedMemories: shared.map((row) => row.content),
  };
}

/** 生成一轮对话;light 槽不可用/输出不可清洗返回 null(回落模板池) */
export async function generateExchange(
  llm: MemoryLlm,
  handle: DbHandle,
  from: WorldCharacter,
  to: WorldCharacter,
  relation: DialogueRelation,
): Promise<DialogueExchange | null> {
  try {
    const [personaFrom, personaTo, context] = await Promise.all([
      loadPersonaContext(handle, from.id),
      loadPersonaContext(handle, to.id),
      loadRelationalContext(handle, from.id, to.id, to.name),
    ]);
    const line = await speak(llm, from, to, relation, context, personaFrom, null);
    if (line === null) return null;
    const reply = await speak(llm, to, from, relation, context, personaTo, line);
    if (reply === null) return null;
    return { line, reply };
  } catch {
    return null;
  }
}

async function speak(
  llm: MemoryLlm,
  self: WorldCharacter,
  other: WorldCharacter,
  relation: DialogueRelation,
  context: RelationalContext,
  persona: string | undefined,
  heard: string | null,
): Promise<string | null> {
  const title = relationTitle(relation.familiarity, relation.affinity);
  const lines = [
    `你的人设: ${persona ?? '无特别设定'}`,
    `你的性格: ${traitLine(self.traits)}`,
    `你们是${title}(熟络度 ${Math.round(relation.familiarity)}/100,好感 ${Math.round(relation.affinity)}/100)。`,
  ];
  if (context.impression !== null) lines.push(`你对${other.name}的印象: ${context.impression}`);
  if (context.sharedMemories.length > 0) {
    lines.push(`相关往事: ${context.sharedMemories.join(';')}`);
  }
  const state = innerState.moodOf(self.id);
  const moodLine = state !== undefined ? describeMood(state) : null;
  if (moodLine !== null) lines.push(`你此刻${moodLine}`);
  lines.push(
    heard === null
      ? `现场: 你和${other.name}碰面了。以${self.name}的身份主动搭一句话,符合人设与关系。`
      : `${other.name}对你说:「${heard}」。以${self.name}的身份自然回一句。`,
    '只输出一句中文台词,不要引号、动作描写或解释。',
  );
  const result = await llm.chat(
    'light',
    [
      { role: 'system', content: renderPrompt('dialogue.system', { name: self.name }) },
      { role: 'user', content: lines.join('\n') },
    ],
    // maxTokens 须给思考型模型(MiniMax-M2.7 等)留出推理余量:120 会整段耗在
    // thinking 上导致正文为空、恒回落模板池
    { taskType: 'agent.dialogue', characterId: self.id, maxTokens: 512 },
  );
  return sanitizeLine(result.content);
}
