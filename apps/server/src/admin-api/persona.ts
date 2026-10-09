import { randomInt } from 'node:crypto';
import type {
  NarrativeHistoryEntry,
  PersonaCard,
  PersonaDraft,
  PersonaView,
  SelfNarrative,
} from '@sims/shared';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { applyRevision, buildInitMessages, narrativeTool, parseNarrativeDraft } from '../agents/narrator.js';
import { hosting, schedule } from '../agents/cognition.js';
import type { MemoryLlm } from '../agents/memory-writer.js';
import type { DbHandle } from '../db/client.js';
import type { StructuredParse, StructuredToolSpec } from '../llm/types.js';
import { characters } from '../db/schema/index.js';
import type { Simulation } from '../world/simulation.js';
import { requireAdmin } from './auth.js';

const cardSchema = z.object({
  性格: z.string().trim().min(1).max(200),
  兴趣: z.string().trim().min(1).max(200),
  目标: z.string().trim().min(1).max(200),
  说话风格: z.string().trim().min(1).max(200),
  bio: z.string().trim().max(500),
});

const narrativeSchema = z.object({
  text: z.string().trim().min(1).max(200),
  traits: z.array(z.string().trim().min(1).max(20)).max(6).default([]),
});

const saveSchema = z.object({
  bio: z.string().max(500).optional(),
  card: cardSchema.optional(),
  selfNarrative: narrativeSchema.optional(),
});

/** 随机种子池:每次抽向组合,让 LLM 生成有差异、有具体感的人设草稿 */
const SEEDS = {
  性格: ['节俭惜财', '热心肠', '慢性子', '争强好胜', '多愁善感', '大大咧咧', '独来独往', '爱凑热闹'],
  兴趣: ['侍弄花草', '钓鱼', '下棋', '做饭', '跑步', '读书', '木工', '拍照'],
  目标: ['攒钱开一家小店', '盖一栋自己的房子', '游历整座小镇', '成为镇上最有学问的人', '攒够养老钱', '交到五个知心朋友'],
  说话风格: ['言简意赅', '爱讲老故事', '口头禅很多', '轻声细语', '嗓门洪亮', '爱用比喻'],
} as const;

function view(id: string, persona: Record<string, unknown>): PersonaView {
  const card = persona.card;
  const self = persona.selfNarrative;
  const selfNarrative =
    self !== null &&
    typeof self === 'object' &&
    typeof (self as Record<string, unknown>).text === 'string'
      ? (self as unknown as SelfNarrative)
      : null;
  const history = Array.isArray(persona.narrativeHistory)
    ? (persona.narrativeHistory as unknown[])
        .filter(
          (entry): entry is NarrativeHistoryEntry =>
            entry !== null &&
            typeof entry === 'object' &&
            typeof (entry as Record<string, unknown>).text === 'string',
        )
        .reverse()
    : [];
  return {
    characterId: id,
    bio: typeof persona.bio === 'string' ? persona.bio : '',
    card: card !== null && typeof card === 'object' ? (card as PersonaCard) : null,
    selfNarrative,
    narrativeHistory: history,
  };
}

/** 人设卡工具规格(结构化输出):五字段全必填(生成侧保证,解析侧再兜底) */
function personaTool(): StructuredToolSpec {
  const text = { type: 'string' };
  return {
    name: 'submit_persona',
    description: '提交生成的居民人设卡草稿',
    inputSchema: {
      type: 'object',
      required: ['性格', '兴趣', '目标', '说话风格', 'bio'],
      properties: { 性格: text, 兴趣: text, 目标: text, 说话风格: text, bio: text },
    },
  };
}

/** 工具入参→人设草稿: 五字段白名单截断;任一为空判失败(触发带错重试,再失败 502) */
export function parsePersonaDraft(raw: unknown): StructuredParse<PersonaDraft> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: '输出须为 JSON 对象' };
  }
  const value = raw as Record<string, unknown>;
  const field = (key: string): string =>
    typeof value[key] === 'string' ? (value[key] as string).trim().slice(0, 200) : '';
  const bio = typeof value.bio === 'string' ? value.bio.trim().slice(0, 500) : '';
  const card: PersonaCard = {
    性格: field('性格'),
    兴趣: field('兴趣'),
    目标: field('目标'),
    说话风格: field('说话风格'),
    bio,
  };
  const missing = (Object.keys(card) as Array<keyof PersonaCard>).filter((key) => card[key] === '');
  if (missing.length > 0) {
    return { ok: false, reason: `以下字段缺失或为空: ${missing.join('、')}` };
  }
  return { ok: true, value: { bio, card } };
}

export function buildRandomPrompt(): string {
  const pick = (key: keyof typeof SEEDS): string =>
    SEEDS[key][randomInt(0, SEEDS[key].length)]!;
  return [
    '为像素小镇生成一位居民的预置人设卡,字段: 性格/兴趣/目标/说话风格/bio。',
    '要求具体、接地气、有生活气息,五个字段都用中文,bio 为 2~3 句人物小传。',
    `可参考的随机方向: 性格偏「${pick('性格')}」,兴趣偏「${pick('兴趣')}」,目标偏「${pick('目标')}」,说话风格偏「${pick('说话风格')}」。`,
    '请调用 submit_persona 工具提交草稿。',
  ].join('\n');
}

async function writePersona(
  handle: DbHandle,
  id: string,
  patch: { bio?: string; card?: PersonaCard; selfNarrative?: { text: string; traits: string[] } },
  now: number,
): Promise<void> {
  const rows = await handle.db
    .select({ persona: characters.persona })
    .from(characters)
    .where(eq(characters.id, id))
    .limit(1);
  const current = (rows[0]?.persona ?? {}) as Record<string, unknown>;
  let merged: Record<string, unknown> = { ...current };
  if (patch.bio !== undefined) merged.bio = patch.bio;
  if (patch.card !== undefined) merged.card = { ...patch.card };
  // selfNarrative 提供即一次人工修订: 旧版入演化史,version+1(与 LLM 修订同款入链)
  if (patch.selfNarrative !== undefined) {
    merged = applyRevision(merged, patch.selfNarrative, now);
  }
  await handle.db.update(characters).set({ persona: merged }).where(eq(characters.id, id));
}

/**
 * 预置人设(观察者定位): 后台查看/编辑角色人设,可 LLM 随机生成草稿(仅返回不落库)。
 * 保存即写 persona jsonb(浅合并保留 traits/modelSlot);托管中的角色清日程交泵按新人设重规划。
 * selfNarrative 提供即一次人工修订(旧版入演化史);narrative/generate 用 light 槽
 * 从人设卡提炼自我叙事草稿(仅返回不落库,C5)。
 */
export function registerPersonaRoutes(
  app: FastifyInstance,
  handle: DbHandle,
  sim: Simulation,
): void {
  app.get('/api/admin/characters/:id/persona', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    const rows = await handle.db
      .select({ persona: characters.persona })
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1);
    return await reply.send(view(id, (rows[0]?.persona ?? {}) as Record<string, unknown>));
  });

  app.put('/api/admin/characters/:id/persona', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply
        .code(400)
        .send({ error: 'body 须为 { bio?, card?, selfNarrative? }(card 五字段齐备)' });
    }
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    if (
      parsed.data.bio === undefined &&
      parsed.data.card === undefined &&
      parsed.data.selfNarrative === undefined
    ) {
      return await reply.code(400).send({ error: 'bio/card/selfNarrative 至少提供一项' });
    }
    await writePersona(handle, id, parsed.data, sim.clock.gameMinutes);
    if (hosting.has(id)) schedule.clear(id); // 托管中: 清日程交泵按新人设重规划
    const rows = await handle.db
      .select({ persona: characters.persona })
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1);
    return await reply.send(view(id, (rows[0]?.persona ?? {}) as Record<string, unknown>));
  });

  app.post('/api/admin/characters/:id/persona/random', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    const llm = app.llm as MemoryLlm;
    try {
      const draft = await llm.chatStructured(
        'light',
        [
          { role: 'system', content: '你是人设编剧,为像素小镇生成居民人设卡草稿。' },
          { role: 'user', content: buildRandomPrompt() },
        ],
        personaTool(),
        { taskType: 'agent.persona_random' },
        parsePersonaDraft,
      );
      return await reply.send(draft);
    } catch (error) {
      return await reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : '模型调用失败,请重试' });
    }
  });

  // 自我叙事草稿(C5): light 槽从人设卡提炼第一人称「我是谁」,仅返回不落库
  app.post('/api/admin/characters/:id/persona/narrative/generate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!sim.characters.has(id)) {
      return await reply.code(404).send({ error: '角色不在当前活跃世界' });
    }
    const rows = await handle.db
      .select({ persona: characters.persona })
      .from(characters)
      .where(eq(characters.id, id))
      .limit(1);
    const blob = (rows[0]?.persona ?? {}) as Record<string, unknown>;
    const bio = typeof blob.bio === 'string' ? blob.bio : '';
    const card =
      blob.card !== null && typeof blob.card === 'object'
        ? (blob.card as Record<string, unknown>)
        : {};
    const name = sim.characters.get(id)?.name ?? '无名居民';
    const llm = app.llm as MemoryLlm;
    try {
      const draft = await llm.chatStructured(
        'light',
        buildInitMessages(name, bio, card),
        narrativeTool(false),
        { taskType: 'agent.narrative_init', characterId: id },
        parseNarrativeDraft,
      );
      return await reply.send({ text: draft.text, traits: draft.traits });
    } catch (error) {
      return await reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : '模型调用失败,请重试' });
    }
  });
}
