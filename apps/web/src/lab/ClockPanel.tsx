import type { WorldSnapshotMessage } from '@sims/shared';

/** 时钟控制面板(LabPage 左栏一):暂停/倍速/+60分/+1天,错误文案显示在本块 */
const TIME_SCALES = [1, 4, 16] as const;

export function ClockPanel({
  snapshot,
  controlError,
  onPause,
  onScale,
  onAdvance,
}: {
  snapshot: WorldSnapshotMessage | null;
  controlError: string | null;
  onPause: () => void;
  onScale: (scale: number) => void;
  onAdvance: (n: number) => void;
}) {
  return (
    <div className="px-box lab-panel-px">
      <div className="px-inner lab-panel-inner">
        <h3>时钟控制</h3>
        <div className="lab-btn-row">
          <button
            type="button"
            className="px-btn"
            disabled={snapshot === null}
            onClick={onPause}
          >
            {snapshot?.paused ? '▶ 继续' : '⏸ 暂停'}
          </button>
          {TIME_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={`px-btn${snapshot?.timeScale === scale ? ' on' : ''}`}
              disabled={snapshot === null}
              onClick={() => onScale(scale)}
            >
              {scale}x
            </button>
          ))}
          <button type="button" className="px-btn" onClick={() => onAdvance(60)}>
            +60分
          </button>
          <button type="button" className="px-btn" onClick={() => onAdvance(1440)}>
            +1天
          </button>
        </div>
        {controlError !== null && <p className="lab-err">{controlError}</p>}
      </div>
    </div>
  );
}
