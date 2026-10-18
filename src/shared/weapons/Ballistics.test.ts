import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { createGameBus, EV } from '../core/Events';
import { DamageSystem, makeDamageRequest, type Damageable } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { materialIndex } from '../world/maps/types';
import { Ballistics, makeShotTrace, type RoundBlocker } from './Ballistics';
import { AR_DEFAULT, requireWeapon } from './WeaponDefs';

/**
 * Hitscan ballistics: the function every round in the game goes through.
 *
 * Three of its rules are the kind that look right in any wrong version, and all three are
 * about what a round does *after* it first touches something:
 *
 *  - **penetration is a budget in metres of concrete equivalent**, spent against each
 *    surface's own density, and what survives is a damage fraction rather than a yes/no;
 *  - **a round passes through a teammate**, which is why the friendly filter is in target
 *    selection and not only at the damage door — stopping harmlessly in one would be a free
 *    body block;
 *  - **the muzzle is the origin of the damage request even after a wall**, because that is
 *    the side of the target the round arrived on, and a shield between the two is in its way.
 *
 * None of those is visible from the outside without geometry, so these build it.
 *
 * A fourth is about *what* a round touches rather than what it does next: **a body can stop a
 * round without taking damage** (`RoundBlocker`, 2026-10-18). That one is a networked client
 * predicting a terminus for somebody else's hit to be announced against, and the way it looks
 * right in a wrong version is by dealing the damage as well.
 */

let fakeNow = 0;
// `DamageSystem.apply` timestamps its hits.
installClock({ nowMs: () => fakeNow++ });

const PLASTER = materialIndex('plaster');
const CONCRETE = materialIndex('concrete');
const METAL = materialIndex('metal');

/** A floor at y = 0, plus whatever the case adds. */
function world(build: (set: ColliderSet) => void = () => {}): CollisionWorld {
  const set = new ColliderSet(8);
  set.add({ x: 0, y: -1, z: 0 }, { x: 200, y: 2, z: 200 }, 0, 0, 0, 'concrete');
  build(set);
  const w = new CollisionWorld(set, { min: { x: -100, y: -8, z: -100 }, max: { x: 100, y: 24, z: 100 } }, 8);
  w.configure(46, 0.005);
  return w;
}

/** A 0.1 m plaster partition at x = 4, and a 1 m concrete wall at x = 20. */
function twoWalls(): CollisionWorld {
  return world((set) => {
    set.add({ x: 4, y: 1.5, z: 0 }, { x: 0.1, y: 3, z: 20 }, 0, 0, 0, 'plaster');
    set.add({ x: 20, y: 1.5, z: 0 }, { x: 1, y: 3, z: 20 }, 0, 0, 0, 'concrete');
  });
}

function dummy(entityId: number, x: number, z: number, team?: 'A' | 'B', decals = false): Damageable {
  const rig = new HitboxRig();
  rig.setTransform(x, 0, z, 0);
  return {
    entityId,
    displayName: `t${entityId}`,
    health: new Health({ ...DEFAULT_HEALTH_CONFIG }),
    rig,
    team,
    decals,
  };
}

/**
 * A drawn body with a rig and no health: what a networked client's remote players are.
 *
 * The same rig and the same side as a `dummy` above, and nothing else — which is the whole
 * claim being tested, that a round can be stopped by something this runtime cannot hurt.
 */
function blocker(
  entityId: number,
  x: number,
  z: number,
  team?: 'A' | 'B',
  stopsRounds = true,
): RoundBlocker {
  const rig = new HitboxRig();
  rig.setTransform(x, 0, z, 0);
  return { entityId, team, rig, stopsRounds };
}

function harness(w: CollisionWorld) {
  const bus = createGameBus();
  const impacts: string[] = [];
  bus.on(EV.BulletImpact, (p) => impacts.push(`${p.material}/${p.penetrated ? 'p' : '-'}`));
  const damage = new DamageSystem(bus);
  const ballistics = new Ballistics(w, damage, bus);
  const trace = makeShotTrace();
  const request = makeDamageRequest(AR_DEFAULT);
  request.sourceId = 1;
  /** Due east from the shooter's eye at x = 0. */
  const fireEast = (def = AR_DEFAULT): void => {
    ballistics.fire(0, 1.5, 0, 1, 0, 0, def, request, trace);
  };
  return { ballistics, damage, trace, request, impacts, fireEast };
}

describe('a fresh shot trace', () => {
  it('starts as a round that has not been fired', () => {
    expect(makeShotTrace()).toEqual({
      distance: 0,
      endX: 0,
      endY: 0,
      endZ: 0,
      hitWorld: false,
      nx: 0,
      ny: 1,
      nz: 0,
      material: 0,
      hitTarget: false,
      targetId: -1,
      zone: 'torso',
      upperTorso: false,
      damage: 0,
      lethal: false,
      hitBlocker: false,
      surfacesPenetrated: 0,
      penetrationRetain: 1,
      penetrationCost: 0,
    });
  });
});

describe('a round with nothing in its way', () => {
  it('is simply gone at the maximum range', () => {
    const h = harness(world());
    h.ballistics.fire(0, 1.5, 0, 0, 1, 0, AR_DEFAULT, h.request, h.trace);
    expect(h.trace.distance).toBe(300);
    expect(h.trace.hitWorld).toBe(false);
    expect(h.trace.hitTarget).toBe(false);
    // The end point is the full range along the ray, which is where the tracer is drawn to.
    expect(h.trace.endY).toBe(301.5);
    expect(h.impacts).toEqual([]);
  });
});

describe('penetration', () => {
  it('crosses a thin partition and stops at a thick wall, reporting what each cost', () => {
    const h = harness(twoWalls());
    h.fireEast();
    // Plaster is 0.74 density over 0.1 m: 0.074 of a 0.28 budget. The concrete behind it is a
    // whole metre at 1.0 and is never affordable, so the round dies on its face.
    expect(h.trace.surfacesPenetrated).toBe(1);
    expect(h.trace.penetrationRetain).toBe(0.7357142817761217);
    expect(h.trace.penetrationCost).toBe(1.074000001102686);
    expect(h.trace.hitWorld).toBe(true);
    expect(h.trace.material).toBe(CONCRETE);
    expect(h.trace.distance).toBe(19.5);
    // One impact per surface, and the flag says whether the round carried on through it.
    expect(h.impacts).toEqual([`${PLASTER}/p`, `${CONCRETE}/-`]);
  });

  it('spends the budget it is given, so a sidearm stops where a rifle does not', () => {
    const pistol = requireWeapon('pistol_talon');
    expect(pistol.penetration).toBe(0.1);
    expect(AR_DEFAULT.penetration).toBe(0.28);
    // Both afford the plaster; neither affords the concrete. The budget is what decides, and
    // the cost is recorded whichever way it goes.
    const h = harness(twoWalls());
    h.fireEast(pistol);
    expect(h.trace.surfacesPenetrated).toBe(1);
    expect(h.trace.penetrationCost).toBe(1.074000001102686);
  });

  it('carries the surviving damage fraction into the body behind the wall', () => {
    const h = harness(twoWalls());
    const target = dummy(7, 8, 0, 'B');
    h.damage.register(dummy(1, 0, 0, 'A'));
    h.damage.register(target);
    h.fireEast();

    expect(h.trace.hitTarget).toBe(true);
    expect(h.trace.targetId).toBe(7);
    expect(h.trace.zone).toBe('head');
    expect(h.trace.surfacesPenetrated).toBe(1);
    expect(h.trace.penetrationRetain).toBe(0.7357142817761217);
    // The damage is the weapon's, scaled by what the plaster took out of it.
    expect(h.trace.damage).toBe(37.52142837058221);
    expect(h.trace.lethal).toBe(false);
    expect(h.trace.distance).toBe(7.9350000000000005);
    // The wall's impact was emitted; the body's was not, because people leave no bullet holes.
    expect(h.impacts).toEqual([`${PLASTER}/p`]);
  });

  it('gives the damage request the muzzle, not the last hole it came through', () => {
    const h = harness(twoWalls());
    h.damage.register(dummy(1, 0, 0, 'A'));
    h.damage.register(dummy(7, 8, 0, 'B'));
    h.fireEast();
    // A round that came through a wall still came from where it was fired, and that is the
    // side of the target it arrived on — which is what a shield is checked against.
    expect([h.request.originX, h.request.originY, h.request.originZ]).toEqual([0, 1.5, 0]);
    expect(h.request.penetrationRetain).toBe(0.7357142817761217);
    expect(h.request.distance).toBe(7.9350000000000005);
  });
});

describe('choosing a target', () => {
  it('stops in the nearest hostile body', () => {
    const h = harness(world());
    h.damage.register(dummy(1, 0, 0, 'A'));
    h.damage.register(dummy(7, 8, 0, 'B'));
    h.damage.register(dummy(11, 6, 0, 'B'));
    h.fireEast();
    expect(h.trace.targetId).toBe(11);
    // Six metres less the rig's own radius. Exactly 5.935 here, where the shot reached the
    // body on its first pass; through the plaster above it is a last-bit longer, because the
    // total is `travelled + t` rather than `t` alone.
    expect(h.trace.distance).toBe(5.935);
  });

  it('passes through a teammate rather than stopping harmlessly in one', () => {
    const h = harness(world());
    h.damage.register(dummy(1, 0, 0, 'A'));
    const mate = dummy(9, 2, 0, 'A');
    h.damage.register(mate);
    h.damage.register(dummy(7, 8, 0, 'B'));
    h.fireEast();
    // The enemy four metres past the teammate is the one that is hit, and the teammate is
    // untouched: a body block would otherwise be free.
    expect(h.trace.targetId).toBe(7);
    expect(h.trace.distance).toBe(7.935);
    expect(mate.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
  });

  it('never tests the shooter, the dead, or a teammate', () => {
    const h = harness(world());
    h.damage.register(dummy(1, 0, 0, 'A'));
    h.damage.register(dummy(9, 2, 0, 'A'));
    const corpse = dummy(10, 3, 0, 'B');
    corpse.health.applyDamage(1000);
    h.damage.register(corpse);
    h.damage.register(dummy(7, 8, 0, 'B'));
    h.fireEast();
    // Four registered, and the rig test only ran against the one that could be hit.
    expect(h.ballistics.lastRigTests).toBe(1);
    expect(h.trace.targetId).toBe(7);
  });

  it('skips nobody when the shooter is on no side', () => {
    // A sentry is on a side; a range dummy never fires. A source with no team filters nothing.
    const h = harness(world());
    h.damage.register(dummy(9, 2, 0, 'A'));
    h.damage.register(dummy(7, 8, 0, 'B'));
    h.fireEast();
    expect(h.trace.targetId).toBe(9);
    expect(h.ballistics.lastRigTests).toBe(2);
  });
});

describe('a body that stops a round without taking damage', () => {
  /** A wall six metres past the bodies below, so "did the round carry on" has an answer. */
  function wall(): CollisionWorld {
    return world((set) => set.add({ x: 11, y: 1.5, z: 0 }, { x: 1, y: 3, z: 20 }, 0, 0, 0, 'concrete'));
  }

  it('ends the round where the body is, and announces nothing at all', () => {
    const h = harness(wall());
    h.damage.register(dummy(1, 0, 0, 'A'));
    h.ballistics.blockers = () => [blocker(4, 5, 0, 'B')];
    h.fireEast();

    // The terminus is the body, five metres out, which is where the tracer now ends.
    expect(h.trace.hitBlocker).toBe(true);
    expect(h.trace.distance).toBe(4.935);
    expect(h.trace.endX).toBe(4.935);
    // Nothing was decided: no hit, no target, no damage. The hitmarker is the server's.
    expect(h.trace.hitTarget).toBe(false);
    expect(h.trace.targetId).toBe(-1);
    expect(h.trace.damage).toBe(0);
    expect(h.trace.lethal).toBe(false);
    expect(h.damage.lastHit.valid).toBe(false);
    expect(h.damage.blockedByInvulnerable).toBe(0);
    // And the bug, in one line: the wall behind the enemy no longer gets the spark, the hole
    // and the click that belonged to the body in front of it.
    expect(h.trace.hitWorld).toBe(false);
    expect(h.impacts).toEqual([]);
  });

  it('is passed through when the simulation would pass through it', () => {
    // A teammate, a dead or dormant body, and the shooter's own: every rule target selection
    // applies, applied here, because a client that stopped a round the server lets past has
    // shown the player a hit that is not coming.
    for (const body of [blocker(4, 5, 0, 'A'), blocker(4, 5, 0, 'B', false), blocker(1, 5, 0, 'B')]) {
      const h = harness(wall());
      h.damage.register(dummy(1, 0, 0, 'A'));
      h.ballistics.blockers = () => [body];
      h.fireEast();
      expect(h.trace.hitBlocker).toBe(false);
      expect(h.trace.hitWorld).toBe(true);
      expect(h.impacts).toEqual([`${CONCRETE}/-`]);
    }
  });

  it('loses to a damageable body in front of it and wins from in front of one', () => {
    // Both scans share one hit record, so which of the two is nearer has to decide — in both
    // directions, and with the record holding the hit that actually stopped the round.
    const near = harness(wall());
    near.damage.register(dummy(1, 0, 0, 'A'));
    near.damage.register(dummy(7, 4, 0, 'B'));
    near.ballistics.blockers = () => [blocker(4, 8, 0, 'B')];
    near.fireEast();
    expect(near.trace.hitTarget).toBe(true);
    expect(near.trace.targetId).toBe(7);
    expect(near.trace.hitBlocker).toBe(false);
    expect(near.trace.damage).toBeGreaterThan(0);
    expect(near.trace.distance).toBe(3.935);

    const far = harness(wall());
    far.damage.register(dummy(1, 0, 0, 'A'));
    const behind = dummy(7, 8, 0, 'B');
    far.damage.register(behind);
    far.ballistics.blockers = () => [blocker(4, 4, 0, 'B')];
    far.fireEast();
    expect(far.trace.hitBlocker).toBe(true);
    expect(far.trace.hitTarget).toBe(false);
    expect(far.trace.distance).toBe(3.935);
    // The body behind the blocker was tested and then spared, which is the half that matters:
    // the round stopped short of it.
    expect(behind.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
  });

  it('is nobody unless somebody is set, so every other runtime is untouched', () => {
    // The server, both killstreaks and single-player never set the list. The default is the
    // only thing keeping this change out of their shot path.
    const h = harness(wall());
    h.damage.register(dummy(1, 0, 0, 'A'));
    h.fireEast();
    expect(h.trace.hitBlocker).toBe(false);
    expect(h.trace.hitWorld).toBe(true);
    expect(h.ballistics.lastRigTests).toBe(0);
  });
});

describe('a target board', () => {
  it('takes a bullet hole, as metal, because that is what the range boards are', () => {
    const h = harness(world());
    h.damage.register(dummy(3, 5, 0, undefined, true));
    h.fireEast();
    expect(h.trace.hitTarget).toBe(true);
    expect(h.trace.targetId).toBe(3);
    // An ordinary `bullet.impact`, so the decal, the debris and the click all come from the
    // code that already handles every other surface in the game.
    expect(h.impacts).toEqual([`${METAL}/-`]);
  });

  it('leaves no hole when the rig does not ask for one', () => {
    const h = harness(world());
    h.damage.register(dummy(3, 5, 0, 'B'));
    h.fireEast();
    expect(h.trace.hitTarget).toBe(true);
    expect(h.impacts).toEqual([]);
  });
});

describe('the trace record', () => {
  it('is reset by every shot, so no field survives from the last one', () => {
    const h = harness(twoWalls());
    h.damage.register(dummy(7, 8, 0, 'B'));
    h.fireEast();
    expect(h.trace.hitTarget).toBe(true);
    expect(h.trace.surfacesPenetrated).toBe(1);

    // Straight up, into nothing: every field from the hit above has to be gone.
    h.ballistics.fire(0, 1.5, 0, 0, 1, 0, AR_DEFAULT, h.request, h.trace);
    expect(h.trace.hitTarget).toBe(false);
    expect(h.trace.targetId).toBe(-1);
    expect(h.trace.zone).toBe('torso');
    expect(h.trace.damage).toBe(0);
    expect(h.trace.lethal).toBe(false);
    expect(h.trace.hitWorld).toBe(false);
    expect(h.trace.hitBlocker).toBe(false);
    expect(h.trace.surfacesPenetrated).toBe(0);
    expect(h.trace.penetrationRetain).toBe(1);
    expect(h.trace.penetrationCost).toBe(0);
  });
});
