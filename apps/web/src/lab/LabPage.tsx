import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SYS_CONFIG_FIELDS,
  SYS_CONFIG_GROUP_LABELS,
  SYS_CONFIG_GROUPS,
} from '@sims/shared';
import { formatCoins } from '../format';
import { WorldCanvas } from '../game/WorldCanvas';
import {
  fetchDebugParams,
  reviveCharacter,
  setDebugParams,
  setPaused,
  setTimeScale,
} from '../net/debugApi';
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
 * IntentForms/LogPanel;社交 v1 增 11 意图与事件日志流):全屏画布+悬浮 HUD,
 * 右列=快捷操作面板(前往/活动/社交/资产/商店)+11 意图协议表单+世界状态只读表,
 * 左下=回执与社交事件日志。
 * 暂停/倍率经 /debug 联调通道(M4 换正式指令)。
 * 地图全量操控(点击移动/方向键步进)仅此页开启,主页面纯观看。
 */
export default function LabPage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const events = useWorldStore((state) => state.events);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  // 世界参数控制面板:original=最近一次已知生效值,draft=表单草稿,dirty 决定保存可用
  const [paramsOriginal, setParamsOriginal] = useState<Record<string, number> | null>(null);
  const [paramsDraft, setParamsDraft] = useState<Record<string, number> | null>(null);
  const nextLogIdRef = useRef(1);
  const lastEventSeqRef = useRef(0);

  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchDebugParams()
      .then((params) => {
        if (!cancelled) {
          setParamsOriginal(params);
          setParamsDraft(params);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setControlError(error instanceof Error ? error.message : '世界参数加载失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 社交事件流(social v1): 闲聊对话与结成友谊进左下角日志,与意图回执同流展示
  useEffect(() => {
    const fresh = events.filter((entry) => entry.seq > lastEventSeqRef.current);
    if (fresh.length === 0) return;
    lastEventSeqRef.current = fresh[fresh.length - 1]!.seq;
    const names = useWorldStore.getState().snapshot?.characters ?? [];
    const nameOf = (id: string): string => names.find((c) => c.id === id)?.name ?? id;
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const entries: LogEntry[] = [];
    for (const { event } of fresh) {
      if (event.type === 'social.chat') {
        const sign = event.affinityDelta >= 0 ? '+' : '';
        entries.push({
          id: nextLogIdRef.current++,
          time: now,
          tick: event.tick,
          summary: 'chat',
          ok: true,
          message: `💬 ${nameOf(event.fromId)} → ${nameOf(event.toId)}:「${event.content}」(好感 ${sign}${event.affinityDelta})`,
        });
      } else if (event.type === 'friendship.formed') {
        entries.push({
          id: nextLogIdRef.current++,
          time: now,
          tick: event.tick,
          summary: 'friendship',
          ok: true,
          message: `🎉 ${nameOf(event.aId)} 和 ${nameOf(event.bId)} 成了「${event.title}」`,
        });
      }
    }
    if (entries.length > 0) {
      setLog((prev) => [...entries.reverse(), ...prev].slice(0, LOG_MAX));
    }
  }, [events]);

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

  const paramsDirty =
    paramsOriginal !== null &&
    paramsDraft !== null &&
    SYS_CONFIG_FIELDS.some((field) => paramsDraft[field.key] !== paramsOriginal[field.key]);

  const saveParams = async (): Promise<void> => {
    if (paramsOriginal === null || paramsDraft === null) return;
    const updates: Record<string, number> = {};
    for (const field of SYS_CONFIG_FIELDS) {
      const value = paramsDraft[field.key];
      if (value !== undefined && value !== paramsOriginal[field.key]) updates[field.key] = value;
    }
    if (Object.keys(updates).length === 0) return;
    try {
      const params = await setDebugParams(updates);
      setParamsOriginal(params);
      setParamsDraft(params);
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
            <h3>意图操作台(11 意图全量)</h3>
            <IntentForms
              key={character.id}
              character={character}
              snapshot={snapshot}
              onRun={run}
            />
          </section>
        )}
        <section className="lab-panel">
          <h3>世界参数</h3>
          {paramsDraft === null ? (
            <p className="hint">参数加载中…</p>
          ) : (
            <>
              {SYS_CONFIG_GROUPS.map((group) => (
                <div key={group} className="param-group">
                  <div className="param-group-title">{SYS_CONFIG_GROUP_LABELS[group]}</div>
                  {SYS_CONFIG_FIELDS.filter((field) => field.group === group).map((field) => (
                    <label key={field.key} className="param-row" title={field.desc}>
                      <span>{field.label}</span>
                      <input
                        type="number"
                        value={paramsDraft[field.key] ?? ''}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        onChange={(e) =>
                          setParamsDraft((prev) =>
                            prev === null ? prev : { ...prev, [field.key]: Number(e.target.value) },
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              ))}
              <button
                type="button"
                disabled={!paramsDirty}
                onClick={() => void saveParams()}
              >
                保存参数
              </button>
            </>
          )}
        </section>

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
