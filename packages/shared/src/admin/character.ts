/** 角色当日意图(want)视图(D3 弹性意图;status 为意图生命周期真实状态) */
export interface CharacterWantView {
  id: string;
  activityId: string;
  label: string;
  /** 第一人称理由(慢层生成/fallback 模板) */
  why: string;
  urgency: number;
  status: 'pending' | 'doing' | 'done' | 'abandoned';
}

/** GET /api/admin/characters/:id/schedule 响应(当日无意图时 day=null/wants=[]) */
export interface CharacterScheduleView {
  characterId: string;
  day: number | null;
  /** llm=慢槽生成;fallback=模板回落 */
  source: 'llm' | 'fallback' | null;
  wants: CharacterWantView[];
}

/** 托管模式(M4e):full=Agent 完全自主;policy=生活方针约束(主推) */
export const HOSTING_MODES = ['full', 'policy'] as const;

export type HostingMode = (typeof HOSTING_MODES)[number];

/** GET/POST /api/admin/characters/:id/hosting(未托管时 hosted=false/mode=null/policyText=null) */
export interface HostingStateView {
  characterId: string;
  hosted: boolean;
  mode: HostingMode | null;
  policyText: string | null;
}

// ============ 预置人设(后台查看/保存/LLM 随机草稿) ============

/** 人设卡五字段(后台预置编辑/LLM 随机草稿/日计划注入共用,characters.persona.card 同构落库) */
export interface PersonaCard {
  性格: string;
  兴趣: string;
  目标: string;
  说话风格: string;
  bio: string;
}

/**
 * L4 自我叙事(10-cognition §4.3/§6,C5): 「我是谁」的第一人称陈述,人格本体。
 * characters.persona.selfNarrative 同构落库;未初始化时消费端回落人设卡 bio。
 */
export interface SelfNarrative {
  /** 第一人称自我陈述,≤200 字 */
  text: string;
  /** 核心特质词 3~6 个(修订时只许微调) */
  traits: string[];
  /** 从 1 起,每次修订 +1(修订全程可审计) */
  version: number;
  /** 上次修订的游戏分钟 */
  updatedAtGameMinutes: number;
}

/** 演化史条目: 修订时旧版整体入档,环形保留最近 10 版(面板可回看,直播可观测) */
export interface NarrativeHistoryEntry extends SelfNarrative {
  archivedAtGameMinutes: number;
}

/** GET/PUT /api/admin/characters/:id/persona——预置人设查看与保存(未编辑过时 card=null) */
export interface PersonaView {
  characterId: string;
  bio: string;
  card: PersonaCard | null;
  /** L4 自我叙事(null=尚未初始化) */
  selfNarrative: SelfNarrative | null;
  /** 演化史,新→旧 */
  narrativeHistory: NarrativeHistoryEntry[];
}

/** PUT persona 请求:提供哪段写哪段(bio 直写可清空,card 整体覆盖),traits/modelSlot 不受影响;
 * selfNarrative 提供即视为一次人工修订(旧版入演化史,version+1) */
export interface PersonaSaveRequest {
  bio?: string;
  card?: PersonaCard;
  selfNarrative?: { text: string; traits: string[] };
}

/** POST /api/admin/characters/:id/persona/random——LLM 随机人设草稿(仅返回不落库) */
export interface PersonaDraft {
  bio: string;
  card: PersonaCard;
}

/** POST /api/admin/characters/:id/persona/narrative/generate——LLM 生成自我叙事草稿(仅返回不落库) */
export interface NarrativeDraft {
  text: string;
  traits: string[];
}

// ============ 意识访谈(观察者与 agent 对话,TA 基于自身记忆/经历第一人称回答) ============

export interface MindTalkMessage {
  role: 'agent' | 'player';
  text: string;
}

/** GET /api/admin/characters/:id/mindtalk 与 POST 共用响应(POST body={text}) */
export interface MindTalkView {
  characterId: string;
  messages: MindTalkMessage[];
}
