import type { ReactNode } from 'react';

/** 弹窗骨架(游戏界面自绘,零组件库): settings-overlay 点击关 >
 * px-box settings-modal(stopPropagation)> settings-head(标题+✕)> 内容 > settings-actions 底栏。
 * 骨架有异的 WorldSettingsModal(无 px-box/底栏嵌在 section 内)/LoginModal(login 专属布局)不套用。 */
export function ModalPanel({
  title,
  onClose,
  boxClassName,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  /** 追加在 settings-modal 后的弹窗级类名(如 mindtalk-modal) */
  boxClassName?: string;
  children: ReactNode;
  /** 底部 settings-actions 内容;缺省=单个关闭按钮 */
  footer?: ReactNode;
}): JSX.Element {
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className={`px-box settings-modal${boxClassName !== undefined ? ` ${boxClassName}` : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-head">
          <h2>{title}</h2>
          <button type="button" className="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
        {footer !== undefined && <div className="settings-actions">{footer}</div>}
      </div>
    </div>
  );
}
