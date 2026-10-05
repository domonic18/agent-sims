import { describe, expect, it } from 'vitest';
import { WORLD_PRESETS, WORLD_TIME_SCALES } from '@sims/shared';
import { BALANCE_DEFAULTS, validateBalanceOverrides } from '../src/config/balance.js';

// 纯逻辑校验:预设表是设置菜单一键应用的数据源,取值错误会在运行期被
// validateBalanceOverrides 拒绝,这里前移到 CI 拦截。
describe('难度预设表', () => {
  it('三档 id 唯一且含标准档', () => {
    const ids = WORLD_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('standard');
  });

  it('每档 params 合法、均偏离默认、倍率在档位表内', () => {
    for (const preset of WORLD_PRESETS) {
      expect(validateBalanceOverrides(preset.params), preset.id).toEqual([]);
      for (const [key, value] of Object.entries(preset.params)) {
        expect(value, `${preset.id}.${key}`).not.toBe(BALANCE_DEFAULTS[key]);
      }
      expect(WORLD_TIME_SCALES).toContain(preset.rules.initialTimeScale);
    }
  });

  it('标准档=默认规则+空覆盖', () => {
    const standard = WORLD_PRESETS.find((preset) => preset.id === 'standard');
    expect(standard?.rules).toEqual({ allowDeath: true, allowChat: true, initialTimeScale: 1 });
    expect(standard?.params).toEqual({});
  });
});
