import { eq } from 'drizzle-orm';
import type { ModelSlot } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { modelConfigs } from '../db/schema/index.js';
import { decryptSecret } from '../utils/crypto.js';
import { env } from '../config/env.js';
import {
  chatViaAnthropic,
  chatViaOpenAi,
  chatViaSystemOne,
  embedViaOpenAi,
  type FetchImpl,
} from './adapters.js';
import type {
  LlmChatResult,
  LlmEmbedResult,
  LlmMessage,
  SlotRuntimeConfig,
  SystemOneQuestion,
  SystemOneResult,
} from './types.js';
import { LlmError } from './types.js';
import { recordTokenUsage, type TokenUsageEntry } from './usage.js';

export interface ModelRouterOptions {
  fetchImpl?: FetchImpl;
  loadConfig?: (slot: ModelSlot) => Promise<SlotRuntimeConfig>;
  persistUsage?: (entry: TokenUsageEntry) => Promise<void>;
}

interface ChatTask {
  taskType: string;
  characterId?: string | null;
  maxTokens?: number;
  temperature?: number;
}

/** 四槽位唯一模型出口:按槽位配置分发协议适配器,每次调用落 token_usage。
 * systemone 槽位无自由对话形态(chat 走 systemOne),反之亦然。 */
export class ModelRouter {
  private readonly fetchImpl: FetchImpl;
  private readonly loadConfig: (slot: ModelSlot) => Promise<SlotRuntimeConfig>;
  private readonly persistUsage: (entry: TokenUsageEntry) => Promise<void>;

  constructor(
    private readonly handle: DbHandle,
    opts: ModelRouterOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.loadConfig =
      opts.loadConfig ??
      (async (slot) => {
        const [row] = await handle.db
          .select()
          .from(modelConfigs)
          .where(eq(modelConfigs.slot, slot))
          .limit(1);
        if (!row) {
          throw new LlmError(slot, `槽位 ${slot} 未配置`);
        }
        if (!row.enabled) {
          throw new LlmError(slot, `槽位 ${slot} 未启用`);
        }
        if (!row.baseUrl || !row.model || !row.apiKeyEncrypted) {
          throw new LlmError(slot, `槽位 ${slot} 配置不完整(baseUrl/model/apiKey)`);
        }
        let apiKey: string;
        try {
          apiKey = decryptSecret(row.apiKeyEncrypted, env.MASTER_KEY);
        } catch {
          throw new LlmError(slot, `槽位 ${slot} 密钥解密失败(MASTER_KEY 不匹配)`);
        }
        return {
          slot: row.slot,
          protocol: row.protocol,
          baseUrl: row.baseUrl,
          model: row.model,
          apiKey,
        };
      });
    this.persistUsage = opts.persistUsage ?? ((entry) => recordTokenUsage(handle, entry));
  }

  /** 对话补全(slow/light 走此入口;jev 槽位须协议=openai 兼容轨) */
  async chat(slot: ModelSlot, messages: LlmMessage[], task: ChatTask): Promise<LlmChatResult> {
    const cfg = await this.loadConfig(slot);
    const opts = {
      maxTokens: task.maxTokens,
      temperature: task.temperature,
      timeoutMs: env.LLM_TIMEOUT_MS,
    };
    const result =
      cfg.protocol === 'anthropic'
        ? await chatViaAnthropic(cfg, messages, opts, this.fetchImpl)
        : cfg.protocol === 'openai'
          ? await chatViaOpenAi(cfg, messages, opts, this.fetchImpl)
          : (() => {
              throw new LlmError(slot, `槽位 ${slot} 协议为 systemone(类型化问答),不支持对话;请用 systemOne()`);
            })();
    await this.persistUsage({
      slot,
      characterId: task.characterId ?? null,
      taskType: task.taskType,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
    return result;
  }

  /** Jev 类型化问答(jev 槽位协议=systemone 原生轨) */
  async systemOne(
    slot: ModelSlot,
    state: string,
    questions: Record<string, SystemOneQuestion>,
    task: { taskType: string; characterId?: string | null },
  ): Promise<SystemOneResult> {
    const cfg = await this.loadConfig(slot);
    if (cfg.protocol !== 'systemone') {
      throw new LlmError(slot, `槽位 ${slot} 协议为 ${cfg.protocol},非 systemone;请用 chat()`);
    }
    const result = await chatViaSystemOne(
      cfg,
      state,
      questions,
      { timeoutMs: env.LLM_TIMEOUT_MS },
      this.fetchImpl,
    );
    await this.persistUsage({
      slot,
      characterId: task.characterId ?? null,
      taskType: task.taskType,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
    return result;
  }

  /** 向量化(仅 embedding 槽位) */
  async embed(
    slot: ModelSlot,
    inputs: string[],
    task: { taskType: string; characterId?: string | null },
  ): Promise<LlmEmbedResult> {
    const cfg = await this.loadConfig(slot);
    const result = await embedViaOpenAi(cfg, inputs, { timeoutMs: env.LLM_TIMEOUT_MS }, this.fetchImpl);
    await this.persistUsage({
      slot,
      characterId: task.characterId ?? null,
      taskType: task.taskType,
      promptTokens: result.promptTokens,
      completionTokens: 0,
    });
    return result;
  }
}
