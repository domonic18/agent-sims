import { TOWN_MAP, relationTitle, type TraitVector } from '@sims/shared';
import { and, desc, eq, ilike } from 'drizzle-orm';
import type { DbHandle } from '../db/client.js';
import { BALANCE } from '../config/balance.js';
import { characterImpressions, memories } from '../db/schema/memory.js';
import { renderPrompt } from '../prompts/registry.js';
import type { WorldCharacter } from '../world/character.js';
import { innerState } from './cognition.js';
import type { MemoryLlm } from './memory-writer.js';
import { describeMood } from './mood.js';
import { loadPersonaContext } from './slow-layer.js';
import type { StructuredParse, StructuredToolSpec } from '../llm/types.js';

/**
 * 对话生成(10-cognition §7.2 ③,agent-design §6;E3 自然终止多轮):动机引擎
 * 点火后经 light 槽逐轮生成——每轮一次结构化调用返回 {line, wantsMore} 终止信号
 * 搭车零额外调用;双方都还想聊且未达 CHAT_MAX_ROUNDS 才续轮(发起者先说,奇偶
 * 交替),轮间复查距离走散即以已生成句收束(不丢句)。上下文=人设卡+双方特质+
 * 关系称号+定点印象+共同记忆(姓名匹配)+此刻情绪。收束后句数不足 2 由调用方
 * 回落模板池补齐;上下文加载失败返回 null 整场回落(收益封顶同款红线:不烧就退模板)。
 */

/** 一轮台词+终止信号(E3):wantsMore=false 或达 CHAT_MAX_ROUNDS 收束 */
export interface DialogueTurn {
  line: string;
  wantsMore: boolean;
  /** 发起方顺带发出的聚会邀约(E3 最小版,可空;听者轮忽略) */
  invitation: { placeId: string; note: string } | null;
}

/** 一场完整对话:交替台词(发起者先说)+发起方邀约(任一轮顺带,一般末轮) */
export interface DialogueSession {
  lines: string[];
  invitation: { placeId: string; note: string } | null;
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

/** 生成一场多轮对话(E3):双方人设+共同上下文加载一次,逐轮 light 槽结构化调用;
 * 任一轮失败/不可解析即以已生成句收束(调用方补模板),全败返回 null 整场回落。
 * 双方是否继续聊由每轮 wantsMore 决定,达 CHAT_MAX_ROUNDS 硬上限强制收束。 */
export async function generateConversation(
  llm: MemoryLlm,
  handle: DbHandle,
  from: WorldCharacter,
  to: WorldCharacter,
  relation: DialogueRelation,
): Promise<DialogueSession | null> {
  let personaFrom: string | undefined;
  let personaTo: string | undefined;
  let context: RelationalContext;
  try {
    [personaFrom, personaTo, context] = await Promise.all([
      loadPersonaContext(handle, from.id),
      loadPersonaContext(handle, to.id),
      loadRelationalContext(handle, from.id, to.id, to.name),
    ]);
  } catch {
    return null;
  }
  const lines: string[] = [];
  let invitation: DialogueSession['invitation'] = null;
  let heard: string | null = null;
  for (let round = 0; round < BALANCE.CHAT_MAX_ROUNDS; round += 1) {
    const initiator = round % 2 === 0;
    const self = initiator ? from : to;
    const other = initiator ? to : from;
    let turn: DialogueTurn | null = null;
    try {
      turn = await speakTurn(
        llm,
        self,
        other,
        relation,
        context,
        initiator ? personaFrom : personaTo,
        heard,
      );
    } catch {
      turn = null;
    }
    if (turn === null) break;
    lines.push(turn.line);
    if (initiator && turn.invitation !== null) invitation = turn.invitation;
    if (!turn.wantsMore) break;
    heard = turn.line;
    // 轮间复查距离:生成期间走散(被意图拽走等)以已生成句收束,不丢句
    if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) > BALANCE.SOCIAL_CHAT_DISTANCE) break;
  }
  if (lines.length === 0) return null;
  return { lines, invitation };
}

/** 对话轮工具规格(结构化输出):台词+是否续聊,邀约可选顺带 */
function turnTool(): StructuredToolSpec {
  return {
    name: 'dialogue_turn',
    description: '以角色身份说一句台词,并表达是否想继续聊下去',
    inputSchema: {
      type: 'object',
      required: ['line', 'wantsMore'],
      properties: {
        line: { type: 'string', description: '台词(一句中文,不带引号与动作描写)' },
        wantsMore: { type: 'boolean', description: '是否还想继续聊(话不投机/没话说了就 false)' },
        invitation: {
          type: 'object',
          description: '(可选)邀请对方改天一起去某地,只在真心想约时给出',
          properties: {
            placeId: { type: 'string', description: '场所 id' },
            note: { type: 'string', description: '一句话邀约理由' },
          },
        },
      },
    },
  };
}

/** 工具入参→台词轮:line 不可清洗判失败(触发带错重试);邀约字段不全视为无邀约 */
export function parseTurn(raw: unknown): StructuredParse<DialogueTurn> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: '输出须为 JSON 对象' };
  }
  const record = raw as Record<string, unknown>;
  const line = typeof record.line === 'string' ? sanitizeLine(record.line) : null;
  if (line === null) return { ok: false, reason: 'line 须为非空台词' };
  return {
    ok: true,
    value: { line, wantsMore: record.wantsMore === true, invitation: parseInvitation(record.invitation) },
  };
}

function parseInvitation(raw: unknown): DialogueTurn['invitation'] {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.placeId !== 'string' || record.placeId.trim() === '') return null;
  if (typeof record.note !== 'string' || record.note.trim() === '') return null;
  return { placeId: record.placeId.trim(), note: record.note.trim().slice(0, LINE_MAX) };
}

const PLACE_MENU = TOWN_MAP.places.map((p) => `${p.id}(${p.name})`).join('、');

async function speakTurn(
  llm: MemoryLlm,
  self: WorldCharacter,
  other: WorldCharacter,
  relation: DialogueRelation,
  context: RelationalContext,
  persona: string | undefined,
  heard: string | null,
): Promise<DialogueTurn> {
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
    `只输出 JSON:{"line": 台词, "wantsMore": 是否想继续聊}。想邀对方改天一起去某地时(可选,别强求)附加 "invitation": {"placeId": 场所id, "note": 一句话理由}。镇上场所: ${PLACE_MENU}。`,
  );
  // maxTokens 须给思考型模型(MiniMax-M2.7 等)留出推理余量:120 会整段耗在
  // thinking 上导致正文为空、恒回落模板池
  return llm.chatStructured(
    'light',
    [
      { role: 'system', content: renderPrompt('dialogue.system', { name: self.name }) },
      { role: 'user', content: lines.join('\n') },
    ],
    turnTool(),
    { taskType: 'agent.dialogue', characterId: self.id, maxTokens: 512 },
    parseTurn,
  );
}
