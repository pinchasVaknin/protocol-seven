import { describe, expect, it } from 'vitest';
import { ColliderSet } from './ColliderSet';
import { CollisionWorld, makeGroundProbe, makeMoveOutput, type MoveOutput } from './CollisionWorld';
import { makeRayHit } from './Geometry';

/**
 * Capsule movement against the static world.
 *
 * This is what the player and every bot move through, so the properties below are the ones the
 * movement system is written on top of and never re-checks: a capsule pushed into a wall ends up
 * outside it, a capsule standing on a floor is told it is grounded and given the floor normal,
 * and a move that would pass through a thin wall in one tick does not.
 *
 * That last one is the reason `MAX_SUBSTEPS` exists. A 0.5 m wall and a capsule travelling 2 m in
 * a tick is tunnelling unless the move is split, and tunnelling is the failure that looks like a
 * cheat rather than like a bug.
 */

const FLOOR = { x: 40, y: 1, z: 40 };
const BOUNDS = { min: { x: -20, y: -8, z: -20 }, max: { x: 20, y: 12, z: 20 } };

/** A floor whose top face is y = 0, plus whatever else the test asks for. */
function world(...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>) {
  const set = new ColliderSet(boxes.length + 2);
  set.add({ x: 0, y: -0.5, z: 0 }, FLOOR, 0, 0, 0, 'floor');
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  return new CollisionWorld(set, BOUNDS, 4);
}

const RADIUS = 0.35;
const HEIGHT = 1.8;

function move(
  cw: CollisionWorld,
  from: readonly number[],
  delta: readonly number[],
): MoveOutput {
  const out = makeMoveOutput();
  cw.moveCapsule(from[0]!, from[1]!, from[2]!, delta[0]!, delta[1]!, delta[2]!, RADIUS, HEIGHT, out);
  return out;
}

describe('makeMoveOutput and makeGroundProbe', () => {
  it('start with no contacts and no ground', () => {
    const out = makeMoveOutput();

    expect(out.contactCount).toBe(0);
    expect(out.grounded).toBe(false);
    expect(out.groundIndex).toBe(-1);
    expect(out.hitCeiling).toBe(false);
  });

  it('give the ground probe an upward normal, so an unset probe is not a cliff', () => {
    expect(makeGroundProbe()).toEqual({ distance: 0, nx: 0, ny: 1, nz: 0, index: -1 });
  });
});

describe('moveCapsule across open floor', () => {
  it('goes where it was asked to go', () => {
    const out = move(world(), [0, 0, 0], [2, 0, 0]);

    expect(out.x).toBeCloseTo(2, 6);
    expect(out.z).toBeCloseTo(0, 6);
    expect(out.hitWall).toBe(false);
  });

  it('is told it is grounded once it rests into the floor, with the floor normal', () => {
    // A capsule whose lowest sphere is exactly tangent to the surface is not *overlapping* it,
    // so it reports no contact and no ground. Movement keeps a hair of penetration, which is
    // what this starting height stands in for; `probeGround` is the other half of the answer.
    const out = move(world(), [0, -0.02, 0], [1, 0, 0]);

    expect(out.grounded).toBe(true);
    expect(out.groundNy).toBeCloseTo(1, 6);
    expect(out.groundIndex).toBe(0);
  });

  it('reports no ground for a capsule exactly tangent to the surface', () => {
    const out = move(world(), [0, 0, 0], [1, 0, 0]);

    expect(out.grounded).toBe(false);
  });

  it('does not sink into the floor it is standing on', () => {
    const out = move(world(), [0, 0, 0], [1, 0, 0]);

    expect(out.y).toBeGreaterThanOrEqual(-1e-3);
  });
});

describe('moveCapsule into a wall', () => {
  /** A 1 m thick wall standing at x = 4. */
  function walled() {
    return world([4, 1.5, 0, 1, 3, 10]);
  }

  it('stops at the wall rather than passing through it', () => {
    const out = move(walled(), [0, 0, 0], [8, 0, 0]);

    expect(out.x).toBeLessThan(3.5);
    expect(out.hitWall).toBe(true);
  });

  it('ends up outside the wall, by at least the capsule radius', () => {
    const out = move(walled(), [0, 0, 0], [8, 0, 0]);

    // The wall's near face is at x = 3.5; the capsule centre must stay a radius clear of it.
    expect(out.x).toBeLessThanOrEqual(3.5 - RADIUS + 1e-3);
  });

  it('reports a contact with an outward normal', () => {
    const out = move(walled(), [0, 0, 0], [8, 0, 0]);

    expect(out.contactCount).toBeGreaterThan(0);
    expect(out.normals[0]).toBeCloseTo(-1, 3);
  });

  it('slides along the wall rather than stopping dead', () => {
    const out = move(walled(), [3, 0, 0], [2, 0, 2]);

    expect(out.z).toBeGreaterThan(1);
    expect(out.hitWall).toBe(true);
  });

  it('does not tunnel through a thin wall within the substep envelope', () => {
    // Substeps are `radius * SUBSTEP_FRACTION` = 0.14 m, capped at MAX_SUBSTEPS = 16, so the
    // envelope is about 2.24 m of travel per call. Gameplay moves about 0.12 m a tick.
    const thin = world([4, 1.5, 0, 0.3, 3, 10]);
    const out = move(thin, [2, -0.02, 0], [2, 0, 0]);

    expect(out.x).toBeLessThan(4);
    expect(out.hitWall).toBe(true);
  });

  it('does tunnel past that envelope, which is what the substep cap costs', () => {
    // Pins current behaviour. A 12 m displacement in one call is sixteen 0.75 m substeps, each
    // longer than the wall is thick, so nothing is ever found overlapping. This is the designed
    // limit of MAX_SUBSTEPS rather than a defect in the resolver: no gameplay path asks for it.
    const thin = world([4, 1.5, 0, 0.3, 3, 10]);
    const out = move(thin, [0, -0.02, 0], [12, 0, 0]);

    expect(out.x).toBeGreaterThan(4);
  });

  it('leaves a move that touches nothing unobstructed', () => {
    const out = move(walled(), [0, 0, 0], [1, 0, 0]);

    expect(out.x).toBeCloseTo(1, 6);
    expect(out.hitWall).toBe(false);
  });
});

describe('overlapCapsule', () => {
  it('is false in open space and true inside a solid', () => {
    const cw = world([4, 1.5, 0, 1, 3, 10]);

    expect(cw.overlapCapsule(0, 0, 0, RADIUS, HEIGHT)).toBe(false);
    expect(cw.overlapCapsule(4, 0.5, 0, RADIUS, HEIGHT)).toBe(true);
  });

  it('is true when only the radius reaches in', () => {
    const cw = world([4, 1.5, 0, 1, 3, 10]);

    expect(cw.overlapCapsule(3.3, 0.5, 0, RADIUS, HEIGHT)).toBe(true);
    expect(cw.overlapCapsule(3.0, 0.5, 0, RADIUS, HEIGHT)).toBe(false);
  });
});

describe('probeGround', () => {
  it('finds the floor below a capsule in the air and says how far it must drop', () => {
    const out = makeGroundProbe();
    const found = world().probeGround(0, 1, 0, RADIUS, HEIGHT, 2, out);

    expect(found).toBe(true);
    expect(out.distance).toBeCloseTo(1, 1);
    expect(out.ny).toBeCloseTo(1, 6);
    expect(out.index).toBe(0);
  });

  it('finds nothing when the floor is further than the drop allowed', () => {
    const out = makeGroundProbe();

    expect(world().probeGround(0, 10, 0, RADIUS, HEIGHT, 1, out)).toBe(false);
  });

  it('reports no drop for a capsule already resting on the floor', () => {
    const out = makeGroundProbe();
    world().probeGround(0, 0, 0, RADIUS, HEIGHT, 2, out);

    expect(out.distance).toBeCloseTo(0, 2);
  });
});

describe('raycast and segmentClear', () => {
  it('raycast finds the wall and names the collider', () => {
    const cw = world([4, 1.5, 0, 1, 3, 10]);
    const out = makeRayHit();

    expect(cw.raycast(0, 1, 0, 1, 0, 0, 20, out)).toBe(true);
    expect(out.t).toBeCloseTo(3.5, 6);
  });

  it('raycast misses over the top of the wall', () => {
    const cw = world([4, 1.5, 0, 1, 3, 10]);
    const out = makeRayHit();

    expect(cw.raycast(0, 5, 0, 1, 0, 0, 20, out)).toBe(false);
  });

  it('segmentClear is true across open floor and false through a wall', () => {
    const cw = world([4, 1.5, 0, 1, 3, 10]);
    const out = makeRayHit();

    expect(cw.segmentClear(0, 1, 0, 2, 1, 0, out)).toBe(true);
    expect(cw.segmentClear(0, 1, 0, 8, 1, 0, out)).toBe(false);
  });
});

describe('sharing', () => {
  it('reuses a baked collider set and grid rather than rebuilding them', () => {
    const first = world([4, 1.5, 0, 1, 3, 10]);
    const second = CollisionWorld.sharing(first.colliders, first.hash);

    expect(second.colliders).toBe(first.colliders);
    expect(second.hash).toBe(first.hash);
    expect(second.overlapCapsule(4, 0.5, 0, RADIUS, HEIGHT)).toBe(true);
  });
});
