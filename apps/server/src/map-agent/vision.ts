/**
 * 地图效果视觉评估(问题4):vision 槽位多模态看渲染截图 → 中文改进要点,
 * 注入 run 首条用户消息——slow 主模型不必具备视觉能力也能「看到」效果。
 * 失败按 LlmError 原样上抛,runs 端点转 400 给出可读提示。
 */
import type { TileMapDefinition } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { ModelRouter } from '../llm/router.js';

const SYSTEM_PROMPT = [
  '你是像素小镇模拟游戏的地图效果评审。',
  '输入是编辑器按游戏实际贴图渲染的最终效果截图。',
  '从以下维度检查并给出可执行的改进要点:',
  '1. 贴图异常:黑块/占位色块、素材缺失、明显错位或压盖;',
  '2. 布局与美观:建筑间距、留白、道路连贯、装饰自然度;',
  '3. 功能可读性:出入口是否清晰、同类场所是否过挤;',
  '4. 密度:过密会让模拟事件与 LLM 调用暴涨,过松则交互稀疏。',
  '用 4-8 条中文要点输出,每条一句话,直接说改什么;没有问题的维度不要凑数。',
].join('\n');

/** 文档概况注入评估请求,弥补纯截图难判断的尺度信息 */
export function describeDocNote(doc: TileMapDefinition): string {
  const places = doc.places.map((p) => `${p.name}(${p.w}x${p.h})`).join('、');
  return [
    `尺寸 ${doc.width}x${doc.height} 格,场所 ${doc.places.length} 个,资源节点 ${(doc.resources ?? []).length} 个。`,
    `场所清单: ${places}`,
  ].join('\n');
}

export async function describeMapScreenshot(
  handle: DbHandle,
  screenshot: string,
  note: string,
): Promise<string> {
  const router = new ModelRouter(handle);
  const result = await router.chat(
    'vision',
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `评审这张地图效果截图。地图概况:\n${note}`, images: [screenshot] },
    ],
    // thinking 显式关闭:评审是清单式任务,思考型模型开思考会让大图评审动辄分钟级
    { taskType: 'map_agent_vision', maxTokens: 2048, temperature: 0.2, thinking: 'disabled' },
  );
  const text = result.content.trim();
  if (text === '') {
    throw new Error('视觉模型返回空评估');
  }
  return text;
}
