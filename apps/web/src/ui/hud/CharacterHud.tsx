import { useEffect, useState } from 'react';
import { formatCoins } from '../../format';
import { getHosting } from '../../net/hostingApi';
import { useAuthStore } from '../../store/authStore';
import { useWorldStore } from '../../store/worldStore';
import type { CharacterView } from '../side-panel/place';
import { PixelAvatar } from './PixelAvatar';
import { activityChip } from './activityChip';

function VitalBar({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: number;
  tone: 'green' | 'gold' | 'red';
  title?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="hud-vital" title={title}>
      <span>{label}</span>
      <span className={`px-bar${tone === 'gold' ? ' gold' : tone === 'red' ? ' red' : ''}`}>
        <i style={{ width: `calc(${clamped}% - 4px)` }} />
        <u />
      </span>
      <b>{Math.round(value)}</b>
    </div>
  );
}

/** 左上角色面板(UI-1): ‹›切换角色,选中谁显示谁;体力/健康/得分/徽标/行动/住房;可收起为头行免遮挡 */
export function CharacterHud({
  onHosting,
  onMindTalk,
  onMemories,
}: {
  onHosting?: (characterId: string) => void;
  onMindTalk?: (characterId: string) => void;
  onMemories?: (characterId: string) => void;
}) {
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedCharacterId = useWorldStore((state) => state.selectedCharacterId);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);
  const hostingMap = useWorldStore((state) => state.hostingMap);
  const applyHosting = useWorldStore((state) => state.applyHosting);
  const isAdmin = useAuthStore((state) => state.token !== null);
  const [collapsed, setCollapsed] = useState(false);

  // 选中即拉托管状态兜底(hosting_changed 事件只保在线期间,首帧/重连/他人已托管时徽标不丢)
  useEffect(() => {
    if (selectedCharacterId === null) return;
    let cancelled = false;
    getHosting(selectedCharacterId)
      .then((view) => {
        if (!cancelled) applyHosting(view.characterId, view.hosted, view.mode);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedCharacterId, applyHosting]);

  const characters = snapshot?.characters ?? [];
  const character: CharacterView | null =
    characters.find((item) => item.id === selectedCharacterId) ?? null;
  if (snapshot === null || character === null) return null;

  const cycle = (dir: 1 | -1): void => {
    if (characters.length === 0) return;
    const index = characters.findIndex((item) => item.id === character.id);
    const next = characters[(index + dir + characters.length) % characters.length];
    if (next !== undefined) selectCharacter(next.id);
  };

  const chip = activityChip(character);
  const housing = character.housing;
  const hostingMode = hostingMap[character.id] ?? null;

  return (
    <aside className="px-box hud-character">
      <div className="px-inner hud-character-inner">
        <div className="hud-char-head">
          <button type="button" className="px-btn sq" title="上一位居民" onClick={() => cycle(-1)}>
            ‹
          </button>
          <PixelAvatar characterId={character.id} />
          <div className="hud-char-who">
            <b>
              {character.name}
              {!character.alive && ' 👻'}
            </b>
            <span>居民 · {characters.length} 人在镇</span>
            {hostingMode !== null && (
              <span
                className="hud-tag bot"
                title={hostingMode === 'policy' ? '托管中·生活方针:玩家操作被拒收' : '托管中·全托管:玩家操作被拒收'}
              >
                🤖 托管{hostingMode === 'policy' ? '·方针' : '·全'}
              </span>
            )}
          </div>
          <button type="button" className="px-btn sq" title="下一位居民" onClick={() => cycle(1)}>
            ›
          </button>
          <button
            type="button"
            className="px-btn sq hud-char-collapse"
            title={collapsed ? '展开面板' : '收起面板(不遮挡画面)'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '▾' : '▴'}
          </button>
        </div>

        {collapsed ? null : (
          <>
        <div className="hud-char-bars">
          <VitalBar label="体力" value={character.energy} tone="green" />
          {snapshot.gameType === 'survival' && (
            <VitalBar
              label="健康"
              value={character.health}
              tone="red"
              title="生存模式:体力低于饥饿线持续损耗,吃饱(体力≥康复线)自然恢复;归零重伤休整"
            />
          )}
        </div>

        <div className="hud-char-stats">
          <div className="hud-stat">
            <span>金币</span>
            <b className="px-num gold">{formatCoins(character.coins)}</b>
          </div>
          <div className="hud-stat">
            <span>得分</span>
            <b className="px-num cyan">{character.score}</b>
          </div>
          <div className="hud-stat">
            <span>知识</span>
            <b className="px-num blue">{character.knowledge}</b>
          </div>
        </div>

        <div className="hud-char-tags">
          {character.sleepDebt && (
            <span className="hud-tag sad" title="昨夜睡眠不足:今日正收益 ×0.7">
              😪 缺觉 ×0.7
            </span>
          )}
          {chip !== null && (
            <span className="hud-tag doing">
              {chip.icon} {chip.label}
            </span>
          )}
          {character.alive && character.collapsed && (
            <span className="hud-tag sad" title="体力耗尽倒地: 只能就地休息/睡觉或喂食恢复">
              😵 虚脱
            </span>
          )}
          {!character.alive && (
            <span className="hud-tag sad" title="角色已倒下,等待救治或超时复活">
              👻 倒下
            </span>
          )}
        </div>

        <div className="hud-char-home">
          {housing !== null
            ? `🏠 ${housing.propertyId} · ${housing.ownership === 'rent' ? '租住' : '自有'}`
            : '🚫 无住房(资产页可租房)'}
        </div>

        <div className="hud-char-agent">
          {/* 操控类入口(托管/访谈)admin 专属;记忆只读对游客开放(直播观众了解角色内心) */}
          {isAdmin && (
            <>
              <button
                type="button"
                className="px-btn"
                title={hostingMode !== null ? '查看/修改托管状态或接管' : '把角色托管给 Agent 自主生活'}
                onClick={() => onHosting?.(character.id)}
              >
                🤖 {hostingMode !== null ? '托管中' : '托管'}
              </button>
              <button
                type="button"
                className="px-btn"
                title="和 TA 聊聊——TA 基于自己的记忆与经历第一人称回答"
                onClick={() => onMindTalk?.(character.id)}
              >
                🗣 意识访谈
              </button>
            </>
          )}
          <button
            type="button"
            className="px-btn"
            title="查看 TA 的记忆流(只读)"
            onClick={() => onMemories?.(character.id)}
          >
            🧠 记忆
          </button>
        </div>
          </>
        )}
      </div>
    </aside>
  );
}
