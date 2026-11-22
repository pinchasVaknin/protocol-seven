import { describe, expect, it } from 'vitest';
import { beginSlab, makeSlabHit, narrowSlab } from './RaySlab';

/**
 * The ray-slab test the world's colliders and a body's hitboxes now share (BACKLOG #12).
 *
 * Both callers have their own suites over it — `Geometry.test.ts` and `HitboxRig.test.ts`, the
 * latter pinning hits per zone, the nearest-box choice, normals under yaw, a ray starting inside
 * a box and the parallel-axis case — so what is here is the test itself rather than either
 * caller's use of it: the three slabs narrowing, the face it remembers, and the one input the
 * two copies used to disagree about.
 */

/** A unit box at the origin, from a ray's point of view. */
function through(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT = 100,
): { hit: boolean; min: number; axis: number; sign: number } {
  const out = makeSlabHit();
  beginSlab(out, maxT);
  const hit =
    narrowSlab(out, ox, dx, 1, 0) && narrowSlab(out, oy, dy, 1, 1) && narrowSlab(out, oz, dz, 1, 2);
  return { hit, min: out.min, axis: out.axis, sign: out.sign };
}

describe('beginSlab', () => {
  it('opens at the origin, not behind it', () => {
    // `min = 0` is what makes a ray that began inside the box land at zero rather than behind
    // itself, which is the property `ai/PlayerCombatant` relies on.
    const out = makeSlabHit();
    beginSlab(out, 42);
    expect(out).toEqual({ min: 0, max: 42, axis: 0, sign: 0 });
  });

  it('clears the face a previous test left behind', () => {
    const out = makeSlabHit();
    beginSlab(out, 10);
    narrowSlab(out, -5, 1, 1, 2);
    expect([out.axis, out.sign]).toEqual([2, -1]);
    beginSlab(out, 10);
    expect([out.axis, out.sign]).toEqual([0, 0]);
  });
});

describe('narrowSlab', () => {
  it('finds the near face of a box straight ahead, and names it', () => {
    const r = through(0, 0, -5, 0, 0, 1);
    expect(r.hit).toBe(true);
    expect(r.min).toBeCloseTo(4, 12);
    // Entered through the low Z face, so the axis is Z and the face is the negative one.
    expect([r.axis, r.sign]).toEqual([2, -1]);
  });

  it('names the high face when the ray comes the other way', () => {
    const r = through(0, 0, 5, 0, 0, -1);
    expect(r.min).toBeCloseTo(4, 12);
    expect([r.axis, r.sign]).toEqual([2, 1]);
  });

  it('leaves the face unset for a ray that began inside', () => {
    // Nothing narrowed past 0, so no slab claimed the near intersection.
    const r = through(0, 0, 0, 0, 0, 1);
    expect(r.hit).toBe(true);
    expect([r.min, r.sign]).toEqual([0, 0]);
  });

  it('misses a box the ray passes beside', () => {
    expect(through(5, 0, -5, 0, 0, 1).hit).toBe(false);
  });

  it('misses a box behind the far end of maxT', () => {
    expect(through(0, 0, -50, 0, 0, 1, 10).hit).toBe(false);
  });

  it('takes a parallel ray that is inside the slab and rejects one that is not', () => {
    // `d` under EPS on an axis: the ray never crosses that slab, so the only question is
    // whether it started between its faces.
    expect(through(0.5, 0, -5, 0, 0, 1).hit).toBe(true);
    expect(through(1.5, 0, -5, 0, 0, 1).hit).toBe(false);
    // Exactly on the face counts as inside, which is what `>=` and `<=` are for.
    expect(through(1, 0, -5, 0, 0, 1).hit).toBe(true);
    expect(through(-1, 0, -5, 0, 0, 1).hit).toBe(true);
  });

  /**
   * The one input the world's copy and the rig's used to answer differently (BACKLOG #12).
   *
   * The world's wrote the parallel in-range test as `o >= -h && o <= h` and the rig's as
   * `!(o < -h || o > h)`. Every comparison against NaN is false, so the first **rejects** a NaN
   * coordinate and the second's negated form **accepts** it and goes on to report a hit at a
   * NaN distance.
   *
   * The rejecting form is what this file kept. NaN was measured rather than argued about: a
   * guard that threw on a NaN `o`, `d` or `h` was put inside both copies and the project run —
   * 7,190 tests over 316 files, the 3,600-tick determinism scenario, the content, progression,
   * readability, intro and event-decode probes, and five seeded bot matches. It never tripped.
   * So this case does not pin behaviour anything depends on; it pins which of the two forms is
   * here, so that a future rewrite cannot quietly swap it back.
   */
  it('rejects a NaN coordinate rather than reporting a hit at a NaN distance', () => {
    const out = makeSlabHit();
    beginSlab(out, 100);
    expect(narrowSlab(out, NaN, 0, 1, 0)).toBe(false);
    // And the negated spelling the rig's copy had would have answered the other way.
    const o = NaN;
    const h = 1;
    expect(!(o < -h || o > h)).toBe(true);
    expect(o >= -h && o <= h).toBe(false);
  });

  it('is the near face across all three axes, whichever is nearest', () => {
    // A diagonal ray from outside a corner: X is crossed last, so X owns the entry.
    const r = through(-3, -2, -2, 1, 1, 1);
    expect(r.hit).toBe(true);
    expect(r.min).toBeCloseTo(2, 12);
    expect([r.axis, r.sign]).toEqual([0, -1]);
  });
});
