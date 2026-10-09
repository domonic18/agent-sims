/**
 * 登录防暴力(OPS-2):内存滑动窗口失败计数,按 IP+用户名双键独立判锁。
 * 单实例部署内存态够用(重启即清零,重新计数);任一键命中 15 分钟窗 5 次失败即锁,
 * 锁定期间拒绝在 DB 校验之前(不打询库开销)。双键意义:IP 键防同源喷洒,
 * 用户名键防换 IP 撞单一账号(frpc 本地穿透下所有公网请求在 nginx 侧同 IP,靠它兜底)。
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export interface LockState {
  locked: boolean;
  /** 锁定剩余秒数(向上取整);未锁定为 0 */
  retryAfterSec: number;
}

export class LoginThrottle {
  private readonly hits = new Map<string, number[]>();
  private checksSinceSweep = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly windowMs: number = WINDOW_MS,
    private readonly maxFailures: number = MAX_FAILURES,
  ) {}

  /** 查询是否处于锁定态(只读,不记失败);顺带惰性清理过期记录 */
  check(ip: string, username: string): LockState {
    this.sweep();
    const t = this.now();
    const states = [this.keyState(`ip:${ip}`, t), this.keyState(`user:${username}`, t)];
    const retryAfterMs = Math.max(...states.map((s) => s.retryAfterMs), 0);
    return {
      locked: retryAfterMs > 0,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
    };
  }

  /** 记一次失败;返回后该键是否已达到锁定阈值 */
  failure(ip: string, username: string): void {
    const t = this.now();
    for (const key of [`ip:${ip}`, `user:${username}`]) {
      const hits = this.hits.get(key) ?? [];
      hits.push(t);
      this.hits.set(key, hits);
    }
  }

  /** 登录成功:清双键计数(合法用户偶手滑不背历史包袱) */
  success(ip: string, username: string): void {
    this.hits.delete(`ip:${ip}`);
    this.hits.delete(`user:${username}`);
  }

  private keyState(key: string, t: number): { retryAfterMs: number } {
    const hits = this.hits.get(key);
    if (!hits || hits.length === 0) return { retryAfterMs: 0 };
    const windowStart = t - this.windowMs;
    while (typeof hits[0] === 'number' && hits[0] <= windowStart) hits.shift();
    if (hits.length === 0) {
      this.hits.delete(key);
      return { retryAfterMs: 0 };
    }
    const oldest = hits[0];
    if (hits.length >= this.maxFailures && oldest !== undefined) {
      // 窗口内已满:剩余锁定时长=最早一次失败滑出窗口之时
      return { retryAfterMs: oldest + this.windowMs - t };
    }
    return { retryAfterMs: 0 };
  }

  /** 全表清扫:防长期运行下失效键累积(单实例键量小,低频扫即可) */
  private sweep(): void {
    this.checksSinceSweep += 1;
    if (this.checksSinceSweep < 64) return;
    this.checksSinceSweep = 0;
    const windowStart = this.now() - this.windowMs;
    for (const [key, hits] of this.hits) {
      const alive = hits.filter((hit) => hit > windowStart);
      if (alive.length === 0) this.hits.delete(key);
      else this.hits.set(key, alive);
    }
  }
}
