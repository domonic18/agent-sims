import { eq } from 'drizzle-orm';
import { MODEL_SLOT_MAX_TOKENS, type ModelSlot } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { modelConfigs } from '../db/schema/index.js';
import { decryptSecret } from '../utils/crypto.js';
import { env } from '../config/env.js';
import { logTech } from '../telemetry.js';
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
          maxTokens: row.maxTokens ?? null,
        };
      });
    this.persistUsage = opts.persistUsage ?? ((entry) => recordTokenUsage(handle, entry));
  }

  /** 埋点包装(M-G.1②):成败各落一条技术日志,异常原样上抛 */
  private async runLogged<T>(
    slot: ModelSlot,
    taskType: string,
    label: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await run();
      logTech('info', 'llm', '调用完成', { slot, taskType, label, ms: Date.now() - startedAt });
      return result;
    } catch (err) {
      logTech('error', 'llm', err instanceof Error ? err.message : String(err), {
        slot,
        taskType,
        label,
        ms: Date.now() - startedAt,
      });
      throw err;
    }
  }

  /** 对话补全(slow/light 走此入口;jev 槽位须协议=openai 兼容轨) */
  async chat(slot: ModelSlot, messages: LlmMessage[], task: ChatTask): Promise<LlmChatResult> {
    return this.runLogged(slot, task.taskType, 'chat', async () => {
      const cfg = await this.loadConfig(slot);
      const baseMax =
        // 槽位设置值覆盖任务值覆盖内置默认(后台可调,救思考型模型 thinking 吃光小上限);
        // 连通探测不经 router,恒 maxTokens=1 不受影响
        cfg.maxTokens ?? task.maxTokens ?? MODEL_SLOT_MAX_TOKENS[slot] ?? null;
      const call = async (maxTokens: number | null): Promise<LlmChatResult> => {
        const result =
          cfg.protocol === 'anthropic'
            ? await chatViaAnthropic(
                cfg,
                messages,
                { maxTokens: maxTokens ?? undefined, temperature: task.temperature, timeoutMs: env.LLM_TIMEOUT_MS },
                this.fetchImpl,
              )
            : cfg.protocol === 'openai'
              ? await chatViaOpenAi(
                  cfg,
                  messages,
                  { maxTokens: maxTokens ?? undefined, temperature: task.temperature, timeoutMs: env.LLM_TIMEOUT_MS },
                  this.fetchImpl,
                )
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
      };
      let result = await call(baseMax);
      // 思考型模型饥饿兜底:输出撞上限且正文为空=thinking 吃光预算,加倍重试一次
      if (baseMax !== null && result.content.trim() === '' && result.completionTokens >= baseMax) {
        logTech('warn', 'llm', '正文为空疑似 thinking 耗尽 max_tokens,加倍上限重试一次', {
          slot,
          taskType: task.taskType,
          maxTokens: baseMax,
          completionTokens: result.completionTokens,
        });
        result = await call(baseMax * 2);
      }
      return result;
    });
  }

  /** Jev 类型化问答(jev 槽位协议=systemone 原生轨) */
  async systemOne(
    slot: ModelSlot,
    state: string,
    questions: Record<string, SystemOneQuestion>,
    task: { taskType: string; characterId?: string | null },
  ): Promise<SystemOneResult> {
    return this.runLogged(slot, task.taskType, 'systemOne', async () => {
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
    });
  }

  /** 向量化(仅 embedding 槽位) */
  async embed(
    slot: ModelSlot,
    inputs: string[],
    task: { taskType: string; characterId?: string | null },
  ): Promise<LlmEmbedResult> {
    return this.runLogged(slot, task.taskType, 'embed', async () => {
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
    });
  }
}
