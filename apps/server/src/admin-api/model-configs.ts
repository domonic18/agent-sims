import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { MODEL_SLOTS, type ModelConfigView, type ModelSlot } from '@sims/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { DbHandle } from '../db/client.js';
import { modelConfigs } from '../db/schema/index.js';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/crypto.js';
import { requireAdmin } from './auth.js';

/** 连通性探测超时 */
const PROBE_TIMEOUT_MS = 15_000;

const putSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
  model: z.string().min(1).optional(),
  /** 只写字段:空串或缺省=保留原值 */
  apiKey: z.string().optional(),
  enabled: z.boolean().optional(),
});

function toView(
  slot: ModelSlot,
  row: typeof modelConfigs.$inferSelect | undefined,
): ModelConfigView {
  if (!row) {
    return {
      slot,
      baseUrl: '',
      model: '',
      apiKeyMasked: '',
      apiKeyConfigured: false,
      enabled: false,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      updatedAt: new Date(0).toISOString(),
    };
  }
  let masked = '';
  if (row.apiKeyEncrypted) {
    try {
      masked = maskSecret(decryptSecret(row.apiKeyEncrypted, env.MASTER_KEY));
    } catch {
      masked = '解密失败(密钥不匹配?)';
    }
  }
  return {
    slot: row.slot,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKeyMasked: masked,
    apiKeyConfigured: Boolean(row.apiKeyEncrypted),
    enabled: row.enabled,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus ?? null,
    lastTestError: row.lastTestError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadRow(handle: DbHandle, slot: ModelSlot) {
  const [row] = await handle.db
    .select()
    .from(modelConfigs)
    .where(eq(modelConfigs.slot, slot))
    .limit(1);
  return row;
}

async function probeModel(config: {
  slot: ModelSlot;
  baseUrl: string;
  model: string;
  apiKey: string;
}): Promise<{ ok: boolean; detail: string }> {
  const isEmbedding = config.slot === 'embedding';
  const url = `${config.baseUrl}${isEmbedding ? '/embeddings' : '/chat/completions'}`;
  const body = isEmbedding
    ? { model: config.model, input: ['ping'] }
    : {
        model: config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    if (isEmbedding) {
      const data = (JSON.parse(text) as { data?: Array<{ embedding?: unknown[] }> }).data;
      const dims = data?.[0]?.embedding?.length;
      if (typeof dims !== 'number') {
        return { ok: false, detail: `响应缺少向量字段: ${text.slice(0, 200)}` };
      }
      return { ok: true, detail: `模型 ${config.model} 连通正常(${dims} 维)` };
    }
    return { ok: true, detail: `模型 ${config.model} 连通正常` };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 300) };
  }
}

async function testSlot(handle: DbHandle, slot: ModelSlot): Promise<{ ok: boolean; detail: string }> {
  const row = await loadRow(handle, slot);
  if (!row?.baseUrl || !row.model || !row.apiKeyEncrypted) {
    return { ok: false, detail: '槽位未配置完整(baseUrl/model/apiKey)' };
  }
  try {
    const apiKey = decryptSecret(row.apiKeyEncrypted, env.MASTER_KEY);
    return await probeModel({ slot, baseUrl: row.baseUrl, model: row.model, apiKey });
  } catch {
    return { ok: false, detail: '密钥解密失败(MASTER_KEY 与密文不匹配)' };
  }
}

async function persistTestResult(
  handle: DbHandle,
  slot: ModelSlot,
  result: { ok: boolean; detail: string },
): Promise<void> {
  await handle.db
    .update(modelConfigs)
    .set({
      lastTestedAt: new Date(),
      lastTestStatus: result.ok ? 'success' : 'failed',
      lastTestError: result.ok ? null : result.detail,
      updatedAt: new Date(),
    })
    .where(eq(modelConfigs.slot, slot));
}

export function registerModelConfigRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/api/admin/model-configs', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const rows = await handle.db.select().from(modelConfigs);
    const bySlot = new Map(rows.map((row) => [row.slot, row] as const));
    return await reply.send(MODEL_SLOTS.map((slot) => toView(slot, bySlot.get(slot))));
  });

  app.put('/api/admin/model-configs/:slot', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = request.params as { slot: string };
    if (!MODEL_SLOTS.includes(params.slot as ModelSlot)) {
      return await reply.code(404).send({ error: `未知槽位: ${params.slot}` });
    }
    const parsed = putSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue) {
        return await reply.code(400).send({ error: `${issue.path.join('.')}: ${issue.message}` });
      }
      return await reply.code(400).send({ error: '请求参数不合法' });
    }
    const target = params.slot as ModelSlot;
    const data = parsed.data;
    const existing = await loadRow(handle, target);
    if (!existing && !data.baseUrl && !data.model && !data.apiKey) {
      return await reply.code(400).send({ error: '槽位不存在且未提供任何配置字段' });
    }
    await handle.db
      .insert(modelConfigs)
      .values({
        slot: target,
        baseUrl: data.baseUrl ?? '',
        model: data.model ?? '',
        apiKeyEncrypted: data.apiKey ? encryptSecret(data.apiKey, env.MASTER_KEY) : null,
        enabled: data.enabled ?? false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: modelConfigs.slot,
        set: {
          ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
          ...(data.model !== undefined ? { model: data.model } : {}),
          ...(data.apiKey
            ? { apiKeyEncrypted: encryptSecret(data.apiKey, env.MASTER_KEY) }
            : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          updatedAt: new Date(),
        },
      });
    const row = await loadRow(handle, target);
    return await reply.send(toView(target, row));
  });

  app.post('/api/admin/model-configs/:slot/test', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = request.params as { slot: string };
    if (!MODEL_SLOTS.includes(params.slot as ModelSlot)) {
      return await reply.code(404).send({ error: `未知槽位: ${params.slot}` });
    }
    const target = params.slot as ModelSlot;
    const startedAt = performance.now();
    const result = await testSlot(handle, target);
    await persistTestResult(handle, target, result);
    return await reply.send({
      ok: result.ok,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: result.detail,
    });
  });
}
