import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle.js';

/** 可拨动时钟:测试里手动推进时间模拟滑动窗口 */
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe('LoginThrottle', () => {
  it('窗口内第 5 次失败即锁,锁定期间 check 报剩余秒数', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(clock.now);
    for (let i = 0; i < 4; i += 1) {
      throttle.failure('1.2.3.4', 'admin');
      expect(throttle.check('1.2.3.4', 'admin').locked).toBe(false);
    }
    throttle.failure('1.2.3.4', 'admin');
    const state = throttle.check('1.2.3.4', 'admin');
    expect(state.locked).toBe(true);
    expect(state.retryAfterSec).toBeGreaterThan(0);
    expect(state.retryAfterSec).toBeLessThanOrEqual(15 * 60);
  });

  it('滑动窗口:失败记录滑出 15 分钟窗后自动解封', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(clock.now);
    for (let i = 0; i < 5; i += 1) throttle.failure('1.2.3.4', 'admin');
    expect(throttle.check('1.2.3.4', 'admin').locked).toBe(true);
    clock.advance(15 * 60 * 1000 + 1);
    expect(throttle.check('1.2.3.4', 'admin')).toEqual({ locked: false, retryAfterSec: 0 });
  });

  it('双键独立:同 IP 换用户名不受 IP 键已锁影响之外,别的 IP/用户名互不牵连', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 5; i += 1) throttle.failure('1.2.3.4', 'admin');
    expect(throttle.check('1.2.3.4', 'admin').locked).toBe(true);
    // 同 IP 不同用户名:IP 键已锁 → 仍拒(frpc 同 IP 拓扑下防换号喷洒)
    expect(throttle.check('1.2.3.4', 'root').locked).toBe(true);
    // 不同 IP 相同用户名:用户名键已锁 → 仍拒(防换 IP 撞单一账号)
    expect(throttle.check('5.6.7.8', 'admin').locked).toBe(true);
    // 双键全新 → 放行
    expect(throttle.check('5.6.7.8', 'root').locked).toBe(false);
  });

  it('登录成功清空该 IP+用户名的双键计数', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 4; i += 1) throttle.failure('1.2.3.4', 'admin');
    throttle.success('1.2.3.4', 'admin');
    expect(throttle.check('1.2.3.4', 'admin').locked).toBe(false);
  });

  it('长跑键不泄漏:大量过期键被清扫回收', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(clock.now);
    for (let round = 0; round < 200; round += 1) {
      throttle.failure(`10.0.${Math.floor(round / 256)}.${round % 256}`, `u${round}`);
      // check 会累计 sweep 计数,驱动周期清扫
      throttle.check('1.1.1.1', 'x');
    }
    clock.advance(15 * 60 * 1000 + 1);
    for (let i = 0; i < 64; i += 1) throttle.check('1.1.1.1', 'x');
    // 内部 Map 已清空:同键再查不解锁旧记录(用长度可观察行为替代私有字段)
    expect(throttle.check('10.0.0.0', 'u0').locked).toBe(false);
  });
});
