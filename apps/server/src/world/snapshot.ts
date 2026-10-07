import type { WorldSnapshotMessage } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { Simulation } from './simulation.js';

/** 状态快照:调试端点与同步层共用的对外形态(协议面在 @sims/shared) */
export function worldSnapshot(sim: Simulation): WorldSnapshotMessage {
  const round = (value: number): number => {
    const f = 10 ** BALANCE.SNAPSHOT_DECIMALS;
    return Math.round(value * f) / f;
  };
  return {
    tick: sim.tick,
    paused: sim.paused,
    timeScale: sim.timeScale,
    gameType: sim.gameType,
    clock: {
      gameMinutes: sim.clock.gameMinutes,
      day: sim.clock.day,
      time: sim.clock.formatTime(),
      isNight: sim.clock.isNight,
    },
    characters: [...sim.characters.values()].map((character) => ({
      id: character.id,
      name: character.name,
      x: character.x,
      y: character.y,
      pathRemaining: character.path.length,
      energy: round(character.energy),
      health: round(character.health),
      coins: character.coins,
      alive: character.alive,
      collapsed: character.collapsed,
      diedAtGameMinutes: character.diedAtGameMinutes,
      backpack: { ...character.backpack },
      fridge: { ...character.fridge },
      score: round(character.score),
      knowledge: character.knowledge,
      sleepWindowMinutes: character.sleepWindowMinutes,
      sleepDebt:
        character.sleepDebtEndGameMinutes !== null &&
        sim.clock.gameMinutes < character.sleepDebtEndGameMinutes,
      traits: { ...character.traits },
      activity: character.activity
        ? {
            activityId: character.activity.activityId,
            elapsedMinutes: character.activity.elapsed,
            anchorKind: character.activity.anchorKind,
          }
        : null,
      housing: character.housing
        ? {
            propertyId: character.housing.propertyId,
            ownership: character.housing.ownership,
            paidThroughDay: character.housing.paidThroughDay,
          }
        : null,
    })),
    socials: [...sim.socials.values()].map((relation) => ({
      fromId: relation.fromId,
      toId: relation.toId,
      familiarity: round(relation.familiarity),
      affinity: round(relation.affinity),
    })),
    maintenance: [...sim.maintenanceSpots.values()].map((spot) => ({ ...spot })),
    resources: [...sim.resourceNodes.values()].map((node) => ({ ...node })),
  };
}
