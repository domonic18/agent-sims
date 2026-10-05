import { useEffect, useRef, useState } from 'react';
import { Slider, Tooltip } from 'antd';
import type { AssetAnimConfig } from '@sims/shared';

/**
 * 素材放大校验器(M-L.2,design/05 §3):canvas 像素级放大(NEAREST 效果
 * 经 imageSmoothingEnabled=false)+可选动画帧网格(帧框/组行标注),
 * 供 draft→active 人工校验——终结"盲裁无校验"。
 */
export function SpriteInspector({
  url,
  width,
  height,
  anim,
}: {
  url: string;
  width: number;
  height: number;
  anim: AssetAnimConfig | null;
}) {
  const [scale, setScale] = useState(4);
  const [showGrid, setShowGrid] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.src = url;
    image.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      const cell = Math.max(width, height) * scale + 24;
      canvas.width = cell;
      canvas.height = cell;
      ctx.clearRect(0, 0, cell, cell);
      ctx.imageSmoothingEnabled = false;
      const offsetX = Math.floor((cell - width * scale) / 2);
      const offsetY = Math.floor((cell - height * scale) / 2);
      ctx.drawImage(image, offsetX, offsetY, width * scale, height * scale);
      if (anim !== null && showGrid) {
        const { frameWidth, frameHeight, groups } = anim;
        ctx.strokeStyle = 'rgba(24,144,255,0.55)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= width; x += frameWidth) {
          ctx.beginPath();
          ctx.moveTo(offsetX + x * scale + 0.5, offsetY);
          ctx.lineTo(offsetX + x * scale + 0.5, offsetY + height * scale);
          ctx.stroke();
        }
        for (let y = 0; y <= height; y += frameHeight) {
          ctx.beginPath();
          ctx.moveTo(offsetX, offsetY + y * scale + 0.5);
          ctx.lineTo(offsetX + width * scale, offsetY + y * scale + 0.5);
          ctx.stroke();
        }
        ctx.font = '10px monospace';
        for (const [group, baseRow] of Object.entries(groups)) {
          const labelY = offsetY + baseRow * frameHeight * scale;
          ctx.fillStyle = 'rgba(24,144,255,0.9)';
          ctx.fillRect(offsetX - 2, labelY, 58, 14);
          ctx.fillStyle = '#fff';
          ctx.fillText(group, offsetX + 2, labelY + 11);
        }
      }
    };
    return () => {
      cancelled = true;
    };
  }, [url, width, height, scale, showGrid, anim]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: '#57606a' }}>放大</span>
        <Slider
          style={{ flex: 1, margin: 0 }}
          min={1}
          max={16}
          step={1}
          value={scale}
          onChange={setScale}
        />
        <span style={{ fontSize: 12, width: 32 }}>{scale}x</span>
        {anim !== null && (
          <Tooltip title="按动画帧配置叠加帧框与组标注">
            <label style={{ fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />{' '}
              帧网格
            </label>
          </Tooltip>
        )}
      </div>
      <div
        style={{
          background:
            'repeating-conic-gradient(#e8e8e8 0% 25%, #f6f6f6 0% 50%) 0 0 / 16px 16px',
          border: '1px solid #d9d9d9',
          borderRadius: 4,
          display: 'flex',
          justifyContent: 'center',
          padding: 8,
        }}
      >
        <canvas ref={canvasRef} style={{ maxWidth: '100%', imageRendering: 'pixelated' }} />
      </div>
      <div style={{ fontSize: 12, color: '#57606a', marginTop: 4 }}>
        {width}×{height}px
      </div>
    </div>
  );
}
