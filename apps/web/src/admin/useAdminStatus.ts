import { useEffect, useState } from 'react';
import { fetchTokenUsageSummary, fetchWorlds } from './api';

export interface AdminWorldStatus {
  name: string;
  characters: number;
  createdAt: string;
}

export interface AdminStatus {
  world: AdminWorldStatus | null;
  /** 今日 tokens 汇总 */
  tokensToday: number | null;
  /** 今日调用次数 */
  callsToday: number | null;
}

/** 顶栏世界状态条: 当前活跃世界 + 今日 Token 读数,60s 轮询,失败静默降级为 null */
export function useAdminStatus(enabled: boolean): AdminStatus {
  const [status, setStatus] = useState<AdminStatus>({ world: null, tokensToday: null, callsToday: null });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      const next: AdminStatus = { world: null, tokensToday: null, callsToday: null };
      try {
        const worlds = await fetchWorlds();
        const active = worlds.find((w) => w.status === 'active') ?? null;
        if (active) {
          next.world = { name: active.name, characters: active.characters.length, createdAt: active.createdAt };
        }
      } catch {
        // 静默降级: 状态条显示「—」,不打扰主流程
      }
      try {
        const usage = await fetchTokenUsageSummary('today');
        next.tokensToday = usage.kpi.totalTokens;
        next.callsToday = usage.kpi.calls;
      } catch {
        // 同上
      }
      if (alive) setStatus(next);
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return status;
}

/** 仪表读数格式: 1234 → 1.2k */
export function fmtTokens(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
