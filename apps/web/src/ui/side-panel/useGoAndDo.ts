import { useEffect, useRef, useState } from 'react';
import {
  TOWN_MAP,
  findActivityAnchorAt,
  getActivityDefinition,
  type ActivityDefinition,
  type Intent,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { sendIntent } from '../../net/socket';
import { pushToast } from '../../store/toastStore';
import { activityAnchors, findPlaceAt, type CharacterView } from './place';

export type RunIntent = (intent: Intent) => Promise<void>;

export interface GoAndDoPending {
  /** go-and-do 待办: 到达目标后自动接续(activity=开始活动 / buy=店内购入) */
  kind: 'activity' | 'buy';
  id: string;
}

/**
 * 面板动作层: run(通用意图下发+反馈)、go-and-do 合成(startActivity/buyItem
 * 未在位时先 move_to,到达后随 tick 快照自动接续)与 feedback 状态。
 * 协议仍是两步显式语义,此处仅为客户端 UI 合成(move_to → start_activity/buy_item)。
 */
export function useGoAndDo(
  character: CharacterView | null,
  snapshot: WorldSnapshotMessage | null,
  selectedId: string | null,
): {
  feedback: { ok: boolean; message: string } | null;
  run: RunIntent;
  startActivity: (def: ActivityDefinition) => Promise<void>;
  buyItem: (itemId: string) => Promise<void>;
  pending: GoAndDoPending | null;
} {
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState<GoAndDoPending | null>(null);
  const pendingArrivalRef = useRef(false);

  const run: RunIntent = async (intent) => {
    const ack = await sendIntent(intent);
    setFeedback(ack);
    pushToast(ack.ok, ack.message);
  };

  /** 开始活动:已在锚点位(使用格或紧邻家具占地;无锚点活动已在场所)直接开始;否则先前往最近锚点使用格/场所入口 */
  const startActivity = async (def: ActivityDefinition): Promise<void> => {
    if (character === null || snapshot === null) return;
    const anchors = activityAnchors(def.id);
    const atPlace = findPlaceAt(snapshot, character.x, character.y);
    const arrived =
      anchors.length > 0
        ? findActivityAnchorAt(def.id, character.x, character.y) !== null
        : def.placeIds.includes(atPlace?.id ?? '');
    if (arrived) {
      await run({ type: 'start_activity', characterId: character.id, activityId: def.id });
      return;
    }
    // 未在位:锚点活动去最近使用格,无锚点活动(散步)去首选场所入口
    const nearest =
      anchors.length > 0
        ? anchors.reduce((best, a) =>
            Math.abs(a.x - character.x) + Math.abs(a.y - character.y) <
            Math.abs(best.x - character.x) + Math.abs(best.y - character.y)
              ? a
              : best,
          )
        : null;
    const target =
      nearest !== null
        ? { x: nearest.x, y: nearest.y }
        : (() => {
            const place = TOWN_MAP.places.find((p) => p.id === def.placeIds[0]);
            return place !== undefined ? { x: place.entrance.x, y: place.entrance.y } : null;
          })();
    if (target === null) return;
    const ack = await sendIntent({
      type: 'move_to',
      characterId: character.id,
      x: target.x,
      y: target.y,
    });
    setFeedback(ack);
    pushToast(ack.ok, ack.message);
    pendingArrivalRef.current = false;
    setPending(ack.ok ? { kind: 'activity', id: def.id } : null);
  };

  /** 购物(M3.6f 店内购约束):已在商店直接购入;否则先前往商店入口,到达后自动接续 buy_item */
  const buyItem = async (itemId: string): Promise<void> => {
    if (character === null || snapshot === null) return;
    if (findPlaceAt(snapshot, character.x, character.y)?.id === 'shop') {
      await run({ type: 'buy_item', characterId: character.id, itemId });
      return;
    }
    const shop = TOWN_MAP.places.find((p) => p.id === 'shop');
    if (shop === undefined) return;
    const ack = await sendIntent({
      type: 'move_to',
      characterId: character.id,
      x: shop.entrance.x,
      y: shop.entrance.y,
    });
    setFeedback(ack);
    pushToast(ack.ok, ack.ok ? '前往商店,到达后自动购入' : ack.message);
    pendingArrivalRef.current = false;
    setPending(ack.ok ? { kind: 'buy', id: itemId } : null);
  };

  useEffect(() => {
    setPending(null);
  }, [selectedId]);

  // 前往途中随每 tick 快照检查:到达目标(锚点使用格/场所/商店)后自动接续;
  // 途中改道/被打断则放弃。pendingArrivalRef 标记"快照已反映行进",
  // 未见行进前不判弃(move_to 刚下发时快照尚未反映移动)。
  useEffect(() => {
    if (pending === null || character === null || snapshot === null) return;
    if (character.activity !== null) {
      pendingArrivalRef.current = false;
      setPending(null);
      return;
    }
    if (character.pathRemaining > 0) {
      pendingArrivalRef.current = true;
      return;
    }
    const finish = (): void => {
      pendingArrivalRef.current = false;
      setPending(null);
    };
    if (pending.kind === 'buy') {
      if (findPlaceAt(snapshot, character.x, character.y)?.id === 'shop') {
        finish();
        void run({ type: 'buy_item', characterId: character.id, itemId: pending.id });
        return;
      }
    } else {
      const def = getActivityDefinition(pending.id);
      if (def === null) {
        finish();
        return;
      }
      const anchors = activityAnchors(def.id);
      const arrived =
        anchors.length > 0
          ? findActivityAnchorAt(def.id, character.x, character.y) !== null
          : def.placeIds.includes(findPlaceAt(snapshot, character.x, character.y)?.id ?? '');
      if (arrived) {
        finish();
        void run({ type: 'start_activity', characterId: character.id, activityId: def.id });
        return;
      }
    }
    if (pendingArrivalRef.current) {
      finish();
    }
  }, [pending, character, snapshot]);

  return { feedback, run, startActivity, buyItem, pending };
}
