import { describe, expect, it } from 'vitest';
import { ColliderSet } from './ColliderSet';
import { SpatialHash } from './SpatialHash';

/**
 * The broadphase grid.
 *
 * Two properties carry everything above this file. A collider that straddles several cells must
 * be registered in **all** of them, or a capsule standing in one of those cells never learns it
 * is there — a hole in the world rather than a performance problem. And having been registered
 * several times, it must come back from a query **once**, which is what `claim` is for: the
 * narrowphase is the expensive part and testing the same box three times is three times the
 * cost for one answer.
 *
 * `beginQuery()` is what arms `claim` for a new query. Forgetting it would make the second query
 * of a frame silently skip every collider the first one touched, so the tests below call it the
 * way the real callers do and then prove the skip is gone once it is called again.
 */

const BOUNDS = { min: { x: -16, y: -8, z: -16 }, max: { x: 16, y: 8, z: 16 } };

function built(...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>) {
  const set = new ColliderSet(boxes.length + 1);
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  const hash = new SpatialHash(4);
  hash.build(set, BOUNDS);
  return { set, hash };
}

/** Every collider the grid reports for a box, de-duplicated by `claim`. */
function query(hash: SpatialHash, min: readonly number[], max: readonly number[]): number[] {
  const out = new Int32Array(64);
  hash.beginQuery();
  const n = hash.queryAabb(min[0]!, min[1]!, min[2]!, max[0]!, max[1]!, max[2]!, out);
  return Array.from(out.subarray(0, n));
}

describe('build', () => {
  it('covers the bounds with a cell of padding on every side', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);

    // The origin drops a whole cell below the minimum and the span adds one above the maximum,
    // so a collider sitting exactly on the boundary still has a cell to be registered in.
    expect(hash.cellSize).toBe(4);
    expect(hash.dimensions).toEqual([10, 6, 10]);
    expect(hash.cellCount).toBe(10 * 6 * 10);
  });

  it('puts the origin at the low corner of the bounds', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);

    expect(hash.origin).toEqual([-20, -12, -20]);
  });

  it('registers a collider that sits on a cell corner in all eight cells round it', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);

    // The origin is a multiple of the cell size, so a box centred on the world origin has its
    // AABB straddling the corner where eight cells meet. Being in all eight is the point: a
    // capsule in any one of them has to be able to find it.
    expect(hash.itemCount).toBe(8);
  });

  it('registers a collider wholly inside one cell just once', () => {
    const { hash } = built([2, 2, 2, 1, 1, 1]);

    expect(hash.itemCount).toBe(1);
  });

  it('registers a long collider in every cell its AABB reaches', () => {
    // A 10 x 1 x 10 slab at the origin: four cells on X, four on Z, two on Y.
    const { hash } = built([0, 0, 0, 10, 1, 10]);

    expect(hash.itemCount).toBe(4 * 2 * 4);
  });

  it('is empty for an empty set', () => {
    const { hash } = built();

    expect(hash.itemCount).toBe(0);
  });
});

describe('the cell lookups', () => {
  it('clamp into the grid, so a point outside still names a real cell', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);

    expect(hash.cellXOf(-1000)).toBe(0);
    expect(hash.cellXOf(1000)).toBe(9);
  });

  it('do not clamp in their raw form, which is how cast tells inside from outside', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);

    expect(hash.rawCellX(-1000)).toBeLessThan(0);
    expect(hash.rawCellX(1000)).toBeGreaterThan(9);
    expect(hash.inGrid(hash.rawCellX(-1000), 0, 0)).toBe(false);
    expect(hash.inGrid(hash.rawCellX(0), hash.rawCellY(0), hash.rawCellZ(0))).toBe(true);
  });

  it('agree with each other inside the grid', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);

    for (const x of [-15, -8, -0.1, 0, 0.1, 7, 15]) {
      expect(hash.rawCellX(x)).toBe(hash.cellXOf(x));
    }
  });
});

describe('queryAabb', () => {
  it('finds a collider in the box it is asked about', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);

    expect(query(hash, [-1, -1, -1], [1, 1, 1])).toEqual([0]);
  });

  it('finds nothing in an empty corner of the world', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);

    expect(query(hash, [12, 4, 12], [14, 6, 14])).toEqual([]);
  });

  it('returns a straddling collider once, not once per cell it occupies', () => {
    const { hash } = built([0, 0, 0, 10, 1, 10]);

    // The query spans every cell the collider is registered in.
    expect(query(hash, [-6, -1, -6], [6, 1, 6])).toEqual([0]);
  });

  it('finds every collider in range, each once', () => {
    const { hash } = built([-6, 0, 0, 1, 1, 1], [0, 0, 0, 1, 1, 1], [6, 0, 0, 1, 1, 1]);

    expect(query(hash, [-8, -1, -1], [8, 1, 1]).sort()).toEqual([0, 1, 2]);
  });

  it('skips a collider already claimed in the same query, and finds it again in the next', () => {
    const { hash } = built([0, 0, 0, 10, 1, 10]);
    const out = new Int32Array(64);

    hash.beginQuery();
    const first = hash.queryAabb(-6, -1, -6, 0, 1, 0, out);
    const second = hash.queryAabb(0, -1, 0, 6, 1, 6, out);

    expect(first).toBe(1);
    expect(second).toBe(0);

    hash.beginQuery();
    expect(hash.queryAabb(0, -1, 0, 6, 1, 6, out)).toBe(1);
  });

  it('stops at the capacity of the array it was given rather than overrunning it', () => {
    const { hash } = built([-6, 0, 0, 1, 1, 1], [0, 0, 0, 1, 1, 1], [6, 0, 0, 1, 1, 1]);
    const out = new Int32Array(2);

    hash.beginQuery();
    expect(hash.queryAabb(-8, -1, -1, 8, 1, 1, out)).toBe(2);
  });

  it('clamps a query that reaches outside the grid rather than missing', () => {
    const { hash } = built([-15, 0, -15, 1, 1, 1]);

    expect(query(hash, [-1000, -1000, -1000], [-14, 1, -14])).toEqual([0]);
  });
});

describe('the queried-cell record', () => {
  it('notes the cells a query walked, for the debug overlay', () => {
    const { hash } = built([0, 0, 0, 1, 1, 1]);
    hash.beginQuery();
    const out = new Int32Array(8);
    hash.queryAabb(-1, -1, -1, 1, 1, 1, out);

    expect(hash.queriedCells.length).toBeGreaterThan(0);
  });
});
