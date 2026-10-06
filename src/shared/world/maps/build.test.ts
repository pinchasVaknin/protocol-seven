import { describe, expect, it } from 'vitest';
import {
  addBox,
  addProp,
  addSpan,
  addSupplyPoint,
  addWallAlongX,
  addWallAlongZ,
  type Gap,
  rampAlongX,
  rampAlongZ,
  rotateHalf,
  rotateHalfProps,
  rotateHalfSpawns,
} from './build';
import type { Brush, PropDef, SpawnZone, SupplyPointDef } from './types';

/**
 * Characterisation of the half-map rotation: `(x, z) -> (-x, -z)`, `yaw -> yaw + pi`, `y`
 * untouched, applied to a two-element input; and the one refusal — a pitched brush throws.
 */

const BRUSHES: readonly Brush[] = [
  { position: { x: 3, y: 1, z: -4 }, size: { x: 2, y: 2, z: 2 }, rotationY: 0.5, material: 'concrete', solid: true },
  { position: { x: -1, y: 0.5, z: 2 }, size: { x: 4, y: 1, z: 1 }, rotationY: 0, material: 'metal', shadows: false, uvScale: 2 },
];

const PROPS: readonly PropDef[] = [
  { shape: 'crate', position: { x: 5, y: 0, z: 6 }, rotationY: 1 },
  { shape: 'pillar', position: { x: -2, y: 0, z: -3 }, rotationY: -1 },
];

const SPAWNS: readonly SpawnZone[] = [
  { team: 'A', position: { x: 10, y: 0, z: 20 }, facingYaw: 0, radius: 3 },
  { team: 'A', position: { x: -10, y: 1, z: 20 }, facingYaw: 1.5, radius: 2 },
];

describe('rotateHalf', () => {
  it('negates x and z, keeps y, adds pi to the yaw, and keeps every other field', () => {
    const out = rotateHalf(BRUSHES);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ ...BRUSHES[0], position: { x: -3, y: 1, z: 4 }, rotationY: 0.5 + Math.PI });
    expect(out[1]).toEqual({ ...BRUSHES[1], position: { x: 1, y: 0.5, z: -2 }, rotationY: Math.PI });
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(BRUSHES));
    rotateHalf(BRUSHES);
    expect(BRUSHES).toEqual(copy);
  });

  it('refuses a pitched brush', () => {
    const pitched: Brush = { ...BRUSHES[0]!, rotationX: 0.2 };
    expect(() => rotateHalf([pitched])).toThrow(/pitched brush/);
    const rolled: Brush = { ...BRUSHES[0]!, rotationZ: 0.2 };
    expect(() => rotateHalf([rolled])).toThrow(/pitched brush/);
  });
});

describe('rotateHalfProps', () => {
  it('rotates each placement and keeps the shape', () => {
    expect(rotateHalfProps(PROPS)).toEqual([
      { shape: 'crate', position: { x: -5, y: 0, z: -6 }, rotationY: 1 + Math.PI },
      { shape: 'pillar', position: { x: 2, y: 0, z: 3 }, rotationY: -1 + Math.PI },
    ]);
  });
});

describe('rotateHalfSpawns', () => {
  it('hands the rotated half to team B', () => {
    expect(rotateHalfSpawns(SPAWNS)).toEqual([
      { team: 'B', position: { x: -10, y: 0, z: -20 }, facingYaw: Math.PI, radius: 3 },
      { team: 'B', position: { x: 10, y: 1, z: -20 }, facingYaw: 1.5 + Math.PI, radius: 2 },
    ]);
  });

  it('rotating twice returns to the original positions, on the other team', () => {
    const twice = rotateHalfSpawns(rotateHalfSpawns(SPAWNS));
    expect(twice.map((z) => z.position)).toEqual(SPAWNS.map((z) => z.position));
    expect(twice[0]?.facingYaw).toBeCloseTo(2 * Math.PI, 12);
    expect(twice.every((z) => z.team === 'B')).toBe(true);
  });
});

/**
 * The rest of the builders, pinned before the three rotations above were given a shared mirror
 * (refactor A3b).
 *
 * `spansAround` is the richest thing in this file and had no test at all: it clips every gap to
 * the wall, sorts them, merges the ones that touch or overlap, and returns what is left solid.
 * Each of those four steps has a failure that authors a wall nobody notices — an unmerged pair
 * leaves a 2 cm sliver of wall between two doors, which is both a rendering artefact and
 * something the capsule catches on, and that is the case the merge exists for.
 *
 * The two ramps are pinned to their exact doubles rather than approximately. They are the
 * subject of an open side task — the grey box hand-rolls the same two ramps down a different
 * floating-point path — and these numbers are what that task has to match.
 */

/** The spans a wall from -10 to 10 is left with, as [centre, length] pairs. */
function wallSpans(gaps: readonly Gap[]): Array<[number, number]> {
  const out: Brush[] = [];
  addWallAlongX(out, 'concrete', -10, 10, 0, 3, 5, 5.5, gaps);
  return out.map((b) => [b.position.x, b.size.x]);
}

describe('addBox', () => {
  it('takes a centre and full extents, and yaws to zero by default', () => {
    const out: Brush[] = [];
    addBox(out, 'metal', 1, 2, 3, 4, 5, 6);

    expect(out).toEqual([
      {
        position: { x: 1, y: 2, z: 3 },
        size: { x: 4, y: 5, z: 6 },
        rotationY: 0,
        material: 'metal',
      },
    ]);
  });

  it('omits every option that was not given, rather than writing a default in', () => {
    const out: Brush[] = [];
    addBox(out, 'metal', 0, 0, 0, 1, 1, 1);

    expect('solid' in out[0]!).toBe(false);
    expect('shadows' in out[0]!).toBe(false);
    expect('uvScale' in out[0]!).toBe(false);
  });

  it('writes an option that was given, including false', () => {
    const out: Brush[] = [];
    addBox(out, 'metal', 0, 0, 0, 1, 1, 1, {
      solid: false,
      shadows: false,
      uvScale: 3,
      rotationY: 0.5,
    });

    expect(out[0]?.solid).toBe(false);
    expect(out[0]?.shadows).toBe(false);
    expect(out[0]?.uvScale).toBe(3);
    expect(out[0]?.rotationY).toBe(0.5);
  });

  it('appends, so one array collects a whole map', () => {
    const out: Brush[] = [];
    addBox(out, 'metal', 0, 0, 0, 1, 1, 1);
    addBox(out, 'concrete', 1, 1, 1, 1, 1, 1);

    expect(out).toHaveLength(2);
    expect(out[1]?.material).toBe('concrete');
  });
});

describe('addSpan', () => {
  it('turns two intervals per axis into a centre and an extent', () => {
    const out: Brush[] = [];
    addSpan(out, 'concrete', -4, 6, 0, 3, 10, 12);

    expect(out[0]?.position).toEqual({ x: 1, y: 1.5, z: 11 });
    expect(out[0]?.size).toEqual({ x: 10, y: 3, z: 2 });
  });

  it('does not care which end of an interval comes first', () => {
    const forward: Brush[] = [];
    const backward: Brush[] = [];
    addSpan(forward, 'concrete', -4, 6, 0, 3, 10, 12);
    addSpan(backward, 'concrete', 6, -4, 3, 0, 12, 10);

    expect(backward).toEqual(forward);
  });
});

describe('addWallAlongX, and the span arithmetic under it', () => {
  it('is one solid span when there are no doorways', () => {
    expect(wallSpans([])).toEqual([[0, 20]]);
  });

  it('cuts a doorway into two spans', () => {
    expect(wallSpans([[-1, 1]])).toEqual([
      [-5.5, 9],
      [5.5, 9],
    ]);
  });

  it('cuts two doorways into three spans', () => {
    expect(
      wallSpans([
        [-6, -4],
        [4, 6],
      ]),
    ).toEqual([
      [-8, 4],
      [0, 8],
      [8, 4],
    ]);
  });

  it('merges two overlapping doorways into one opening', () => {
    // [-2,1] and [0,3] become [-2,3]: no sliver of wall left between them.
    expect(
      wallSpans([
        [-2, 1],
        [0, 3],
      ]),
    ).toEqual([
      [-6, 8],
      [6.5, 7],
    ]);
  });

  it('merges two doorways that merely touch, for the same reason', () => {
    expect(
      wallSpans([
        [-2, 0],
        [0, 2],
      ]),
    ).toEqual([
      [-6, 8],
      [6, 8],
    ]);
  });

  it('ignores a gap outside the wall, so one door list serves both faces of a room', () => {
    expect(
      wallSpans([
        [-50, -40],
        [40, 50],
      ]),
    ).toEqual([[0, 20]]);
  });

  it('drops a gap too thin to be a doorway rather than splitting the wall', () => {
    expect(wallSpans([[0, 0.00001]])).toEqual([[0, 20]]);
  });

  it('builds nothing when the doorway covers the whole wall', () => {
    expect(wallSpans([[-10, 10]])).toEqual([]);
  });

  it('normalises a gap given back to front', () => {
    expect(wallSpans([[1, -1]])).toEqual(wallSpans([[-1, 1]]));
  });

  it('carries the material and the other two axes onto every span', () => {
    const out: Brush[] = [];
    addWallAlongX(out, 'brick', -10, 10, 0, 3, 5, 5.5, [[-1, 1]], { shadows: false });

    for (const brush of out) {
      expect(brush.material).toBe('brick');
      expect(brush.position.y).toBe(1.5);
      expect(brush.size.y).toBe(3);
      expect(brush.position.z).toBe(5.25);
      expect(brush.shadows).toBe(false);
    }
  });
});

describe('addWallAlongZ', () => {
  it('cuts the doorway out of Z and leaves X alone', () => {
    const out: Brush[] = [];
    addWallAlongZ(out, 'metal', -1, 1, 0, 3, -8, 8, [[-2, 2]]);

    expect(out.map((b) => [b.position.z, b.size.z])).toEqual([
      [-5, 6],
      [5, 6],
    ]);
    for (const brush of out) {
      expect(brush.position.x).toBe(0);
      expect(brush.size.x).toBe(2);
    }
  });
});

describe('rampAlongX', () => {
  it('passes its top face through both authored endpoints', () => {
    const out: Brush[] = [];
    rampAlongX(out, 'metal', -18, 0, -13.5, 1.5, 6, 3.5, 0.5);

    expect(out).toEqual([
      {
        position: { x: -15.67094305849579, y: 0.5128291754873715, z: 6 },
        size: { x: 4.743416490252569, y: 0.5, z: 3.5 },
        rotationY: 0,
        rotationZ: 0.3217505543966422,
        material: 'metal',
      },
    ]);
  });

  it('describes the same solid whichever end is given first', () => {
    const forward: Brush[] = [];
    const backward: Brush[] = [];
    rampAlongX(forward, 'metal', -18, 0, -13.5, 1.5, 6, 3.5, 0.5);
    rampAlongX(backward, 'metal', -13.5, 1.5, -18, 0, 6, 3.5, 0.5);

    expect(backward).toEqual(forward);
  });

  it('pitches up toward +X for a rising run', () => {
    const out: Brush[] = [];
    rampAlongX(out, 'metal', 0, 0, 10, 10, 0, 1, 0.2);

    expect(out[0]?.rotationZ).toBeCloseTo(Math.PI / 4, 12);
  });
});

describe('rampAlongZ', () => {
  it('passes its top face through both authored endpoints', () => {
    const out: Brush[] = [];
    rampAlongZ(out, 'metal', 8, -3, 2, 0, 10.3, 3.0, 0.6);

    expect(out).toEqual([
      {
        position: { x: 10.3, y: -1.7683281572999747, z: 4.865835921350013 },
        size: { x: 3, y: 0.6, z: 6.708203932499369 },
        rotationY: 0,
        rotationX: 0.4636476090008061,
        material: 'metal',
      },
    ]);
  });

  it('describes the same solid whichever end is given first', () => {
    const forward: Brush[] = [];
    const backward: Brush[] = [];
    rampAlongZ(forward, 'metal', 8, -3, 2, 0, 10.3, 3.0, 0.6);
    rampAlongZ(backward, 'metal', 2, 0, 8, -3, 10.3, 3.0, 0.6);

    expect(backward).toEqual(forward);
  });

  it('reads a descent toward +Z as a positive angle, which is the grey box convention', () => {
    const out: Brush[] = [];
    rampAlongZ(out, 'metal', 0, 0, 10, -10, 0, 1, 0.2);

    expect(out[0]?.rotationX).toBeCloseTo(Math.PI / 4, 12);
  });
});

describe('addProp', () => {
  it('places a shape on the ground at a yaw', () => {
    const out: PropDef[] = [];
    addProp(out, 'crate', 3, 4, 1.5);

    expect(out).toEqual([{ shape: 'crate', position: { x: 3, y: 0, z: 4 }, rotationY: 1.5 }]);
  });

  it('defaults the yaw and the height to zero', () => {
    const out: PropDef[] = [];
    addProp(out, 'pillar', 1, 2);

    expect(out[0]?.rotationY).toBe(0);
    expect(out[0]?.position.y).toBe(0);
  });

  it('takes a height when a prop sits on a deck', () => {
    const out: PropDef[] = [];
    addProp(out, 'crate', 0, 0, 0, 4);

    expect(out[0]?.position.y).toBe(4);
  });
});

describe('addSupplyPoint', () => {
  it('writes the crate and the trigger from one call, at the same place', () => {
    const props: PropDef[] = [];
    const supply: SupplyPointDef[] = [];
    addSupplyPoint(props, supply, 'ammo_w', -26, 0, 6, Math.PI, 2.5);

    expect(props).toEqual([
      { shape: 'ammoCrate', position: { x: -26, y: 0, z: 6 }, rotationY: Math.PI },
    ]);
    expect(supply).toEqual([
      { id: 'ammo_w', position: { x: -26, y: 0, z: 6 }, rotationY: Math.PI, radius: 2.5 },
    ]);
  });

  it('keeps the two records in step, which is the whole reason it is one call', () => {
    const props: PropDef[] = [];
    const supply: SupplyPointDef[] = [];
    addSupplyPoint(props, supply, 'ammo_e', 1, 2, 3);

    expect(supply[0]?.position).toEqual(props[0]?.position);
    expect(supply[0]?.rotationY).toBe(props[0]?.rotationY);
  });

  it('defaults the yaw to zero and the radius to the generous two metres', () => {
    const props: PropDef[] = [];
    const supply: SupplyPointDef[] = [];
    addSupplyPoint(props, supply, 'ammo_w', 0, 0, 0);

    expect(supply[0]?.radius).toBe(2);
    expect(supply[0]?.rotationY).toBe(0);
  });
});
