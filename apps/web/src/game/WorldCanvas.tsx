import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { TOWN_MAP } from '@sims/shared';
import { WorldScene } from './WorldScene';

/** Phaser 画布宿主:创建/销毁世界场景(主页面与 /lab 调试台复用同一 WorldScene) */
export function WorldCanvas({ interactive = true }: { interactive?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: TOWN_MAP.width * 16,
      height: TOWN_MAP.height * 16,
      pixelArt: true,
      backgroundColor: '#8fc978',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [WorldScene],
    });
    // create() 在 boot 后异步执行,先写入再启动不会丢
    game.registry.set('interactive', interactive);
    return () => {
      game.destroy(true);
    };
  }, [interactive]);
  return <div ref={hostRef} className="canvas-host" />;
}
