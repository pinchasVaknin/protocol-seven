import { describe, expect, it } from 'vitest';
import type { BotDirector } from '../ai/BotDirector';
import type { BotTeam, Combatant } from '../ai/Combatant';
import { DEFAULT_TIERS } from '../ai/DifficultyTiers';
import { DamageSystem } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { installClock } from '../core/Clock';
import { createGameBus, EV } from '../core/Events';
import { DT } from '../core/Loop';
import { angleDelta, DEG2RAD } from '../core/MathUtil';
import { Rng } from '../core/Rng';
import { simCos, simSin } from '../core/SimMath';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import type { MapDef } from '../world/maps/types';
import type { StreakContext } from './KillstreakBase';
import { makeSentryTally, SentryGun } from './SentryGun';
import { DEFAULT_STREAK_CONFIG, streakDef } from './StreakDefs';
import { SILENT_PRESENTATION, type StreakPresentation } from './StreakPresentation';

/**
 * What the turret decides, pinned (A16).
 *
 * Two methods carry the sentry's behaviour and both are refactored here: `acquire`, which is six
 * filters and a nearest-of search, and `onTick`, which drives the bot aim model. These pin the
 * filters one at a time — range, the watched arc, line of sight, Cold-Blooded, hostility in both
 * team modes, and the owner by id — because each is a separate reason a sentry does not shoot and
 * a refactor that merged two of them would look right in every aggregate test.
 *
 * `targetId` is the read-out they go through: it is the public answer to "who is it shooting at",
 * so an acquisition can be asserted without reaching for a private.
 */

// `DamageSystem` stamps its last-hit read-out with the clock; any monotonic one will do.
let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const OWNER = 1;

/** A body that is only a pose, a team and a participation flag. */
function body(entityId: number, team: BotTeam, px: number, pz: number) {
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

/** A floor, and optionally a wall across the sentry's lane at z = -6. */
function world(withWall: boolean): CollisionWorld {
  const set = new ColliderSet(2);
  set.add({ x: 0, y: -1, z: 0 }, { x: 80, y: 2, z: 80 }, 0, 0, 0, 'concrete');
  if (withWall) set.add({ x: 0, y: 2, z: -6 }, { x: 20, y: 6, z: 0.5 }, 0, 0, 0, 'concrete');
  return new CollisionWorld(set, { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 24, z: 40 } }, 8);
}

interface RigOptions {
  readonly freeForAll?: boolean;
  readonly targetable?: (entityId: number) => boolean;
  readonly withWall?: boolean;
  /** The facing the turret is placed with. Yaw 0 looks down -Z. */
  readonly restYaw?: number;
}

function rig(roster: ReturnType<typeof body>[], options: RigOptions = {}) {
  const shots: number[] = [];
  const blasts: number[] = [];
  const present: StreakPresentation = {
    ...SILENT_PRESENTATION,
    sentryShot: (_x, y) => shots.push(y),
    blast: (_x, _y, _z, radius) => blasts.push(radius),
  };
  const bus = createGameBus();
  const damage = new DamageSystem(bus);
  const context: StreakContext = {
    bus,
    world: world(options.withWall ?? false),
    damage,
    bots: {} as BotDirector,
    present,
    mapDef: {} as MapDef,
    cfg: DEFAULT_STREAK_CONFIG,
    rng: new Rng(7),
    tiers: DEFAULT_TIERS,
    roster: roster as unknown as Combatant[],
    freeForAll: options.freeForAll ?? false,
    targetable: options.targetable ?? (() => true),
    visibleToUav: () => true,
    nextEntityId: () => 900,
  };
  const sentry = new SentryGun(
    streakDef('sentry'),
    OWNER,
    'A',
    1,
    context,
    0,
    0,
    0,
    options.restYaw ?? 0,
  );
  sentry.onActivate();
  const destroyed: { byId: number; instanceId: number }[] = [];
  bus.on(EV.StreakDestroyed, (p) => destroyed.push({ byId: p.byId, instanceId: p.instanceId }));
  const run = (ticks: number): boolean => {
    let live = true;
    for (let i = 0; i < ticks; i++) live = sentry.onTick(i);
    return live;
  };
  return { sentry, run, damage, bus, shots, blasts, destroyed };
}

describe('what a sentry acquires', () => {
  it('takes an enemy standing in its lane', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -10)]);
    r.run(1);
    expect(r.sentry.targetId).toBe(2);
  });

  it('reports -1 and returns to its placed facing with nothing in the arc', () => {
    const r = rig([body(OWNER, 'A', 0, 2)], { restYaw: 0.4 });
    r.run(30);
    expect(r.sentry.targetId).toBe(-1);
    // Slewed back toward the facing it was placed with, so `turretYaw` is near zero.
    expect(Math.abs(r.sentry.turretYaw)).toBeLessThan(0.05);
  });

  it('ignores anything past sentryRange', () => {
    const justIn = DEFAULT_STREAK_CONFIG.sentryRange - 1;
    const near = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -justIn)]);
    near.run(1);
    expect(near.sentry.targetId).toBe(2);

    const far = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -(DEFAULT_STREAK_CONFIG.sentryRange + 4))]);
    far.run(1);
    expect(far.sentry.targetId).toBe(-1);
  });

  it('watches an arc rather than a sphere', () => {
    // Just inside the half-angle, then just outside it, at the same distance.
    const arc = DEFAULT_STREAK_CONFIG.sentryArcDeg * DEG2RAD;
    const d = 10;
    const inside = rig([
      body(OWNER, 'A', 0, 2),
      body(2, 'B', -simSin(arc * 0.9) * d, -simCos(arc * 0.9) * d),
    ]);
    inside.run(1);
    expect(inside.sentry.targetId).toBe(2);

    const outside = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, d)]);
    outside.run(1);
    expect(outside.sentry.targetId).toBe(-1);
  });

  it('needs a clear line: a wall across the lane hides the body behind it', () => {
    const open = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -10)]);
    open.run(1);
    expect(open.sentry.targetId).toBe(2);

    const blocked = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -10)], { withWall: true });
    blocked.run(1);
    expect(blocked.sentry.targetId).toBe(-1);
  });

  it('never considers a body the Cold-Blooded hook protects', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -8), body(3, 'B', 0, -14)], {
      targetable: (entityId) => entityId !== 2,
    });
    r.run(1);
    // Not merely passed over for the nearer one: the protected body is never a candidate, so
    // the farther one is taken instead of nothing.
    expect(r.sentry.targetId).toBe(3);
  });

  it('skips the owner by id, and in Free-for-All takes a body on its own side', () => {
    const teams = rig([body(OWNER, 'A', 0, 2), body(2, 'A', 0, -10)]);
    teams.run(1);
    expect(teams.sentry.targetId).toBe(-1);

    const ffa = rig([body(OWNER, 'A', 0, 2), body(2, 'A', 0, -10)], { freeForAll: true });
    ffa.run(1);
    expect(ffa.sentry.targetId).toBe(2);

    // The owner is skipped by id even in Free-for-All, where hostility would otherwise allow it.
    const ownerInArc = rig([body(OWNER, 'A', 0, -10)], { freeForAll: true });
    ownerInArc.run(1);
    expect(ownerInArc.sentry.targetId).toBe(-1);
  });

  it('skips a body that is not participating', () => {
    const dead = body(2, 'B', 0, -10);
    dead.participating = false;
    const r = rig([body(OWNER, 'A', 0, 2), dead]);
    r.run(1);
    expect(r.sentry.targetId).toBe(-1);
  });

  it('takes the nearest of two in the arc', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -16), body(3, 'B', 0, -7)]);
    r.run(1);
    expect(r.sentry.targetId).toBe(3);
    // And in the other declaration order, so this is distance and not position in the roster.
    const swapped = rig([body(OWNER, 'A', 0, 2), body(3, 'B', 0, -7), body(2, 'B', 0, -16)]);
    swapped.run(1);
    expect(swapped.sentry.targetId).toBe(3);
  });
});

describe('how a sentry aims and fires', () => {
  it('pays the reaction delay before the first round leaves', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -10)]);
    const reactionTicks = Math.ceil(DEFAULT_STREAK_CONFIG.sentryReactionSeconds / DT);
    r.run(reactionTicks - 1);
    expect(r.sentry.shotsFired).toBe(0);
    r.run(120);
    expect(r.sentry.shotsFired).toBeGreaterThan(0);
  });

  it('shoots from its eye height, at its own rate', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -10)]);
    r.run(240);
    // Every round is announced from the same point above the base.
    expect(new Set(r.shots)).toEqual(new Set([0.74]));
    expect(r.shots).toHaveLength(r.sentry.shotsFired);
    // Rate-limited: four seconds at 420 rpm can never be more than 28 rounds.
    expect(r.sentry.shotsFired).toBeLessThanOrEqual(Math.ceil((DEFAULT_STREAK_CONFIG.sentryRpm / 60) * 4));
    expect(r.sentry.shotsHit).toBeLessThanOrEqual(r.sentry.shotsFired);
  });

  it('poses the turret relative to the base it was placed on', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', -6, -6)], { restYaw: 0.3 });
    r.run(90);
    // A body at (-6, -6) sits on bearing +pi/4 from a turret at the origin, and the base was
    // placed facing 0.3 — so the turret's own yaw settles on the difference, give or take the
    // aim model's cone. The whole point of the field is that it is *not* the world bearing.
    const bearing = Math.atan2(6, 6);
    expect(r.sentry.turretYaw).toBeCloseTo(angleDelta(0.3, bearing), 1);
    expect(r.sentry.turretPitch).toBeGreaterThanOrEqual(-0.7);
    expect(r.sentry.turretPitch).toBeLessThanOrEqual(0.7);
  });

  it('turns rather than snapping: the aim has to come round to a body behind it', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', -8, -8)]);
    r.run(1);
    const firstTick = r.sentry.turretYaw;
    r.run(20);
    // It is on its way round and has not arrived in one tick.
    expect(Math.abs(firstTick)).toBeLessThan(Math.abs(r.sentry.turretYaw));
  });
});

describe('a sentry’s life and death', () => {
  it('registers itself as damageable and unregisters on expiry', () => {
    const r = rig([body(OWNER, 'A', 0, 2)]);
    expect(r.damage.get(r.sentry.entityId)).toBe(r.sentry);
    r.sentry.onExpire();
    expect(r.damage.get(r.sentry.entityId)).toBe(undefined);
  });

  it('dies to the ordinary damage path and says who did it', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -10)]);
    expect(r.run(1)).toBe(true);
    r.bus.emit(EV.EntityKilled, {
      targetId: r.sentry.entityId,
      sourceId: 2,
      weaponId: 'ar_default',
      zone: 'torso',
      killerHealth: 200,
    });
    expect(r.destroyed).toEqual([{ byId: 2, instanceId: 1 }]);
    // A heavy blast, and the streak reports itself finished on the next tick.
    expect(r.blasts).toContain(2.2);
    expect(r.run(1)).toBe(false);
  });

  it('lives its def’s duration when nothing shoots it down', () => {
    const r = rig([body(OWNER, 'A', 0, 2)]);
    const ticks = Math.round(streakDef('sentry').durationSeconds / DT);
    expect(r.run(ticks)).toBe(true);
    expect(r.run(1)).toBe(false);
  });

  it('folds its counters into a tally without clearing them', () => {
    const r = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -10)]);
    r.run(240);
    const tally = makeSentryTally();
    r.sentry.tallyInto(tally);
    expect(tally.placed).toBe(1);
    expect(tally.shotsFired).toBe(r.sentry.shotsFired);
    expect(tally.shotsHit).toBe(r.sentry.shotsHit);
    expect(tally.kills).toBe(r.sentry.kills);
    expect(tally.killsOnOwnSubstrate).toBe(r.sentry.killsOnOwnSubstrate);
    // Added to, not replaced: two sentries fold into one row.
    r.sentry.tallyInto(tally);
    expect(tally.placed).toBe(2);
    expect(tally.shotsFired).toBe(r.sentry.shotsFired * 2);
  });

  it('reports the state the debug panel prints', () => {
    const idle = rig([body(OWNER, 'A', 0, 2)]);
    idle.run(1);
    expect(idle.sentry.describe()).toBe(
      `SENTRY #1 scanning · hp 260 · 0/0 (—%) · ${idle.sentry.secondsRemaining.toFixed(0)}s`,
    );

    const engaged = rig([body(OWNER, 'A', 0, 2), body(2, 'B', 0, -10)]);
    engaged.run(1);
    expect(engaged.sentry.describe()).toContain('-> #2');
  });
});
