import { useEffect, useRef, useState } from 'react';
import {
  findActivityAnchorAt,
  getActivityDefinition,
  placeIdMatches,
  type ActivityDefinition,
  type Intent,
  type MaintenanceTaskId,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { sendIntent } from '../../net/socket';
import { pushToast } from '../../store/toastStore';
import { useWorldStore } from '../../store/worldStore';
import { activityAnchors, findPlaceAt, findPlaceByRef, type CharacterView } from './place';

export type RunIntent = (intent: Intent) => Promise<void>;

/**
 * 最近同岗工单目标(M-G.5):clean→杂物点/repair→围栏破损/救治→窗口内幽灵,
 * 按曼哈顿距离取最近;无候选返回 null(自动接单与按钮置灰共用)。
 */
export function nearestWorkTarget(
  task: MaintenanceTaskId,
  character: { x: number; y: number },
  snapshot: WorldSnapshotMessage,
): { targetId: string; distance: number } | null {
  const candidates =
    task === 'rescue'
      ? snapshot.characters
          .filter((c) => !c.alive && c.diedAtGameMinutes !== null)
          .map((c) => ({ targetId: c.id, x: c.x, y: c.y }))
      : snapshot.maintenance
          .filter((spot) => spot.kind === (task === 'clean' ? 'litter' : 'fence_damage'))
          .map((spot) => ({ targetId: spot.id, x: spot.x, y: spot.y }));
  let best: { targetId: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.x - character.x) + Math.abs(candidate.y - character.y);
    if (best === null || distance < best.distance) {
      best = { targetId: candidate.targetId, distance };
    }
  }
  return best;
}

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
  startWorkTask: (task: MaintenanceTaskId) => Promise<void>;
  pending: GoAndDoPending | null;
} {
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState<GoAndDoPending | null>(null);
  const pendingArrivalRef = useRef(false);
  const map = useWorldStore((state) => state.map);

  const run: RunIntent = async (intent) => {
    const ack = await sendIntent(intent);
    setFeedback(ack);
    pushToast(ack.ok, ack.message);
  };

  /** 开始活动:已在锚点位(使用格或紧邻家具占地;无锚点活动已在场所)直接开始;否则先前往最近锚点使用格/场所入口 */
  const startActivity = async (def: ActivityDefinition): Promise<void> => {
    if (character === null || snapshot === null || map === null) return;
    const anchors = activityAnchors(map, def.id);
    const atPlace = findPlaceAt(map, character.x, character.y);
    const arrived =
      anchors.length > 0
        ? findActivityAnchorAt(map, def.id, character.x, character.y) !== null
        : atPlace !== null && def.placeIds.some((id) => placeIdMatches(id, atPlace.id));
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
            const first = def.placeIds[0];
            if (first === undefined) return null;
            const place = findPlaceByRef(map, first);
            return place !== null ? { x: place.entrance.x, y: place.entrance.y } : null;
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
    if (character === null || snapshot === null || map === null) return;
    const at = findPlaceAt(map, character.x, character.y);
    if (at !== null && placeIdMatches('shop', at.id)) {
      await run({ type: 'buy_item', characterId: character.id, itemId });
      return;
    }
    const shop = findPlaceByRef(map, 'shop');
    if (shop === null) return;
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

  /** 接维护工单(M-G.5):单意图自带寻路,选最近同岗目标直接下发,无目标静默 */
  const startWorkTask = async (task: MaintenanceTaskId): Promise<void> => {
    if (character === null || snapshot === null) return;
    const target = nearestWorkTarget(task, character, snapshot);
    if (target === null) return;
    await run({ type: 'work_task', characterId: character.id, targetId: target.targetId });
  };

  useEffect(() => {
    setPending(null);
  }, [selectedId]);

  // 前往途中随每 tick 快照检查:到达目标(锚点使用格/场所/商店)后自动接续;
  // 途中改道/被打断则放弃。pendingArrivalRef 标记"快照已反映行进",
  // 未见行进前不判弃(move_to 刚下发时快照尚未反映移动)。
  useEffect(() => {
    if (pending === null || character === null || snapshot === null || map === null) return;
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
      const at = findPlaceAt(map, character.x, character.y);
      if (at !== null && placeIdMatches('shop', at.id)) {
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
      const anchors = activityAnchors(map, def.id);
      const atPlace = findPlaceAt(map, character.x, character.y);
      const arrived =
        anchors.length > 0
          ? findActivityAnchorAt(map, def.id, character.x, character.y) !== null
          : atPlace !== null && def.placeIds.some((id) => placeIdMatches(id, atPlace.id));
      if (arrived) {
        finish();
        void run({ type: 'start_activity', characterId: character.id, activityId: def.id });
        return;
      }
    }
    if (pendingArrivalRef.current) {
      finish();
    }
  }, [pending, character, snapshot, map]);

  return { feedback, run, startActivity, buyItem, startWorkTask, pending };
}
