import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchWorlds, getToken } from '../admin/api';
import { debugTick, setPaused, setTimeScale } from '../net/debugApi';
import { connectWorld, sendIntent } from '../net/socket';
import { useWorldStore } from '../store/worldStore';
import { Toasts } from '../ui/Toasts';
import { EventList } from '../ui/hud/EventList';
import { AdminMemoryPanel } from './AdminMemoryPanel';
import { AdminMoodPanel } from './AdminMoodPanel';
import { AdminPersonaPanel } from './AdminPersonaPanel';
import { AdminResidentsPanel } from './AdminResidentsPanel';
import { AdminSchedulePanel } from './AdminSchedulePanel';
import { ClockPanel } from './ClockPanel';
import { DevResidentsPanel } from './DevResidentsPanel';
import { IntentForms, type RunFn } from './IntentForms';
import { LogPanel, type LogEntry } from './LogPanel';
import { ParamsPanel } from './ParamsPanel';
import './lab.css';

const LOG_MAX = 100;

/**
 * /lab 世界实验室(UI-1 C5 三栏游戏化,无画布): 左·世界控制(时钟/参数热调/dev 居民管理),
 * 中·意图调试(13 意图全量表单+回执终端),右·世界事件实时流(复用日志中文格式化)。
 * 地图操控与面板操作回到主界面;本页专注观测与调试。dev 区块探测 /debug 404 自动隐藏。
 * 面板子组件各自持有区块内状态;跨区共享的 adminMsg/memCharId/controlError 留本层下发。
 */
export default function LabPage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);
  // 管理员通道(有 token 且校验通过才显示;与 admin 后台共享 localStorage)
  const [adminAvailable, setAdminAvailable] = useState(false);
  // admin 各面板操作提示统一显示在「添加居民」块
  const [adminMsg, setAdminMsg] = useState<string | null>(null);
  // 记忆/情绪/日程/人设面板共享角色选择
  const [memCharId, setMemCharId] = useState('');
  const nextLogIdRef = useRef(1);

  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // admin 探测:本地有 token 才打接口,401 会清 token(下次进页不再显示)
    if (getToken() !== null) {
      void fetchWorlds()
        .then(() => {
          if (!cancelled) setAdminAvailable(true);
        })
        .catch(() => {
          if (!cancelled) setAdminAvailable(false);
        });
    }
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

  // 快照就绪后默认选中第一位居民
  useEffect(() => {
    const first = snapshot?.characters[0];
    if (memCharId === '' && first !== undefined) setMemCharId(first.id);
  }, [snapshot, memCharId]);

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
          <ClockPanel
            snapshot={snapshot}
            controlError={controlError}
            onPause={() => void togglePause()}
            onScale={(scale) => void changeScale(scale)}
            onAdvance={(n) => void advance(n)}
          />

          <ParamsPanel onError={setControlError} />

          <DevResidentsPanel character={character} onError={setControlError} />

          {adminAvailable && (
            <AdminResidentsPanel msg={adminMsg} onMsg={setAdminMsg} />
          )}

          {adminAvailable && (
            <div className="px-box lab-panel-px">
              <div className="px-inner lab-panel-inner">
                <AdminMemoryPanel
                  snapshot={snapshot}
                  memCharId={memCharId}
                  onSelectCharacter={setMemCharId}
                  onMsg={setAdminMsg}
                />
                <AdminMoodPanel memCharId={memCharId} />
                <AdminSchedulePanel
                  snapshot={snapshot}
                  memCharId={memCharId}
                  onMsg={setAdminMsg}
                />
                <AdminPersonaPanel
                  snapshot={snapshot}
                  memCharId={memCharId}
                  onMsg={setAdminMsg}
                />
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
