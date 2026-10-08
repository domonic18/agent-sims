/** LLM 调用链公共类型:适配器输入/输出与槽位运行时配置(ModelRouter 的唯一原料) */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 视觉消息附图(data URL,如 data:image/png;base64,...);仅 openai/anthropic 协议序列化 */
  images?: string[];
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

/** Jev 原生 SystemOne 类型化问答(/v1/systemone,官方文档对齐 2026-10-08):
 * 问题按 key 分组,答案按同 key 返回;输出仅 choice/score/noul 三型。
 * score 题 criteria=分级量表数组,答案 score 为选中档位下标(0 起);
 * 传单条 criteria 会退化为单选项分类,恒回 0——量表必须给全档位。 */
export type SystemOneQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };

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
  /** 最大输出 tokens 上限,null=不干预(任务值/适配器缺省生效) */
  maxTokens: number | null;
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
