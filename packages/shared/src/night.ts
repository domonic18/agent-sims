/**
 * 昼夜渲染强度(纯展示函数): server 协议只带布尔 isNight,夜色渐变由
 * web 端按快照 clock.gameMinutes 本地计算。夜幕 20:00 起渐入、22:00 全夜,
 * 黎明 04:00 起渐出、06:00 全昼——在 isNight(22:00~06:00)边界外各留
 * 一小时过渡,避免昼夜硬切。
 */
export const NIGHT_FADE_START = 20 * 60;
export const NIGHT_FADE_END = 22 * 60;
export const DAWN_FADE_START = 4 * 60;
export const DAWN_FADE_END = 6 * 60;

const DAY_MINUTES = 1440;

/** 夜色强度 0(白昼)~1(深夜): 黄昏/黎明各两小时线性过渡 */
export function nightIntensity(gameMinutes: number): number {
  const minute = ((gameMinutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (minute >= NIGHT_FADE_END || minute < DAWN_FADE_START) return 1;
  if (minute < DAWN_FADE_END) {
    return 1 - (minute - DAWN_FADE_START) / (DAWN_FADE_END - DAWN_FADE_START);
  }
  if (minute >= NIGHT_FADE_START) {
    return (minute - NIGHT_FADE_START) / (NIGHT_FADE_END - NIGHT_FADE_START);
  }
  return 0;
}
