/**
 * 左下角模型心跳仪表(UI 反馈): 心电图风格小窗实时展示模型调用脉冲,
 * 附 slow/light/jev 三槽位累计 Token 总量(万/亿缩写,不细分)。
 * 低存在感: 小尺寸+半透明;点击 × 收起为呼吸圆点(偏好存 localStorage),圆点点击展开。
 */
import { useEffect, useRef, useState } from 'react';
import type { ModelPulseView } from '@sims/shared';
import { getModelPulse } from '../../net/worldApi';

const POLL_MS = 3_000;
const COLLAPSE_KEY = 'sims.pulse.collapsed';

const SLOT_LABELS = { slow: '慢', light: '轻', jev: '决' } as const;

/** 主流计量缩写: <1万 原值,≥1万 x.x万,≥1亿 x.x亿 */
function formatTokens(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万`;
  return String(n);
}

/** 心电折线: 基线走平,有调用的桶起尖峰,末点带亮珠 */
function drawElectrocardiogram(canvas: HTMLCanvasElement, pulse: number[]): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const base = h - 4;
  const amplitude = h - 8;
  const max = Math.max(1, ...pulse);
  ctx.strokeStyle = 'rgba(86, 108, 134, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, base + 0.5);
  ctx.lineTo(w, base + 0.5);
  ctx.stroke();
  ctx.strokeStyle = '#4ade80';
  ctx.shadowColor = 'rgba(74, 222, 128, 0.7)';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  const step = w / (pulse.length - 1);
  for (let i = 0; i < pulse.length; i += 1) {
    const x = i * step;
    const y = base - ((pulse[i] ?? 0) / max) * amplitude;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  const last = pulse[pulse.length - 1] ?? 0;
  ctx.fillStyle = last > 0 ? '#4ade80' : 'rgba(74, 222, 128, 0.45)';
  ctx.beginPath();
  ctx.arc(w - 1.5, base - (last / max) * amplitude, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

export function ModelPulse() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [data, setData] = useState<ModelPulseView | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (collapsed) return;
    let alive = true;
    const tick = async (): Promise<void> => {
      if (document.hidden) return;
      try {
        const view = await getModelPulse();
        if (alive) setData(view);
      } catch {
        // 静默:仪表属低存在感装饰,断连不打扰玩家
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [collapsed]);

  useEffect(() => {
    if (collapsed || data === null || canvasRef.current === null) return;
    drawElectrocardiogram(canvasRef.current, data.pulse);
  }, [collapsed, data]);

  if (collapsed) {
    return (
      <button
        type="button"
        className="hud-model-pulse-dot"
        aria-label="展开模型调用仪表"
        title="展开模型调用仪表"
        onClick={() => {
          localStorage.removeItem(COLLAPSE_KEY);
          setCollapsed(false);
        }}
      />
    );
  }

  return (
    <div className="hud-model-pulse" title="模型调用脉冲(近1分钟)">
      <canvas ref={canvasRef} className="pulse-canvas" />
      <div className="pulse-tokens">
        {(['slow', 'light', 'jev'] as const).map((slot) => (
          <span key={slot}>
            <i>{SLOT_LABELS[slot]}</i>
            {data === null ? '—' : formatTokens(data.totals[slot])}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="pulse-toggle"
        aria-label="收起模型调用仪表"
        title="收起"
        onClick={() => {
          localStorage.setItem(COLLAPSE_KEY, '1');
          setCollapsed(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
