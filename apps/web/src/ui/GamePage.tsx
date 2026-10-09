import { useEffect, useRef, useState } from 'react';
import { WORLD_TIME_SCALES, type UiMetaView } from '@sims/shared';
import { connectWorld } from '../net/socket';
import { getUiMeta, updateWorldSettings } from '../net/worldApi';
import { useAuthStore } from '../store/authStore';
import { useWorldStore } from '../store/worldStore';
import { WorldCanvas } from '../game/WorldCanvas';
import { WorldSettingsModal } from './WorldSettingsModal';
import { Toasts } from './Toasts';
import { LoginModal } from './LoginModal';
import { CharacterHud } from './hud/CharacterHud';
import { HostingModal } from './hud/HostingModal';
import { MindTalkModal } from './hud/MindTalkModal';
import { MemoryModal } from './hud/MemoryModal';
import { ActionBar } from './hud/ActionBar';
import { InspectCard } from './hud/InspectCard';
import { LogDrawer } from './hud/LogDrawer';
import { BootScreen } from './BootScreen';
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
 * 游览/操控分层(游客可浏览公布):游客=看状态/日志/点选跟随,操作控件全隐藏,
 * 画布 spectator(点选角色不下发移动);管理员登录后解锁 WASD/地图移动/动作条/
 * 时钟控制/设置。意图通道服务端同源校验,前端隐藏非唯一防线。
 */
export default function GamePage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const viewers = useWorldStore((state) => state.viewers);
  const bootPhase = useWorldStore((state) => state.bootPhase);
  const textureProgress = useWorldStore((state) => state.textureProgress);
  const selectedCharacterId = useWorldStore((state) => state.selectedCharacterId);
  const token = useAuthStore((state) => state.token);
  const username = useAuthStore((state) => state.username);
  const logout = useAuthStore((state) => state.logout);
  const isAdmin = token !== null;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [hostingOpenId, setHostingOpenId] = useState<string | null>(null);
  const [mindTalkOpenId, setMindTalkOpenId] = useState<string | null>(null);
  const [memoryOpenId, setMemoryOpenId] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  // 模型徽标(公开读,后台开关裁定显隐):加载失败静默,不影响游戏
  const [uiMeta, setUiMeta] = useState<UiMetaView | null>(null);
  // 弹窗打开前世界在运行则自动暂停,关闭时恢复(若期间被他人恢复则不双写)
  const resumeOnCloseRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getUiMeta()
      .then((meta) => {
        if (!cancelled) setUiMeta(meta);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const character =
    snapshot?.characters.find((item) => item.id === selectedCharacterId) ?? null;
  const { run, startActivity, startWorkTask, startSleep, pending } = useGoAndDo(
    character,
    snapshot,
    selectedCharacterId,
  );

  // token 变化(登录/退出)重连 socket,角色随登录态升级/降级
  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, [token]);

  const openSettings = async (): Promise<void> => {
    if (settingsOpen || !isAdmin) return;
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

  // ESC 开关设置弹窗(游客无设置入口,ESC 无效)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isAdmin) return;
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

  // 加载罩(L1):素材/纹理阶段或场景已就绪但首帧快照未到时全屏覆盖;素材错误露出错误文案
  const showBoot = bootPhase !== 'error' && (bootPhase !== 'scene-ready' || snapshot === null);
  const bootText =
    bootPhase === 'world-data'
      ? '正在加载世界数据…'
      : bootPhase === 'textures'
        ? '正在绘制像素素材 '
        : '正在进入小镇…';

  return (
    <main className="game-page">
      <WorldCanvas interactive={isAdmin} />

      {showBoot && (
        <BootScreen
          text={bootText}
          {...(bootPhase === 'textures' ? { progress: textureProgress } : {})}
        />
      )}

      <CharacterHud
        onHosting={(id) => {
          if (!isAdmin) {
            setLoginOpen(true);
            return;
          }
          setMindTalkOpenId(null);
          setMemoryOpenId(null);
          setHostingOpenId(id);
        }}
        onMindTalk={(id) => {
          if (!isAdmin) {
            setLoginOpen(true);
            return;
          }
          setHostingOpenId(null);
          setMemoryOpenId(null);
          setMindTalkOpenId(id);
        }}
        onMemories={(id) => {
          setHostingOpenId(null);
          setMindTalkOpenId(null);
          setMemoryOpenId(id);
        }}
      />

      {isAdmin && (
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
                <small>
                  第 {snapshot.clock.day} 天 {snapshot.clock.isNight ? '🌙' : '☀️'}
                </small>
                <b className="px-num">{snapshot.clock.time}</b>
              </div>
            ) : (
              <div className="hud-clock-date">
                <small>等待世界</small>
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
      )}
      {isAdmin && controlError !== null && <p className="hud-error">{controlError}</p>}

      <div className="hud-topright">
        <span className={`hud-net ${status}`} title={STATUS_LABEL[status] ?? status} />
        <span className="hud-viewers" title="当前在线查看人数(含本页)">
          👁 {viewers}
        </span>
        <LogDrawer />
        {isAdmin ? (
          <>
            <span className="hud-user" title="已登录管理员">
              👤 {username ?? 'admin'}
            </span>
            <button
              type="button"
              className="px-btn big"
              title="退出登录(回到游客浏览)"
              onClick={() => {
                logout();
                setSettingsOpen(false);
              }}
            >
              ⎋
            </button>
            <button
              type="button"
              className="px-btn big"
              title="世界设置(ESC)"
              onClick={() => void openSettings()}
            >
              ⚙
            </button>
          </>
        ) : (
          <button
            type="button"
            className="px-btn big"
            title="管理员登录(解锁居民操控)"
            onClick={() => setLoginOpen(true)}
          >
            🔑
          </button>
        )}
      </div>

      {isAdmin && (
        <ActionBar
          character={character}
          snapshot={snapshot}
          pending={pending}
          run={run}
          startActivity={startActivity}
          startSleep={startSleep}
          startWorkTask={startWorkTask}
        />
      )}

      {isAdmin && settingsOpen && <WorldSettingsModal onClose={() => void closeSettings()} />}
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      {hostingOpenId !== null && (
        <HostingModal
          characterId={hostingOpenId}
          characterName={snapshot?.characters.find((item) => item.id === hostingOpenId)?.name ?? '居民'}
          onClose={() => setHostingOpenId(null)}
        />
      )}
      {mindTalkOpenId !== null && (
        <MindTalkModal
          characterId={mindTalkOpenId}
          characterName={snapshot?.characters.find((item) => item.id === mindTalkOpenId)?.name ?? '居民'}
          onClose={() => setMindTalkOpenId(null)}
        />
      )}
      {memoryOpenId !== null && (
        <MemoryModal
          characterId={memoryOpenId}
          characterName={snapshot?.characters.find((item) => item.id === memoryOpenId)?.name ?? '居民'}
          onClose={() => setMemoryOpenId(null)}
        />
      )}

      <InspectCard
        isAdmin={isAdmin}
        character={character}
        onActivity={(def) => void startActivity(def)}
        onSleep={() => void startSleep()}
        onWorkTask={(targetId) => {
          if (character !== null) {
            void run({ type: 'work_task', characterId: character.id, targetId });
          }
        }}
        onMove={(x, y) => {
          if (character !== null) {
            void run({ type: 'move_to', characterId: character.id, x, y });
          }
        }}
      />

      {uiMeta?.showModels === true &&
        (uiMeta.slowModel !== null || uiMeta.jevModel !== null) && (
          <div className="hud-model-badge">
            {uiMeta.slowModel !== null && <span>LLM {uiMeta.slowModel}</span>}
            {uiMeta.jevModel !== null && <span>SystemOne {uiMeta.jevModel}</span>}
          </div>
        )}

      <Toasts />
    </main>
  );
}
