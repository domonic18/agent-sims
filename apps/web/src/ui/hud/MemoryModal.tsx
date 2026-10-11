import { useCallback, useEffect, useState } from 'react';
import type {
  MemoryImpressionsResponse,
  MemoryPanelResponse,
  MemoryType,
} from '@sims/shared';
import { MEMORY_TYPES, MEMORY_TYPE_LABELS } from '@sims/shared';
import { getCharacterImpressions, getCharacterMemories } from '../../net/worldApi';
import { formatGameMinutes } from '../../format';
import { toErrorMessage } from '../errors';
import { ModalPanel } from '../ModalPanel';
import { useWorldStore } from '../../store/worldStore';
import { PixelAvatar } from './PixelAvatar';

/** dialogue 记忆转泡: 「我和XX聊了聊:台词」拆出 lead=「和 XX 的对话」,台词入泡;其余整条入泡 */
function splitDialogue(content: string): { lead: string | null; text: string } {
  const m = content.match(/^我和(.+?)聊了聊:([\s\S]+)$/);
  if (m === null || m[1] === undefined || m[2] === undefined) return { lead: null, text: content };
  return { lead: `和 ${m[1]} 的对话`, text: m[2] };
}

/** 记忆查看弹窗(只读): 游戏页直接翻看 TA 的记忆流(游客/观众同样可见,直播观察姿态);
 * 缺省按时间倒序最近 50 条;类型过滤(事件/洞察/梦境/对话)+洞察溯源+关系印象区
 * (10-cognition §3 全员人可见);对话记忆以聊天气泡呈现。 */
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
  const [type, setType] = useState<MemoryType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);

  const load = useCallback(
    async (t: MemoryType | null): Promise<void> => {
      setLoading(true);
      try {
        const [panel, imp] = await Promise.all([
          getCharacterMemories(characterId, {
            limit: 50,
            ...(t === null ? {} : { type: t }),
          }),
          getCharacterImpressions(characterId).catch(() => null),
        ]);
        setData(panel);
        if (imp !== null) setImpressions(imp);
        setError(null);
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [characterId],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const switchType = (next: MemoryType | null): void => {
    setType(next);
    void load(next);
  };

  return (
    <ModalPanel
      title={
        <span className="mem-modal-title">
          <PixelAvatar characterId={characterId} size={24} />
          {characterName} · 记忆库
        </span>
      }
      onClose={onClose}
      boxClassName="memory-modal"
      footer={
        <button type="button" className="px-btn" onClick={onClose}>
          关闭
        </button>
      }
    >
      <p className="hint">TA 经历过的事都会记在这里;洞察是 TA 从经历中沉淀的认知(带溯源),梦境是睡饱后的回忆变形(只读)。</p>

      <div className="mem-toolbar">
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
          <p className="mem-result-line">
            <span>按时间倒序</span>
            <span className="mem-count">{data.items.length} 条</span>
          </p>
          <ul className="memory-list">
            {data.items.length === 0 ? (
              <li className="hint">暂无记忆</li>
            ) : (
              data.items.map((item) => {
                if (item.type === 'dialogue') {
                  const { lead, text } = splitDialogue(item.content);
                  return (
                    <li key={item.id} className="memory-item mem-chat-item">
                      <div className="mem-chat-body">
                        {lead !== null && <small className="mem-chat-lead">{lead}</small>}
                        <div className="bubble-row">
                          <PixelAvatar characterId={characterId} size={28} />
                          <div className="bubble">{text}</div>
                        </div>
                        <small className="mem-meta">
                          <span className="mem-badge dialogue">{MEMORY_TYPE_LABELS[item.type]}</span>
                          <span className="mem-imp" title={`重要度 ${item.importance}/10`}>
                            <i style={{ width: `${Math.min(100, item.importance * 10)}%` }} />
                            <u />
                          </span>
                          {formatGameMinutes(item.gameMinutes)}
                        </small>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={item.id} className={`memory-item mem-type-${item.type}`}>
                    <span className={`mem-badge ${item.type}`}>{MEMORY_TYPE_LABELS[item.type]}</span>
                    <div className="memory-body">
                      <div>{item.content}</div>
                      <small className="mem-meta">
                        <span className="mem-imp" title={`重要度 ${item.importance}/10`}>
                          <i style={{ width: `${Math.min(100, item.importance * 10)}%` }} />
                          <u />
                        </span>
                        {formatGameMinutes(item.gameMinutes)}
                      </small>
                      {item.sources !== undefined && item.sources.length > 0 && (
                        <small className="mem-sources">
                          溯源: {item.sources.join(' / ')}
                        </small>
                      )}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </>
      )}

      {impressions !== null && impressions.items.length > 0 && (
        <>
          <p className="hint" style={{ marginTop: 8 }}>
            对其他人的印象({impressions.items.length} 人,点击定位)
          </p>
          <ul className="mem-impressions">
            {impressions.items.map((item) => (
              <li
                key={item.aboutId}
                className="mem-imp-card"
                title={`点击定位 ${item.aboutName}`}
                onClick={() => selectCharacter(item.aboutId)}
              >
                <div className="mem-imp-head">
                  <PixelAvatar characterId={item.aboutId} size={20} />
                  <b>{item.aboutName}</b>
                </div>
                <div className="mem-imp-text">{item.content}</div>
                <small>{formatGameMinutes(item.gameMinutes)}更新</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </ModalPanel>
  );
}
