import { useCallback, useEffect, useState } from 'react';
import type {
  MemoryImpressionsResponse,
  MemoryPanelResponse,
  MemoryType,
} from '@sims/shared';
import { MEMORY_TYPES, MEMORY_TYPE_LABELS } from '@sims/shared';
import { getCharacterImpressions, getCharacterMemories } from '../../net/worldApi';
import { formatGameMinutes } from '../../format';

/** 记忆查看弹窗(只读): 游戏页直接翻看 TA 的记忆流(游客/观众同样可见,直播观察姿态);
 * 缺省按时间倒序最近 50 条,输入检索词走三因子语义检索(命中带综合分/相关度);
 * 层过滤(事件/洞察/梦境/对话)+洞察溯源+关系印象区(10-cognition §3 全员人可见)。 */
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
  const [impressions, setImpressions] = useState<MemoryImpressionsResponse | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<MemoryType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (q: string, t: MemoryType | null): Promise<void> => {
      setLoading(true);
      try {
        const [panel, imp] = await Promise.all([
          getCharacterMemories(
            characterId,
            {
              limit: 50,
              ...(q === '' ? {} : { q }),
              ...(t === null ? {} : { type: t }),
            },
          ),
          getCharacterImpressions(characterId).catch(() => null),
        ]);
        setData(panel);
        if (imp !== null) setImpressions(imp);
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
    void load('', null);
  }, [load]);

  const search = (): void => {
    void load(query.trim(), type);
  };
  const backToRecent = (): void => {
    setQuery('');
    setType(null);
    void load('', null);
  };
  const switchType = (next: MemoryType | null): void => {
    setType(next);
    void load(query.trim(), next);
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
        <p className="hint">TA 经历过的事都会记在这里;洞察是 TA 从经历中沉淀的认知(带溯源),梦境是睡饱后的回忆变形(只读)。</p>

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

        <div className="mem-filters">
          <button
            type="button"
            className={`px-btn${type === null ? ' on' : ''}`}
            disabled={loading}
            onClick={() => switchType(null)}
          >
            全部
          </button>
          {MEMORY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`px-btn${type === t ? ' on' : ''}`}
              disabled={loading}
              onClick={() => switchType(t)}
            >
              {MEMORY_TYPE_LABELS[t]}
            </button>
          ))}
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
                      {item.sources !== undefined && item.sources.length > 0 && (
                        <small className="mem-sources">
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

        {impressions !== null && impressions.items.length > 0 && (
          <>
            <p className="hint" style={{ marginTop: 8 }}>
              对其他人的印象({impressions.items.length} 人)
            </p>
            <ul className="memory-list">
              {impressions.items.map((item) => (
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

        <div className="settings-actions">
          <button type="button" className="px-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
