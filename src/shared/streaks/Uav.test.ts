import { describe, expect, it } from 'vitest';
import type { BotDirector } from '../ai/BotDirector';
import type { BotTeam, Combatant } from '../ai/Combatant';
import { DEFAULT_TIERS } from '../ai/DifficultyTiers';
import { DamageSystem } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { createGameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { TAU } from '../core/MathUtil';
import { Rng } from '../core/Rng';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import type { MapDef } from '../world/maps/types';
import type { StreakContext } from './KillstreakBase';
import { DEFAULT_STREAK_CONFIG, streakDef } from './StreakDefs';
import { SILENT_PRESENTATION, type StreakPresentation } from './StreakPresentation';
import { Uav } from './Uav';

/**
 * The sweep, pinned (A16).
 *
 * The UAV's whole design is that the read-out is a *snapshot per revolution* rather than a
 * continuous feed, and everything that makes that true lives in one tick method: the bearing
 * advances, the beam records what it crossed, and a contact the beam has not touched for
 * `uavContactFadeSeconds` goes out. These pin all three plus the three filters in front of them
 * — the owner by id, hostility, and the Ghost hook — because the refactor splits that method and
 * the order of those steps is the behaviour.
 */

const OWNER = 1;

/** A body that is only a position, a team and a participation flag: all a sweep reads. */
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

function world(): CollisionWorld {
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 80, y: 2, z: 80 }, 0, 0, 0, 'concrete');
  return new CollisionWorld(set, { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 24, z: 40 } }, 8);
}

interface RigOptions {
  readonly freeForAll?: boolean;
  readonly visibleToUav?: (entityId: number) => boolean;
}

function rig(roster: ReturnType<typeof body>[], options: RigOptions = {}) {
  const sweeps: number[] = [];
  const present: StreakPresentation = { ...SILENT_PRESENTATION, uavSweep: (age) => sweeps.push(age) };
  const bus = createGameBus();
  const context: StreakContext = {
    bus,
    world: world(),
    damage: new DamageSystem(bus),
    bots: {} as BotDirector,
    present,
    mapDef: {} as MapDef,
    cfg: DEFAULT_STREAK_CONFIG,
    rng: new Rng(1),
    tiers: DEFAULT_TIERS,
    roster: roster as unknown as Combatant[],
    freeForAll: options.freeForAll ?? false,
    targetable: () => true,
    visibleToUav: options.visibleToUav ?? (() => true),
    nextEntityId: () => 900,
  };
  const uav = new Uav(streakDef('uav'), OWNER, 'A', 1, context);
  uav.onActivate();
  /** `n` sim ticks, and whether the streak was still live on the last of them. */
  const run = (ticks: number): boolean => {
    let live = true;
    for (let i = 0; i < ticks; i++) live = uav.onTick(i);
    return live;
  };
  return { uav, run, sweeps };
}

/** The bearing the sweep measures a body at, which is how the beam is aimed at one in a test. */
function bearingOf(px: number, pz: number): number {
  const a = Math.atan2(pz, px) % TAU;
  return a < 0 ? a + TAU : a;
}

describe('a UAV sweep', () => {
  it('allocates one contact slot per roster member, unlit, at activation', () => {
    const r = rig([body(OWNER, 'A', 0, 0), body(2, 'B', 10, 0), body(3, 'B', 0, 10)]);
    expect(r.uav.contacts).toHaveLength(3);
    expect(r.uav.contacts.map((c) => c.entityId)).toEqual([OWNER, 2, 3]);
    for (const c of r.uav.contacts) {
      expect(c.age).toBe(Infinity);
      expect(c.active).toBe(false);
      expect(c.x).toBe(0);
      expect(c.z).toBe(0);
    }
    // Activation is itself one audible sweep, at age zero.
    expect(r.sweeps).toEqual([0]);
  });

  it('turns one revolution per uavSweepSeconds and never leaves [0, TAU)', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    const perTick = (TAU / DEFAULT_STREAK_CONFIG.uavSweepSeconds) * DT;
    r.run(1);
    expect(r.uav.sweepAngle).toBe(perTick % TAU);
    r.run(4);
    expect(r.uav.sweepAngle).toBe((perTick * 5) % TAU);
    // Round the revolution and back past the wrap.
    r.run(200);
    expect(r.uav.sweepAngle).toBeGreaterThanOrEqual(0);
    expect(r.uav.sweepAngle).toBeLessThan(TAU);
  });

  it('is audible once per revolution, and reports its age when it wraps', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    const ticksPerRevolution = Math.ceil(DEFAULT_STREAK_CONFIG.uavSweepSeconds / DT);
    // Three revolutions and a few ticks: the wrap lands a tick past the nominal count, because
    // the bearing is accumulated rather than derived from the age.
    r.run(ticksPerRevolution * 3 + 4);
    // The activation sweep, then one per revolution.
    expect(r.sweeps).toHaveLength(4);
    // Each wrap is heard on the tick *after* the revolution's nominal length, because the
    // bearing is a running sum that reaches TAU a tick late. One revolution apart thereafter.
    expect(r.sweeps[1]).toBeCloseTo(DEFAULT_STREAK_CONFIG.uavSweepSeconds + DT, 5);
    expect((r.sweeps[2] ?? 0) - (r.sweeps[1] ?? 0)).toBeCloseTo(
      DEFAULT_STREAK_CONFIG.uavSweepSeconds,
      1,
    );
    expect((r.sweeps[3] ?? 0) - (r.sweeps[2] ?? 0)).toBeCloseTo(
      DEFAULT_STREAK_CONFIG.uavSweepSeconds,
      1,
    );
  });

  it('records an enemy at the position it had when the beam crossed it', () => {
    const enemy = body(2, 'B', 12, 0);
    const r = rig([body(OWNER, 'A', 0, 0), enemy]);
    const bearing = bearingOf(enemy.px, enemy.pz);
    const slot = r.uav.contacts[1];
    if (slot === undefined) throw new Error('no slot for the enemy');

    // Up to just before the beam reaches it: nothing has been seen.
    while (r.uav.sweepAngle + (TAU / DEFAULT_STREAK_CONFIG.uavSweepSeconds) * DT < bearing) r.run(1);
    expect(slot.active).toBe(false);
    expect(slot.age).toBe(Infinity);

    r.run(1);
    expect(slot.active).toBe(true);
    expect(slot.age).toBe(0);
    expect(slot.x).toBe(12);
    expect(slot.z).toBe(0);

    // The body moves on; the dot stays where the beam left it until the next crossing.
    enemy.px = 20;
    r.run(1);
    expect(slot.x).toBe(12);
    expect(slot.age).toBe(DT);
  });

  it('puts a contact out once it has gone uavContactFadeSeconds without being crossed', () => {
    const r = rig([body(OWNER, 'A', 0, 0), body(2, 'B', 12, 0)]);
    const slot = r.uav.contacts[1];
    if (slot === undefined) throw new Error('no slot for the enemy');
    while (!slot.active) r.run(1);

    const fadeTicks = Math.ceil(DEFAULT_STREAK_CONFIG.uavContactFadeSeconds / DT);
    r.run(fadeTicks - 1);
    expect(slot.active).toBe(true);
    r.run(1);
    expect(slot.active).toBe(false);
  });

  it('never records the owner, even though the owner has a slot', () => {
    // The owner sits off the centre, so the beam does pass over their bearing.
    const r = rig([body(OWNER, 'A', 9, 9), body(2, 'B', -9, -9)]);
    const ticksPerRevolution = Math.ceil(DEFAULT_STREAK_CONFIG.uavSweepSeconds / DT);
    r.run(ticksPerRevolution);
    const ownerSlot = r.uav.contacts[0];
    const enemySlot = r.uav.contacts[1];
    expect(ownerSlot?.active).toBe(false);
    expect(ownerSlot?.age).toBe(Infinity);
    expect(enemySlot?.active).toBe(true);
  });

  it('records only the other team when the match has teams', () => {
    const r = rig([body(OWNER, 'A', 9, 9), body(2, 'A', -9, -9), body(3, 'B', 9, -9)]);
    r.run(Math.ceil(DEFAULT_STREAK_CONFIG.uavSweepSeconds / DT));
    expect(r.uav.contacts[1]?.active).toBe(false);
    expect(r.uav.contacts[2]?.active).toBe(true);
  });

  it('records everybody but the owner in Free-for-All, including bodies on the owner’s side', () => {
    const r = rig([body(OWNER, 'A', 9, 9), body(2, 'A', -9, -9), body(3, 'B', 9, -9)], {
      freeForAll: true,
    });
    r.run(Math.ceil(DEFAULT_STREAK_CONFIG.uavSweepSeconds / DT));
    expect(r.uav.contacts[1]?.active).toBe(true);
    expect(r.uav.contacts[2]?.active).toBe(true);
  });

  it('never records a body the Ghost hook hides, so nothing downstream has to filter', () => {
    const r = rig([body(OWNER, 'A', 0, 0), body(2, 'B', 0, 12), body(3, 'B', 0, -12)], {
      visibleToUav: (entityId) => entityId !== 2,
    });
    r.run(Math.ceil(DEFAULT_STREAK_CONFIG.uavSweepSeconds / DT));
    // Never *recorded*, which is the claim: the age was never zeroed, so no fade could have
    // taken a dot away that had been drawn.
    expect(r.uav.contacts[1]?.active).toBe(false);
    expect(r.uav.contacts[1]?.age).toBe(Infinity);
    expect(r.uav.contacts[2]?.active).toBe(true);
  });

  it('skips a body that is not participating', () => {
    const dead = body(2, 'B', 12, 0);
    dead.participating = false;
    const r = rig([body(OWNER, 'A', 0, 0), dead]);
    r.run(Math.ceil(DEFAULT_STREAK_CONFIG.uavSweepSeconds / DT));
    expect(r.uav.contacts[1]?.active).toBe(false);
  });

  it('lives its def’s duration, measured by accumulating DT', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    // 1,800 additions of 1/60 come to 29.999999999999577, so the 1,800th tick is still inside
    // the thirty seconds and the 1,801st is not. Pinned exactly, because `age` is summed rather
    // than multiplied and the refactor must not change where that sum is taken.
    const ticks = Math.round(streakDef('uav').durationSeconds / DT);
    expect(r.run(ticks)).toBe(true);
    expect(r.run(1)).toBe(false);
  });

  it('reports the seconds left, the bearing in degrees and the lit count', () => {
    const r = rig([body(OWNER, 'A', 0, 0), body(2, 'B', 12, 0)]);
    const slot = r.uav.contacts[1];
    if (slot === undefined) throw new Error('no slot for the enemy');
    while (!slot.active) r.run(1);
    const degrees = ((r.uav.sweepAngle * 180) / Math.PI).toFixed(0);
    expect(r.uav.describe()).toBe(
      `UAV ${r.uav.secondsRemaining.toFixed(1)}s · sweep ${degrees}° · 1 contacts`,
    );
  });

  it('empties the contact list when it expires', () => {
    const r = rig([body(OWNER, 'A', 0, 0), body(2, 'B', 12, 0)]);
    r.run(30);
    r.uav.onExpire();
    expect(r.uav.contacts).toHaveLength(0);
  });
});
