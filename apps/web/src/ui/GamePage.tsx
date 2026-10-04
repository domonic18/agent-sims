import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { TOWN_MAP } from '@sims/shared';
import { WorldScene } from '../game/WorldScene';
import { setPaused, setTimeScale } from '../net/debugApi';
import { connectWorld } from '../net/socket';
import { useWorldStore } from '../store/worldStore';
import { SidePanel } from './SidePanel';
import { Toasts } from './Toasts';
import './game-page.css';

const TIME_SCALES = [1, 4, 16] as const;

const STATUS_LABEL: Record<string, string> = {
  connecting: '连接中…',
  connected: '',
  disconnected: '已断开,自动重连中',
};

/** 世界观察页:Phaser 渲染 + HUD(暂停/加速经 /debug 联调通道,M4 换正式指令) */
export default function GamePage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const lastEvent = useWorldStore((state) => state.lastEvent);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [controlError, setControlError] = useState<string | null>(null);

  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
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
    return () => {
      game.destroy(true);
    };
  }, []);

  const togglePause = async (): Promise<void> => {
    if (snapshot === null) return;
    try {
      await setPaused(!snapshot.paused);
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  const changeScale = async (scale: number): Promise<void> => {
    try {
      await setTimeScale(scale);
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="game-page">
      <div className="status-bar">
        <span className="title">agent-sims</span>
        {snapshot !== null ? (
          <span>
            第 {snapshot.clock.day} 天 {snapshot.clock.time} {snapshot.clock.isNight ? '🌙' : '☀️'} ·
            tick {snapshot.tick}
          </span>
        ) : (
          <span>等待世界快照…</span>
        )}
        <span className={status}>{STATUS_LABEL[status] ?? status}</span>
      </div>

      <div className="controls">
        <button type="button" onClick={() => void togglePause()} disabled={snapshot === null}>
          {snapshot?.paused ? '▶ 继续' : '⏸ 暂停'}
        </button>
        <span className="speed-group">
          {TIME_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={snapshot?.timeScale === scale ? 'active' : ''}
              onClick={() => void changeScale(scale)}
              disabled={snapshot === null}
            >
              {scale}x
            </button>
          ))}
        </span>
        {snapshot?.paused === true && <span className="paused-badge">已暂停</span>}
        {controlError !== null && <span className="control-error">{controlError}</span>}
      </div>

      <div className="game-main">
        <div className="canvas-wrap">
          <div ref={canvasHostRef} className="canvas-host" />
          <Toasts />
        </div>
        <SidePanel />
      </div>

      {snapshot !== null && snapshot.characters.length > 0 && (
        <div className="character-strip">
          {snapshot.characters.map((character) => (
            <div key={character.id} className="card">
              <div className="card-title">
                {character.name} <small>({character.x},{character.y})</small>
              </div>
              <VitalBar label="体力" value={character.energy} />
              <VitalBar label="幸福" value={character.happiness} />
              <div className="coins">金币 {character.coins}</div>
            </div>
          ))}
        </div>
      )}
      {lastEvent !== null && (
        <p className="last-event">最近事件: {JSON.stringify(lastEvent)}</p>
      )}
    </main>
  );
}

function VitalBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="vital">
      <span className="vital-label">{label}</span>
      <div className="vital-track">
        <div className="vital-fill" style={{ width: `${clamped}%` }} />
      </div>
      <span className="vital-value">{Math.round(value)}</span>
    </div>
  );
}
