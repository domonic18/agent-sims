import type { CameraMode } from '../../store/worldStore';
import { useWorldStore } from '../../store/worldStore';

/** 相机模式切换 chip(UI-1 三态): 点击在 跟随 → 全图概览 → 自由视角 间循环 */
const NEXT: Record<CameraMode, CameraMode> = {
  follow: 'overview',
  overview: 'free',
  free: 'follow',
};

export function CameraModeChip() {
  const cameraMode = useWorldStore((state) => state.cameraMode);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedCharacterId = useWorldStore((state) => state.selectedCharacterId);
  const setCameraMode = useWorldStore((state) => state.setCameraMode);
  const selected = snapshot?.characters.find((character) => character.id === selectedCharacterId);
  const label =
    cameraMode === 'follow'
      ? `相机跟随 · ${selected?.name ?? '—'}`
      : cameraMode === 'overview'
        ? '全图概览'
        : '自由视角';
  return (
    <button
      type="button"
      className="cam-chip"
      title="点击切换视角;自由视角下可拖拽平移、滚轮缩放"
      onClick={() => setCameraMode(NEXT[cameraMode])}
    >
      📷 {label}
    </button>
  );
}
