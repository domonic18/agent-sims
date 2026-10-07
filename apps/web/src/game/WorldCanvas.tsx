import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { WorldScene } from './WorldScene';
import type { TileMapDefinition } from '@sims/shared';
import { fetchGameAssetRegistry } from './manifest';
import { getWorldRecipes } from '../net/worldApi';
import { useWorldStore } from '../store/worldStore';
import { CameraModeChip } from '../ui/hud/CameraModeChip';

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
    // 加载屏阶段上报(L1):清单/地图拉取 → Phaser 纹理灌入 → 场景 ready(WorldScene 写)
    const boot = useWorldStore.getState();
    boot.setBootPhase('world-data');
    boot.setTextureProgress(0);
    void Promise.all([fetchGameAssetRegistry(), fetchMapDefinition(), getWorldRecipes().catch(() => null)])
      .then(([registry, map, recipes]) => {
        if (cancelled) return;
        useWorldStore.getState().setBootPhase('textures');
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: host,
          // UI-1: 画布=视口尺寸(Scale.RESIZE 随窗口自适应),相机跟随角色,不再整图 letterbox
          width: host.clientWidth,
          height: host.clientHeight,
          pixelArt: true,
          backgroundColor: '#8fc978',
          scale: { mode: Phaser.Scale.RESIZE },
          scene: [WorldScene],
        });
        // create() 在 boot 后异步执行,先写入再启动不会丢
        game.registry.set('assets', registry);
        game.registry.set('map', map);
        game.registry.set('interactive', interactive);
        // React 侧同样持一份(侧面板场所/锚点/商店查此源),与 Phaser registry 同源
        useWorldStore.getState().setMap(map);
        // 每世界配方回填(制作面板/Lab 意图下拉消费;失败不打断画布,消费端出厂兜底)
        if (recipes !== null) useWorldStore.getState().applyRecipes(recipes.recipes);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          // error 阶段让 GamePage 摘除加载罩,露出下方错误文案
          useWorldStore.getState().setBootPhase('error');
          setAssetError(err instanceof Error ? err.message : '素材清单加载失败');
        }
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
  return (
    <div ref={hostRef} className="canvas-host">
      <CameraModeChip />
    </div>
  );
}
