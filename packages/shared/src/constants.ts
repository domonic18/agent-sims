/**
 * 双端消费的游戏平衡常量(M3.6h;TD-1 自 balances.ts 更名,避免与 server
 * config/balance.ts 一字之差混淆):server 裁决与 web 展示共用同一份,
 * 消除"web 硬编码复制+注释维持同步"的漂移风险。
 * 仅上提双端消费项;服务端专属数值(tick/衰减/昼夜)仍在 apps/server config/balance.ts。
 * 数值口径见 docs/design/04-numerical-design.md(改数值先改文档)。
 */
import { getItem } from './items.js';

/** 步行速度:格/游戏分钟(1 tick = 1 游戏分钟,即每 tick 移动格数) */
export const WALK_SPEED_TILES_PER_TICK = 2;
/** 背包容积上限(体积单位,数值文档 §3.2) */
export const BACKPACK_VOLUME_LIMIT = 8;
/** 冰箱容积上限(体积单位,数值文档 §3.2) */
export const FRIDGE_VOLUME_LIMIT = 30;
/** 镇核心单仓容积上限(体积单位,S2批2 数值文档 §5.6):全世界共享库存总量闸 */
export const STORAGE_VOLUME_LIMIT = 200;
/** 低体力阈值:≤该值仅允许基础活动(rest/stroll/meal),UI 同步亮警示 */
export const LOW_ENERGY_THRESHOLD = 20;
/** 闲聊同处一地距离(曼哈顿,§6.2):chat 判定,UI 聊天按钮同源禁用;
 * 原名 SOCIAL_PRESENCE_DISTANCE(2026-10-07 同场增益删除后更名) */
export const SOCIAL_CHAT_DISTANCE = 2;
/** 路上相遇触发距离(曼哈顿,E8):世界层 tick 级检测,进入该带即发 social.encounter。
 * 与 SOCIAL_CHAT_DISTANCE 语义不同(事件触发阈值 vs 会合成功判定),数值当前同源对齐 */
export const ENCOUNTER_DISTANCE = 2;
/** 相遇同对冷却(游戏分,E8):一次相遇只触发一次事件,冷却近似边沿触发 */
export const ENCOUNTER_COOLDOWN_MINUTES = 15;
/** 同对角色每日「有收益」闲聊次数(数值文档 §6.2);超出可继续聊但收益为 0,UI 提示同源 */
export const CHAT_DAILY_GAINED = 6;
/** 赴约候场时长(游戏分,E3 聚会邀约):到场后对方未现的等待预算,超时 want 废弃改道
 * (「等到中午没来,先去忙了」);铸造时 expiresAtMin = createdAtMin + 此值 */
export const MEETING_WAIT_MINUTES = 360;
/** 救治窗口(goal-design §7,M-G.5):24 游戏小时——growth 累倒送医/survival 重伤休整共用;
 * 窗口内救治免扣,超时自动苏醒(growth 扣得分 ×0.8) */
export const REVIVE_WINDOW_MINUTES = 1440;

/** 库存体积求和(Σ份数×单件体积);未知物品按 0 计(调用方保证 id 合法) */
export function inventoryVolume(record: Record<string, number>): number {
  let volume = 0;
  for (const [itemId, count] of Object.entries(record)) {
    const item = getItem(itemId);
    if (item !== null) {
      volume += item.volume * count;
    }
  }
  return volume;
}
