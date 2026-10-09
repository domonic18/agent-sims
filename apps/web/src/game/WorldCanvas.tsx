import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { WorldScene } from './WorldScene';
import { RENDER_DPR } from './text-style';
import type { TileMapDefinition } from '@sims/shared';
import { fetchGameAssetRegistry } from './manifest';
import { getWorldRecipes } from '../net/worldApi';
import { useWorldStore } from '../store/worldStore';
import { toErrorMessage } from '../ui/errors';
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
        // Retina 高清: 画布栅格 = 视口 CSS × DPR,CSS 拉伸回 100%(NONE 模式 Phaser
        // 不接管样式/尺寸,窗口变化在 onResize 手动 setGameSize);相机 zoom 按 DPR
        // 放大(WorldScene),可见世界范围与旧 1x 一致,逐设备像素渲染不再发糊
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: host,
          width: Math.round(host.clientWidth * RENDER_DPR),
          height: Math.round(host.clientHeight * RENDER_DPR),
          pixelArt: true,
          backgroundColor: '#8fc978',
          scale: { mode: Phaser.Scale.NONE },
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
          setAssetError(toErrorMessage(err, '素材清单加载失败'));
        }
      });
    const onResize = (): void => {
      game?.scale.setGameSize(
        Math.round(host.clientWidth * RENDER_DPR),
        Math.round(host.clientHeight * RENDER_DPR),
      );
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
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
