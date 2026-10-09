import { useEffect, useState } from 'react';
import type { CharacterMoodResponse } from '@sims/shared';
import { fetchCharacterMood } from '../admin/api';
import { formatGameMinutes } from '../format';

/** 情绪倾向文案(C2,阈值与 server describeMood 同步) */
function moodTone(valence: number): string {
  if (valence >= 0.45) return '很高兴';
  if (valence >= 0.15) return '心情不错';
  if (valence <= -0.45) return '很沮丧';
  if (valence <= -0.15) return '有点低落';
  return '心情平静';
}

/** 管理员·情绪面板(LabPage 左栏六):当前态+冲量历史,与记忆面板共享角色选择 */
export function AdminMoodPanel({ memCharId }: { memCharId: string }) {
  const [moodData, setMoodData] = useState<CharacterMoodResponse | null>(null);

  const loadMood = async (characterId: string): Promise<void> => {
    if (characterId === '') return;
    try {
      setMoodData(await fetchCharacterMood(characterId));
    } catch {
      setMoodData(null);
    }
  };

  useEffect(() => {
    setMoodData(null);
    if (memCharId !== '') void loadMood(memCharId);
  }, [memCharId]);

  return (
    <>
      <h3 style={{ marginTop: 14 }}>管理员 · 情绪</h3>
      <div className="lab-btn-row">
        <button
          type="button"
          className="px-btn"
          disabled={memCharId === ''}
          onClick={() => void loadMood(memCharId)}
        >
          ↻ 刷新
        </button>
        {moodData !== null && (
          <span className="hint">
            {moodTone(moodData.current.valence)}
            {moodData.current.labels.length > 0
              ? `(${moodData.current.labels.join('、')})`
              : ''}
            {` · 倾向 ${moodData.current.valence >= 0 ? '+' : ''}${moodData.current.valence.toFixed(2)}`}
          </span>
        )}
      </div>
      {moodData !== null && (
        <div className="lab-mood-bar" aria-hidden>
          <span
            className={`lab-mood-fill ${moodData.current.valence >= 0 ? 'up' : 'down'}`}
            style={{ width: `${((moodData.current.valence + 1) / 2) * 100}%` }}
          />
        </div>
      )}
      {moodData !== null && moodData.history.length > 0 && (
        <ul className="memory-list">
          {moodData.history.map((point, index) => (
            <li key={index} className="memory-item">
              <span
                className={`mem-badge ${point.delta >= 0 ? 'mood-up' : 'mood-down'}`}
              >
                {point.delta >= 0 ? '振奋' : '受挫'}
              </span>
              <div className="memory-body">
                <div>{point.labels.join('、')}</div>
                <small>
                  {formatGameMinutes(point.gameMinutes)} ·{' '}
                  {point.delta >= 0 ? '+' : ''}
                  {point.delta.toFixed(2)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
