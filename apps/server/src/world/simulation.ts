import type {
  CharacterArrivedEvent,
  WorldControlEvent,
  WorldEvent,
  WorldSnapshotMessage,
} from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { GameClock } from './clock.js';
import { applyVitalDecay, stepMovement, type WorldCharacter } from './character.js';
import { EventBus } from './event-bus.js';
import { TileMap } from './map.js';
import { TOWN_MAP } from './map-data.js';
import { findPath } from './pathfinding.js';

/**
 * 世界模拟核心:固定 tick(1 tick = 1 游戏分钟),纯逻辑零 I/O。
 * 推进来源有二:实时驱动器(TickDriver,暂停时冻结)与手动推进
 * (调试端点/headless,不受暂停限制)。
 */
export class Simulation {
  readonly clock = new GameClock();
  readonly map: TileMap = TileMap.fromDefinition(TOWN_MAP);
  readonly characters = new Map<string, WorldCharacter>();
  /** 世界事件总线:离散事件与控制变更即时分发,感知/同步层订阅 */
  readonly events = new EventBus<WorldEvent>();
  tick = 0;
  paused = false;
  timeScale: number = BALANCE.DEFAULT_TIME_SCALE;

  advanceTicks(n: number): void {
    for (let i = 0; i < n; i += 1) {
      this.tick += 1;
      this.clock.advance(1);
      this._stepCharacters();
    }
  }

  spawnCharacter(id: string, x: number, y: number, name = id): WorldCharacter {
    if (this.characters.has(id)) {
      throw new Error(`角色已存在: ${id}`);
    }
    if (!this.map.isWalkable(x, y)) {
      throw new Error(`出生点不可行走: (${x},${y})`);
    }
    const character: WorldCharacter = {
      id,
      name,
      x,
      y,
      path: [],
      energy: BALANCE.START_ENERGY,
      happiness: BALANCE.START_HAPPINESS,
      coins: 0,
    };
    this.characters.set(id, character);
    return character;
  }

  character(id: string): WorldCharacter {
    const character = this.characters.get(id);
    if (!character) {
      throw new Error(`角色不存在: ${id}`);
    }
    return character;
  }

  /** 重新规划到目标的路径(意图指令层校验后调用) */
  requestMoveTo(characterId: string, x: number, y: number): WorldCharacter {
    const character = this.character(characterId);
    if (!this.map.isWalkable(x, y)) {
      throw new Error(`目标不可行走: (${x},${y})`);
    }
    const path = findPath(this.map, { x: character.x, y: character.y }, { x, y });
    if (path === null) {
      throw new Error(`不可达: (${character.x},${character.y}) → (${x},${y})`);
    }
    character.path = path;
    return character;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this._emitControl();
  }

  setTimeScale(scale: number): void {
    if (!(BALANCE.TIME_SCALES as readonly number[]).includes(scale)) {
      throw new RangeError(`非法时间倍率: ${scale}(可用档位: ${BALANCE.TIME_SCALES.join('/')})`);
    }
    this.timeScale = scale;
    this._emitControl();
  }

  /** 状态快照:调试端点与同步层共用的对外形态(协议面在 @sims/shared) */
  snapshot(): WorldSnapshotMessage {
    return {
      tick: this.tick,
      paused: this.paused,
      timeScale: this.timeScale,
      clock: {
        gameMinutes: this.clock.gameMinutes,
        day: this.clock.day,
        time: this.clock.formatTime(),
        isNight: this.clock.isNight,
      },
      characters: [...this.characters.values()].map((character) => ({
        id: character.id,
        name: character.name,
        x: character.x,
        y: character.y,
        pathRemaining: character.path.length,
        energy: Math.round(character.energy * 10) / 10,
        happiness: Math.round(character.happiness * 10) / 10,
        coins: character.coins,
      })),
    };
  }

  private _emitControl(): void {
    const event: WorldControlEvent = {
      type: 'world.control',
      tick: this.tick,
      paused: this.paused,
      timeScale: this.timeScale,
    };
    this.events.emit(event);
  }

  private _stepCharacters(): void {
    for (const character of this.characters.values()) {
      applyVitalDecay(character, 1);
      const arrived = stepMovement(character, BALANCE.WALK_SPEED_TILES_PER_MINUTE);
      if (arrived) {
        const event: CharacterArrivedEvent = {
          type: 'character.arrived',
          characterId: character.id,
          tick: this.tick,
          x: character.x,
          y: character.y,
        };
        this.events.emit(event);
      }
    }
  }
}
