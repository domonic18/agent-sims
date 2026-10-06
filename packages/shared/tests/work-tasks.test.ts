import { describe, expect, it } from 'vitest';
import { countWorkTargets, isGatherTask, nearestWorkTarget, resourceNodeLabel } from '../src';
import type { WorkTargetSnapshotView } from '../src';

const snapshot: WorkTargetSnapshotView = {
  characters: [
    { id: 'ghost', x: 10, y: 10, alive: false, diedAtGameMinutes: 100 },
    { id: 'alive', x: 12, y: 10, alive: true, diedAtGameMinutes: null },
  ],
  resources: [
    { id: 'berry_bush:1:1', kind: 'berry_bush', x: 1, y: 1, charges: 2, respawnAtDay: null },
    { id: 'berry_bush:2:2', kind: 'berry_bush', x: 2, y: 2, charges: 0, respawnAtDay: 2 },
    { id: 'junk_pile:3:3', kind: 'junk_pile', x: 3, y: 3, charges: null, respawnAtDay: null },
  ],
  maintenance: [
    { id: 'litter:5:5', kind: 'litter', x: 5, y: 5, variant: 0 },
    { id: 'fence_damage:6:6', kind: 'fence_damage', x: 6, y: 6, variant: 1 },
  ],
};

describe('工单注册表(TD-1 表驱动)', () => {
  it('countWorkTargets: 按族+kind+存量过滤,浆果丛只数有存量,rescue 只数窗口内幽灵', () => {
    expect(countWorkTargets('gather_berry', snapshot)).toBe(1); // 枯竭丛不计
    expect(countWorkTargets('scavenge', snapshot)).toBe(1);
    expect(countWorkTargets('clean', snapshot)).toBe(1);
    expect(countWorkTargets('repair', snapshot)).toBe(1);
    expect(countWorkTargets('rescue', snapshot)).toBe(1); // 存活角色不计
  });

  it('nearestWorkTarget: 曼哈顿取最近,无候选 null', () => {
    expect(nearestWorkTarget('clean', { x: 4, y: 4 }, snapshot)?.targetId).toBe('litter:5:5');
    expect(nearestWorkTarget('gather_berry', { x: 0, y: 0 }, snapshot)?.targetId).toBe(
      'berry_bush:1:1',
    );
    expect(nearestWorkTarget('repair', { x: 60, y: 60 }, snapshot)?.targetId).toBe(
      'fence_damage:6:6',
    );
    expect(
      nearestWorkTarget('repair', { x: 60, y: 60 }, { ...snapshot, maintenance: [] }),
    ).toBeNull();
  });

  it('isGatherTask/resourceNodeLabel: 采集守卫与节点标签反查', () => {
    expect(isGatherTask('gather_berry')).toBe(true);
    expect(isGatherTask('clean')).toBe(false);
    expect(resourceNodeLabel('berry_bush')).toBe('浆果丛');
    expect(resourceNodeLabel('junk_pile')).toBe('拾荒堆');
    expect(resourceNodeLabel('unknown')).toBe('unknown');
  });
});
