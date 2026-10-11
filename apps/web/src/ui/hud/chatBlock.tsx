import type { WorldEvent } from '@sims/shared';
import { PixelAvatar } from './PixelAvatar';

type ChatEvent = Extract<WorldEvent, { type: 'social.chat' }>;

/**
 * 对话块(社交聊天专用渲染,不走 renderRow 时间线):
 * 头部=双头像+名A↔名B+好感Δ徽标+时刻;台词按 lines 奇偶左右分侧气泡
 * (发起者恒左、受话者恒右,偶索引=发起者);无 lines 渲单泡(content)。
 * 点名字定位发起者,点气泡定位说话方。
 */
export function ChatBlock({
  event,
  nameOf,
  timeText,
  onLocate,
}: {
  event: ChatEvent;
  nameOf: (id: string) => string;
  timeText: string;
  onLocate: (id: string) => void;
}): JSX.Element {
  const delta = event.affinityDelta;
  const lines = event.lines ?? [event.content];
  return (
    <div className="chat-block">
      <div className="chat-head">
        <span
          className="chat-head-names"
          title={`点击定位 ${nameOf(event.fromId)}`}
          onClick={() => onLocate(event.fromId)}
        >
          <PixelAvatar characterId={event.fromId} size={20} />
          <i>
            {nameOf(event.fromId)} ↔ {nameOf(event.toId)}
          </i>
        </span>
        {delta !== 0 && (
          <span className={`chat-delta${delta > 0 ? ' up' : ' down'}`}>
            好感{delta > 0 ? '+' : ''}
            {delta}
          </span>
        )}
        <span className="chat-time">{timeText}</span>
      </div>
      {lines.map((line, index) => {
        const fromSide = index % 2 === 0;
        const speakerId = fromSide ? event.fromId : event.toId;
        return (
          <div key={index} className={`bubble-row ${fromSide ? 'left' : 'right'}`}>
            <PixelAvatar characterId={speakerId} size={28} />
            <span className="bubble" title={`点击定位 ${nameOf(speakerId)}`} onClick={() => onLocate(speakerId)}>
              {line}
            </span>
          </div>
        );
      })}
    </div>
  );
}
