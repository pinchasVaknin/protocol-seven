import { describe, expect, it } from 'vitest';
import type { BotDirector } from '../ai/BotDirector';
import type { BotTeam, Combatant } from '../ai/Combatant';
import { DEFAULT_TIERS } from '../ai/DifficultyTiers';
import { DamageSystem, type DamageRequest } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { installClock } from '../core/Clock';
import { createGameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Rng } from '../core/Rng';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import type { MapDef } from '../world/maps/types';
import type { StreakContext } from './KillstreakBase';
import { MortarStrike } from './MortarStrike';
import { DEFAULT_STREAK_CONFIG, streakDef } from './StreakDefs';
import { SILENT_PRESENTATION, type StreakPresentation } from './StreakPresentation';

/**
 * The barrage: twelve shells, scattered, over six seconds (A16).
 *
 * The sequence *is* the streak — the delay before the first shell is the warning and the interval
 * between them is what makes it zone denial rather than an instant kill — and all of it lives in
 * one timer in `onTick` plus one shell in `land`. The refactor splits the shell into choosing a
 * point and applying the blast, so these pin the schedule, the scatter against a fixed seed, and
 * the linear falloff that reaches `DamageSystem` as `penetrationRetain`.
 *
 * The damage door is the real `DamageSystem`, intercepted at `apply`, because the request object
 * is reused for every body in a blast: what matters is the values at the moment of the call.
 */

// `DamageSystem` stamps its last-hit read-out with the clock; any monotonic one will do.
let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const OWNER = 1;

/**
 * Ticks from the mark to the first shell.
 *
 * `mortarDelay` is 2.4 s and the timer is decremented by `DT` rather than compared against the
 * age, so 144 decrements leave it a hair above zero and the shell leaves on the 145th tick.
 * The off-by-one is the pinned behaviour: a refactor that derived the schedule from `age` would
 * fire a tick early and move every impact in the barrage.
 */
const DELAY_TICKS = Math.ceil(DEFAULT_STREAK_CONFIG.mortarDelay / DT) + 1;

/** A body that is only a position, a team and a participation flag. */
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

/** A floor whose top surface is y = 0. */
function world(): CollisionWorld {
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 80, y: 2, z: 80 }, 0, 0, 0, 'concrete');
  return new CollisionWorld(set, { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 24, z: 40 } }, 8);
}

/** One `DamageSystem.apply` call, flattened: the object itself is reused between calls. */
interface Applied {
  readonly targetId: number;
  readonly zone: string;
  readonly distance: number;
  readonly penetrationRetain: number;
  readonly sourceId: number;
  readonly weaponId: string;
  readonly originY: number;
}

function rig(roster: ReturnType<typeof body>[], seed = 5) {
  const impacts: { x: number; y: number; z: number }[] = [];
  const blasts: { radius: number; bright: boolean }[] = [];
  const inbound: number[] = [];
  const present: StreakPresentation = {
    ...SILENT_PRESENTATION,
    mortarImpact: (x, y, z) => impacts.push({ x, y, z }),
    blast: (_x, _y, _z, radius, bright) => blasts.push({ radius, bright }),
    mortarInbound: (x) => inbound.push(x),
  };
  const bus = createGameBus();
  const damage = new DamageSystem(bus);
  const applied: Applied[] = [];
  const realApply = damage.apply.bind(damage);
  damage.apply = (request: DamageRequest) => {
    applied.push({
      targetId: request.targetId,
      zone: request.zone,
      distance: request.distance,
      penetrationRetain: request.penetrationRetain,
      sourceId: request.sourceId,
      weaponId: request.weapon.id,
      originY: request.originY,
    });
    return realApply(request);
  };
  const context: StreakContext = {
    bus,
    world: world(),
    damage,
    bots: {} as BotDirector,
    present,
    mapDef: {} as MapDef,
    cfg: DEFAULT_STREAK_CONFIG,
    rng: new Rng(seed),
    tiers: DEFAULT_TIERS,
    roster: roster as unknown as Combatant[],
    freeForAll: false,
    targetable: () => true,
    visibleToUav: () => true,
    nextEntityId: () => 900,
  };
  const mortar = new MortarStrike(streakDef('mortar'), OWNER, 'A', 4, context, 6, -6);
  mortar.onActivate();
  const run = (ticks: number): boolean => {
    let live = true;
    for (let i = 0; i < ticks; i++) live = mortar.onTick(i);
    return live;
  };
  return { mortar, run, impacts, blasts, inbound, applied };
}

describe('the barrage’s schedule', () => {
  it('whistles once when the mark is confirmed', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    expect(r.inbound).toEqual([6]);
    expect(r.mortar.fired).toBe(0);
  });

  it('holds the first shell for mortarDelay', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    r.run(DELAY_TICKS - 1);
    expect(r.mortar.fired).toBe(0);
    r.run(1);
    expect(r.mortar.fired).toBe(1);
  });

  it('lands mortarShells of them, one per mortarInterval, and then stops', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    const intervalTicks = Math.round(DEFAULT_STREAK_CONFIG.mortarInterval / DT);
    r.run(DELAY_TICKS);
    expect(r.mortar.fired).toBe(1);
    r.run(intervalTicks);
    expect(r.mortar.fired).toBe(2);
    // The whole barrage, and not one more however long the streak is left running.
    r.run(intervalTicks * DEFAULT_STREAK_CONFIG.mortarShells);
    expect(r.mortar.fired).toBe(DEFAULT_STREAK_CONFIG.mortarShells);
    expect(r.impacts).toHaveLength(DEFAULT_STREAK_CONFIG.mortarShells);
  });

  it('lets the last impact breathe, then reports itself done on its def’s duration', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    const ticks = Math.round(streakDef('mortar').durationSeconds / DT);
    expect(r.run(ticks - 1)).toBe(true);
    expect(r.mortar.fired).toBe(DEFAULT_STREAK_CONFIG.mortarShells);
    expect(r.run(1)).toBe(false);
  });

  it('reports the count and the mark for the debug panel', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    expect(r.mortar.describe()).toBe(`MORTAR 0/12 · mark 6,-6`);
    r.run(DELAY_TICKS);
    expect(r.mortar.describe()).toBe(`MORTAR 1/12 · mark 6,-6`);
  });
});

describe('where a shell lands', () => {
  it('scatters over the disc around the mark, within mortarScatter, and repeats for a seed', () => {
    const first = rig([body(OWNER, 'A', 0, 0)], 5);
    first.run(Math.round(streakDef('mortar').durationSeconds / DT));
    const second = rig([body(OWNER, 'A', 0, 0)], 5);
    second.run(Math.round(streakDef('mortar').durationSeconds / DT));
    // Bit-identical for the same seed: the scatter is two `rng.float()` calls per shell.
    expect(first.impacts).toEqual(second.impacts);

    for (const impact of first.impacts) {
      const d = Math.hypot(impact.x - 6, impact.z - -6);
      expect(d).toBeLessThanOrEqual(DEFAULT_STREAK_CONFIG.mortarScatter);
      // On the floor the probe found, not at the mark's own height.
      expect(impact.y).toBe(0);
    }
    // Twelve different points rather than twelve on the mark.
    expect(new Set(first.impacts.map((i) => i.x)).size).toBe(DEFAULT_STREAK_CONFIG.mortarShells);
  });

  it('draws a bright blast of mortarRadius above each impact', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    r.run(DELAY_TICKS);
    expect(r.blasts).toEqual([{ radius: DEFAULT_STREAK_CONFIG.mortarRadius, bright: true }]);
  });

  it('is unaffected by a different seed landing in a different place', () => {
    const a = rig([body(OWNER, 'A', 0, 0)], 5);
    const b = rig([body(OWNER, 'A', 0, 0)], 11);
    a.run(DELAY_TICKS);
    b.run(DELAY_TICKS);
    expect(a.impacts).not.toEqual(b.impacts);
  });
});

describe('what a shell does to a body', () => {
  it('hits everybody inside the radius, friend or foe, and nobody outside it', () => {
    // Both standing on the mark; the owner's own teammate is in the blast with the enemy.
    const r = rig([body(OWNER, 'A', 6, -6), body(2, 'A', 6, -6), body(3, 'B', 40, 40)]);
    r.run(DELAY_TICKS);
    const hit = r.applied.map((a) => a.targetId).sort((x, y) => x - y);
    expect(hit).toEqual([OWNER, 2]);
  });

  it('credits the owner, with the mortar’s own weapon, against the torso', () => {
    const r = rig([body(OWNER, 'A', 6, -6)]);
    r.run(DELAY_TICKS);
    const shot = r.applied[0];
    expect(shot?.sourceId).toBe(OWNER);
    expect(shot?.weaponId).toBe('streak_mortar');
    expect(shot?.zone).toBe('torso');
    // No distance term of its own: the radial falloff is the whole of it.
    expect(shot?.distance).toBe(0);
  });

  it('falls off linearly from where the shell actually landed, in the 0..1 band', () => {
    // Two bodies a metre apart, so one shell reaches both and the near one keeps more. The
    // reference distance is the impact, not the mark: the shell is scattered off it.
    const near = body(2, 'B', 6, -6);
    const far = body(3, 'B', 7, -6);
    const r = rig([near, far], 5);
    r.run(DELAY_TICKS);

    const impact = r.impacts[0];
    if (impact === undefined) throw new Error('no shell landed');
    const retainFor = (b: ReturnType<typeof body>): number => {
      const dx = b.px - impact.x;
      const dy = b.py + b.aimHeight - (impact.y + 0.4);
      const dz = b.pz - impact.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return Math.max(0, Math.min(1, 1 - d / DEFAULT_STREAK_CONFIG.mortarRadius));
    };

    for (const b of [near, far]) {
      const shot = r.applied.find((a) => a.targetId === b.entityId);
      expect(shot).toBeDefined();
      // Exactly the linear term, clamped: `1 - distance / mortarRadius`.
      expect(shot?.penetrationRetain).toBe(retainFor(b));
      expect(shot?.penetrationRetain).toBeGreaterThanOrEqual(0);
      expect(shot?.penetrationRetain).toBeLessThanOrEqual(1);
    }
  });

  it('states where the burst came from, so a shield can be in front of it', () => {
    const r = rig([body(2, 'B', 6, -6)]);
    r.run(DELAY_TICKS);
    // Lifted off the floor by the same 0.4 the blast is drawn at.
    expect(r.applied[0]?.originY).toBeCloseTo(0.4, 10);
  });

  it('ignores a body that is not participating', () => {
    const dead = body(2, 'B', 6, -6);
    dead.participating = false;
    const r = rig([dead]);
    r.run(DELAY_TICKS);
    expect(r.applied).toEqual([]);
  });
});
