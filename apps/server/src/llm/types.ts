/** LLM 调用链公共类型:适配器输入/输出与槽位运行时配置(ModelRouter 的唯一原料) */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmEmbedResult {
  vector: number[];
  promptTokens: number;
}

/** Jev 原生 SystemOne 类型化问答(/v1/systemone,2026-10-05 实测定稿):
 * 问题按 key 分组,答案按同 key 返回;输出仅 choice/score/noul 三型。 */
export type SystemOneQuestion =
  | { type: 'choice'; criteria: { text: string }; choices: string[] }
  | { type: 'score'; criteria: string[]; range: [number, number] }
  | { type: 'noul'; criteria: { text: string } };

export type SystemOneAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number };

export interface SystemOneResult {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  promptTokens: number;
  completionTokens: number;
}

/** 槽位运行时配置:解密后的明文 Key 只在内存流转,绝不入日志/快照 */
export interface SlotRuntimeConfig {
  slot: string;
  protocol: 'openai' | 'anthropic' | 'systemone';
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface LlmCallOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export class LlmError extends Error {
  constructor(
    public readonly slot: string,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
