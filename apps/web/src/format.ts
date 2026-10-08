/** 金币显示:四舍五入到 0.1(服务端工资 0.5 币/分粒度),整数值不带小数点 */
export function formatCoins(coins: number): string {
  const rounded = Math.round(coins * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 游戏分钟 → 第 X 天 HH:MM(记忆条目时间戳) */
export function formatGameMinutes(gameMinutes: number | null): string {
  if (gameMinutes === null) return '未知时刻';
  const day = Math.floor(gameMinutes / 1440) + 1;
  const hh = String(Math.floor((gameMinutes % 1440) / 60)).padStart(2, '0');
  const mm = String(gameMinutes % 60).padStart(2, '0');
  return `第 ${day} 天 ${hh}:${mm}`;
}
