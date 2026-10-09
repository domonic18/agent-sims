import { useEffect, useState } from 'react';
import type { CharacterScheduleView, WorldSnapshotMessage } from '@sims/shared';
import { fetchCharacterSchedule, replanCharacter } from '../admin/api';

/** 日程块状态徽标文案(M4d) */
const SCHEDULE_STATUS_LABELS: Record<CharacterScheduleBlockStatus, string> = {
  pending: '待开始',
  active: '进行中',
  done: '已完成',
};

type CharacterScheduleBlockStatus = CharacterScheduleView['blocks'][number]['status'];

function blockRange(startMin: number, endMin: number): string {
  const hhmm = (m: number): string =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${hhmm(startMin)}~${hhmm(endMin)}`;
}

/** 管理员·今日日程面板(LabPage 左栏七):5s 轮询看块状态翻转,与记忆面板共享角色选择;
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

  // 随角色切换拉取,5s 轮询看块状态翻转
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
      onMsg(`${name} 日程已清空,泵将在 2 秒内重新规划`);
      setScheduleData(null);
    } catch (error) {
      onMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <h3 style={{ marginTop: 14 }}>管理员 · 今日日程</h3>
      <div className="lab-btn-row">
        <button
          type="button"
          className="px-btn"
          disabled={memCharId === ''}
          onClick={() => void doReplan()}
        >
          重新规划
        </button>
        <span className="hint">
          {scheduleData === null
            ? '选择居民后查看日程(自治开启后 2 秒内生成)'
            : scheduleData.day === null
              ? '暂无当日计划'
              : `第 ${scheduleData.day} 天 · ${
                  scheduleData.source === 'llm' ? '慢思考生成' : '模板回落'
                }`}
        </span>
      </div>
      {scheduleData !== null && scheduleData.day !== null && (
        <ul className="memory-list">
          {scheduleData.blocks.map((b) => (
            <li key={`${b.startMin}-${b.activityId}`} className="memory-item">
              <span className={`mem-badge ${b.status}`}>
                {SCHEDULE_STATUS_LABELS[b.status]}
              </span>
              <div className="memory-body">
                <div>
                  {blockRange(b.startMin, b.endMin)} · {b.label}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
