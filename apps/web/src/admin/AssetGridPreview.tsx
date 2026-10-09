import type { AssetAdminView } from '@sims/shared';

/** 占地预览:图按 16px/格 网格叠加,红框 = gridW×gridH 占地(锚点换算),图错/占地错一眼即见 */
export function GridPreview({ asset, url, scale }: { asset: AssetAdminView; url: string; scale: number }) {
  const cell = 16 * scale;
  const w = asset.width * scale;
  const h = asset.height * scale;
  const gw = asset.gridW * cell;
  const gh = asset.gridH * cell;
  const left = asset.anchor === 'top-left' ? 0 : (w - gw) / 2;
  const top = asset.anchor === 'top-left' ? 0 : h - gh;
  return (
    <div style={{ position: 'relative', width: w, height: h, flex: 'none' }}>
      <img src={url} width={w} height={h} alt={asset.slug} style={{ imageRendering: 'pixelated', display: 'block' }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `repeating-linear-gradient(0deg, rgba(64,120,255,.28) 0 1px, transparent 1px ${cell}px), repeating-linear-gradient(90deg, rgba(64,120,255,.28) 0 1px, transparent 1px ${cell}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width: gw,
          height: gh,
          border: '2px solid rgba(217,45,32,.9)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.55)',
        }}
      />
    </div>
  );
}
