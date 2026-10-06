import { describe, expect, it } from 'vitest';
import { isLeaseValid } from '../src';

describe('isLeaseValid 租约谓词(TD-1 双端同源)', () => {
  it('自有产权恒有效,paidThroughDay 忽略', () => {
    expect(isLeaseValid({ ownership: 'owned', paidThroughDay: 0 }, 100)).toBe(true);
  });

  it('租赁: 付到日 ≥ 今日有效,过期无效;null(无住宿)放行——床位归属另有校验,租约不背此责', () => {
    expect(isLeaseValid({ ownership: 'rent', paidThroughDay: 4 }, 4)).toBe(true);
    expect(isLeaseValid({ ownership: 'rent', paidThroughDay: 4 }, 5)).toBe(false);
    expect(isLeaseValid(null, 1)).toBe(true);
  });
});
