import { useEffect, useRef } from 'react';
import type { TileMapDefinition } from '@sims/shared';
import { mapPixelSize, renderMapDefinition } from './mapRender';

/** 地图定义预览画布(只读):宽度自适应容器,tile 取整缩放,devicePixelRatio 高清渲染 */
export function MapPreviewCanvas({
  definition,
  grid = false,
  labels = true,
}: {
  definition: TileMapDefinition;
  grid?: boolean;
  labels?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (wrap === null || canvas === null) return;
    const draw = (): void => {
      const cssWidth = wrap.clientWidth;
      if (cssWidth <= 0) return;
      const nextTile = Math.max(2, Math.floor(cssWidth / definition.width));
      const { width, height } = mapPixelSize(definition, nextTile);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderMapDefinition(ctx, definition, { tile: nextTile, grid, labels });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [definition, grid, labels]);

  return (
    <div ref={wrapRef} style={{ width: '100%', overflow: 'auto' }}>
      <canvas ref={canvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
    </div>
  );
}
