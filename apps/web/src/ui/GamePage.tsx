import { useEffect, useRef, useState } from 'react';
import { WORLD_TIME_SCALES } from '@sims/shared';
import { connectWorld } from '../net/socket';
import { updateWorldSettings } from '../net/worldApi';
import { useWorldStore } from '../store/worldStore';
import { WorldCanvas } from '../game/WorldCanvas';
import { WorldSettingsModal } from './WorldSettingsModal';
import { Toasts } from './Toasts';
import { CharacterHud } from './hud/CharacterHud';
import { ActionBar } from './hud/ActionBar';
import { LogDrawer } from './hud/LogDrawer';
import { useGoAndDo } from './side-panel/useGoAndDo';
import './game-page.css';
import './world-settings.css';

const STATUS_LABEL: Record<string, string> = {
  connecting: '连接中…',
  connected: '',
  disconnected: '已断开,自动重连中',
};

/**
 * 游戏主界面(UI-1): 全屏像素画布打底,HUD 悬浮——左上角色面板(‹›切换)、
 * 顶中时钟/倍率、右上日志与设置、底部快捷动作条。
 * 意图经 useGoAndDo 下发(与侧面板同一动作层);画布仅点选角色/缩放,无地图操控。
 */
export default function GamePage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedCharacterId = useWorldStore((state) => state.selectedCharacterId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  // 弹窗打开前世界在运行则自动暂停,关闭时恢复(若期间被他人恢复则不双写)
  const resumeOnCloseRef = useRef(false);

  const character =
    snapshot?.characters.find((item) => item.id === selectedCharacterId) ?? null;
  const { run, startActivity, startWorkTask, startSleep, pending } = useGoAndDo(
    character,
    snapshot,
    selectedCharacterId,
  );

  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, []);

  const openSettings = async (): Promise<void> => {
    if (settingsOpen) return;
    setSettingsOpen(true);
    const current = useWorldStore.getState().snapshot;
    if (current !== null && !current.paused) {
      try {
        await updateWorldSettings({ paused: true });
        resumeOnCloseRef.current = true;
        setControlError(null);
      } catch (error) {
        setControlError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const closeSettings = async (): Promise<void> => {
    setSettingsOpen(false);
    if (!resumeOnCloseRef.current) return;
    resumeOnCloseRef.current = false;
    const current = useWorldStore.getState().snapshot;
    if (current !== null && current.paused) {
      try {
        await updateWorldSettings({ paused: false });
        setControlError(null);
      } catch (error) {
        setControlError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  // ESC 开关设置弹窗
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      void (settingsOpen ? closeSettings() : openSettings());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const togglePause = async (): Promise<void> => {
    const current = useWorldStore.getState().snapshot;
    if (current === null) return;
    try {
      await updateWorldSettings({ paused: !current.paused });
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  const changeScale = async (scale: number): Promise<void> => {
    try {
      await updateWorldSettings({ timeScale: scale });
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="game-page">
      <WorldCanvas interactive={false} />

      <CharacterHud />

      <div className="px-box hud-clock">
        <div className="px-inner hud-clock-inner">
          <button
            type="button"
            className="px-btn sq"
            disabled={snapshot === null}
            title={snapshot?.paused ? '继续' : '暂停'}
            onClick={() => void togglePause()}
          >
            {snapshot?.paused ? '▶' : '⏸'}
          </button>
          {snapshot !== null ? (
            <div className="hud-clock-date">
              <small>DAY {snapshot.clock.day}</small>
              <b className="px-num">{snapshot.clock.time}</b>
            </div>
          ) : (
            <div className="hud-clock-date">
              <small>WAIT</small>
              <b className="px-num">--:--</b>
            </div>
          )}
          {WORLD_TIME_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={`px-btn${snapshot?.timeScale === scale ? ' on' : ''}`}
              disabled={snapshot === null}
              onClick={() => void changeScale(scale)}
            >
              {scale}x
            </button>
          ))}
        </div>
      </div>
      {controlError !== null && <p className="hud-error">{controlError}</p>}

      <div className="hud-topright">
        <span className={`hud-net ${status}`} title={STATUS_LABEL[status] ?? status} />
        <LogDrawer />
        <button
          type="button"
          className="px-btn big"
          title="世界设置(ESC)"
          onClick={() => void openSettings()}
        >
          ⚙
        </button>
      </div>

      <ActionBar
        character={character}
        snapshot={snapshot}
        pending={pending}
        run={run}
        startActivity={startActivity}
        startSleep={startSleep}
        startWorkTask={startWorkTask}
      />

      {settingsOpen && <WorldSettingsModal onClose={() => void closeSettings()} />}

      <Toasts />
    </main>
  );
}
