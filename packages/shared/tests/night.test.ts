import { describe, expect, it } from 'vitest';
import {
  DAWN_FADE_END,
  DAWN_FADE_START,
  NIGHT_FADE_END,
  NIGHT_FADE_START,
  nightIntensity,
} from '../src/night.js';

describe('nightIntensity 昼夜渐变', () => {
  it('拐点: 白昼为 0,深夜为 1,正午/午夜', () => {
    expect(nightIntensity(12 * 60)).toBe(0);
    expect(nightIntensity(NIGHT_FADE_START - 1)).toBe(0);
    expect(nightIntensity(NIGHT_FADE_END)).toBe(1);
    expect(nightIntensity(0)).toBe(1);
    expect(nightIntensity(DAWN_FADE_START - 1)).toBe(1);
  });

  it('黄昏线性渐入,黎明线性渐出', () => {
    expect(nightIntensity(NIGHT_FADE_START)).toBe(0);
    expect(nightIntensity(NIGHT_FADE_START + 30)).toBeCloseTo(0.25);
    expect(nightIntensity(NIGHT_FADE_END - 30)).toBeCloseTo(0.75);
    expect(nightIntensity(DAWN_FADE_START)).toBe(1);
    expect(nightIntensity(DAWN_FADE_START + 30)).toBeCloseTo(0.75);
    expect(nightIntensity(DAWN_FADE_END - 1)).toBeGreaterThan(0);
    expect(nightIntensity(DAWN_FADE_END)).toBe(0);
  });

  it('跨天 gameMinutes(次日/多日后)取模稳定', () => {
    expect(nightIntensity(1440 + NIGHT_FADE_END + 5)).toBe(1);
    expect(nightIntensity(3 * 1440 + 12 * 60)).toBe(0);
    expect(nightIntensity(2 * 1440 + NIGHT_FADE_START + 60)).toBeCloseTo(0.5);
  });
});
