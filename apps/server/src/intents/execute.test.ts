import { describe, expect, it } from 'vitest';
import {
  buyItemIntentSchema,
  buyPropertyIntentSchema,
  moveToIntentSchema,
  placeFurnitureIntentSchema,
  rentPropertyIntentSchema,
} from '@sims/shared';
import { executeIntent } from './execute.js';
import { Simulation } from '../world/simulation.js';

describe('executeIntent 意图执行', () => {
  it('move_to 校验通过后设置路径并返回摘要', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 5, 7);
    const parsed = moveToIntentSchema.parse({ type: 'move_to', characterId: 'jev', x: 9, y: 7 });
    const result = executeIntent(sim, parsed);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('4 格');
    expect(sim.character('jev').path.at(-1)).toEqual({ x: 9, y: 7 });
  });

  it('协议层拒绝非法意图(缺字段/错误类型)', () => {
    expect(() => moveToIntentSchema.parse({ type: 'move_to', characterId: 'jev' })).toThrow();
    expect(() => moveToIntentSchema.parse({ type: 'fly_to', characterId: 'jev', x: 1, y: 1 })).toThrow();
  });

  it('业务校验:不可行走/未知角色抛错', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 5, 7);
    expect(() =>
      executeIntent(sim, moveToIntentSchema.parse({ type: 'move_to', characterId: 'jev', x: 0, y: 0 })),
    ).toThrow(/不可行走/);
    expect(() =>
      executeIntent(sim, moveToIntentSchema.parse({ type: 'move_to', characterId: 'ghost', x: 6, y: 7 })),
    ).toThrow(/角色不存在/);
  });

  it('buy_item: 家具入库存,余额不足拒绝', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 5, 7);
    sim.character('jev').coins = 30;
    const bought = executeIntent(sim, buyItemIntentSchema.parse({ type: 'buy_item', characterId: 'jev', itemId: 'chair' }));
    expect(bought.ok).toBe(true);
    expect(bought.message).toContain('存入库存');
    expect(sim.character('jev').items).toEqual(['chair']);
    expect(() =>
      executeIntent(sim, buyItemIntentSchema.parse({ type: 'buy_item', characterId: 'jev', itemId: 'bed' })),
    ).toThrow(/金币不足/);
  });

  it('rent/buy_property 与 place_furniture: 返回摘要消息', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 5, 7);
    sim.character('jev').coins = 600;
    const rented = executeIntent(sim, rentPropertyIntentSchema.parse({ type: 'rent_property', characterId: 'jev', propertyId: 'home' }));
    expect(rented.message).toContain('租约付至第');
    const bought = executeIntent(sim, buyPropertyIntentSchema.parse({ type: 'buy_property', characterId: 'jev', propertyId: 'home' }));
    expect(bought.message).toContain('买下');
    sim.character('jev').coins = 100;
    executeIntent(sim, buyItemIntentSchema.parse({ type: 'buy_item', characterId: 'jev', itemId: 'lamp' }));
    const placed = executeIntent(sim, placeFurnitureIntentSchema.parse({ type: 'place_furniture', characterId: 'jev', itemId: 'lamp' }));
    expect(placed.message).toContain('摆放');
    expect(sim.character('jev').housing?.placedItems).toEqual(['lamp']);
  });
});
