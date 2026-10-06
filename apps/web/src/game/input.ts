import Phaser from 'phaser';
import type { TileMapDefinition } from '@sims/shared';
import { sendIntent } from '../net/socket';
import { pushToast } from '../store/toastStore';
import { useWorldStore } from '../store/worldStore';
import { TILE } from './assets';
import type { CharacterRender } from './character-view';
import { inRect } from './terrain';
import { createIsWalkable } from './walkability';

/** WASD 连续行进(M3.6g 验收反馈①): 按住时前瞻整段下发,路径余量 ≤ 该值即提前续路 */
const WASD_EXTEND_TILES = 3;
/** WASD 单次下发的前瞻格数(松手由 stop_move 急停,前瞻只影响连续手感) */
const WASD_LOOKAHEAD_TILES = 6;
/** 单击保护窗(ms): 起步后该时间内即使按住也不续路,保证单击恰好 1 格(快照余量滞后,不能依赖 pathRemaining 判定) */
const KEY_TAP_GUARD_MS = 250;
/** 按住续路时两次下发的最小间隔(ms);起步/转向不受此限 */
const KEY_STEP_MIN_INTERVAL_MS = 100;
/** 长按朝不可行走方向时,拒绝 toast 的最小重复间隔(ms) */
const KEY_BLOCKED_TOAST_INTERVAL_MS = 1200;

/**
 * 地图点击三分支(M3.6a): 点角色=选中;点建筑=侧栏定位联动;
 * 其余空地=下发 move_to 由服务端裁决(不可行走/不可达拒绝信息经 toast 展示)。
 */
export function handleMapClick(
  scene: Phaser.Scene,
  pointer: Phaser.Input.Pointer,
  views: Map<string, CharacterRender>,
  interactive: boolean,
  map: TileMapDefinition,
): void {
  const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
  const tx = Math.floor(world.x / TILE);
  const ty = Math.floor(world.y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return;

  for (const [id, view] of views) {
    const hit =
      Math.abs(world.x - view.node.x) <= 10 &&
      world.y >= view.node.y - 28 &&
      world.y <= view.node.y + 8;
    if (hit) {
      useWorldStore.getState().selectCharacter(id);
      return;
    }
  }

  // 纯观看页(主页面): 点选角色跟随即可,不下发移动/定位
  if (!interactive) return;

  // 点维护点(M-G.5): 命中损耗点即让选中角色接对应工单(杂物→清洁/破损→修理)
  const spot = useWorldStore.getState().snapshot?.maintenance.find(
    (item) => item.x === tx && item.y === ty,
  );
  if (spot !== undefined) {
    const { selectedCharacterId } = useWorldStore.getState();
    if (selectedCharacterId === null) {
      pushToast(false, '先点击角色选中,再接维护工单');
      return;
    }
    void sendIntent({ type: 'work_task', characterId: selectedCharacterId, targetId: spot.id }).then(
      (ack) => pushToast(ack.ok, ack.message),
    );
    return;
  }

  const place = map.places.find((p) => p.door !== undefined && inRect(tx, ty, p));
  if (place !== undefined) {
    useWorldStore.getState().focusPlace(place.id);
    pushToast(true, `已定位「${place.name}」`);
    return;
  }

  useWorldStore.getState().focusPlace(null);
  const { selectedCharacterId } = useWorldStore.getState();
  if (selectedCharacterId === null) {
    pushToast(false, '先点击角色选中,再下达移动指令');
    return;
  }
  void sendIntent({ type: 'move_to', characterId: selectedCharacterId, x: tx, y: ty }).then(
    (ack) => pushToast(ack.ok, ack.message),
  );
}

/**
 * 方向键/WASD 移动控制器(tap-vs-hold 语义)——单击/起步仅下发 1 格;
 * 持住时先经单击保护窗(KEY_TAP_GUARD_MS,快照余量滞后,不能依赖 pathRemaining
 * 区分点按与长按),之后余量 ≤ WASD_EXTEND_TILES 即前瞻整段续路,连贯行进;
 * 持住转向立即前瞻。松手仅当发过前瞻段才 stop_move 急停(单击步不回收)。
 * 撞墙时向不可行走格下发以获得服务端拒绝提示(toast 节流);焦点在表单控件时忽略。
 */
export class KeyboardController {
  private readonly _keys: Record<string, Phaser.Input.Keyboard.Key> | null;
  private _lastStepAt = 0;
  private _lastBlockedToastAt = 0;
  /** WASD 当前按住方向(松手置 null,用于转向判定与急停) */
  private _dir: { dx: number; dy: number } | null = null;
  /** WASD 作用中的角色 id(切角色重置方向状态) */
  private _characterId: string | null = null;
  /** 本次按下起始时刻(单击保护窗用) */
  private _pressedAt = 0;
  /** 持住续路是否发过前瞻段(松手急停仅据此判定,快照余量滞后不可依赖) */
  private _hasHoldPath = false;
  private readonly _isWalkable: (x: number, y: number) => boolean;

  constructor(scene: Phaser.Scene, map: TileMapDefinition) {
    const keyboard = scene.input.keyboard;
    this._keys =
      keyboard !== null
        ? (keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D') as Record<
            string,
            Phaser.Input.Keyboard.Key
          >)
        : null;
    this._isWalkable = createIsWalkable(map);
  }

  step(time: number): void {
    const keys = this._keys;
    if (keys === null) return;
    const active = document.activeElement;
    if (active !== null && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
    const dir =
      keys.UP?.isDown || keys.W?.isDown ? { dx: 0, dy: -1 }
      : keys.DOWN?.isDown || keys.S?.isDown ? { dx: 0, dy: 1 }
      : keys.LEFT?.isDown || keys.A?.isDown ? { dx: -1, dy: 0 }
      : keys.RIGHT?.isDown || keys.D?.isDown ? { dx: 1, dy: 0 }
      : null;
    const { snapshot, selectedCharacterId } = useWorldStore.getState();
    if (snapshot === null || selectedCharacterId === null) return;
    const character = snapshot.characters.find((c) => c.id === selectedCharacterId);
    if (character === undefined) return;
    if (this._characterId !== character.id) {
      this._characterId = character.id;
      this._dir = null;
    }

    if (dir === null) {
      const wasHolding = this._dir !== null;
      this._dir = null;
      // 仅持住续路过(发过前瞻段)才急停;单击只发 1 格,不 stop_move 免清掉该步
      if (wasHolding && this._hasHoldPath) {
        this._hasHoldPath = false;
        void sendIntent({ type: 'stop_move', characterId: character.id });
      }
      return;
    }
    if (snapshot.paused) return;
    const prev = this._dir;
    const fresh = prev === null;
    const turned = fresh || prev.dx !== dir.dx || prev.dy !== dir.dy;
    if (turned) {
      this._lastStepAt = time;
      this._pressedAt = time;
      this._hasHoldPath = false;
      this._dir = dir;
      if (fresh) {
        // 单击/起步: 只下发 1 格(按住才有连续步),不可行走也照发换服务端拒绝提示
        void sendIntent({
          type: 'move_to',
          characterId: character.id,
          x: character.x + dir.dx,
          y: character.y + dir.dy,
        }).then((ack) => {
          if (!ack.ok && time - this._lastBlockedToastAt > KEY_BLOCKED_TOAST_INTERVAL_MS) {
            this._lastBlockedToastAt = time;
            pushToast(false, ack.message);
          }
        });
        return;
      }
      // 持住转向: 立即前瞻整段(落入下方前瞻逻辑),转向即时响应
    } else {
      // 持住同向续路: 单击保护窗内不续路,余量充足不重发,余量 ≤ 阈值时前瞻补足
      if (time - this._pressedAt < KEY_TAP_GUARD_MS) return;
      if (time - this._lastStepAt < KEY_STEP_MIN_INTERVAL_MS) return;
      if (character.pathRemaining > WASD_EXTEND_TILES) return;
    }

    let tx = character.x;
    let ty = character.y;
    for (let i = 0; i < WASD_LOOKAHEAD_TILES; i += 1) {
      if (!this._isWalkable(tx + dir.dx, ty + dir.dy)) break;
      tx += dir.dx;
      ty += dir.dy;
    }
    // 紧邻即墙: 向不可行走格下发换取服务端拒绝文案(反馈撞墙)
    const blockedAhead = tx === character.x && ty === character.y;
    this._lastStepAt = time;
    this._dir = dir;
    this._hasHoldPath = true;
    void sendIntent({
      type: 'move_to',
      characterId: character.id,
      x: blockedAhead ? character.x + dir.dx : tx,
      y: blockedAhead ? character.y + dir.dy : ty,
    }).then((ack) => {
      if (!ack.ok && time - this._lastBlockedToastAt > KEY_BLOCKED_TOAST_INTERVAL_MS) {
        this._lastBlockedToastAt = time;
        pushToast(false, ack.message);
      }
    });
  }
}
