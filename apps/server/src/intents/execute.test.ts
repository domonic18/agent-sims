import { describe, expect, it } from 'vitest';
import {
  buyItemIntentSchema,
  buyPropertyIntentSchema,
  chatIntentSchema,
  eatItemIntentSchema,
  moveToIntentSchema,
  rentPropertyIntentSchema,
  stopMoveIntentSchema,
  storeItemIntentSchema,
  takeItemIntentSchema,
} from '@sims/shared';
import { executeIntent } from './execute.js';
import { Simulation } from '../world/simulation.js';

describe('executeIntent 意图执行', () => {
  it('move_to 校验通过后设置路径并返回摘要', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 8, 12);
    const parsed = moveToIntentSchema.parse({ type: 'move_to', characterId: 'jev', x: 12, y: 12 });
    const result = executeIntent(sim, parsed);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('4 格');
    expect(sim.character('jev').path.at(-1)).toEqual({ x: 12, y: 12 });
  });

  it('协议层拒绝非法意图(缺字段/错误类型)', () => {
    expect(() => moveToIntentSchema.parse({ type: 'move_to', characterId: 'jev' })).toThrow();
    expect(() => moveToIntentSchema.parse({ type: 'fly_to', characterId: 'jev', x: 1, y: 1 })).toThrow();
  });

  it('stop_move: 行进中清空路径即停,静止时幂等;未知角色拒绝', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 8, 12);
    sim.requestMoveTo('jev', 12, 12);
    expect(sim.character('jev').path.length).toBeGreaterThan(0);
    const stopped = executeIntent(sim, stopMoveIntentSchema.parse({ type: 'stop_move', characterId: 'jev' }));
    expect(stopped).toMatchObject({ ok: true });
    expect(stopped.message).toContain('停止移动');
    expect(sim.character('jev').path).toEqual([]);
    const idle = executeIntent(sim, stopMoveIntentSchema.parse({ type: 'stop_move', characterId: 'jev' }));
    expect(idle.ok).toBe(true); // 幂等:静止再停无副作用
    expect(() => stopMoveIntentSchema.parse({ type: 'stop_move' })).toThrow();
    expect(() =>
      executeIntent(sim, stopMoveIntentSchema.parse({ type: 'stop_move', characterId: 'ghost' })),
    ).toThrow(/角色不存在/);
  });

  it('业务校验:不可行走/未知角色抛错', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 8, 12);
    expect(() =>
      executeIntent(sim, moveToIntentSchema.parse({ type: 'move_to', characterId: 'jev', x: 0, y: 0 })),
    ).toThrow(/不可行走/);
    expect(() =>
      executeIntent(sim, moveToIntentSchema.parse({ type: 'move_to', characterId: 'ghost', x: 13, y: 12 })),
    ).toThrow(/角色不存在/);
  });

  it('buy_item: 店内购买入背包(不即食),余额不足拒绝', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 23, 28); // 商店内部
    sim.character('jev').coins = 30;
    const bought = executeIntent(sim, buyItemIntentSchema.parse({ type: 'buy_item', characterId: 'jev', itemId: 'coffee' }));
    expect(bought.ok).toBe(true);
    expect(bought.message).toContain('放入背包');
    expect(sim.character('jev').coins).toBe(24);
    expect(sim.character('jev').backpack).toEqual({ coffee: 1 });
    sim.character('jev').coins = 5;
    expect(() =>
      executeIntent(sim, buyItemIntentSchema.parse({ type: 'buy_item', characterId: 'jev', itemId: 'cake' })),
    ).toThrow(/金币不足/);
  });

  it('eat_item: 任意地点进食结算并清背包', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 23, 28); // 商店内部(原地即吃,无须回家)
    sim.character('jev').coins = 30;
    executeIntent(sim, buyItemIntentSchema.parse({ type: 'buy_item', characterId: 'jev', itemId: 'coffee' }));
    sim.character('jev').energy = 90; // 留出增益空间(上限 100 夹取)
    const energy = sim.character('jev').energy;
    const eaten = executeIntent(sim, eatItemIntentSchema.parse({ type: 'eat_item', characterId: 'jev', itemId: 'coffee' }));
    expect(eaten.ok).toBe(true);
    expect(eaten.message).toContain('吃掉');
    expect(sim.character('jev').energy).toBeCloseTo(energy + 10, 5);
    expect(sim.character('jev').backpack).toEqual({});
  });

  it('store/take_item: 须回家存取冰箱,消息带存取后余量', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 23, 28); // 商店,首个生成 → home-a
    sim.character('jev').coins = 30;
    executeIntent(sim, buyItemIntentSchema.parse({ type: 'buy_item', characterId: 'jev', itemId: 'coffee' }));
    expect(() =>
      executeIntent(sim, storeItemIntentSchema.parse({ type: 'store_item', characterId: 'jev', itemId: 'coffee', count: 1 })),
    ).toThrow(/须回到/); // 还在商店,不在家
    sim.character('jev').x = 11;
    sim.character('jev').y = 7; // home-a 室内
    const stored = executeIntent(sim, storeItemIntentSchema.parse({ type: 'store_item', characterId: 'jev', itemId: 'coffee', count: 1 }));
    expect(stored.ok).toBe(true);
    expect(stored.message).toContain('存入冰箱');
    expect(sim.character('jev').backpack).toEqual({});
    expect(sim.character('jev').fridge).toEqual({ coffee: 1 });
    const taken = executeIntent(sim, takeItemIntentSchema.parse({ type: 'take_item', characterId: 'jev', itemId: 'coffee', count: 1 }));
    expect(taken.ok).toBe(true);
    expect(taken.message).toContain('从冰箱取出');
    expect(sim.character('jev').backpack).toEqual({ coffee: 1 });
    expect(sim.character('jev').fridge).toEqual({});
    expect(() =>
      executeIntent(sim, takeItemIntentSchema.parse({ type: 'take_item', characterId: 'jev', itemId: 'coffee', count: 1 })),
    ).toThrow(/不足/); // 冰箱已空
  });

  it('rent/buy_property: 返回摘要消息', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 8, 12);
    sim.character('jev').coins = 600;
    const rented = executeIntent(sim, rentPropertyIntentSchema.parse({ type: 'rent_property', characterId: 'jev', propertyId: 'home-a' }));
    expect(rented.message).toContain('租约付至第');
    const bought = executeIntent(sim, buyPropertyIntentSchema.parse({ type: 'buy_property', characterId: 'jev', propertyId: 'home-a' }));
    expect(bought.message).toContain('买下');
  });

  it('chat: 同处一地闲聊回执带对话内容,距离太远拒绝', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 8, 12);
    sim.spawnCharacter('mia', 9, 12);
    const chatted = executeIntent(sim, chatIntentSchema.parse({ type: 'chat', characterId: 'jev', targetId: 'mia' }));
    expect(chatted.ok).toBe(true);
    expect(chatted.message).toMatch(/^jev 对 mia 说:「.+」$/);
    sim.requestMoveTo('mia', 13, 15);
    sim.advanceTicks(sim.character('mia').path.length);
    expect(() =>
      executeIntent(sim, chatIntentSchema.parse({ type: 'chat', characterId: 'jev', targetId: 'mia' })),
    ).toThrow(/距离太远/);
  });

  it('chat 自定义台词(C3): line 透传回执,超 80 字协议拒绝', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 8, 12);
    sim.spawnCharacter('mia', 9, 12);
    const chatted = executeIntent(
      sim,
      chatIntentSchema.parse({ type: 'chat', characterId: 'jev', targetId: 'mia', line: '多谢相救！' }),
    );
    expect(chatted.ok).toBe(true);
    expect(chatted.message).toContain('多谢相救！');
    expect(() =>
      chatIntentSchema.parse({ type: 'chat', characterId: 'jev', targetId: 'mia', line: '啊'.repeat(81) }),
    ).toThrow();
  });

  it('世界规则关闭聊天(M5): chat 返回 ok=false 且不产生社交关系', () => {
    const sim = new Simulation();
    sim.spawnCharacter('jev', 8, 12);
    sim.spawnCharacter('mia', 9, 12);
    sim.rules.allowChat = false;
    const result = executeIntent(sim, chatIntentSchema.parse({ type: 'chat', characterId: 'jev', targetId: 'mia' }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('聊天已关闭');
    expect(sim.socials.size).toBe(0);
  });
});
