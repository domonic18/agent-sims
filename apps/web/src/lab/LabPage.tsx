import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCoins } from '../format';
import { WorldCanvas } from '../game/WorldCanvas';
import { reviveCharacter, setPaused, setTimeScale } from '../net/debugApi';
import { connectWorld, sendIntent } from '../net/socket';
import { useWorldStore } from '../store/worldStore';
import { SidePanel } from '../ui/SidePanel';
import { Toasts } from '../ui/Toasts';
import { IntentForms, type RunFn } from './IntentForms';
import { LogPanel, type LogEntry } from './LogPanel';
import './lab.css';

const LOG_MAX = 100;
const TIME_SCALES = [1, 4, 16] as const;

/**
 * /lab 独立调试台(M3.6b;M3.6d 全屏化+操作收口;M3.6e 六意图;M3.6h 拆分
 * IntentForms/LogPanel):全屏画布+悬浮 HUD,右列=快捷操作面板(前往/活动/
 * 资产/商店)+10 意图协议表单+世界状态只读表,左下=回执日志。
 * 暂停/倍率经 /debug 联调通道(M4 换正式指令)。
 * 地图全量操控(点击移动/方向键步进)仅此页开启,主页面纯观看。
 */
export default function LabPage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const nextLogIdRef = useRef(1);

  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, []);

  const character = snapshot?.characters.find((c) => c.id === selectedId) ?? null;

  const run: RunFn = async (intent, summary) => {
    const tick = useWorldStore.getState().snapshot?.tick ?? null;
    const ack = await sendIntent(intent);
    const id = nextLogIdRef.current++;
    setLog((prev) =>
      [
        {
          id,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          tick,
          summary,
          ok: ack.ok,
          message: ack.message,
        },
        ...prev,
      ].slice(0, LOG_MAX),
    );
  };

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

  const revive = async (): Promise<void> => {
    if (character === null) return;
    try {
      await reviveCharacter(character.id);
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="lab-page">
      <div className="status-bar">
        <span className="title">
          agent-sims · lab 调试台 <Link to="/">← 返回主页面</Link>
        </span>
        {snapshot !== null ? (
          <span>
            第 {snapshot.clock.day} 天 {snapshot.clock.time} {snapshot.clock.isNight ? '🌙' : '☀️'} ·
            tick {snapshot.tick} · {snapshot.paused ? '已暂停' : `${snapshot.timeScale}x`}
          </span>
        ) : (
          <span>等待世界快照…</span>
        )}
        <span className={status}>
          {status === 'connected' ? '' : status === 'connecting' ? '连接中…' : '已断开,自动重连中'}
        </span>
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
        {character !== null && !character.alive && (
          <button type="button" className="revive-btn" onClick={() => void revive()}>
            ✚ 复活 {character.name}
          </button>
        )}
        {controlError !== null && <span className="control-error">{controlError}</span>}
      </div>

      <div className="canvas-wrap">
        <WorldCanvas />
        <Toasts />
      </div>

      <aside className={sideCollapsed ? 'lab-side collapsed' : 'lab-side'}>
        <SidePanel />
        {character !== null && (
          <section className="lab-panel">
            <h3>意图操作台(10 意图全量)</h3>
            <IntentForms key={character.id} character={character} onRun={run} />
          </section>
        )}
        <section className="lab-panel">
          <h3>世界状态(只读)</h3>
          {snapshot === null ? (
            <p className="hint">等待快照…</p>
          ) : (
            <table className="world-table">
              <thead>
                <tr>
                  <th>角色</th>
                  <th>坐标</th>
                  <th>体力</th>
                  <th>幸福</th>
                  <th>金币</th>
                  <th>繁荣分</th>
                  <th>存活</th>
                  <th>活动</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.characters.map((c) => (
                  <tr key={c.id} className={c.id === selectedId ? 'selected' : ''}>
                    <td>{c.name}</td>
                    <td>
                      {c.x},{c.y}
                    </td>
                    <td className={c.energy <= 20 ? 'low-energy' : ''}>{Math.round(c.energy)}</td>
                    <td>{Math.round(c.happiness)}</td>
                    <td>{formatCoins(c.coins)}</td>
                    <td>{formatCoins(c.lifeScore)}</td>
                    <td className={c.alive ? '' : 'dead'}>{c.alive ? '✓' : '☠'}</td>
                    <td>{c.activity?.activityId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </aside>

      <button
        type="button"
        className="lab-side-toggle"
        style={{ right: sideCollapsed ? 12 : 318 }}
        title={sideCollapsed ? '展开操作列' : '收起操作列'}
        onClick={() => setSideCollapsed((value) => !value)}
      >
        {sideCollapsed ? '◀' : '▶'}
      </button>

      <LogPanel log={log} />
    </main>
  );
}
