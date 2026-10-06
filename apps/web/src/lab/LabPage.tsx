import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SYS_CONFIG_FIELDS,
  SYS_CONFIG_GROUP_LABELS,
  SYS_CONFIG_GROUPS,
} from '@sims/shared';
import {
  debugSpawn,
  debugTick,
  fetchDebugParams,
  probeDebugAvailable,
  reviveCharacter,
  setDebugParams,
  setPaused,
  setTimeScale,
} from '../net/debugApi';
import { connectWorld, sendIntent } from '../net/socket';
import { useWorldStore } from '../store/worldStore';
import { Toasts } from '../ui/Toasts';
import { EventList } from '../ui/hud/EventList';
import { IntentForms, type RunFn } from './IntentForms';
import { LogPanel, type LogEntry } from './LogPanel';
import './lab.css';

const LOG_MAX = 100;
const TIME_SCALES = [1, 4, 16] as const;

/**
 * /lab 世界实验室(UI-1 C5 三栏游戏化,无画布): 左·世界控制(时钟/参数热调/dev 居民管理),
 * 中·意图调试(13 意图全量表单+回执终端),右·世界事件实时流(复用日志中文格式化)。
 * 地图操控与面板操作回到主界面;本页专注观测与调试。dev 区块探测 /debug 404 自动隐藏。
 */
export default function LabPage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);
  // 世界参数控制面板:original=最近一次已知生效值,draft=表单草稿,dirty 决定保存可用
  const [paramsOriginal, setParamsOriginal] = useState<Record<string, number> | null>(null);
  const [paramsDraft, setParamsDraft] = useState<Record<string, number> | null>(null);
  // dev 通道可用性(生产 /debug 未注册 → 404 → 整块隐藏)
  const [devAvailable, setDevAvailable] = useState(false);
  const [spawnName, setSpawnName] = useState('');
  const nextLogIdRef = useRef(1);
  const spawnCountRef = useRef(0);

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
    void probeDebugAvailable().then((ok) => {
      if (!cancelled) setDevAvailable(ok);
    });
    return () => {
      cancelled = true;
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

  const advance = async (n: number): Promise<void> => {
    try {
      await debugTick(n);
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

  const spawn = async (): Promise<void> => {
    spawnCountRef.current += 1;
    try {
      await debugSpawn({
        id: `guest-${Date.now() % 100000}`,
        name: spawnName.trim() !== '' ? spawnName.trim() : `访客${spawnCountRef.current}`,
        x: 30,
        y: 22,
      });
      setSpawnName('');
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
      <header className="px-box lab-top">
        <div className="px-inner lab-top-inner">
          <b className="lab-title">⚙ 世界实验室</b>
          {snapshot !== null ? (
            <span className="lab-clock">
              第 {snapshot.clock.day} 天 {snapshot.clock.time} · tick {snapshot.tick} ·{' '}
              {snapshot.paused ? '已暂停' : `${snapshot.timeScale}x`}
            </span>
          ) : (
            <span className="lab-clock">等待世界快照…</span>
          )}
          <span className={`hud-net ${status}`} title={status} />
          <Link to="/" className="px-btn lab-back">
            ← 返回游戏
          </Link>
        </div>
      </header>

      <div className="lab-grid">
        {/* 左栏 · 世界控制 */}
        <section className="lab-col">
          <div className="px-box lab-panel-px">
            <div className="px-inner lab-panel-inner">
              <h3>时钟控制</h3>
              <div className="lab-btn-row">
                <button
                  type="button"
                  className="px-btn"
                  disabled={snapshot === null}
                  onClick={() => void togglePause()}
                >
                  {snapshot?.paused ? '▶ 继续' : '⏸ 暂停'}
                </button>
                {TIME_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    className={`px-btn${snapshot?.timeScale === scale ? ' on' : ''}`}
                    disabled={snapshot === null}
                    onClick={() => void changeScale(scale)}
                  >
                    {scale}x
                  </button>
                ))}
                <button type="button" className="px-btn" onClick={() => void advance(60)}>
                  +60分
                </button>
                <button type="button" className="px-btn" onClick={() => void advance(1440)}>
                  +1天
                </button>
              </div>
              {controlError !== null && <p className="lab-err">{controlError}</p>}
            </div>
          </div>

          <div className="px-box lab-panel-px">
            <div className="px-inner lab-panel-inner">
              <h3>世界参数热调</h3>
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
                    className="px-btn"
                    disabled={!paramsDirty}
                    onClick={() => void saveParams()}
                  >
                    保存参数
                  </button>
                </>
              )}
            </div>
          </div>

          {devAvailable && (
            <div className="px-box lab-panel-px">
              <div className="px-inner lab-panel-inner">
                <h3>居民管理(dev)</h3>
                <div className="lab-btn-row">
                  <input
                    className="lab-input"
                    placeholder="新居民名字"
                    value={spawnName}
                    onChange={(e) => setSpawnName(e.target.value)}
                  />
                  <button type="button" className="px-btn" onClick={() => void spawn()}>
                    ➕ 生成
                  </button>
                </div>
                {character !== null && !character.alive && (
                  <button type="button" className="px-btn" onClick={() => void revive()}>
                    ✚ 复活 {character.name}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 中栏 · 意图调试 */}
        <section className="lab-col lab-col-mid">
          <div className="px-box lab-panel-px">
            <div className="px-inner lab-panel-inner">
              <h3>意图操作台{character !== null ? ` · ${character.name}` : ''}</h3>
              {character !== null ? (
                <IntentForms key={character.id} character={character} snapshot={snapshot} onRun={run} />
              ) : (
                <p className="hint">等待快照…</p>
              )}
            </div>
          </div>
          <LogPanel log={log} />
        </section>

        {/* 右栏 · 世界事件 */}
        <section className="lab-col">
          <div className="px-box lab-panel-px lab-grow">
            <div className="px-inner lab-panel-inner">
              <h3>世界事件</h3>
              <EventList />
            </div>
          </div>
        </section>
      </div>

      <Toasts />
    </main>
  );
}
