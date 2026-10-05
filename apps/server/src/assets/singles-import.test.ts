import { describe, expect, it } from 'vitest';
import { matchKindBySize, parseIndoorTheme, parseOutdoorFilename } from './singles-import.js';

describe('parseOutdoorFilename 户外语义文件名', () => {
  it('标准命名解析 theme/kind/name', () => {
    const parsed = parseOutdoorFilename('21_Beach_16x16_Bamboo_Bar_Chiar_1.png');
    expect(parsed).toEqual({
      theme: 'beach',
      kindSlug: 'bamboo-bar-chiar',
      name: 'Bamboo Bar Chiar 1',
    });
  });

  it('变体后缀(Sand/Stone/Wood)并入素材名,kind 去变体', () => {
    const parsed = parseOutdoorFilename('21_Beach_16x16_Ball_Sand.png');
    expect(parsed?.kindSlug).toBe('ball');
    expect(parsed?.name).toBe('Ball Sand');
  });

  it('非语义命名返回 null', () => {
    expect(parseOutdoorFilename('115.png')).toBeNull();
    expect(parseOutdoorFilename('readme.txt')).toBeNull();
  });

  it('ME_Singles 形态解析 theme/kind/NxN 占地', () => {
    const parsed = parseOutdoorFilename('ME_Singles_Camping_2x2_Tree_1.png');
    expect(parsed?.theme).toBe('camping');
    expect(parsed?.kindSlug).toBe('tree');
    expect(parsed?.name).toBe('Tree 1');
    expect(parsed?.grid).toEqual({ w: 2, h: 2 });
  });

  it('ME_Singles 形态尾部多组编号并入变体', () => {
    const parsed = parseOutdoorFilename('ME_Singles_City_Terrains_1x1_Sidewalk_2_1.png');
    expect(parsed?.theme).toBe('city-terrains');
    expect(parsed?.kindSlug).toBe('sidewalk');
    expect(parsed?.name).toBe('Sidewalk 2 1');
  });
});

describe('parseIndoorTheme 室内目录名', () => {
  it('编号前缀剥离', () => {
    expect(parseIndoorTheme('8_Gym_Singles')).toBe('gym');
    expect(parseIndoorTheme('4_Bedroom_Singles')).toBe('bedroom');
  });

  it('不匹配目录名原样 kebab', () => {
    expect(parseIndoorTheme('MiscDir')).toBe('misc-dir');
  });
});

describe('matchKindBySize 尺寸指纹', () => {
  it('精确命中已验证 kind', () => {
    expect(matchKindBySize(32, 38)).toBe('bed');
    expect(matchKindBySize(20, 36)).toBe('treadmill');
  });

  it('近似尺寸不命中(健身车 16x28 ≠ 跑步机)', () => {
    expect(matchKindBySize(16, 28)).toBeNull();
  });

  it('未知尺寸返回 null', () => {
    expect(matchKindBySize(64, 64)).toBeNull();
  });
});
