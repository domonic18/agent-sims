import { formatCoins } from '../../format';
import { useWorldStore } from '../../store/worldStore';
import type { CharacterView } from '../side-panel/place';
import { PixelAvatar } from './PixelAvatar';
import { activityChip } from './activityChip';

function VitalBar({ label, value, tone }: { label: string; value: number; tone: 'green' | 'gold' }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="hud-vital">
      <span>{label}</span>
      <span className={`px-bar${tone === 'gold' ? ' gold' : ''}`}>
        <i style={{ width: `calc(${clamped}% - 4px)` }} />
        <u />
      </span>
      <b>{Math.round(value)}</b>
    </div>
  );
}

/** 左上角色面板(UI-1): ‹›切换角色,选中谁显示谁;体力/幸福/资源/徽标/行动/住房 */
export function CharacterHud() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedCharacterId = useWorldStore((state) => state.selectedCharacterId);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);

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
          </div>
          <button type="button" className="px-btn sq" title="下一位居民" onClick={() => cycle(1)}>
            ›
          </button>
        </div>

        <div className="hud-char-bars">
          <VitalBar label="体力" value={character.energy} tone="green" />
          <VitalBar label="幸福" value={character.happiness} tone="gold" />
        </div>

        <div className="hud-char-stats">
          <div className="hud-stat">
            <span>金币</span>
            <b className="px-num gold">{formatCoins(character.coins)}</b>
          </div>
          <div className="hud-stat">
            <span>繁荣</span>
            <b className="px-num cyan">{character.lifeScore}</b>
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
      </div>
    </aside>
  );
}
