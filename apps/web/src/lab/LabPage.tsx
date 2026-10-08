import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GENDERS,
  GENDER_LABELS,
  MEMORY_TYPE_LABELS,
  SYS_CONFIG_FIELDS,
  SYS_CONFIG_GROUP_LABELS,
  SYS_CONFIG_GROUPS,
  type Gender,
  type MemoryPanelResponse,
  type WorldArchiveView,
} from '@sims/shared';
import {
  addWorldCharacter,
  deleteWorldArchive,
  fetchCharacterAutonomy,
  fetchCharacterMemories,
  fetchWorldArchives,
  fetchWorlds,
  getToken,
  loadWorldArchive,
  saveWorldArchive,
  setCharacterAutonomy,
} from '../admin/api';
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

/** 游戏分钟 → 第 X 天 HH:MM(记忆条目时间戳) */
function formatGameMinutes(gameMinutes: number | null): string {
  if (gameMinutes === null) return '未知时刻';
  const day = Math.floor(gameMinutes / 1440) + 1;
  const hh = String(Math.floor((gameMinutes % 1440) / 60)).padStart(2, '0');
  const mm = String(gameMinutes % 60).padStart(2, '0');
  return `第 ${day} 天 ${hh}:${mm}`;
}

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
  // 管理员通道(有 token 且校验通过才显示;与 admin 后台共享 localStorage)
  const [adminAvailable, setAdminAvailable] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminGender, setAdminGender] = useState<Gender>('unspecified');
  const [adminPersona, setAdminPersona] = useState('');
  const [adminMsg, setAdminMsg] = useState<string | null>(null);
  // 世界存档(C6):列表/保存命名/读取删除
  const [archives, setArchives] = useState<WorldArchiveView[]>([]);
  const [archiveLabel, setArchiveLabel] = useState('');
  // 记忆面板(M4b/A3):角色选择/检索词/响应(只读)
  const [memCharId, setMemCharId] = useState('');
  const [memQuery, setMemQuery] = useState('');
  const [memData, setMemData] = useState<MemoryPanelResponse | null>(null);
  const [memLoading, setMemLoading] = useState(false);
  // 自治开关(M4c):null=未查询;共享记忆面板的角色选择
  const [autonomyOn, setAutonomyOn] = useState<boolean | null>(null);
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

  const addResident = async (): Promise<void> => {
    const name = adminName.trim();
    if (name === '') {
      setAdminMsg('名字不能为空');
      return;
    }
    try {
      const spawned = await addWorldCharacter({
        name,
        gender: adminGender,
        ...(adminPersona.trim() !== '' ? { persona: adminPersona.trim() } : {}),
      });
      setAdminMsg(`「${spawned.name}」已入驻 (${spawned.x},${spawned.y})`);
      setAdminName('');
      setAdminPersona('');
    } catch (error) {
      setAdminMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshArchives = async (): Promise<void> => {
    try {
      setArchives(await fetchWorldArchives());
    } catch (error) {
      setAdminMsg(error instanceof Error ? error.message : String(error));
    }
  };

  // admin 面板可用后拉一次存档列表
  useEffect(() => {
    if (adminAvailable) void refreshArchives();
  }, [adminAvailable]);

  const saveArchive = async (): Promise<void> => {
    try {
      const saved = await saveWorldArchive(archiveLabel);
      setAdminMsg(`已保存「${saved.label}」(${saved.characterCount} 位居民)`);
      setArchiveLabel('');
      await refreshArchives();
    } catch (error) {
      setAdminMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const loadArchive = async (archive: WorldArchiveView): Promise<void> => {
    try {
      await loadWorldArchive(archive.id);
      setAdminMsg(`已读取「${archive.label}」`);
    } catch (error) {
      setAdminMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const removeArchive = async (archive: WorldArchiveView): Promise<void> => {
    try {
      await deleteWorldArchive(archive.id);
      await refreshArchives();
    } catch (error) {
      setAdminMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const loadMemories = async (characterId: string, q: string): Promise<void> => {
    if (characterId === '') return;
    setMemLoading(true);
    try {
      setMemData(
        await fetchCharacterMemories(characterId, {
          ...(q.trim() !== '' ? { q: q.trim() } : {}),
          limit: 50,
        }),
      );
    } catch (error) {
      setAdminMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setMemLoading(false);
    }
  };

  const searchMemories = async (): Promise<void> => {
    await loadMemories(memCharId, memQuery);
  };

  // 快照就绪后默认选中第一位居民;admin 通道就绪或切换角色时回退时间浏览
  useEffect(() => {
    const first = snapshot?.characters[0];
    if (memCharId === '' && first !== undefined) setMemCharId(first.id);
  }, [snapshot, memCharId]);

  useEffect(() => {
    if (adminAvailable && memCharId !== '') void loadMemories(memCharId, '');
  }, [adminAvailable, memCharId]);

  // 自治状态随角色切换拉取;角色不在世界(404)按未开启处理
  useEffect(() => {
    setAutonomyOn(null);
    if (!adminAvailable || memCharId === '') return;
    fetchCharacterAutonomy(memCharId)
      .then((r) => setAutonomyOn(r.enabled))
      .catch(() => setAutonomyOn(false));
  }, [adminAvailable, memCharId]);

  const toggleAutonomy = async (): Promise<void> => {
    if (memCharId === '' || autonomyOn === null) return;
    const next = !autonomyOn;
    try {
      await setCharacterAutonomy(memCharId, next);
      setAutonomyOn(next);
      const name = snapshot?.characters.find((c) => c.id === memCharId)?.name ?? '角色';
      setAdminMsg(`${name} 自治已${next ? '开启' : '关闭'}`);
    } catch (error) {
      setAdminMsg(error instanceof Error ? error.message : String(error));
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

          {adminAvailable && (
            <div className="px-box lab-panel-px">
              <div className="px-inner lab-panel-inner">
                <h3>管理员 · 添加居民</h3>
                <div className="lab-btn-row">
                  <input
                    className="lab-input"
                    placeholder="新居民名字"
                    maxLength={20}
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                  />
                  <select
                    className="lab-input lab-select"
                    value={adminGender}
                    onChange={(e) => setAdminGender(e.target.value as Gender)}
                  >
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>
                        {GENDER_LABELS[g]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="px-btn" onClick={() => void addResident()}>
                    ➕ 入驻
                  </button>
                </div>
                <input
                  className="lab-input"
                  style={{ width: '100%', marginTop: 6 }}
                  placeholder="人设一句话(可选,预留字段)"
                  maxLength={100}
                  value={adminPersona}
                  onChange={(e) => setAdminPersona(e.target.value)}
                />
                {adminMsg !== null && <p className="hint">{adminMsg}</p>}

                <h3 style={{ marginTop: 14 }}>管理员 · 世界存档</h3>
                <div className="lab-btn-row">
                  <input
                    className="lab-input"
                    placeholder="存档名(留空自动时间戳)"
                    maxLength={40}
                    value={archiveLabel}
                    onChange={(e) => setArchiveLabel(e.target.value)}
                  />
                  <button type="button" className="px-btn" onClick={() => void saveArchive()}>
                    💾 保存
                  </button>
                </div>
                <ul className="lab-archive-list">
                  {archives.length === 0 ? (
                    <li className="hint">暂无存档</li>
                  ) : (
                    archives.map((archive) => (
                      <li key={archive.id} className="lab-archive-row">
                        <div className="lab-archive-meta">
                          <b>{archive.label}</b>
                          <small>
                            {new Date(archive.createdAt).toLocaleString('zh-CN', { hour12: false })} ·{' '}
                            {archive.characterCount} 位居民
                          </small>
                        </div>
                        <span className="lab-btn-row">
                          <button
                            type="button"
                            className="px-btn"
                            onClick={() => void loadArchive(archive)}
                          >
                            读取
                          </button>
                          <button
                            type="button"
                            className="px-btn"
                            onClick={() => void removeArchive(archive)}
                          >
                            删除
                          </button>
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          )}

          {adminAvailable && (
            <div className="px-box lab-panel-px">
              <div className="px-inner lab-panel-inner">
                <h3>管理员 · 记忆面板</h3>
                <div className="lab-btn-row">
                  <button
                    type="button"
                    className="px-btn"
                    disabled={memCharId === '' || autonomyOn === null}
                    onClick={() => void toggleAutonomy()}
                  >
                    {autonomyOn === null ? '自治:—' : autonomyOn ? '自治:开(点击关闭)' : '自治:关(点击开启)'}
                  </button>
                  <select
                    className="lab-input lab-memory-char"
                    value={memCharId}
                    onChange={(e) => setMemCharId(e.target.value)}
                  >
                    {(snapshot?.characters ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="lab-input"
                    placeholder="语义检索记忆…"
                    maxLength={100}
                    value={memQuery}
                    onChange={(e) => setMemQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void searchMemories();
                    }}
                  />
                  <button
                    type="button"
                    className="px-btn"
                    disabled={memCharId === ''}
                    onClick={() => void searchMemories()}
                  >
                    🔍 检索
                  </button>
                </div>
                {memLoading && <p className="hint">加载中…</p>}
                {memData !== null && !memLoading && (
                  <>
                    {memData.notice !== null && <p className="lab-err">{memData.notice}</p>}
                    <p className="hint">
                      {memData.mode === 'search'
                        ? `三因子检索 · 命中 ${memData.items.length} 条`
                        : `最近 ${memData.items.length} 条`}
                    </p>
                    <ul className="lab-memory-list">
                      {memData.items.length === 0 ? (
                        <li className="hint">暂无记忆</li>
                      ) : (
                        memData.items.map((item) => (
                          <li key={item.id} className="lab-memory-item">
                            <span className={`lab-mem-badge ${item.type}`}>
                              {MEMORY_TYPE_LABELS[item.type]}
                            </span>
                            <div className="lab-memory-body">
                              <div>{item.content}</div>
                              <small>
                                {formatGameMinutes(item.gameMinutes)} · 重要度 {item.importance}
                                {item.score !== undefined && item.factors !== undefined
                                  ? ` · 综合 ${item.score.toFixed(2)}(相关 ${
                                      item.factors.relevance === null
                                        ? '—'
                                        : item.factors.relevance.toFixed(2)
                                    })`
                                  : ''}
                              </small>
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  </>
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
