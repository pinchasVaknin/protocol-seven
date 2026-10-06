import { describe, expect, it } from 'vitest';
import { ColliderSet } from './ColliderSet';
import { makeRayHit, type RayHit } from './Geometry';
import { Raycaster } from './Raycaster';
import { SpatialHash } from './SpatialHash';

/**
 * The grid-walking raycaster.
 *
 * `cast` is a DDA walk: it steps cell by cell along the ray and narrowphases what each cell
 * holds. The property that makes it correct rather than merely fast is the early return — a hit
 * inside the current cell is final, because no later cell can be nearer. So the test that
 * matters most is **two boxes in line**: the near one must win from either direction, which it
 * only does if the walk order and that early return are both right.
 *
 * The other half is the grid entry. A ray that starts outside the grid has to be advanced to it
 * before the walk can begin, and a ray that never enters has to be refused. `gridEntryT` is
 * private, so both are exercised through `cast` from outside the bounds — which is also the only
 * way a caller can reach them.
 */

const BOUNDS = { min: { x: -16, y: -8, z: -16 }, max: { x: 16, y: 8, z: 16 } };

function scene(...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>) {
  const set = new ColliderSet(boxes.length + 1);
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  const hash = new SpatialHash(4);
  hash.build(set, BOUNDS);
  return new Raycaster(set, hash);
}

function cast(
  caster: Raycaster,
  o: readonly number[],
  d: readonly number[],
  maxDist = 100,
): RayHit | null {
  const out = makeRayHit();
  return caster.cast(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, maxDist, out) ? out : null;
}

describe('cast from inside the grid', () => {
  it('hits a box ahead and reports the collider it hit', () => {
    const caster = scene([4, 0, 0, 2, 2, 2]);

    const hit = cast(caster, [-4, 0, 0], [1, 0, 0]);
    expect(hit?.index).toBe(0);
    expect(hit?.t).toBe(7);
  });

  it('misses when there is nothing along the ray', () => {
    const caster = scene([4, 6, 0, 2, 2, 2]);

    expect(cast(caster, [-4, 0, 0], [1, 0, 0])).toBeNull();
  });

  it('takes the nearer of two boxes in line, from either direction', () => {
    const caster = scene([4, 0, 0, 2, 2, 2], [10, 0, 0, 2, 2, 2]);

    expect(cast(caster, [-8, 0, 0], [1, 0, 0])?.index).toBe(0);
    expect(cast(caster, [14, 0, 0], [-1, 0, 0])?.index).toBe(1);
  });

  it('takes the nearer box even when the far one is listed first', () => {
    const caster = scene([10, 0, 0, 2, 2, 2], [4, 0, 0, 2, 2, 2]);

    expect(cast(caster, [-8, 0, 0], [1, 0, 0])?.index).toBe(1);
  });

  it('refuses a hit past maxDist', () => {
    const caster = scene([10, 0, 0, 2, 2, 2]);

    expect(cast(caster, [0, 0, 0], [1, 0, 0], 5)).toBeNull();
    expect(cast(caster, [0, 0, 0], [1, 0, 0], 20)?.index).toBe(0);
  });

  it('walks diagonally across cells without missing a box on the way', () => {
    const caster = scene([6, 0, 6, 2, 2, 2]);
    const inv = 1 / Math.SQRT2;

    expect(cast(caster, [-6, 0, -6], [inv, 0, inv])?.index).toBe(0);
  });

  it('walks along Y as well as the horizontal axes', () => {
    const caster = scene([0, 5, 0, 2, 2, 2]);

    expect(cast(caster, [0, -5, 0], [0, 1, 0])?.index).toBe(0);
  });

  it('counts a narrowphase test per collider it actually examines', () => {
    const caster = scene([4, 0, 0, 2, 2, 2]);
    caster.tests = 0;

    cast(caster, [-4, 0, 0], [1, 0, 0]);
    expect(caster.tests).toBeGreaterThan(0);
  });

  it('tests a collider straddling several cells only once', () => {
    // A 10 m slab is registered in sixteen cells; the walk must not narrowphase it sixteen times.
    const caster = scene([0, 0, 0, 10, 1, 10]);
    caster.tests = 0;

    cast(caster, [-14, 0, 0], [1, 0, 0]);
    expect(caster.tests).toBe(1);
  });
});

describe('cast from outside the grid', () => {
  it('advances to the grid and then finds the box inside it', () => {
    const caster = scene([0, 0, 0, 2, 2, 2]);

    const hit = cast(caster, [-100, 0, 0], [1, 0, 0], 200);
    expect(hit?.index).toBe(0);
    expect(hit?.t).toBeCloseTo(99, 6);
  });

  it('refuses a ray that never enters the grid', () => {
    const caster = scene([0, 0, 0, 2, 2, 2]);

    expect(cast(caster, [-100, 500, 0], [1, 0, 0], 1000)).toBeNull();
  });

  it('refuses a ray pointing away from the grid', () => {
    const caster = scene([0, 0, 0, 2, 2, 2]);

    expect(cast(caster, [-100, 0, 0], [-1, 0, 0], 1000)).toBeNull();
  });

  it('refuses when the grid is further away than maxDist', () => {
    const caster = scene([0, 0, 0, 2, 2, 2]);

    expect(cast(caster, [-100, 0, 0], [1, 0, 0], 50)).toBeNull();
  });

  it('enters correctly on a diagonal approach', () => {
    const caster = scene([0, 0, 0, 2, 2, 2]);
    const inv = 1 / Math.SQRT2;

    expect(cast(caster, [-60, 0, -60], [inv, 0, inv], 200)?.index).toBe(0);
  });
});

describe('an empty world', () => {
  it('hits nothing, from inside or outside', () => {
    const caster = scene();

    expect(cast(caster, [0, 0, 0], [1, 0, 0])).toBeNull();
    expect(cast(caster, [-100, 0, 0], [1, 0, 0], 200)).toBeNull();
  });
});

describe('the output record', () => {
  it('is left untouched on a miss', () => {
    const caster = scene([4, 6, 0, 2, 2, 2]);
    const out = makeRayHit();
    const before = { ...out };

    expect(caster.cast(-4, 0, 0, 1, 0, 0, 100, out)).toBe(false);
    expect(out).toEqual(before);
  });

  it('carries a unit normal on a hit', () => {
    const caster = scene([4, 0, 0, 2, 2, 2]);
    const hit = cast(caster, [-4, 0, 0], [1, 0, 0]);

    expect(Math.hypot(hit?.nx ?? 0, hit?.ny ?? 0, hit?.nz ?? 0)).toBeCloseTo(1, 6);
    expect(hit?.nx).toBe(-1);
  });
});
