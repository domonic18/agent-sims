import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { WorldScene } from './WorldScene';
import type { TileMapDefinition } from '@sims/shared';
import { fetchGameAssetRegistry } from './manifest';

/** Phaser 画布宿主:先取素材 manifest 再创建世界场景(主页面与 /lab 调试台复用) */
/** 当前世界地图定义(M-L.5:创建向导生成的随机地图与内置地图同源渲染) */
async function fetchMapDefinition(): Promise<TileMapDefinition> {
  const res = await fetch('/api/world/map', { cache: 'no-store' });
  if (!res.ok) throw new Error(`世界地图加载失败(HTTP ${res.status})`);
  return (await res.json()) as TileMapDefinition;
}

export function WorldCanvas({ interactive = true }: { interactive?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let game: Phaser.Game | null = null;
    void Promise.all([fetchGameAssetRegistry(), fetchMapDefinition()])
      .then(([registry, map]) => {
        if (cancelled) return;
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: host,
          width: map.width * 16,
          height: map.height * 16,
          pixelArt: true,
          backgroundColor: '#8fc978',
          scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
          scene: [WorldScene],
        });
        // create() 在 boot 后异步执行,先写入再启动不会丢
        game.registry.set('assets', registry);
        game.registry.set('map', map);
        game.registry.set('interactive', interactive);
      })
      .catch((err: unknown) => {
        if (!cancelled) setAssetError(err instanceof Error ? err.message : '素材清单加载失败');
      });
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [interactive]);

  if (assetError !== null) {
    return (
      <div className="canvas-host" style={{ display: 'grid', placeItems: 'center', color: '#a33' }}>
        <p style={{ maxWidth: 420, textAlign: 'center' }}>{assetError}</p>
      </div>
    );
  }
  return <div ref={hostRef} className="canvas-host" />;
}
