import { useEffect, useState } from 'react';
import type { AssetAnimConfig } from '@sims/shared';
import { CHARACTER_ROW_OFFSETS, characterVariant } from '../../game/assets';
import { fetchGameAssetRegistry, type GameAssetRegistry } from '../../game/manifest';

interface AvatarFrame {
  url: string;
  col: number;
  row: number;
  frameWidth: number;
  frameHeight: number;
}

/** 帧内艺术区实测包围盒(像素级): 不同表(通用/预置)艺术区在格内位置不同,不硬编码契约 */
interface ArtBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 全身像放大倍数: 整数倍最近邻保像素锐利;实测包围盒 ×2 后在框内居中 */
const ART_SCALE = 2;

/** sheet url+格坐标 → 艺术区包围盒(同帧只测一次;canvas 读同源 /assets 无污染) */
const boundsCache = new Map<string, ArtBounds | null>();

async function measureArtBounds(url: string, col: number, row: number, cellW: number, cellH: number): Promise<ArtBounds | null> {
  const key = `${url}#${col},${row}`;
  const cached = boundsCache.get(key);
  if (cached !== undefined) return cached;
  const bounds = await new Promise<ArtBounds | null>((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = cellW;
      canvas.height = cellH;
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
      const { data } = ctx.getImageData(0, 0, cellW, cellH);
      let minX = cellW;
      let minY = cellH;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < cellH; y += 1) {
        for (let x = 0; x < cellW; x += 1) {
          if (data[(y * cellW + x) * 4 + 3]! > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      resolve(maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    };
    img.src = url;
  });
  boundsCache.set(key, bounds);
  return bounds;
}

/** 角色清单素材 → 头像帧信息(idle 组 down 朝向首帧所在格,与画布渲染同源同变体) */
function frameOf(registry: GameAssetRegistry, characterId: string): AvatarFrame | null {
  const slug = characterVariant(characterId, registry.characterSlugs);
  const entry = registry.bySlug.get(slug);
  if (entry === undefined || entry.anim === null) return null;
  const anim: AssetAnimConfig = entry.anim;
  const start = ((anim.groups.idle ?? 0) + CHARACTER_ROW_OFFSETS.down) * anim.columns;
  return {
    url: `/assets/${entry.url}`,
    col: start % anim.columns,
    row: Math.floor(start / anim.columns),
    frameWidth: anim.frameWidth,
    frameHeight: anim.frameHeight,
  };
}

/**
 * 像素头像(UI-1): 从角色 sprite 表裁 idle 首帧全身像的 CSS 切图,与画布同 atlas
 * 同变体。格内艺术区逐表实测(canvas 扫 alpha 包围盒,结果缓存)——预置表艺术区
 * 偏左(x8)与通用表(右半 x16)不同,硬编码契约必然错位;失败回落整格居中展示。
 */
export function PixelAvatar({ characterId, size = 48 }: { characterId: string; size?: number }) {
  const [frame, setFrame] = useState<AvatarFrame | null>(null);
  const [bounds, setBounds] = useState<ArtBounds | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBounds(null);
    void fetchGameAssetRegistry()
      .then((registry) => {
        const next = frameOf(registry, characterId);
        if (cancelled) return;
        setFrame(next);
        if (next !== null) {
          void measureArtBounds(next.url, next.col, next.row, next.frameWidth, next.frameHeight).then(
            (measured) => {
              if (!cancelled) setBounds(measured);
            },
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  // 实测包围盒 ×2 整数放大居中;无实测(加载中/失败)先整格 1 倍居中兜底,测完再放大
  const crop = bounds ?? { x: 0, y: 0, w: frame?.frameWidth ?? 32, h: frame?.frameHeight ?? 32 };
  const scale = bounds === null ? Math.max(1, Math.floor(size / crop.h)) : ART_SCALE;
  const drawW = crop.w * scale;
  const drawH = crop.h * scale;
  return (
    <span className="px-avatar" style={{ width: size, height: size }}>
      {frame !== null && (
        <img
          src={frame.url}
          alt=""
          style={{
            left: (size - drawW) / 2,
            top: (size - drawH) / 2,
            transform: `scale(${scale}) translate(${(-crop.x).toFixed(1)}px, ${(-crop.y).toFixed(1)}px)`,
            transformOrigin: 'top left',
            imageRendering: 'pixelated',
          }}
        />
      )}
    </span>
  );
}
