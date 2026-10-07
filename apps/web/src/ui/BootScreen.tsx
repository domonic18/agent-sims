/**
 * 游戏风加载屏(L1):两处复用同一家——
 * ① main.tsx Suspense 兜底(JS chunk 下载期,indeterminate);
 * ② GamePage 启动罩(世界数据/像素素材/进入小镇,素材进度 determinate)。
 * index.html 内有一份等价静态版(JS 未落地时的首字节反馈),改样式请两处同步。
 */
interface BootScreenProps {
  text: string;
  /** 0~1 有值=确定进度条,缺省=滑动不确定条 */
  progress?: number;
}

export function BootScreen({ text, progress }: BootScreenProps) {
  return (
    <div className="boot">
      <div className="px-box boot-box">
        <div className="px-inner boot-inner">
          <div className="boot-title">AGENT·SIMS</div>
          <div className="boot-bar">
            {progress === undefined ? (
              <div className="boot-bar-fill indeterminate" />
            ) : (
              <div className="boot-bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            )}
          </div>
          <div className="boot-text">
            {progress === undefined ? text : `${text} ${Math.round(progress * 100)}%`}
          </div>
          <div className="boot-tip">像素小镇 · 加载中请稍候</div>
        </div>
      </div>
    </div>
  );
}
