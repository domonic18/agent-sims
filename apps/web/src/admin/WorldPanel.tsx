import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_WORLD_RULES,
  GENDERS,
  GENDER_LABELS,
  WORLD_CHARACTER_LIMITS,
  WORLD_TIME_SCALES,
  pickRandomName,
  type Gender,
  type WorldCharacterConfig,
  type WorldRules,
  type WorldView,
} from '@sims/shared';
import { ApiError, closeWorld, createWorld, deleteWorld, fetchWorlds } from './api';

/** 表单行状态:persona 为预留字段(v1 只存不生效) */
interface DraftCharacter {
  name: string;
  gender: Gender;
  persona: string;
}

function emptyDraft(): DraftCharacter {
  return { name: '', gender: 'unspecified', persona: '' };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export function WorldPanel() {
  const [worlds, setWorlds] = useState<WorldView[] | null>(null);
  const [name, setName] = useState('小镇生活');
  const [rules, setRules] = useState<WorldRules>({ ...DEFAULT_WORLD_RULES });
  const [drafts, setDrafts] = useState<DraftCharacter[]>([emptyDraft()]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setWorlds(await fetchWorlds());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载世界列表失败');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = worlds?.find((w) => w.status === 'active') ?? null;
  const history = worlds?.filter((w) => w.status === 'closed') ?? [];

  const patchDraft = (index: number, patch: Partial<DraftCharacter>): void => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const randomizeAll = (): void => {
    setDrafts((prev) => {
      const used = new Set<string>();
      return prev.map((d) => {
        const next = pickRandomName(d.gender, used);
        used.add(next);
        return { ...d, name: next };
      });
    });
  };

  const submit = async (): Promise<void> => {
    const characters: WorldCharacterConfig[] = drafts.map(({ name: n, gender, persona }) => ({
      name: n.trim(),
      gender,
      ...(persona.trim() ? { persona: persona.trim() } : {}),
    }));
    if (characters.some((c) => c.name === '')) {
      setError('有人物名字为空,请补齐或移除该行');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createWorld({ name: name.trim(), characters, rules });
      setNotice(`世界「${created.name}」已创建,${created.characters.length} 位居民已入驻`);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const close = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await closeWorld(id);
      setNotice('世界已关闭归档(模拟暂停)');
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '关闭失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (world: WorldView): Promise<void> => {
    if (!window.confirm(`删除世界「${world.name}」?其人物记录将一并清理,不可恢复。`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWorld(world.id);
      setNotice(`已删除「${world.name}」`);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="world-panel">
      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="world-notice">{notice}</p>}

      <section className="world-card">
        <h2>当前世界</h2>
        {active === null ? (
          <p className="world-empty">暂无活跃世界——用下方表单创建一个</p>
        ) : (
          <div className="world-active">
            <div className="world-active-head">
              <strong>{active.name}</strong>
              <span className="world-status active">运行中</span>
              <span className="world-meta">创建于 {formatTime(active.createdAt)}</span>
              <button
                type="button"
                className="admin-secondary"
                disabled={busy}
                onClick={() => void close(active.id)}
              >
                关闭世界
              </button>
            </div>
            <ul className="world-residents">
              {active.characters.map((c, i) => (
                <li key={i}>
                  {c.name}
                  <small> · {GENDER_LABELS[c.gender]}{c.persona ? ` · ${c.persona}` : ''}</small>
                </li>
              ))}
            </ul>
            <div className="world-rule-chips">
              <span className={`slot-tag ${active.rules.allowDeath ? 'on' : 'off'}`}>
                死亡 {active.rules.allowDeath ? '开' : '关'}
              </span>
              <span className={`slot-tag ${active.rules.allowChat ? 'on' : 'off'}`}>
                聊天 {active.rules.allowChat ? '开' : '关'}
              </span>
              <span className="slot-tag off">倍率 {active.rules.initialTimeScale}x</span>
            </div>
          </div>
        )}
      </section>

      <section className="world-card">
        <h2>创建新世界</h2>
        <p className="world-hint">
          创建会归档当前世界并重置小镇(人物/坐标/时钟全部重新开始);
          性格特质、Agent 模型绑定等配置已预留,后续里程碑接入。
        </p>
        <label className="world-name-row">
          世界名
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <div className="world-roster-head">
          <span>居民({drafts.length}/{WORLD_CHARACTER_LIMITS.max})</span>
          <span className="world-roster-actions">
            <button type="button" className="admin-secondary" disabled={busy} onClick={randomizeAll}>
              一键随机名字
            </button>
            <button
              type="button"
              className="admin-secondary"
              disabled={busy || drafts.length >= WORLD_CHARACTER_LIMITS.max}
              onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
            >
              + 添加居民
            </button>
          </span>
        </div>
        <ul className="world-roster">
          {drafts.map((d, i) => (
            <li key={i} className="world-roster-row">
              <input
                placeholder="名字"
                value={d.name}
                maxLength={20}
                onChange={(e) => patchDraft(i, { name: e.target.value })}
              />
              <select
                value={d.gender}
                onChange={(e) => patchDraft(i, { gender: e.target.value as Gender })}
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {GENDER_LABELS[g]}
                  </option>
                ))}
              </select>
              <input
                className="world-persona"
                placeholder="人设(预留)"
                value={d.persona}
                maxLength={100}
                onChange={(e) => patchDraft(i, { persona: e.target.value })}
              />
              <button
                type="button"
                className="admin-secondary"
                title="随机一个名字"
                disabled={busy}
                onClick={() => patchDraft(i, { name: pickRandomName(d.gender) })}
              >
                随机
              </button>
              <button
                type="button"
                className="admin-secondary"
                title="移除该行"
                disabled={busy || drafts.length <= WORLD_CHARACTER_LIMITS.min}
                onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="world-rules">
          <span className="world-rules-title">世界规则</span>
          <label className="world-rules-check">
            <input
              type="checkbox"
              checked={rules.allowDeath}
              onChange={(e) => setRules((r) => ({ ...r, allowDeath: e.target.checked }))}
            />
            允许死亡
          </label>
          <label className="world-rules-check">
            <input
              type="checkbox"
              checked={rules.allowChat}
              onChange={(e) => setRules((r) => ({ ...r, allowChat: e.target.checked }))}
            />
            允许角色聊天
          </label>
          <label className="world-rules-check">
            初始倍率
            <select
              value={rules.initialTimeScale}
              onChange={(e) =>
                setRules((r) => ({ ...r, initialTimeScale: Number(e.target.value) as WorldRules['initialTimeScale'] }))
              }
            >
              {WORLD_TIME_SCALES.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="world-hint">
          规则随本世界创建定格:关闭死亡后体力归 0 只会躺平不会死;关闭聊天后角色聊天指令将被拒绝。
        </p>
        <button
          type="button"
          className="world-create"
          disabled={busy || name.trim() === ''}
          onClick={() => void submit()}
        >
          {busy ? '创建中…' : '创建世界'}
        </button>
      </section>

      <section className="world-card">
        <h2>历史世界({history.length})</h2>
        {history.length === 0 ? (
          <p className="world-empty">暂无归档世界</p>
        ) : (
          <ul className="world-history">
            {history.map((w) => (
              <li key={w.id}>
                <div className="world-history-info">
                  <strong>{w.name}</strong>
                  <span className="world-status closed">已归档</span>
                  <span className="world-meta">
                    {w.characters.length} 位 · {formatTime(w.createdAt)}
                    {w.closedAt ? ` → ${formatTime(w.closedAt)}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="admin-danger"
                  disabled={busy}
                  onClick={() => void remove(w)}
                >
                  删除记录
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
