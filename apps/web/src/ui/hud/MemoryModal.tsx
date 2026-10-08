import { useCallback, useEffect, useState } from 'react';
import type { MemoryPanelResponse } from '@sims/shared';
import { MEMORY_TYPE_LABELS } from '@sims/shared';
import { fetchCharacterMemories } from '../../admin/api';
import { formatGameMinutes } from '../../format';

/** 记忆查看弹窗(只读): 管理员在游戏页直接翻看 TA 的记忆流;
 * 缺省按时间倒序最近 50 条,输入检索词走三因子语义检索(命中带综合分/相关度)。 */
export function MemoryModal({
  characterId,
  characterName,
  onClose,
}: {
  characterId: string;
  characterName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<MemoryPanelResponse | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (q: string): Promise<void> => {
      setLoading(true);
      try {
        setData(await fetchCharacterMemories(characterId, q === '' ? { limit: 50 } : { q, limit: 50 }));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [characterId],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  const search = (): void => {
    const q = query.trim();
    void load(q);
  };
  const backToRecent = (): void => {
    setQuery('');
    void load('');
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="px-box settings-modal memory-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <h2>🧠 {characterName} · 记忆</h2>
          <button type="button" className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="hint">TA 经历过的事都会记在这里;梦境是 TA 睡饱后对当天经历的回忆变形(只读)。</p>

        <div className="memory-search">
          <input
            autoFocus
            value={query}
            maxLength={100}
            placeholder="语义检索记忆…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search();
            }}
          />
          <button type="button" className="px-btn" disabled={loading} onClick={search}>
            🔍 检索
          </button>
          <button type="button" className="px-btn" disabled={loading} onClick={backToRecent}>
            ↺ 最近
          </button>
        </div>

        {loading && <p className="hint">加载中…</p>}
        {error !== null && <p className="feedback err">{error}</p>}
        {data !== null && !loading && (
          <>
            {data.notice !== null && <p className="feedback err">{data.notice}</p>}
            <p className="hint">
              {data.mode === 'search'
                ? `三因子检索 · 命中 ${data.items.length} 条`
                : `最近 ${data.items.length} 条`}
            </p>
            <ul className="memory-list">
              {data.items.length === 0 ? (
                <li className="hint">暂无记忆</li>
              ) : (
                data.items.map((item) => (
                  <li key={item.id} className="memory-item">
                    <span className={`mem-badge ${item.type}`}>{MEMORY_TYPE_LABELS[item.type]}</span>
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
                    </div>
                  </li>
                ))
              )}
            </ul>
          </>
        )}

        <div className="settings-actions">
          <button type="button" className="px-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
