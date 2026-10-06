import { useEffect, useState } from 'react';
import type { AssetAnimConfig } from '@sims/shared';
import { CHARACTER_ROW_OFFSETS, characterVariant } from '../../game/assets';
import { fetchGameAssetRegistry, type GameAssetRegistry } from '../../game/manifest';

interface AvatarFrame {
  url: string;
  frameWidth: number;
  frameHeight: number;
  col: number;
  row: number;
}

let registryPromise: Promise<GameAssetRegistry> | null = null;

function loadRegistry(): Promise<GameAssetRegistry> {
  registryPromise ??= fetchGameAssetRegistry();
  return registryPromise;
}

/** 角色清单素材 → 头像帧信息(idle 组 down 朝向首帧,与画布渲染同源同变体) */
function frameOf(registry: GameAssetRegistry, characterId: string): AvatarFrame | null {
  const slug = characterVariant(characterId, registry.characterSlugs);
  const entry = registry.bySlug.get(slug);
  if (entry === undefined || entry.anim === null) return null;
  const anim: AssetAnimConfig = entry.anim;
  const start = ((anim.groups.idle ?? 0) + CHARACTER_ROW_OFFSETS.down) * anim.columns;
  return {
    url: `/assets/${entry.url}`,
    frameWidth: anim.frameWidth,
    frameHeight: anim.frameHeight,
    col: start % anim.columns,
    row: Math.floor(start / anim.columns),
  };
}

/**
 * 像素头像(UI-1): 从角色 sprite 表裁首帧的 CSS 切图,与画布同 atlas 同变体,
 * 浑然一体。img 先平移到目标帧再统一放大,无需知道整表尺寸。
 */
export function PixelAvatar({ characterId, size = 48 }: { characterId: string; size?: number }) {
  const [frame, setFrame] = useState<AvatarFrame | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRegistry()
      .then((registry) => {
        if (!cancelled) setFrame(frameOf(registry, characterId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  const scale = size >= 44 ? 3 : 2;
  return (
    <span className="px-avatar" style={{ width: size, height: size }}>
      {frame !== null && (
        <img
          src={frame.url}
          alt=""
          style={{
            transform: `scale(${scale}) translate(${(-frame.col * frame.frameWidth).toFixed(1)}px, ${(-frame.row * frame.frameHeight).toFixed(1)}px)`,
            transformOrigin: 'top left',
            imageRendering: 'pixelated',
          }}
        />
      )}
    </span>
  );
}
