import { useEffect, useState } from 'react';
import type { AssetAnimConfig } from '@sims/shared';
import { CHARACTER_ROW_OFFSETS, characterVariant } from '../../game/assets';
import { fetchGameAssetRegistry, type GameAssetRegistry } from '../../game/manifest';

interface AvatarFrame {
  url: string;
  col: number;
  row: number;
}

/** LimeZu 角色表帧内艺术区契约: 32px 格内艺术占右半 16px、顶部 +13px、高 24px(越出格底 5px) */
const ART_OFFSET_X = 16;
const ART_OFFSET_Y = 13;
const ART_W = 16;
/** 全身像放大倍数: 16x24 艺术区 ×2 = 32x48,恰好填满 48px 头像框高度 */
const ART_SCALE = 2;

let registryPromise: Promise<GameAssetRegistry> | null = null;

function loadRegistry(): Promise<GameAssetRegistry> {
  registryPromise ??= fetchGameAssetRegistry();
  return registryPromise;
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
  };
}

/**
 * 像素头像(UI-1): 从角色 sprite 表裁 idle 首帧全身像的 CSS 切图,与画布同 atlas
 * 同变体。img 平移到帧内艺术区再统一放大;表为 32px 格契约,艺术区偏移见常量。
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

  const width = ART_W * ART_SCALE;
  return (
    <span className="px-avatar" style={{ width: size, height: size }}>
      {frame !== null && (
        <img
          src={frame.url}
          alt=""
          style={{
            left: (size - width) / 2,
            transform: `scale(${ART_SCALE}) translate(${(-frame.col * 32 - ART_OFFSET_X).toFixed(1)}px, ${(-frame.row * 32 - ART_OFFSET_Y).toFixed(1)}px)`,
            transformOrigin: 'top left',
            imageRendering: 'pixelated',
          }}
        />
      )}
    </span>
  );
}
