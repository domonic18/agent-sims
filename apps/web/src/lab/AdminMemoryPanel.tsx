import { useEffect, useState } from 'react';
import {
  MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  type MemoryImpressionsResponse,
  type MemoryPanelResponse,
  type MemoryType,
  type WorldSnapshotMessage,
} from '@sims/shared';
import {
  fetchCharacterAutonomy,
  fetchCharacterImpressions,
  fetchCharacterMemories,
  setCharacterAutonomy,
} from '../admin/api';
import { formatGameMinutes } from '../format';

/** 管理员·记忆面板(LabPage 左栏五):托管开关/角色下拉/语义检索/记忆列表/印象列表;
 * 角色选择(memCharId)与提示文案(adminMsg)由父级持有,与情绪/日程/人设面板共享 */
export function AdminMemoryPanel({
  snapshot,
  memCharId,
  onSelectCharacter,
  onMsg,
}: {
  snapshot: WorldSnapshotMessage | null;
  memCharId: string;
  onSelectCharacter: (id: string) => void;
  onMsg: (message: string | null) => void;
}) {
  const [memQuery, setMemQuery] = useState('');
  const [memType, setMemType] = useState<MemoryType | null>(null);
  const [memData, setMemData] = useState<MemoryPanelResponse | null>(null);
  const [memImpressions, setMemImpressions] = useState<MemoryImpressionsResponse | null>(null);
  const [memLoading, setMemLoading] = useState(false);
  // 自治开关(M4c):null=未查询
  const [autonomyOn, setAutonomyOn] = useState<boolean | null>(null);

  const loadMemories = async (characterId: string, q: string, t: MemoryType | null): Promise<void> => {
    if (characterId === '') return;
    setMemLoading(true);
    try {
      const [panel, imp] = await Promise.all([
        fetchCharacterMemories(characterId, {
          ...(q.trim() !== '' ? { q: q.trim() } : {}),
          ...(t === null ? {} : { type: t }),
          limit: 50,
        }),
        fetchCharacterImpressions(characterId).catch(() => null),
      ]);
      setMemData(panel);
      if (imp !== null) setMemImpressions(imp);
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setMemLoading(false);
    }
  };

  const searchMemories = async (): Promise<void> => {
    await loadMemories(memCharId, memQuery, memType);
  };

  const switchMemType = (next: MemoryType | null): void => {
    setMemType(next);
    void loadMemories(memCharId, memQuery, next);
  };

  // 角色切换(或首次就绪)拉取记忆;admin 通道由父级挂载门控
  useEffect(() => {
    if (memCharId !== '') void loadMemories(memCharId, '', null);
  }, [memCharId]);

  // 自治状态随角色切换拉取;角色不在世界(404)按未开启处理
  useEffect(() => {
    setAutonomyOn(null);
    if (memCharId === '') return;
    fetchCharacterAutonomy(memCharId)
      .then((r) => setAutonomyOn(r.enabled))
      .catch(() => setAutonomyOn(false));
  }, [memCharId]);

  const toggleAutonomy = async (): Promise<void> => {
    if (memCharId === '' || autonomyOn === null) return;
    const next = !autonomyOn;
    try {
      await setCharacterAutonomy(memCharId, next);
      setAutonomyOn(next);
      const name = snapshot?.characters.find((c) => c.id === memCharId)?.name ?? '角色';
      onMsg(`${name} 托管(全)已${next ? '开启' : '关闭'}`);
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <h3>管理员 · 记忆面板</h3>
      <div className="lab-btn-row">
        <button
          type="button"
          className="px-btn"
          disabled={memCharId === '' || autonomyOn === null}
          onClick={() => void toggleAutonomy()}
        >
          {autonomyOn === null
            ? '托管(全):—'
            : autonomyOn
              ? '托管(全):开(点击关闭)'
              : '托管(全):关(点击开启)'}
        </button>
        <select
          className="lab-input lab-memory-char"
          value={memCharId}
          onChange={(e) => onSelectCharacter(e.target.value)}
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
      <div className="lab-btn-row">
        <button
          type="button"
          className={`px-btn${memType === null ? ' on' : ''}`}
          disabled={memCharId === ''}
          onClick={() => switchMemType(null)}
        >
          全部
        </button>
        {MEMORY_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`px-btn${memType === t ? ' on' : ''}`}
            disabled={memCharId === ''}
            onClick={() => switchMemType(t)}
          >
            {MEMORY_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {memData !== null && !memLoading && (
        <>
          {memData.notice !== null && <p className="lab-err">{memData.notice}</p>}
          <p className="hint">
            {memData.mode === 'search'
              ? `三因子检索 · 命中 ${memData.items.length} 条`
              : `最近 ${memData.items.length} 条`}
          </p>
          <ul className="memory-list">
            {memData.items.length === 0 ? (
              <li className="hint">暂无记忆</li>
            ) : (
              memData.items.map((item) => (
                <li key={item.id} className="memory-item">
                  <span className={`mem-badge ${item.type}`}>
                    {MEMORY_TYPE_LABELS[item.type]}
                  </span>
                  <div className="memory-body">
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
                    {item.sources !== undefined && item.sources.length > 0 && (
                      <small className="lab-mem-sources">
                        溯源: {item.sources.join(' / ')}
                      </small>
                    )}
                  </div>
                </li>
              ))
            )}
          </ul>
        </>
      )}
      {memImpressions !== null && memImpressions.items.length > 0 && (
        <>
          <p className="hint" style={{ marginTop: 10 }}>
            对其他人的印象({memImpressions.items.length} 人)
          </p>
          <ul className="memory-list">
            {memImpressions.items.map((item) => (
              <li key={item.aboutId} className="memory-item">
                <span className="mem-badge impression">印象</span>
                <div className="memory-body">
                  <div>
                    <b>{item.aboutName}</b>: {item.content}
                  </div>
                  <small>{formatGameMinutes(item.gameMinutes)}更新</small>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
