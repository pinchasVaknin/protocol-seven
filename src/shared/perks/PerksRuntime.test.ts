import { describe, expect, it } from 'vitest';
import type { BotTeam, Combatant } from '../ai/Combatant';
import { PLAYER_ENTITY_ID } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { createGameBus, EV, type GameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import type { PlayerSim } from '../player/PlayerState';
import type { WeaponSystem } from '../weapons/WeaponSystem';
import { resolvePerkState } from './PerkState';
import { PerksRuntime, PICKUP_LIFETIME } from './PerksRuntime';

/**
 * The two perks with a world presence (A18).
 *
 * Both are *inert while unequipped and still subscribed*, which is the design — "the cost is one
 * branch per event either way" — so the first thing each block pins is that nothing happens
 * without the perk. The rest is the rule M9 left behind when the meshes went to the renderer:
 * whether a pickup exists, whether walking over it grants anything, and whether a footstep is
 * one Tracker reveals.
 *
 * The pickup that *cannot* be collected is the case worth having: a magazine you have no room
 * for is left where it is, so walking past a full reserve does not silently eat it.
 */

const BOT = 7;
const ENEMY = 8;

function body(entityId: number, team: BotTeam, px = 0, pz = 0) {
  return {
    entityId,
    displayName: `P${entityId}`,
    team,
    health: new Health(DEFAULT_HEALTH_CONFIG),
    rig: new HitboxRig(),
    px,
    py: 0,
    pz,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.65,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

/** A player position, which is all `simulate` reads of the sim. */
function at(x: number, y: number, z: number): PlayerSim {
  return { x, y, z } as unknown as PlayerSim;
}

interface RigOptions {
  /** What `addReserve` hands back. Zero models a reserve with no room in it. */
  readonly roundsAccepted?: number;
  readonly localTeam?: BotTeam;
}

function rig(roster: ReturnType<typeof body>[], options: RigOptions = {}) {
  const bus: GameBus = createGameBus();
  const asked: number[] = [];
  const weapons = {
    weapon: {
      definition: { magSize: 30 },
      addReserve: (rounds: number) => {
        asked.push(rounds);
        return options.roundsAccepted ?? rounds;
      },
    },
  } as unknown as WeaponSystem;

  const scavenged: { rounds: number; x: number }[] = [];
  bus.on(EV.PerkScavenged, (p) => scavenged.push({ rounds: p.rounds, x: p.x }));

  const runtime = new PerksRuntime({
    bus,
    roster: roster as unknown as Combatant[],
    weapons,
    localTeam: options.localTeam ?? 'A',
  });
  /** Kill `entityId` the way the match announces it. */
  const kill = (entityId: number): void => {
    bus.emit(EV.EntityKilled, {
      targetId: entityId,
      sourceId: PLAYER_ENTITY_ID,
      weaponId: 'ar_default',
      zone: 'torso',
      killerHealth: 200,
    });
  };
  const live = (): number => runtime.pickups.filter((p) => p.active).length;
  return { runtime, bus, kill, live, scavenged, asked };
}

const SCAVENGER = resolvePerkState(['scavenger']);
const TRACKER = resolvePerkState(['tracker']);
const NOTHING = resolvePerkState([]);

describe('the pickup pool', () => {
  it('is allocated once, inactive, and never grows', () => {
    const r = rig([body(BOT, 'B')]);
    expect(r.runtime.pickups).toHaveLength(16);
    expect(r.live()).toBe(0);
    r.runtime.setPerks(SCAVENGER);
    for (let i = 0; i < 40; i++) r.kill(BOT);
    // Slots are reused: a consumer reads `active`, never the length.
    expect(r.runtime.pickups).toHaveLength(16);
  });
});

describe('Scavenger, unequipped', () => {
  it('drops nothing, though the subscription is live', () => {
    const r = rig([body(BOT, 'B')]);
    r.kill(BOT);
    expect(r.live()).toBe(0);
    expect(r.runtime.pickupsSpawned).toBe(0);
  });

  it('collects nothing', () => {
    const r = rig([body(BOT, 'B')]);
    r.runtime.simulate(at(0, 0, 0), true);
    expect(r.runtime.pickupsCollected).toBe(0);
  });
});

describe('Scavenger’s pickups', () => {
  it('drops one where the body fell', () => {
    const r = rig([body(BOT, 'B', 5, -3)]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    expect(r.live()).toBe(1);
    expect(r.runtime.pickupsSpawned).toBe(1);
    const pickup = r.runtime.pickups.find((p) => p.active);
    expect(pickup?.x).toBe(5);
    expect(pickup?.z).toBe(-3);
    expect(pickup?.age).toBe(0);
  });

  it('drops nothing for the player’s own death', () => {
    const r = rig([body(PLAYER_ENTITY_ID, 'A'), body(BOT, 'B')]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(PLAYER_ENTITY_ID);
    expect(r.live()).toBe(0);
  });

  it('drops nothing for a body that is not on the roster', () => {
    const r = rig([body(BOT, 'B')]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(999);
    expect(r.live()).toBe(0);
  });

  it('stops at the pool’s capacity rather than growing it', () => {
    const r = rig([body(BOT, 'B')]);
    r.runtime.setPerks(SCAVENGER);
    for (let i = 0; i < 25; i++) r.kill(BOT);
    expect(r.live()).toBe(16);
    expect(r.runtime.pickupsSpawned).toBe(16);
  });

  it('expires on its own after PICKUP_LIFETIME, uncollected', () => {
    const r = rig([body(BOT, 'B', 50, 50)]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    // `age` is summed one `DT` at a time, so 1,800 of them come to 29.999999999999577 and the
    // 1,801st tick is the one that clears thirty seconds. Pinned exactly: a refactor that
    // derived the age from a tick count would expire the pickup a frame early.
    const ticks = Math.ceil(PICKUP_LIFETIME / DT);
    for (let i = 0; i < ticks; i++) r.runtime.simulate(at(0, 0, 0), true);
    expect(r.live()).toBe(1);
    r.runtime.simulate(at(0, 0, 0), true);
    expect(r.live()).toBe(0);
    expect(r.runtime.pickupsCollected).toBe(0);
  });

  it('is released wholesale when the perk comes off', () => {
    const r = rig([body(BOT, 'B')]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    expect(r.live()).toBe(1);
    r.runtime.setPerks(NOTHING);
    expect(r.live()).toBe(0);
  });

  it('survives a loadout change that keeps the perk', () => {
    const r = rig([body(BOT, 'B')]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    r.runtime.setPerks(resolvePerkState(['scavenger', 'lightweight']));
    expect(r.live()).toBe(1);
  });
});

describe('collecting a pickup', () => {
  it('grants a magazine when the player walks over it, and says so on the bus', () => {
    const r = rig([body(BOT, 'B', 1, 0)]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    r.runtime.simulate(at(1, 0, 0), true);
    expect(r.runtime.pickupsCollected).toBe(1);
    expect(r.live()).toBe(0);
    // A magazine, asked for by the weapon's own size.
    expect(r.asked).toEqual([30]);
    expect(r.scavenged).toEqual([{ rounds: 30, x: 1 }]);
  });

  it('needs the detour: a pickup out of reach is not collected', () => {
    const r = rig([body(BOT, 'B', 10, 0)]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    r.runtime.simulate(at(0, 0, 0), true);
    expect(r.runtime.pickupsCollected).toBe(0);
    expect(r.live()).toBe(1);
  });

  it('is not collected from two floors up', () => {
    const r = rig([body(BOT, 'B', 0, 0)]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    r.runtime.simulate(at(0, 4, 0), true);
    expect(r.runtime.pickupsCollected).toBe(0);
    expect(r.live()).toBe(1);
  });

  it('is not collected while the player is dead', () => {
    const r = rig([body(BOT, 'B', 0, 0)]);
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    r.runtime.simulate(at(0, 0, 0), false);
    expect(r.runtime.pickupsCollected).toBe(0);
    expect(r.live()).toBe(1);
  });

  it('is left where it is when there is no room for it', () => {
    // Walking over a magazine you cannot carry should not consume it.
    const r = rig([body(BOT, 'B', 0, 0)], { roundsAccepted: 0 });
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    r.runtime.simulate(at(0, 0, 0), true);
    expect(r.runtime.pickupsCollected).toBe(0);
    expect(r.live()).toBe(1);
    expect(r.scavenged).toEqual([]);
  });

  it('ages a pickup it is still standing next to, rather than stalling it', () => {
    const r = rig([body(BOT, 'B', 0, 0)], { roundsAccepted: 0 });
    r.runtime.setPerks(SCAVENGER);
    r.kill(BOT);
    r.runtime.simulate(at(0, 0, 0), true);
    const pickup = r.runtime.pickups.find((p) => p.active);
    expect(pickup?.age).toBe(DT);
  });
});

describe('Tracker', () => {
  it('reveals nothing while unequipped', () => {
    const r = rig([body(ENEMY, 'B')]);
    expect(r.runtime.revealsFootstep(ENEMY)).toBe(false);
  });

  it('reveals the other side’s footsteps', () => {
    const r = rig([body(ENEMY, 'B')], { localTeam: 'A' });
    r.runtime.setPerks(TRACKER);
    expect(r.runtime.revealsFootstep(ENEMY)).toBe(true);
  });

  it('never reveals a teammate, or the player themselves', () => {
    const r = rig([body(PLAYER_ENTITY_ID, 'A'), body(BOT, 'A'), body(ENEMY, 'B')], {
      localTeam: 'A',
    });
    r.runtime.setPerks(TRACKER);
    expect(r.runtime.revealsFootstep(PLAYER_ENTITY_ID)).toBe(false);
    expect(r.runtime.revealsFootstep(BOT)).toBe(false);
    expect(r.runtime.revealsFootstep(ENEMY)).toBe(true);
  });

  it('reveals nothing for a walker who is not on the roster', () => {
    const r = rig([body(ENEMY, 'B')]);
    r.runtime.setPerks(TRACKER);
    expect(r.runtime.revealsFootstep(999)).toBe(false);
  });

  it('follows the local team, so the same body flips with it', () => {
    const r = rig([body(ENEMY, 'B')], { localTeam: 'B' });
    r.runtime.setPerks(TRACKER);
    expect(r.runtime.revealsFootstep(ENEMY)).toBe(false);
  });
});

describe('the perk state it is holding', () => {
  it('reports what it was last given', () => {
    const r = rig([body(BOT, 'B')]);
    expect(r.runtime.perkState).toBe(resolvePerkState([]));
    r.runtime.setPerks(SCAVENGER);
    expect(r.runtime.perkState).toBe(SCAVENGER);
  });
});
