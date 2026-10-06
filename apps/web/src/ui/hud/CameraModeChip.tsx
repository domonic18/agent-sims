import { useWorldStore } from '../../store/worldStore';

/** 相机模式切换 chip(UI-1): 右下角显示当前跟随对象,点击在跟随/全图概览间切换 */
export function CameraModeChip() {
  const cameraMode = useWorldStore((state) => state.cameraMode);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedCharacterId = useWorldStore((state) => state.selectedCharacterId);
  const setCameraMode = useWorldStore((state) => state.setCameraMode);

  if (cameraMode === 'overview') {
    return (
      <button type="button" className="cam-chip" onClick={() => setCameraMode('follow')}>
        📷 全图概览 · 点击跟随
      </button>
    );
  }
  const selected = snapshot?.characters.find((character) => character.id === selectedCharacterId);
  return (
    <button type="button" className="cam-chip" onClick={() => setCameraMode('overview')}>
      📷 相机跟随 · {selected?.name ?? '—'}
    </button>
  );
}
