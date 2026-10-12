/**
 * admin 布局开关(zustand 仅进 admin chunk):地图编辑器这类全屏工作台
 * 挂载时申请铺满内容区(去掉 maxWidth/内边距),卸载时归还普通版式。
 */
import { create } from 'zustand';

interface LayoutState {
  fullBleed: boolean;
  setFullBleed(fullBleed: boolean): void;
}

export const useLayout = create<LayoutState>((set) => ({
  fullBleed: false,
  setFullBleed: (fullBleed) => set({ fullBleed }),
}));
