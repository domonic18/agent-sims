/**
 * 双端消费的游戏平衡常量(M3.6h):server 裁决与 web 展示共用同一份,
 * 消除"web 硬编码复制+注释维持同步"的漂移风险。
 * 仅上提双端消费项;服务端专属数值(tick/衰减/昼夜)仍在 apps/server config/balance.ts。
 * 数值口径见 docs/design/numerical-design.md(改数值先改文档)。
 */
import { getShopItem } from './shop.js';

/** 步行速度:格/游戏分钟(1 tick = 1 游戏分钟,即每 tick 移动格数) */
export const WALK_SPEED_TILES_PER_TICK = 2;
/** 背包容积上限(体积单位,数值文档 §3.2) */
export const BACKPACK_VOLUME_LIMIT = 8;
/** 冰箱容积上限(体积单位,数值文档 §3.2) */
export const FRIDGE_VOLUME_LIMIT = 30;
/** 低体力阈值:≤该值仅允许基础活动(rest/stroll/meal),UI 同步亮警示 */
export const LOW_ENERGY_THRESHOLD = 20;
/** 社交同场距离(曼哈顿):chat 与同场增益的"同处一地"判定,UI 聊天按钮同源禁用 */
export const SOCIAL_PRESENCE_DISTANCE = 2;
/** 同对角色每日「有收益」闲聊次数(数值文档 §6.2);超出可继续聊但收益为 0,UI 提示同源 */
export const CHAT_DAILY_GAINED = 6;

/** 库存体积求和(Σ份数×单件体积);未知商品按 0 计(调用方保证 id 合法) */
export function inventoryVolume(record: Record<string, number>): number {
  let volume = 0;
  for (const [itemId, count] of Object.entries(record)) {
    const item = getShopItem(itemId);
    if (item !== null) {
      volume += item.volume * count;
    }
  }
  return volume;
}
