import type { WorldSnapshotMessage } from '@sims/shared';

/** snapshot.characters 按 id 查显示名/存在性(HUD 日志/对话流/弹窗标题共用);
 * nameOf 未找到回退: 缺省=裸 id(日志类),弹窗标题传『居民』类友好文案 */
export function useCharacterLookup(snapshot: WorldSnapshotMessage | null): {
  nameOf: (id: string, fallback?: string) => string;
  known: (id: string) => boolean;
} {
  const nameOf = (id: string, fallback: string = id): string =>
    snapshot?.characters.find((item) => item.id === id)?.name ?? fallback;
  const known = (id: string): boolean =>
    snapshot?.characters.some((item) => item.id === id) ?? false;
  return { nameOf, known };
}
