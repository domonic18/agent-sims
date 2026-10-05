import { createHash } from 'node:crypto';

/**
 * 种子哈希与顺序 PRNG(design/06):mulberry32(32bit)——种子可枚举可存储;
 * 纪律:生成器全程只经本类取随机,禁止并发分叉消费(破坏可复现)。
 */
export function hashSeed(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0);
}

export class Rng {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed);
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max] 闭区间整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** 原地洗牌(Fisher-Yates,消费次数=长度-1,确定) */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}
