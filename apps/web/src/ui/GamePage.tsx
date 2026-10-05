import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { WORLD_TIME_SCALES } from '@sims/shared';
import { formatCoins } from '../format';
import { connectWorld } from '../net/socket';
import { updateWorldSettings } from '../net/worldApi';
import { useWorldStore } from '../store/worldStore';
import { WorldCanvas } from '../game/WorldCanvas';
import { WorldSettingsModal } from './WorldSettingsModal';
import './game-page.css';
import './world-settings.css';

const STATUS_LABEL: Record<string, string> = {
  connecting: '连接中…',
  connected: '',
  disconnected: '已断开,自动重连中',
};

/**
 * 世界观察页: 画布+状态栏+角色条+游戏内设置菜单(SimCity 式)。
 * 画布仅支持点选角色跟随与滚轮缩放,不下发任何意图;意图操控收口 /lab。
 * 设置菜单经 /api/world/settings 常开通道调暂停/倍率/规则/参数/难度预设,
 * 弹窗打开自动暂停世界,关闭恢复(模拟人生习惯)。
 */
export default function GamePage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const lastEvent = useWorldStore((state) => state.lastEvent);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  // 弹窗打开前世界在运行则自动暂停,关闭时恢复(若期间被他人恢复则不双写)
  const resumeOnCloseRef = useRef(false);

  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, []);

  const openSettings = async (): Promise<void> => {
    if (settingsOpen) return;
    setSettingsOpen(true);
    const current = useWorldStore.getState().snapshot;
    if (current !== null && !current.paused) {
      try {
        await updateWorldSettings({ paused: true });
        resumeOnCloseRef.current = true;
        setControlError(null);
      } catch (error) {
        setControlError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const closeSettings = async (): Promise<void> => {
    setSettingsOpen(false);
    if (!resumeOnCloseRef.current) return;
    resumeOnCloseRef.current = false;
    const current = useWorldStore.getState().snapshot;
    if (current !== null && current.paused) {
      try {
        await updateWorldSettings({ paused: false });
        setControlError(null);
      } catch (error) {
        setControlError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  // ESC 开关设置弹窗
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      void (settingsOpen ? closeSettings() : openSettings());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const togglePause = async (): Promise<void> => {
    const current = useWorldStore.getState().snapshot;
    if (current === null) return;
    try {
      await updateWorldSettings({ paused: !current.paused });
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  const changeScale = async (scale: number): Promise<void> => {
    try {
      await updateWorldSettings({ timeScale: scale });
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="game-page">
      <div className="status-bar">
        <span className="title">
          agent-sims<Link className="lab-link" to="/lab">lab 调试台</Link>
        </span>
        {snapshot !== null ? (
          <span>
            第 {snapshot.clock.day} 天 {snapshot.clock.time} {snapshot.clock.isNight ? '🌙' : '☀️'} ·
            tick {snapshot.tick}
            {snapshot.paused ? ' · 已暂停' : ` · ${snapshot.timeScale}x`}
          </span>
        ) : (
          <span>等待世界快照…</span>
        )}
        <span className={status}>{STATUS_LABEL[status] ?? status}</span>
        <span className="quick-controls">
          <button
            type="button"
            disabled={snapshot === null}
            title={snapshot?.paused ? '继续' : '暂停'}
            onClick={() => void togglePause()}
          >
            {snapshot?.paused ? '▶' : '⏸'}
          </button>
          {WORLD_TIME_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={snapshot?.timeScale === scale ? 'active' : ''}
              disabled={snapshot === null}
              onClick={() => void changeScale(scale)}
            >
              {scale}x
            </button>
          ))}
          <button
            type="button"
            title="世界设置(ESC)"
            onClick={() => void openSettings()}
          >
            ⚙
          </button>
        </span>
        {controlError !== null && <span className="quick-error">{controlError}</span>}
      </div>

      <div className="game-main">
        <div className="canvas-wrap">
          <WorldCanvas interactive={false} />
        </div>
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
              <div className="coins">金币 {formatCoins(character.coins)}</div>
            </div>
          ))}
        </div>
      )}
      {lastEvent !== null && (
        <p className="last-event">最近事件: {JSON.stringify(lastEvent)}</p>
      )}

      {settingsOpen && <WorldSettingsModal onClose={() => void closeSettings()} />}
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
