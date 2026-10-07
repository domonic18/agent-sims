import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_DEFINITIONS,
  CRAFT_RECIPE_IDS,
  cloneRecipes,
  defaultRecipes,
  getActivityDefinition,
  validateRecipes,
} from '../src';

describe('配方配置化(2026-10-07,design/09 §3)', () => {
  it('defaultRecipes: 快照字段(时长/场所/类别/启停)与活动定义一致', () => {
    const recipes = defaultRecipes();
    for (const id of CRAFT_RECIPE_IDS) {
      const activity = getActivityDefinition(id);
      expect(activity).not.toBeNull();
      expect(recipes[id].enabled).toBe(true);
      expect(recipes[id].durationMinutes).toBe(activity!.durationMinutes);
      expect(recipes[id].placeIds).toEqual([...activity!.placeIds]);
      expect(recipes[id].category).toBe(activity!.category);
    }
  });

  it('cloneRecipes: 深拷贝隔离——改副本材料/场地不漏回源表', () => {
    const source = defaultRecipes();
    const copy = cloneRecipes(source);
    copy.craft_bread.inputs[0]!.count = 99;
    copy.craft_bread.placeIds = ['elsewhere'];
    copy.craft_bread.enabled = false;
    expect(source.craft_bread.inputs[0]!.count).toBe(2);
    expect(source.craft_bread.placeIds).toEqual(['restaurant']);
    expect(source.craft_bread.enabled).toBe(true);
  });

  it('validateRecipes: 合法全集零错误', () => {
    expect(validateRecipes(defaultRecipes())).toEqual([]);
  });

  it('validateRecipes: 缺项/坏 ItemId/越界数量/坏时长/未知类别逐项拒绝', () => {
    const recipes = defaultRecipes() as unknown as Record<string, Record<string, unknown>>;
    const broken = {
      ...recipes,
      craft_bread: {
        ...recipes.craft_bread!,
        name: '',
        inputs: [{ itemId: 'not_an_item', count: 2 }],
        outputs: [{ itemId: 'bread', count: 0 }],
        durationMinutes: 0,
        stationKind: 'oven',
        placeIds: [],
        category: 'chef',
      },
      craft_sandwich: undefined,
    };
    const errors = validateRecipes(broken);
    expect(errors).toContain('craft_bread.name: 须为 1~20 字文本');
    expect(errors).toContain('craft_bread.stationKind: 仅支持 stove/workbench');
    expect(errors).toContain('craft_bread.durationMinutes: 须为 1~600 整数分钟');
    expect(errors).toContain('craft_bread.inputs: 须为 1~6 项材料(ItemId 在目录内,数量 1~99 整数)');
    expect(errors).toContain('craft_bread.outputs: 须为 1~6 项产物(ItemId 在目录内,数量 1~99 整数)');
    expect(errors).toContain('craft_bread.placeIds: 须为非空场所 id 数组');
    expect(errors).toContain('craft_bread.category: 未知岗位类别');
    expect(errors).toContain('craft_sandwich: 缺少配方定义');
  });

  it('活动目录 4 条 craft 活动仍在(CraftRecipeId 与 ACTIVITY_DEFINITIONS 对齐)', () => {
    for (const id of CRAFT_RECIPE_IDS) {
      expect(ACTIVITY_DEFINITIONS.some((def) => def.id === id)).toBe(true);
    }
  });
});
