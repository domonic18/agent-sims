import { useEffect, useState } from 'react';
import type { CharacterScheduleView, WorldSnapshotMessage } from '@sims/shared';
import { fetchCharacterSchedule, replanCharacter } from '../admin/api';

/** want 状态徽标:D3 弹性意图四态 */
const WANT_STATUS_META: Record<CharacterScheduleView['wants'][number]['status'], { label: string; cls: string }> = {
  pending: { label: '想做', cls: 'pending' },
  doing: { label: '进行中', cls: 'active' },
  done: { label: '已完成', cls: 'done' },
  abandoned: { label: '放弃', cls: 'dropped' },
};

/** 管理员·今日意图面板(LabPage 左栏七):5s 轮询看 want 状态翻转,与记忆面板共享角色选择;
 * 提示文案经 onMsg(adminMsg)透出 */
export function AdminSchedulePanel({
  snapshot,
  memCharId,
  onMsg,
}: {
  snapshot: WorldSnapshotMessage | null;
  memCharId: string;
  onMsg: (message: string | null) => void;
}) {
  const [scheduleData, setScheduleData] = useState<CharacterScheduleView | null>(null);

  // 随角色切换拉取,5s 轮询看 want 状态翻转
  useEffect(() => {
    setScheduleData(null);
    if (memCharId === '') return;
    let alive = true;
    const load = (): void => {
      fetchCharacterSchedule(memCharId)
        .then((view) => {
          if (alive) setScheduleData(view);
        })
        .catch(() => {
          /* 角色刚移除等瞬时错误:保留上一帧 */
        });
    };
    load();
    const poll = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [memCharId]);

  const doReplan = async (): Promise<void> => {
    if (memCharId === '') return;
    try {
      await replanCharacter(memCharId);
      const name = snapshot?.characters.find((c) => c.id === memCharId)?.name ?? '角色';
      onMsg(`${name} 意图已清空,泵将在 2 秒内重新生成`);
      setScheduleData(null);
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <h3 style={{ marginTop: 14 }}>管理员 · 今日意图</h3>
      <div className="lab-btn-row">
        <button
          type="button"
          className="px-btn"
          disabled={memCharId === ''}
          onClick={() => void doReplan()}
        >
          重新生成
        </button>
        <span className="hint">
          {scheduleData === null
            ? '选择居民后查看意图(自治开启后 2 秒内生成)'
            : scheduleData.day === null
              ? '暂无当日意图'
              : `第 ${scheduleData.day} 天 · ${
                  scheduleData.source === 'llm' ? '慢思考生成' : '个性化回落'
                }`}
        </span>
      </div>
      {scheduleData !== null && scheduleData.day !== null && (
        <ul className="memory-list">
          {scheduleData.wants.map((w) => (
            <li key={w.id} className="memory-item">
              <span className={`mem-badge ${WANT_STATUS_META[w.status].cls}`}>
                {WANT_STATUS_META[w.status].label}
              </span>
              <div className="memory-body">
                <div>
                  {w.label} · 想做程度 {Math.round(w.urgency * 100)}%
                </div>
                <div className="hint">{w.why}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
