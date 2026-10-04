import { useToastStore } from '../store/toastStore';
import './toasts.css';

/** 画布底部轻提示层:操作回执(成功/失败)即时反馈,点击可提前关闭 */
export function Toasts() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={toast.ok ? 'toast ok' : 'toast err'}
          onClick={() => dismiss(toast.id)}
        >
          {toast.ok ? '✓' : '✗'} {toast.message}
        </button>
      ))}
    </div>
  );
}
