/**
 * 难度预设(参数+规则一体):游戏内设置菜单一键应用的世界配置束。
 * params 仅收录偏离出厂默认的覆盖项(缺省键=默认值);应用时经
 * POST /api/world/settings {rules, timeScale, params, resetParams:true} 全量切换,
 * resetParams 先复位 BALANCE_DEFAULTS 再套覆盖,天然清除上一档残留。
 * 约束:每档 params 须通过 server balance.ts validateBalanceOverrides(测试保障),
 * initialTimeScale ∈ WORLD_TIME_SCALES。
 */
import type { WorldRules } from './world-admin.js';

export interface WorldPreset {
  id: 'relaxed' | 'standard' | 'hardcore';
  label: string;
  desc: string;
  rules: Omit<WorldRules, 'params'>;
  /** 仅偏离默认值的覆盖项;标准档为空对象 */
  params: Record<string, number>;
}

export const WORLD_PRESETS: readonly WorldPreset[] = [
  {
    id: 'relaxed',
    label: '轻松',
    desc: '无死亡,慢消耗,出生带补贴,社交收益高',
    rules: { allowDeath: false, allowChat: true, initialTimeScale: 1 },
    params: {
      VITAL_MAX: 120,
      START_ENERGY: 120,
      IDLE_ENERGY_DECAY: 0.01,
      SCORE_WAKE_DEDUCTION: 0.1,
      REVIVE_ENERGY: 120,
      START_COINS: 200,
      SPAWN_PREPAID_DAYS: 3,
      CHAT_FAMILIARITY_GAIN: 8,
      CHAT_AFFINITY_BASE: 6,
      CHAT_SCORE: 3,
      FAMILIARITY_DECAY_PER_DAY: 0,
    },
  },
  {
    id: 'standard',
    label: '标准',
    desc: '默认规则与参数,均衡体验',
    rules: { allowDeath: true, allowChat: true, initialTimeScale: 1 },
    params: {},
  },
  {
    id: 'hardcore',
    label: '硬核',
    desc: '4x 快时轴,高消耗低补贴,死亡惩罚重',
    rules: { allowDeath: true, allowChat: true, initialTimeScale: 4 },
    params: {
      VITAL_MAX: 90,
      START_ENERGY: 80,
      IDLE_ENERGY_DECAY: 0.03,
      SCORE_WAKE_DEDUCTION: 0.35,
      REVIVE_ENERGY: 80,
      CHAT_FAMILIARITY_GAIN: 5,
      CHAT_AFFINITY_BASE: 3,
      CHAT_SCORE: 1,
      FAMILIARITY_DECAY_PER_DAY: 2,
    },
  },
];
