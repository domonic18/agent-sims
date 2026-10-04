import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatCoins } from '../format';
import { connectWorld } from '../net/socket';
import { useWorldStore } from '../store/worldStore';
import { WorldCanvas } from '../game/WorldCanvas';
import './game-page.css';

const STATUS_LABEL: Record<string, string> = {
  connecting: '连接中…',
  connected: '',
  disconnected: '已断开,自动重连中',
};

/**
 * 世界观察页(纯观看): 画布+状态栏+角色条,交互操控全量收口到 /lab 调试台。
 * 画布仅支持点选角色跟随与滚轮缩放,不下发任何意图。
 */
export default function GamePage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const lastEvent = useWorldStore((state) => state.lastEvent);

  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, []);

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
          </span>
        ) : (
          <span>等待世界快照…</span>
        )}
        <span className={status}>{STATUS_LABEL[status] ?? status}</span>
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
