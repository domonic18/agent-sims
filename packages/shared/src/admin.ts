/**
 * 后台模型槽位:四类模型(慢思考/轻量对话/Jev/embedding)的后台配置键,
 * model_configs.slot 与后台表单共用此枚举。
 */
export const MODEL_SLOTS = ['slow', 'light', 'jev', 'embedding'] as const;

export type ModelSlot = (typeof MODEL_SLOTS)[number];
