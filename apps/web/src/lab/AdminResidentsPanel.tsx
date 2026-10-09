import { useEffect, useState } from 'react';
import {
  GENDERS,
  GENDER_LABELS,
  type Gender,
  type WorldArchiveView,
} from '@sims/shared';
import {
  addWorldCharacter,
  deleteWorldArchive,
  fetchWorldArchives,
  loadWorldArchive,
  saveWorldArchive,
} from '../admin/api';

/** 管理员·添加居民+世界存档面板(LabPage 左栏四):入驻表单与存档列表同块;
 * 提示/错误文案统一走 adminMsg(父级持有,记忆/人设等操作也写同一条) */
export function AdminResidentsPanel({
  msg,
  onMsg,
}: {
  msg: string | null;
  onMsg: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('unspecified');
  const [persona, setPersona] = useState('');
  // 世界存档(C6):列表/保存命名/读取删除
  const [archives, setArchives] = useState<WorldArchiveView[]>([]);
  const [archiveLabel, setArchiveLabel] = useState('');

  const addResident = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') {
      onMsg('名字不能为空');
      return;
    }
    try {
      const spawned = await addWorldCharacter({
        name: trimmed,
        gender,
        ...(persona.trim() !== '' ? { persona: persona.trim() } : {}),
      });
      onMsg(`「${spawned.name}」已入驻 (${spawned.x},${spawned.y})`);
      setName('');
      setPersona('');
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshArchives = async (): Promise<void> => {
    try {
      setArchives(await fetchWorldArchives());
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    }
  };

  // 面板仅 admin 通道就绪时挂载:挂载即拉一次存档列表
  useEffect(() => {
    void refreshArchives();
  }, []);

  const saveArchive = async (): Promise<void> => {
    try {
      const saved = await saveWorldArchive(archiveLabel);
      onMsg(`已保存「${saved.label}」(${saved.characterCount} 位居民)`);
      setArchiveLabel('');
      await refreshArchives();
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const loadArchive = async (archive: WorldArchiveView): Promise<void> => {
    try {
      await loadWorldArchive(archive.id);
      onMsg(`已读取「${archive.label}」`);
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const removeArchive = async (archive: WorldArchiveView): Promise<void> => {
    try {
      await deleteWorldArchive(archive.id);
      await refreshArchives();
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="px-box lab-panel-px">
      <div className="px-inner lab-panel-inner">
        <h3>管理员 · 添加居民</h3>
        <div className="lab-btn-row">
          <input
            className="lab-input"
            placeholder="新居民名字"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="lab-input lab-select"
            value={gender}
            onChange={(e) => setGender(e.target.value as Gender)}
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
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
        {msg !== null && <p className="hint">{msg}</p>}

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
  );
}
