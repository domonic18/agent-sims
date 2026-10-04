/** 金币显示:四舍五入到 0.1(服务端工资 0.5 币/分粒度),整数值不带小数点 */
export function formatCoins(coins: number): string {
  const rounded = Math.round(coins * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
