import { useEffect, useRef, useState } from 'react';
import type { WorldSnapshotMessage } from '@sims/shared';
import { debugSpawn, probeDebugAvailable, reviveCharacter } from '../net/debugApi';

type CharacterView = WorldSnapshotMessage['characters'][number];

/** 居民管理 dev 面板(LabPage 左栏三):生产 /debug 未注册 → 404 → 整块隐藏;
 * 生成/复活失败经 onError 透出(时钟控制块统一显示) */
export function DevResidentsPanel({
  character,
  onError,
}: {
  character: CharacterView | null;
  onError: (message: string | null) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [spawnName, setSpawnName] = useState('');
  const spawnCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void probeDebugAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const revive = async (): Promise<void> => {
    if (character === null) return;
    try {
      await reviveCharacter(character.id);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const spawn = async (): Promise<void> => {
    spawnCountRef.current += 1;
    try {
      await debugSpawn({
        id: `guest-${Date.now() % 100000}`,
        name: spawnName.trim() !== '' ? spawnName.trim() : `访客${spawnCountRef.current}`,
        x: 30,
        y: 22,
      });
      setSpawnName('');
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!available) return null;
  return (
    <div className="px-box lab-panel-px">
      <div className="px-inner lab-panel-inner">
        <h3>居民管理(dev)</h3>
        <div className="lab-btn-row">
          <input
            className="lab-input"
            placeholder="新居民名字"
            value={spawnName}
            onChange={(e) => setSpawnName(e.target.value)}
          />
          <button type="button" className="px-btn" onClick={() => void spawn()}>
            ➕ 生成
          </button>
        </div>
        {character !== null && !character.alive && (
          <button type="button" className="px-btn" onClick={() => void revive()}>
            ✚ 复活 {character.name}
          </button>
        )}
      </div>
    </div>
  );
}
