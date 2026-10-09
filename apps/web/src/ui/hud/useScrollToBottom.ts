import { useEffect, type DependencyList, type RefObject } from 'react';

/** 列表新条目自动滚底(enabled=false 跳过,如抽屉关闭/对话收起)。
 * deps 由调用方给定: 触发滚底的时机语义各异(开抽屉/新消息/历史到达),不强行统一 */
export function useScrollToBottom(
  ref: RefObject<HTMLDivElement | null>,
  deps: DependencyList,
  enabled = true,
): void {
  useEffect(() => {
    if (enabled && ref.current !== null) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, deps);
}
