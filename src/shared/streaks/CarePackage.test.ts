import { describe, expect, it } from 'vitest';
import type { BotDirector } from '../ai/BotDirector';
import type { BotTeam, Combatant } from '../ai/Combatant';
import { DEFAULT_TIERS } from '../ai/DifficultyTiers';
import { DamageSystem } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { createGameBus, EV } from '../core/Events';
import { DT } from '../core/Loop';
import { Rng } from '../core/Rng';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import type { MapDef } from '../world/maps/types';
import { CarePackage } from './CarePackage';
import type { StreakContext } from './KillstreakBase';
import { DEFAULT_STREAK_CONFIG, STREAK_DEFS, streakDef } from './StreakDefs';
import { SILENT_PRESENTATION, type StreakPresentation } from './StreakPresentation';

/**
 * The crate: the fall, the contest, and what is inside (A16).
 *
 * `onTick` is two machines sharing a method — a descent integrated on `DT` until the collision
 * world says the floor is there, and a claim timer that *resets* rather than shares when two
 * bodies stand on it. The refactor separates them, so these pin the handover between the two and
 * the one rule that makes the streak contestable rather than a race.
 *
 * The contents are rolled from `ctx.rng` at construction, so they are pinned against a fixed
 * seed: the same seed must keep producing the same crate, byte for byte.
 */

const OWNER = 1;

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

function rig(roster: ReturnType<typeof body>[], seed = 1) {
  const landings: number[] = [];
  const claims: number[] = [];
  const present: StreakPresentation = {
    ...SILENT_PRESENTATION,
    packageLand: (_x, y) => landings.push(y),
    packageClaimed: (_x, y) => claims.push(y),
  };
  const bus = createGameBus();
  const context: StreakContext = {
    bus,
    world: world(),
    damage: new DamageSystem(bus),
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
  const dropped: number[] = [];
  const claimed: { entityId: number; streakId: string }[] = [];
  bus.on(EV.CarePackageDropped, (p) => dropped.push(p.packageId));
  bus.on(EV.CarePackageClaimed, (p) => claimed.push({ entityId: p.entityId, streakId: p.streakId }));
  // Subscribed before activation: the drop is announced from `onActivate`.
  const pack = new CarePackage(streakDef('care_package'), OWNER, 'A', 3, context, 4, -4);
  pack.onActivate();
  const run = (ticks: number): boolean => {
    let live = true;
    for (let i = 0; i < ticks; i++) live = pack.onTick(i);
    return live;
  };
  /** Ticks until the crate is on the floor. */
  const land = (): void => {
    while (!pack.landed) run(1);
  };
  return { pack, run, land, landings, claims, dropped, claimed, bus };
}

describe('what is in the crate', () => {
  it('rolls at construction from the streak rng, and is the same crate for the same seed', () => {
    expect(rig([body(OWNER, 'A', 0, 0)], 1).pack.contents.id).toBe(
      rig([body(OWNER, 'A', 0, 0)], 1).pack.contents.id,
    );
    // The roll is a weighted pick, so two different seeds reach it by different routes.
    const ids = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => rig([body(OWNER, 'A', 0, 0)], s).pack.contents.id));
    expect(ids.size).toBeGreaterThan(1);
  });

  it('can only contain a streak marked fromCarePackage, so never another package', () => {
    const eligible = STREAK_DEFS.filter((s) => s.fromCarePackage).map((s) => s.id);
    expect(eligible).not.toContain('care_package');
    for (let seed = 1; seed <= 40; seed++) {
      expect(eligible).toContain(rig([body(OWNER, 'A', 0, 0)], seed).pack.contents.id);
    }
  });
});

describe('the fall', () => {
  it('is spawned at the drop height above the floor and announced once', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    expect(r.pack.y).toBe(DEFAULT_STREAK_CONFIG.packageDropHeight);
    expect(r.pack.landed).toBe(false);
    expect(r.dropped).toEqual([3]);
  });

  it('descends at packageDropSpeed on the sim tick and stops exactly on the floor', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    const start = r.pack.y;
    r.run(1);
    expect(r.pack.y).toBe(start - DEFAULT_STREAK_CONFIG.packageDropSpeed * DT);
    r.land();
    expect(r.pack.y).toBe(0);
    // One landing, at the floor, and no further ones however long it sits there.
    expect(r.landings).toEqual([0]);
    r.run(60);
    expect(r.landings).toEqual([0]);
  });

  it('offers nothing to a bot while it is still in the air', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    expect(r.pack.objectiveTarget()).toBe(null);
    r.land();
    const target = r.pack.objectiveTarget();
    expect(target?.id).toBe('package_3');
    expect(target?.label).toBe('PACKAGE');
    expect(target?.action).toBe('collect');
    expect(target?.radius).toBe(DEFAULT_STREAK_CONFIG.packageRadius);
    expect(target?.x).toBe(4);
    expect(target?.z).toBe(-4);
  });

  it('stops offering itself once it has expired', () => {
    const r = rig([body(OWNER, 'A', 0, 0)]);
    r.land();
    r.pack.phase = 'EXPIRED';
    expect(r.pack.objectiveTarget()).toBe(null);
  });
});

describe('the claim', () => {
  it('takes packageCaptureSeconds of one body standing on it, and credits that body', () => {
    const claimant = body(2, 'B', 4, -4);
    const r = rig([body(OWNER, 'A', 20, 20), claimant]);
    r.land();
    // The fraction is summed one `DT / packageCaptureSeconds` at a time, so 210 of them come to
    // 0.9999999999999976 and the 211th is the one that crosses. Pinned exactly: a refactor that
    // computed the fraction from the age instead would finish a tick early.
    const ticks = Math.ceil(DEFAULT_STREAK_CONFIG.packageCaptureSeconds / DT);
    r.run(ticks);
    expect(r.pack.claimantId).toBe(2);
    expect(r.pack.claimFraction).toBeLessThan(1);
    expect(r.claimed).toEqual([]);
    // The tick the fraction reaches one is the tick the streak reports itself finished.
    expect(r.run(1)).toBe(false);
    expect(r.claimed).toEqual([{ entityId: 2, streakId: r.pack.contents.id }]);
    expect(r.claims).toEqual([0]);
  });

  it('is open to either side: an enemy of the owner can take it', () => {
    const r = rig([body(OWNER, 'A', 20, 20), body(2, 'B', 4, -4)]);
    r.land();
    r.run(Math.ceil(DEFAULT_STREAK_CONFIG.packageCaptureSeconds / DT) + 1);
    expect(r.claimed[0]?.entityId).toBe(2);
  });

  it('resets rather than shares when a second body steps on', () => {
    const contester = body(3, 'B', 20, 20);
    const r = rig([body(2, 'B', 4, -4), contester]);
    r.land();
    r.run(30);
    expect(r.pack.claimFraction).toBeGreaterThan(0);

    contester.px = 4;
    contester.pz = -4;
    r.run(1);
    expect(r.pack.claimFraction).toBe(0);
    expect(r.pack.claimantId).toBe(-1);
    // And it stays at zero for as long as both are on it.
    r.run(60);
    expect(r.pack.claimFraction).toBe(0);
    expect(r.claimed).toEqual([]);
  });

  it('starts the timer again when the claimant changes', () => {
    const first = body(2, 'B', 4, -4);
    const second = body(3, 'B', 20, 20);
    const r = rig([first, second]);
    r.land();
    r.run(30);
    const partial = r.pack.claimFraction;
    expect(partial).toBeGreaterThan(0);

    // The first walks off as the second arrives, so there is still exactly one claimant.
    first.px = 20;
    first.pz = 20;
    second.px = 4;
    second.pz = -4;
    r.run(1);
    expect(r.pack.claimantId).toBe(3);
    expect(r.pack.claimFraction).toBeCloseTo(DT / DEFAULT_STREAK_CONFIG.packageCaptureSeconds, 10);
  });

  it('counts only bodies within packageRadius and on the same floor', () => {
    const near = body(2, 'B', 4 + DEFAULT_STREAK_CONFIG.packageRadius - 0.1, -4);
    const r = rig([near]);
    r.land();
    r.run(5);
    expect(r.pack.claimantId).toBe(2);

    const far = body(2, 'B', 4 + DEFAULT_STREAK_CONFIG.packageRadius + 0.1, -4);
    const outside = rig([far]);
    outside.land();
    outside.run(5);
    expect(outside.pack.claimantId).toBe(-1);

    // Standing on it from two floors up is not standing on it.
    const above = body(2, 'B', 4, -4);
    above.py = 3;
    const high = rig([above]);
    high.land();
    high.run(5);
    expect(high.pack.claimantId).toBe(-1);
  });

  it('ignores a body that is not participating', () => {
    const dead = body(2, 'B', 4, -4);
    dead.participating = false;
    const r = rig([dead]);
    r.land();
    r.run(5);
    expect(r.pack.claimantId).toBe(-1);
  });

  it('expires on its def’s duration if nobody claims it', () => {
    const r = rig([body(OWNER, 'A', 20, 20)]);
    const ticks = Math.round(streakDef('care_package').durationSeconds / DT);
    expect(r.run(ticks)).toBe(true);
    expect(r.run(1)).toBe(false);
  });

  it('reports the fall and then the claim for the debug panel', () => {
    const r = rig([body(2, 'B', 4, -4)]);
    expect(r.pack.describe()).toBe(
      `PACKAGE falling ${DEFAULT_STREAK_CONFIG.packageDropHeight.toFixed(1)}m · ${r.pack.contents.name}`,
    );
    r.land();
    r.run(30);
    expect(r.pack.describe()).toContain(`PACKAGE ${r.pack.contents.name} · #2`);
  });
});
