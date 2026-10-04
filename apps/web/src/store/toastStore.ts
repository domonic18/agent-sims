import { create } from 'zustand';

export interface ToastItem {
  id: number;
  ok: boolean;
  message: string;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (ok: boolean, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const MAX_VISIBLE = 4;
const AUTO_DISMISS_MS = 3200;

/** 轻提示仓:Phaser 场景与 React 面板共用(操作回执的即时反馈) */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (ok, message) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts.slice(-(MAX_VISIBLE - 1)), { id, ok, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, AUTO_DISMISS_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** 非 React 环境(Phaser 场景)直接调用 */
export function pushToast(ok: boolean, message: string): void {
  useToastStore.getState().push(ok, message);
}
