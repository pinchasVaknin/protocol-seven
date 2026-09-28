import { describe, expect, it } from 'vitest';
import type { BotDirector } from '../ai/BotDirector';
import type { Combatant } from '../ai/Combatant';
import { DEFAULT_TIERS } from '../ai/DifficultyTiers';
import { DamageSystem } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { installClock } from '../core/Clock';
import { createGameBus, EV } from '../core/Events';
import { Btn, type MutableInputCommand } from '../core/InputCommand';
import { Rng } from '../core/Rng';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import type { MapDef } from '../world/maps/types';
import { SentryGun } from './SentryGun';
import { ALL_STREAK_IDS, DEFAULT_STREAK_CONFIG, STREAK_COOLDOWN_SECONDS } from './StreakDefs';
import { SILENT_PRESENTATION } from './StreakPresentation';
import { StreakSystem } from './StreakSystem';

/**
 * Taking your own sentry apart (2026-09-28).
 *
 * The owner holds the use key at their turret, facing it, for a second, and it comes down — for
 * repositioning, not for a refund: the cooldown starts from that moment and the next one has to be
 * earned. These run the real `StreakSystem` with a real `SentryGun`, a real damage door and a real
 * ledger, so "the cooldown starts" is the ledger saying so rather than a flag being set.
 */

// `StreakSystem.simulate` times itself, as every simulation step does; any monotonic clock will do.
let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const OWNER = 1;
const TEAMMATE = 2;

/** A body that is only a position, a facing and a team: all the dismantle reads of anybody. */
function body(entityId: number) {
  return {
    entityId,
    displayName: `P${entityId}`,
    team: 'A' as const,
    health: new Health(DEFAULT_HEALTH_CONFIG),
    rig: new HitboxRig(),
    px: 0,
    py: 0,
    pz: 0,
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

function world(): CollisionWorld {
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 80, y: 2, z: 80 }, 0, 0, 0, 'concrete');
  return new CollisionWorld(set, { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 24, z: 40 } }, 8);
}

function rig() {
  const bus = createGameBus();
  const owner = body(OWNER);
  const teammate = body(TEAMMATE);
  teammate.px = 5;
  const roster = [owner, teammate] as unknown as Combatant[];
  const buttons = new Map<number, number>();
  const command = (id: number): MutableInputCommand => ({
    seq: 0,
    tickIndex: 0,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: buttons.get(id) ?? 0,
    sampledAtMs: 0,
  });
  const collision = world();
  const damage = new DamageSystem(bus);
  const system = new StreakSystem({
    bus,
    score: new ScoreSystem(bus),
    roster,
    context: {
      bus,
      world: collision,
      damage,
      bots: {} as BotDirector,
      present: SILENT_PRESENTATION,
      mapDef: {} as MapDef,
      cfg: DEFAULT_STREAK_CONFIG,
      rng: new Rng(1),
      tiers: DEFAULT_TIERS,
      roster,
      freeForAll: false,
    },
    targetable: () => true,
    visibleToUav: () => true,
    streakDiscount: () => 0,
    reportProgressTo: () => false,
    commandFor: (id) => command(id),
    equippedStreaks: () => ALL_STREAK_IDS,
  });

  const destroyedBy: number[] = [];
  bus.on(EV.StreakDestroyed, (p) => destroyedBy.push(p.byId));

  // The owner stands at the origin looking down -Z; the turret goes a metre in front of them.
  system.debugGrant(OWNER, 'sentry');
  const placed = system.activate(OWNER, 'sentry', 0, 0, -1, 0);
  if (!(placed instanceof SentryGun)) throw new Error('the sentry was not placed');

  let tick = 0;
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) system.simulate(++tick);
  };
  return { system, owner, teammate, buttons, run, sentry: placed, destroyedBy };
}

describe('dismantling your own sentry', () => {
  it('takes a second of the use key, facing it, and starts the cooldown from then', () => {
    const r = rig();
    r.run(2);
    const lockedAtPlacement = r.system.lockoutSecondsFor(OWNER, 'sentry');
    // Placed with ninety seconds of life, so the estimate is ninety and the thirty after it.
    expect(lockedAtPlacement).toBeGreaterThan(100);

    r.buttons.set(OWNER, Btn.Use);
    r.run(0.9);
    expect(r.system.sentries()).toHaveLength(1);
    expect(r.sentry.dismantleFraction).toBeGreaterThan(0.85);
    r.run(0.15);
    expect(r.system.sentries()).toHaveLength(0);
    expect(r.destroyedBy).toEqual([OWNER]);
    // Retired now, so the wait is the thirty seconds from now — not what was left of ninety.
    expect(r.system.lockoutSecondsFor(OWNER, 'sentry')).toBeCloseTo(STREAK_COOLDOWN_SECONDS, 0);
    // And nothing came back: the next one is earned again.
    expect(r.system.balanceOf(OWNER)).toBe(0);
  });

  it('starts again when the key is let go', () => {
    const r = rig();
    r.buttons.set(OWNER, Btn.Use);
    r.run(0.6);
    r.buttons.set(OWNER, 0);
    r.run(0.1);
    expect(r.sentry.dismantleFraction).toBe(0);
    r.buttons.set(OWNER, Btn.Use);
    r.run(0.6);
    expect(r.system.sentries()).toHaveLength(1);
  });

  it('needs the owner at it and facing it', () => {
    const r = rig();
    r.buttons.set(OWNER, Btn.Use);
    r.owner.yaw = Math.PI; // back to it
    r.run(2);
    expect(r.system.sentries()).toHaveLength(1);
    r.owner.yaw = 0;
    r.owner.pz = 3; // four metres off
    r.run(2);
    expect(r.system.sentries()).toHaveLength(1);
  });

  it('is the owner’s alone: a teammate at it with the key does nothing', () => {
    const r = rig();
    r.teammate.px = 0;
    r.teammate.pz = 0;
    r.buttons.set(TEAMMATE, Btn.Use);
    r.run(2);
    expect(r.system.sentries()).toHaveLength(1);
  });
});
