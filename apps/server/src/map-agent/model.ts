/**
 * AI 改图模型工厂(批C):slow 槽 model_configs → ChatOpenAI(langchain)。
 * 与 ModelRouter.loadConfig 同一读取/解密路径;按 baseUrl+model 指纹缓存实例。
 * langchain 走 SDK 自连,token 记账在 runs 端点收口(usage_metadata → recordTokenUsage)。
 */
import { eq } from 'drizzle-orm';
import { ChatOpenAI } from '@langchain/openai';
import type { ModelSlot } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { modelConfigs } from '../db/schema/index.js';
import { decryptSecret } from '../utils/crypto.js';
import { env } from '../config/env.js';
import { LlmError } from '../llm/types.js';

export interface MapAgentModelInfo {
  slot: ModelSlot;
  model: string;
  fingerprint: string;
}

const cache = new Map<string, ChatOpenAI>();

export async function loadChatModel(handle: DbHandle, slot: ModelSlot = 'slow'): Promise<{ model: ChatOpenAI; info: MapAgentModelInfo }> {
  const [row] = await handle.db.select().from(modelConfigs).where(eq(modelConfigs.slot, slot)).limit(1);
  if (!row) throw new LlmError(slot, `槽位 ${slot} 未配置,请先在「模型配置」中设置`);
  if (!row.enabled) throw new LlmError(slot, `槽位 ${slot} 未启用`);
  if (!row.baseUrl || !row.model || !row.apiKeyEncrypted) {
    throw new LlmError(slot, `槽位 ${slot} 配置不完整(baseUrl/model/apiKey)`);
  }
  if (row.protocol === 'anthropic') {
    throw new LlmError(slot, `槽位 ${slot} 协议为 anthropic,AI 助手暂需 OpenAI 兼容模型`);
  }
  let apiKey: string;
  try {
    apiKey = decryptSecret(row.apiKeyEncrypted, env.MASTER_KEY);
  } catch {
    throw new LlmError(slot, `槽位 ${slot} 密钥解密失败(MASTER_KEY 不匹配)`);
  }
  const fingerprint = `${row.baseUrl}::${row.model}`;
  let model = cache.get(fingerprint);
  if (model === undefined) {
    model = new ChatOpenAI({
      model: row.model,
      apiKey,
      temperature: 0.4,
      maxTokens: row.maxTokens ?? undefined,
      configuration: { baseURL: row.baseUrl },
      timeout: env.LLM_TIMEOUT_MS,
      streaming: true,
    });
    cache.set(fingerprint, model);
  }
  return { model, info: { slot: row.slot, model: row.model, fingerprint } };
}
