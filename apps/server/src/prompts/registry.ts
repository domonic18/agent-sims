import { readFileSync } from 'node:fs';
import type { ModelSlot } from '@sims/shared';

/**
 * 提示词注册表(外置唯一入口):模板正文存 apps/server/prompts/*.md,
 * 本模块只持元数据与加载/渲染。启动即全量同步加载,文件缺失/空模板直接抛错(fail fast)。
 * dev: src/prompts/registry.ts → ../../prompts = apps/server/prompts;
 * prod: dist/prompts/registry.js → ../../prompts = /app/prompts(package.json files 随 deploy 携带)。
 */

export interface PromptMeta {
  /** 稳定标识(渲染入口与模板文件名 <id>.md 对应) */
  id: string;
  title: string;
  description: string;
  /** 生效槽位;'-'=不经模型(仅标注归属) */
  slot: ModelSlot | '-';
  taskType: string;
  /** {{var}} 占位清单(后台页展示;全部由代码注入,模板不兜底缺值) */
  variables: readonly string[];
}

const META: readonly PromptMeta[] = [
  { id: 'intents.system', title: '意图生成 · 系统提示', description: '慢层当日 wants 生成的 system 段(角色代入+persona 全文)', slot: 'slow', taskType: 'agent.day_intents', variables: ['name', 'day', 'persona_line'] },
  { id: 'intents.user', title: '意图生成 · 用户消息', description: '慢层意图生成的状态/方针/记忆/要求骨架(上下文行由代码组装)', slot: 'slow', taskType: 'agent.day_intents', variables: ['status_line', 'context_lines', 'memory_lines', 'activity_menu', 'submit_line'] },
  { id: 'policy.compile.system', title: '方针编译 · 系统提示', description: '玩家生活方针→活动偏好编译的 system 段', slot: 'slow', taskType: 'agent.policy_compile', variables: [] },
  { id: 'policy.compile.user', title: '方针编译 · 用户消息', description: '玩家方针原文+可选活动+语义说明', slot: 'slow', taskType: 'agent.policy_compile', variables: ['policy_text', 'activity_menu', 'rule_line', 'submit_line'] },
  { id: 'persona.policy.system', title: '人设偏好编译 · 系统提示', description: 'full 托管下人设卡→活动偏好编译的 system 段', slot: 'slow', taskType: 'agent.persona_policy', variables: [] },
  { id: 'persona.policy.user', title: '人设偏好编译 · 用户消息', description: '人设原文+可选活动+语义说明', slot: 'slow', taskType: 'agent.persona_policy', variables: ['persona', 'activity_menu', 'rule_line', 'submit_line'] },
  { id: 'narrative.evolve.system', title: '叙事修订 · 系统提示', description: '周级/里程碑自我叙事修订的 system 段(防漂移明令)', slot: 'slow', taskType: 'agent.narrative_evolve', variables: ['name'] },
  { id: 'narrative.evolve.user', title: '叙事修订 · 用户消息', description: '当前叙事+特质词+洞察/印象素材+字段要求', slot: 'slow', taskType: 'agent.narrative_evolve', variables: ['current_line', 'traits_line', 'insight_lines', 'relation_lines', 'text_max', 'trait_max'] },
  { id: 'narrative.init.system', title: '叙事初始化 · 系统提示', description: '从人设卡提炼自我叙事(后台生成草稿)的 system 段', slot: 'light', taskType: 'agent.narrative_init', variables: ['name'] },
  { id: 'narrative.init.user', title: '叙事初始化 · 用户消息', description: '人设卡四字段+小传+字段要求', slot: 'light', taskType: 'agent.narrative_init', variables: ['bio_line', 'trait_line', 'interest_line', 'goal_line', 'style_line', 'text_max', 'trait_max'] },
  { id: 'dream.system', title: '认知固化 · 系统提示', description: '睡眠固化/白天反思共用的 system 段(沉睡/走神模式)', slot: 'slow', taskType: 'agent.dream / agent.reflect', variables: ['name', 'mode'] },
  { id: 'dream.user', title: '认知固化 · 用户消息', description: '当日记忆素材+互动者白名单+三段产物要求(dream 段可选)', slot: 'slow', taskType: 'agent.dream / agent.reflect', variables: ['memory_lines', 'partners_line', 'dream_req', 'insight_max', 'relation_max'] },
  { id: 'dialogue.system', title: '对话台词 · 系统提示', description: '面对面闲聊单句台词生成的 system 段', slot: 'light', taskType: 'agent.dialogue', variables: ['name'] },
  { id: 'evaluate.system', title: '记忆复盘 · 系统提示', description: '重要活动轻槽一句话复盘的 system 段(感受重构,禁编造新事件)', slot: 'light', taskType: 'memory.evaluate', variables: ['name'] },
  { id: 'asset.review.system', title: '素材审核 · 系统提示', description: '视觉模型图文相符审核的 system 段', slot: 'vision', taskType: 'asset_ai_review', variables: [] },
  { id: 'persona.random.system', title: '人设草稿 · 系统提示', description: '后台随机生成居民人设卡的 system 段', slot: 'light', taskType: 'agent.persona_random', variables: [] },
  { id: 'persona.random.user', title: '人设草稿 · 用户消息', description: '生成要求+随机方向种子', slot: 'light', taskType: 'agent.persona_random', variables: ['seed_line', 'submit_line'] },
  { id: 'mindtalk.system', title: '意识访谈 · 系统提示', description: '观察者与角色对话的 system 段(记忆/人设/情绪上下文由代码注入)', slot: 'light', taskType: 'agent.mind_talk', variables: ['name', 'context'] },
] as const;

const templates = new Map<string, string>(
  META.map((meta) => {
    const file = new URL(`../../prompts/${meta.id}.md`, import.meta.url);
    let content: string;
    try {
      content = readFileSync(file, 'utf8').trim();
    } catch {
      throw new Error(`提示词模板文件缺失或不可读: ${meta.id}.md(${file.pathname})`);
    }
    if (content === '') throw new Error(`提示词模板为空: ${meta.id}.md`);
    return [meta.id, content] as const;
  }),
);

/** 渲染:{{var}} 整行替换,值为空串或未注入的整行剔除(可选段消失) */
export function renderPrompt(id: string, vars: Readonly<Record<string, string | number>> = {}): string {
  const template = templates.get(id);
  if (template === undefined) throw new Error(`提示词模板未注册: ${id}`);
  return template
    .split('\n')
    .map((line) =>
      line.replace(/\{\{(\w+)\}\}/g, (raw, key: string) => {
        const value = vars[key];
        return value === undefined ? raw : String(value);
      }),
    )
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/** 后台查看视图(元数据+模板全文,只读) */
export interface PromptView extends PromptMeta {
  content: string;
}

export function listPrompts(): PromptView[] {
  return META.map((meta) => ({ ...meta, content: templates.get(meta.id)! }));
}
