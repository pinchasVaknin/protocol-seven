import { describe, expect, it } from 'vitest';
import { ColliderSet } from './ColliderSet';
import {
  capsuleBoxPenetration,
  type Contact,
  makeContact,
  makeRayHit,
  type RayHit,
  rayBox,
  rayBoxExit,
} from './Geometry';

/**
 * The two collision primitives, and the one that measures wall thickness.
 *
 * These are the determinism core. `rayBox` runs per collider per shot and per bot sight check;
 * `capsuleBoxPenetration` runs per collider per entity per tick. Their outputs feed the
 * 3600-tick state hashes directly, which is why this file pins numbers with `toBe` wherever the
 * value is exactly representable, and why the refactor that splits them is allowed to change
 * nothing but where the lines sit.
 *
 * Both work by rigid-transforming the query into the box's local space. So every assertion below
 * is made twice where it matters: once against an axis-aligned box, which takes the fast path
 * that skips the transform, and once against a yawed box, which does not. A refactor that broke
 * only one of the two paths is exactly the failure a single-box test would miss.
 *
 * The yawed numbers carry Float32 precision — 0.70710676, not 0.70710678 — because the basis is
 * stored in a `Float32Array`. Pinned as stored, not as the real quarter turn would be.
 */

/** 0: unit-ish box at the origin. 1: the same box yawed 45 degrees. 2: a 0.5 m wall at x = 5. */
function world(): ColliderSet {
  const set = new ColliderSet(4);
  set.add({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, 0, 0, 0, 'concrete');
  set.add({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, Math.PI / 4, 0, 0, 'concrete');
  set.add({ x: 5, y: 0, z: 0 }, { x: 0.5, y: 4, z: 4 }, 0, 0, 0, 'metal');
  return set;
}

const SET = world();

function cast(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT = 100): RayHit | null {
  const out = makeRayHit();
  return rayBox(SET, i, ox, oy, oz, dx, dy, dz, maxT, out) ? out : null;
}

function touch(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): Contact | null {
  const out = makeContact();
  return capsuleBoxPenetration(SET, i, ax, ay, az, bx, by, bz, r, out) ? out : null;
}

describe('makeRayHit and makeContact', () => {
  it('start with an index of -1, which is how a caller tells "nothing yet" from collider 0', () => {
    expect(makeRayHit()).toEqual({ t: 0, nx: 0, ny: 0, nz: 0, index: -1 });
    expect(makeContact()).toEqual({ depth: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0, index: -1 });
  });

  it('return a fresh record each time, since callers keep one per query', () => {
    expect(makeRayHit()).not.toBe(makeRayHit());
  });
});

describe('rayBox against an axis-aligned box', () => {
  it('reports the near face distance and an outward normal', () => {
    const hit = cast(0, -10, 0, 0, 1, 0, 0);

    expect(hit?.t).toBe(9);
    expect([hit?.nx, hit?.ny, hit?.nz]).toEqual([-1, 0, 0]);
    expect(hit?.index).toBe(0);
  });

  it('flips the normal when the ray comes from the other side', () => {
    expect([cast(0, 10, 0, 0, -1, 0, 0)?.nx]).toEqual([1]);
    expect([cast(0, 0, 10, 0, 0, -1, 0)?.ny]).toEqual([1]);
    expect([cast(0, 0, -10, 0, 0, 1, 0)?.ny]).toEqual([-1]);
  });

  it('misses a box the ray passes beside', () => {
    expect(cast(0, -10, 5, 0, 1, 0, 0)).toBeNull();
  });

  it('misses when the ray runs parallel to every slab it is outside of', () => {
    expect(cast(0, -10, 0, 0, 0, 1, 0)).toBeNull();
  });

  it('refuses a hit past maxT rather than reporting it', () => {
    expect(cast(0, -10, 0, 0, 1, 0, 0, 5)).toBeNull();
    expect(cast(0, -10, 0, 0, 1, 0, 0, 9.5)?.t).toBe(9);
  });

  it('reports t = 0 and a normal facing the ray source when the origin is already inside', () => {
    const hit = cast(0, 0, 0, 0, 1, 0, 0);

    expect(hit?.t).toBe(0);
    // The inside case has no entry face, so the normal is the reversed direction — and the two
    // zero components come out negative, because negating a zero keeps its sign.
    expect([hit?.nx, hit?.ny, hit?.nz]).toEqual([-1, -0, -0]);
  });
});

describe('rayBox against a yawed box', () => {
  it('takes the near face of the rotated solid, not of its AABB', () => {
    const hit = cast(1, -10, 0, 0, 1, 0, 0);

    // The 45-degree box presents a corner at x = -sqrt(2), so the hit is at 10 - 1.4142.
    expect(hit?.t).toBe(8.585786413423671);
    expect(hit?.index).toBe(1);
  });

  it('rotates the face normal back into world space', () => {
    const hit = cast(1, -10, 0, 0, 1, 0, 0);

    expect(hit?.nx).toBe(-0.7071067690849304);
    expect(hit?.ny).toBe(0);
    expect(hit?.nz).toBe(0.7071067690849304);
  });

  it('gives a unit normal', () => {
    const hit = cast(1, -10, 0, 0, 1, 0, 0);
    const len = Math.hypot(hit?.nx ?? 0, hit?.ny ?? 0, hit?.nz ?? 0);

    expect(len).toBeCloseTo(1, 6);
  });

  it('is nearer than the axis-aligned box it was rotated from, from this direction', () => {
    expect((cast(1, -10, 0, 0, 1, 0, 0)?.t ?? 0)).toBeLessThan(cast(0, -10, 0, 0, 1, 0, 0)?.t ?? 0);
  });
});

describe('rayBoxExit', () => {
  it('is the far face, so exit minus entry is the thickness the round pushes through', () => {
    const entry = cast(2, 0, 0, 0, 1, 0, 0);
    const exit = rayBoxExit(SET, 2, 0, 0, 0, 1, 0, 0);

    expect(entry?.t).toBe(4.75);
    expect(exit).toBe(5.25);
    // The wall is 0.5 m thick, which is exactly what S6.4 measures penetration against.
    expect(exit - (entry?.t ?? 0)).toBeCloseTo(0.5, 12);
  });

  it('measures the full width of a box entered head on', () => {
    expect(rayBoxExit(SET, 0, -10, 0, 0, 1, 0, 0)).toBe(11);
  });

  it('returns -1 for a ray that never enters', () => {
    expect(rayBoxExit(SET, 0, -10, 5, 0, 1, 0, 0)).toBe(-1);
  });

  it('works through the rotated basis too', () => {
    expect(rayBoxExit(SET, 1, -10, 0, 0, 1, 0, 0)).toBe(11.414213586576329);
  });

  it('is always past the entry distance for a ray that hits', () => {
    for (const i of [0, 1, 2]) {
      const entry = cast(i, -20, 0, 0, 1, 0, 0);
      const exit = rayBoxExit(SET, i, -20, 0, 0, 1, 0, 0);
      expect(exit).toBeGreaterThan(entry?.t ?? 0);
    }
  });
});

describe('capsuleBoxPenetration against an axis-aligned box', () => {
  it('reports nothing for a capsule well clear of the box', () => {
    expect(touch(0, 5, 0, 0, 5, 2, 0, 0.35)).toBeNull();
  });

  it('reports nothing for a capsule exactly touching, since the test is strict', () => {
    // Surface at x = 1, radius 0.35: a capsule axis at 1.35 is tangent and does not overlap.
    expect(touch(0, 1.35, 0, 0, 1.35, 1, 0, 0.35)).toBeNull();
  });

  it('reports the overlap depth and an outward normal when it does overlap', () => {
    const hit = touch(0, 1.2, 0, 0, 1.2, 1, 0, 0.35);

    expect(hit?.depth).toBe(0.15000000000000002);
    expect([hit?.nx, hit?.ny, hit?.nz]).toEqual([1, 0, 0]);
    expect([hit?.px, hit?.py, hit?.pz]).toEqual([1, 0, 0]);
    expect(hit?.index).toBe(0);
  });

  it('finds the top face for a capsule standing on the box', () => {
    const hit = touch(0, 0, 1.2, 0, 0, 2.2, 0, 0.35);

    expect(hit?.depth).toBe(0.15000000000000002);
    expect([hit?.nx, hit?.ny, hit?.nz]).toEqual([0, 1, 0]);
    expect(hit?.py).toBe(1);
  });

  it('escapes along the shallowest face when the capsule axis is inside the box', () => {
    const hit = touch(0, 0, 0, 0, 0, 0.5, 0, 0.35);

    // Dead centre: every face is equally shallow and the X face wins the tie.
    expect([hit?.nx, hit?.ny, hit?.nz]).toEqual([1, 0, 0]);
    expect(hit?.depth).toBe(1.35);
  });

  it('picks the nearest face when the inside point is off centre', () => {
    const hit = touch(0, 0.8, 0, 0, 0.8, 0.2, 0, 0.35);

    expect([hit?.nx, hit?.ny, hit?.nz]).toEqual([1, 0, 0]);
    expect(hit?.depth).toBe(0.5499999999999999);
    expect(hit?.px).toBe(1);
  });

  it('handles a degenerate capsule whose endpoints coincide', () => {
    const hit = touch(0, 1.2, 0, 0, 1.2, 0, 0, 0.35);

    expect(hit?.depth).toBe(0.15000000000000002);
    expect([hit?.nx, hit?.ny, hit?.nz]).toEqual([1, 0, 0]);
  });

  it('gives a unit normal and a positive depth for every overlap it reports', () => {
    for (const x of [0, 0.4, 0.8, 1.0, 1.2, 1.3]) {
      const hit = touch(0, x, 0, 0, x, 1, 0, 0.35);
      if (hit === null) continue;
      expect(Math.hypot(hit.nx, hit.ny, hit.nz)).toBeCloseTo(1, 6);
      expect(hit.depth).toBeGreaterThan(0);
    }
  });

  it('rejects by the grown local AABB before doing any closest-point work', () => {
    // Far outside on each axis in turn.
    expect(touch(0, 0, 0, 9, 0, 1, 9, 0.35)).toBeNull();
    expect(touch(0, 0, 9, 0, 0, 10, 0, 0.35)).toBeNull();
    expect(touch(0, 9, 0, 0, 9, 1, 0, 0.35)).toBeNull();
  });
});

describe('capsuleBoxPenetration against a yawed box', () => {
  it('measures against the rotated solid and returns a world-space contact', () => {
    const hit = touch(1, 1.5, 0, 0, 1.5, 1, 0, 0.35);

    expect(hit?.depth).toBe(0.26421358804450157);
    expect(hit?.px).toBe(1.4142135381698608);
    expect(hit?.py).toBe(0);
  });

  it('gives a unit normal through the rotated basis', () => {
    const hit = touch(1, 1.5, 0, 0, 1.5, 1, 0, 0.35);

    expect(Math.hypot(hit?.nx ?? 0, hit?.ny ?? 0, hit?.nz ?? 0)).toBeCloseTo(1, 6);
    expect(hit?.nx).toBeCloseTo(1, 6);
  });

  it('reaches further out than the box it was rotated from, because the corner does', () => {
    // The aligned box presents a face at x = 1; the 45-degree box presents a corner at
    // sqrt(2) = 1.4142. So between them there is a band where only the rotated one overlaps.
    expect(touch(0, 1.2, 0, 0, 1.2, 1, 0, 0.35)).not.toBeNull();
    expect(touch(1, 1.2, 0, 0, 1.2, 1, 0, 0.35)).not.toBeNull();

    expect(touch(0, 1.5, 0, 0, 1.5, 1, 0, 0.35)).toBeNull();
    expect(touch(1, 1.5, 0, 0, 1.5, 1, 0, 0.35)).not.toBeNull();

    // And past the corner plus the radius, neither of them does.
    expect(touch(1, 1.9, 0, 0, 1.9, 1, 0, 0.35)).toBeNull();
  });
});

describe('both primitives write into the record they are given', () => {
  it('rayBox fills the caller record and leaves it alone on a miss', () => {
    const out = makeRayHit();
    rayBox(SET, 0, -10, 0, 0, 1, 0, 0, 100, out);
    expect(out.index).toBe(0);

    const before = { ...out };
    expect(rayBox(SET, 0, -10, 5, 0, 1, 0, 0, 100, out)).toBe(false);
    expect(out).toEqual(before);
  });

  it('capsuleBoxPenetration fills the caller record and leaves it alone on a miss', () => {
    const out = makeContact();
    capsuleBoxPenetration(SET, 0, 1.2, 0, 0, 1.2, 1, 0, 0.35, out);
    expect(out.index).toBe(0);

    const before = { ...out };
    expect(capsuleBoxPenetration(SET, 0, 9, 0, 0, 9, 1, 0, 0.35, out)).toBe(false);
    expect(out).toEqual(before);
  });
});
