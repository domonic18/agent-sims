import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  MODEL_PROTOCOLS,
  MODEL_SLOTS,
  MODEL_SLOT_PROTOCOLS,
  type ModelConfigInvokeResult,
  type ModelConfigView,
  type ModelSlot,
} from '@sims/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { DbHandle } from '../db/client.js';
import { modelConfigs } from '../db/schema/index.js';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/crypto.js';
import {
  chatViaAnthropic,
  chatViaOpenAi,
  chatViaSystemOne,
  embedViaOpenAi,
} from '../llm/adapters.js';
import { ModelRouter } from '../llm/router.js';
import type { SlotRuntimeConfig } from '../llm/types.js';
import { requireAdmin } from './auth.js';

const putSchema = z.object({
  protocol: z.enum(MODEL_PROTOCOLS).optional(),
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
      protocol: 'openai',
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
    protocol: row.protocol,
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

/** 连通探测走与正式调用同一套适配器(请求形状单源,防探测/实调漂移) */
async function probeModel(config: SlotRuntimeConfig): Promise<{ ok: boolean; detail: string }> {
  const opts = { timeoutMs: env.PROBE_TIMEOUT_MS, maxTokens: 1 };
  try {
    if (config.slot === 'embedding') {
      const result = await embedViaOpenAi(config, ['ping'], opts, fetch);
      return { ok: true, detail: `模型 ${config.model} 连通正常(${result.vector.length} 维)` };
    }
    if (config.protocol === 'anthropic') {
      await chatViaAnthropic(config, [{ role: 'user', content: 'ping' }], opts, fetch);
    } else if (config.protocol === 'systemone') {
      await chatViaSystemOne(
        config,
        'probe',
        { demo: { type: 'choice', instructions: '连通测试', criteria: { A: '选项 A', B: '选项 B' } } },
        opts,
        fetch,
      );
    } else {
      await chatViaOpenAi(config, [{ role: 'user', content: 'ping' }], opts, fetch);
    }
    return { ok: true, detail: `模型 ${config.model} 连通正常(${config.protocol})` };
  } catch (err) {
    return { ok: false, detail: String(err instanceof Error ? err.message : err).slice(0, 240) };
  }
}

async function testSlot(handle: DbHandle, slot: ModelSlot): Promise<{ ok: boolean; detail: string }> {
  const row = await loadRow(handle, slot);
  if (!row?.baseUrl || !row.model || !row.apiKeyEncrypted) {
    return { ok: false, detail: '槽位未配置完整(baseUrl/model/apiKey)' };
  }
  try {
    const apiKey = decryptSecret(row.apiKeyEncrypted, env.MASTER_KEY);
    return await probeModel({
      slot,
      protocol: row.protocol,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey,
    });
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
  const router = new ModelRouter(handle);

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
    // 协议按槽位锁定(ai-invest 同款交互): embedding 仅 openai,jev 双轨,slow/light 不含原生 systemone
    const allowed = MODEL_SLOT_PROTOCOLS[target];
    if (data.protocol !== undefined && !allowed.includes(data.protocol)) {
      return await reply
        .code(400)
        .send({ error: `槽位 ${target} 不支持协议 ${data.protocol}(可选: ${allowed.join('/')})` });
    }
    const existing = await loadRow(handle, target);
    const protocol = data.protocol ?? existing?.protocol ?? 'openai';
    if (!existing && !data.baseUrl && !data.model && !data.apiKey) {
      return await reply.code(400).send({ error: '槽位不存在且未提供任何配置字段' });
    }
    await handle.db
      .insert(modelConfigs)
      .values({
        slot: target,
        protocol,
        baseUrl: data.baseUrl ?? '',
        model: data.model ?? '',
        apiKeyEncrypted: data.apiKey ? encryptSecret(data.apiKey, env.MASTER_KEY) : null,
        enabled: data.enabled ?? false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: modelConfigs.slot,
        set: {
          ...(data.protocol !== undefined ? { protocol } : {}),
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

  /** 试调用:走 ModelRouter 真实调用链(协议适配+token 记账),与「测试连通」互补 */
  app.post('/api/admin/model-configs/:slot/invoke', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = request.params as { slot: string };
    if (!MODEL_SLOTS.includes(params.slot as ModelSlot)) {
      return await reply.code(404).send({ error: `未知槽位: ${params.slot}` });
    }
    const target = params.slot as ModelSlot;
    const parsed = z
      .object({ prompt: z.string().min(1).max(2000).optional() })
      .safeParse(request.body ?? {});
    const prompt =
      parsed.success && parsed.data.prompt ? parsed.data.prompt : '用一句话介绍你自己';
    const startedAt = performance.now();
    try {
      if (target === 'embedding') {
        const result = await router.embed(target, [prompt], { taskType: 'admin_invoke' });
        const payload: ModelConfigInvokeResult = {
          ok: true,
          latencyMs: Math.round(performance.now() - startedAt),
          detail: `向量 ${result.vector.length} 维`,
          dims: result.vector.length,
          usage: { promptTokens: result.promptTokens, completionTokens: 0 },
        };
        return await reply.send(payload);
      }
      if (target === 'jev') {
        const row = await loadRow(handle, target);
        if (row?.protocol === 'systemone') {
          const result = await router.systemOne(
            target,
            prompt,
            {
              demo: {
                type: 'choice',
                instructions: '试调用:从选项中挑一个',
                criteria: { A: '选项 A', B: '选项 B', C: '选项 C' },
              },
            },
            { taskType: 'admin_invoke' },
          );
          const payload: ModelConfigInvokeResult = {
            ok: true,
            latencyMs: Math.round(performance.now() - startedAt),
            detail: `SystemOne(${result.model})`,
            content: JSON.stringify(result.answers),
            usage: {
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
            },
          };
          return await reply.send(payload);
        }
      }
      const result = await router.chat(
        target,
        [{ role: 'user', content: prompt }],
        { taskType: 'admin_invoke', maxTokens: 256 },
      );
      const payload: ModelConfigInvokeResult = {
        ok: true,
        latencyMs: Math.round(performance.now() - startedAt),
        detail: '对话补全',
        content: result.content,
        usage: {
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        },
      };
      return await reply.send(payload);
    } catch (err) {
      const payload: ModelConfigInvokeResult = {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        detail: String(err instanceof Error ? err.message : err).slice(0, 300),
      };
      return await reply.send(payload);
    }
  });
}
