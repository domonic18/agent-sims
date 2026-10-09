import { useEffect, useState } from 'react';
import {
  type NarrativeHistoryEntry,
  type PersonaCard,
  type SelfNarrative,
  type WorldSnapshotMessage,
} from '@sims/shared';
import {
  fetchPersona,
  generateNarrativeDraft,
  putPersona,
  randomPersonaDraft,
} from '../admin/api';
import { getHosting } from '../net/hostingApi';
import { formatGameMinutes } from '../format';

const EMPTY_PERSONA_CARD: PersonaCard = {
  性格: '',
  兴趣: '',
  目标: '',
  说话风格: '',
  bio: '',
};

/** 管理员·预置人设面板(LabPage 左栏八):bio+card 编辑/随机草稿/自我叙事(L4)与演化史;
 * 角色选择(memCharId)与提示文案(adminMsg)由父级持有 */
export function AdminPersonaPanel({
  snapshot,
  memCharId,
  onMsg,
}: {
  snapshot: WorldSnapshotMessage | null;
  memCharId: string;
  onMsg: (message: string | null) => void;
}) {
  const [bio, setBio] = useState('');
  const [card, setCard] = useState<PersonaCard>(EMPTY_PERSONA_CARD);
  const [narrative, setNarrative] = useState<SelfNarrative | null>(null);
  const [traitsText, setTraitsText] = useState('');
  const [history, setHistory] = useState<NarrativeHistoryEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<'save' | 'random' | 'narr' | 'nsave' | null>(null);

  // 随角色切换拉取回填表单(404 等错误保持空白,保存时透出)
  useEffect(() => {
    if (memCharId === '') return;
    let alive = true;
    setReady(false);
    fetchPersona(memCharId)
      .then((view) => {
        if (!alive) return;
        setBio(view.bio);
        setCard(view.card ?? EMPTY_PERSONA_CARD);
        setNarrative(view.selfNarrative);
        setTraitsText(view.selfNarrative?.traits.join('、') ?? '');
        setHistory(view.narrativeHistory);
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [memCharId]);

  const randomizePersona = async (): Promise<void> => {
    if (memCharId === '' || busy !== null) return;
    setBusy('random');
    try {
      const draft = await randomPersonaDraft(memCharId);
      setBio(draft.bio);
      setCard(draft.card);
      onMsg('已生成随机人设草稿(未落库),确认后点保存');
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const savePersonaForm = async (): Promise<void> => {
    if (memCharId === '' || busy !== null) return;
    setBusy('save');
    try {
      const view = await putPersona(memCharId, { bio, card });
      setBio(view.bio);
      setCard(view.card ?? EMPTY_PERSONA_CARD);
      setNarrative(view.selfNarrative);
      setTraitsText(view.selfNarrative?.traits.join('、') ?? '');
      setHistory(view.narrativeHistory);
      const name = snapshot?.characters.find((c) => c.id === memCharId)?.name ?? '角色';
      // 托管中的角色保存即清日程,泵按新人设重规划(服务端行为,这里只做提示)
      const hosted = await getHosting(memCharId)
        .then((h) => h.hosted)
        .catch(() => false);
      onMsg(`${name} 人设已保存${hosted ? '(托管中:日程已清,泵将按新人设重规划)' : ''}`);
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const parseTraits = (raw: string): string[] =>
    raw
      .split(/[、,，\s]+/)
      .map((t) => t.trim())
      .filter((t) => t !== '')
      .slice(0, 6);

  const generateNarrative = async (): Promise<void> => {
    if (memCharId === '' || busy !== null) return;
    setBusy('narr');
    try {
      const draft = await generateNarrativeDraft(memCharId);
      setNarrative((prev) => ({
        text: draft.text,
        traits: draft.traits,
        version: prev?.version ?? 0,
        updatedAtGameMinutes: prev?.updatedAtGameMinutes ?? 0,
      }));
      setTraitsText(draft.traits.join('、'));
      onMsg('已生成自我叙事草稿(未落库),确认后点保存叙事');
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const saveNarrative = async (): Promise<void> => {
    if (memCharId === '' || busy !== null) return;
    const text = narrative?.text.trim() ?? '';
    if (text === '') {
      onMsg('自我叙事不能为空');
      return;
    }
    setBusy('nsave');
    try {
      const view = await putPersona(memCharId, {
        selfNarrative: { text, traits: parseTraits(traitsText) },
      });
      setNarrative(view.selfNarrative);
      setTraitsText(view.selfNarrative?.traits.join('、') ?? '');
      setHistory(view.narrativeHistory);
      onMsg(`自我叙事已保存(v${view.selfNarrative?.version ?? '?'}),旧版已入演化史`);
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h3 style={{ marginTop: 14 }}>管理员 · 预置人设</h3>
      {!ready ? (
        <p className="hint">人设加载中…</p>
      ) : (
        <>
          <textarea
            className="lab-input lab-persona-bio"
            placeholder="bio · 人物小传(2~3 句)"
            maxLength={500}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
          <div className="lab-persona-grid">
            {(['性格', '兴趣', '目标', '说话风格'] as const).map((field) => (
              <label key={field} className="lab-persona-field">
                <span>{field}</span>
                <input
                  className="lab-input"
                  maxLength={200}
                  value={card[field]}
                  onChange={(e) =>
                    setCard((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                />
              </label>
            ))}
            <label className="lab-persona-field lab-persona-wide">
              <span>小传</span>
              <input
                className="lab-input"
                maxLength={500}
                value={card.bio}
                onChange={(e) =>
                  setCard((prev) => ({ ...prev, bio: e.target.value }))
                }
              />
            </label>
          </div>
          <div className="lab-btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="px-btn"
              disabled={memCharId === '' || busy !== null}
              onClick={() => void randomizePersona()}
            >
              {busy === 'random' ? '生成中…' : '🎲 随机生成'}
            </button>
            <button
              type="button"
              className="px-btn"
              disabled={memCharId === '' || busy !== null}
              onClick={() => void savePersonaForm()}
            >
              {busy === 'save' ? '保存中…' : '💾 保存人设'}
            </button>
          </div>
          <p className="hint">随机草稿只填表不落库;保存后影响 TA 的日程规划、决策与访谈口吻。</p>
          <h4 style={{ margin: '12px 0 0' }}>
            自我叙事(L4)
            {narrative === null
              ? '(未初始化,决策回落 bio)'
              : ` · v${narrative.version}`}
          </h4>
          <textarea
            className="lab-input lab-persona-bio"
            placeholder="第一人称「我是谁」(≤200 字,系统周级/里程碑自动修订)"
            maxLength={200}
            value={narrative?.text ?? ''}
            onChange={(e) =>
              setNarrative((prev) => ({
                text: e.target.value,
                traits: prev?.traits ?? [],
                version: prev?.version ?? 0,
                updatedAtGameMinutes: prev?.updatedAtGameMinutes ?? 0,
              }))
            }
          />
          <input
            className="lab-input"
            style={{ marginTop: 6 }}
            placeholder="特质词(顿号分隔,3~6 个)"
            maxLength={140}
            value={traitsText}
            onChange={(e) => setTraitsText(e.target.value)}
          />
          <div className="lab-btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="px-btn"
              disabled={memCharId === '' || busy !== null}
              onClick={() => void generateNarrative()}
            >
              {busy === 'narr' ? '生成中…' : '✨ 生成叙事草稿'}
            </button>
            <button
              type="button"
              className="px-btn"
              disabled={
                memCharId === '' ||
                busy !== null ||
                (narrative?.text ?? '').trim() === ''
              }
              onClick={() => void saveNarrative()}
            >
              {busy === 'nsave' ? '保存中…' : '💾 保存叙事'}
            </button>
          </div>
          {history.length > 0 && (
            <details className="lab-narrative-history">
              <summary>演化史({history.length} 版,新→旧)</summary>
              <ul>
                {history.map((entry, i) => (
                  <li key={`${entry.version}-${i}`}>
                    <small>
                      v{entry.version} · {formatGameMinutes(entry.archivedAtGameMinutes)}归档
                    </small>
                    <p>{entry.text}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="hint">
            此处修改视为一次人工修订(旧版入演化史);周级复盘与里程碑由系统自动修订并写「我对自己的看法变了」记忆。
          </p>
        </>
      )}
    </>
  );
}
