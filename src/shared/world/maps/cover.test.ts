import { describe, expect, it } from 'vitest';
import { deriveCoverPoints, emitCoverPoint } from './cover';
import type { CoverPoint, PropDef } from './types';

/**
 * Cover derived from prop placements (M3 onward).
 *
 * The number worth a test is `barrels`, whose half-depth was 0.55 until M8 and is 0.75 now.
 * The shape is a *pair* of drums, so its half-extent across that axis is 0.73 m and not 0.31;
 * at 0.55 the derived point sat inside the object and the navmesh — which asks the collision
 * world rather than this table — correctly refused it. Dunes threw four such points and
 * Foundry had been quietly throwing two since M4. A profile number that is too small does not
 * fail loudly, it fails as bots standing in the open.
 *
 * The deliberate absences matter as much: `palm` and `lightMast` are concealment, not cover,
 * and a bot that treated a 0.42 m trunk as cover against a 0.7 m capsule would believe it was
 * hidden while standing in the open.
 */

function points(placements: readonly PropDef[]): CoverPoint[] {
  return deriveCoverPoints(placements);
}

function placement(shape: PropDef['shape'], x = 0, z = 0, rotationY = 0, y = 0): PropDef {
  return { shape, position: { x, y, z }, rotationY };
}

describe('emitCoverPoint', () => {
  it('stands the point off the face by the depth plus the capsule standoff', () => {
    const out: CoverPoint[] = [];
    emitCoverPoint(out, 0, 0, 0, 0, 1, 0.5, 'low');

    expect(out).toHaveLength(1);
    // Face normal (0, 1) at yaw 0, depth 0.5, standoff 0.62.
    expect(out[0]?.position.x).toBeCloseTo(0, 12);
    expect(out[0]?.position.z).toBeCloseTo(1.12, 12);
  });

  it('faces back through the object it is taken behind', () => {
    const out: CoverPoint[] = [];
    emitCoverPoint(out, 0, 0, 0, 0, 1, 0.5, 'low');

    // Standing north of the object, looking south back through it: a half turn. The sign is
    // negative because the yaw is `atan2(-wx, -wz)` and `-wx` here is a negative zero, so it
    // comes out as -pi rather than +pi. The same bearing, and pinned as it is.
    expect(out[0]?.facingYaw).toBe(-Math.PI);
  });

  it('rotates the face normal into world space by the prop yaw', () => {
    const out: CoverPoint[] = [];
    emitCoverPoint(out, 0, 0, Math.PI / 2, 0, 1, 0.5, 'low');

    expect(out[0]?.position.x).toBeCloseTo(1.12, 10);
    expect(out[0]?.position.z).toBeCloseTo(0, 10);
  });

  it('carries the height band and the y it was given', () => {
    const out: CoverPoint[] = [];
    emitCoverPoint(out, 1, 2, 0, 1, 0, 0.2, 'high', 4);

    expect(out[0]?.height).toBe('high');
    expect(out[0]?.position.y).toBe(4);
  });

  it('offsets from the object centre it is given, not from the origin', () => {
    const out: CoverPoint[] = [];
    emitCoverPoint(out, 10, -5, 0, 0, 1, 0.5, 'low');

    expect(out[0]?.position.x).toBeCloseTo(10, 12);
    expect(out[0]?.position.z).toBeCloseTo(-3.88, 12);
  });
});

describe('deriveCoverPoints', () => {
  it('gives a four-sided shape four points and a broad-faced one two', () => {
    expect(points([placement('crate')])).toHaveLength(4);
    expect(points([placement('barrier')])).toHaveLength(2);
    expect(points([placement('container')])).toHaveLength(2);
  });

  it('skips a shape with no profile rather than throwing', () => {
    expect(points([placement('lightBox')])).toEqual([]);
    expect(points([placement('palm')])).toEqual([]);
    expect(points([placement('lightMast')])).toEqual([]);
  });

  it('keeps going past a shape it has no profile for', () => {
    expect(points([placement('palm'), placement('crate'), placement('lightMast')])).toHaveLength(4);
  });

  it('is empty for no placements', () => {
    expect(points([])).toEqual([]);
  });

  it('puts barrels at 0.75 half-depth, not the 0.55 the navmesh refused', () => {
    const [first] = points([placement('barrels', 0, 0, 0)]);

    // First face is (0, -1): the point sits at -(0.75 + 0.62).
    expect(first?.position.z).toBeCloseTo(-1.37, 12);
    expect(first?.height).toBe('low');
  });

  it('derives from the placement position and yaw', () => {
    const [first] = points([placement('crate', 3, 4, 0)]);

    expect(first?.position.x).toBeCloseTo(3, 12);
    expect(first?.position.z).toBeCloseTo(4 - 1.12, 12);
  });

  it('reads the placement y, so railing cover sits above floor cover in the same plan spot', () => {
    const floor = points([placement('crate', 0, 0, 0, 0)]);
    const railing = points([placement('crate', 0, 0, 0, 4)]);

    expect(floor[0]?.position.y).toBe(0);
    expect(railing[0]?.position.y).toBe(4);
    expect(railing[0]?.position.x).toBe(floor[0]?.position.x);
  });

  it('gives every point a finite position and a known height band', () => {
    const all = points([
      placement('crate'),
      placement('crateTall', 5),
      placement('pillar', -5),
      placement('barrels', 0, 5),
      placement('well', 0, -5),
      placement('forklift', 8, 8),
    ]);

    expect(all.length).toBeGreaterThan(0);
    for (const point of all) {
      expect(Number.isFinite(point.position.x)).toBe(true);
      expect(Number.isFinite(point.position.z)).toBe(true);
      expect(Number.isFinite(point.facingYaw)).toBe(true);
      expect(['low', 'high']).toContain(point.height);
    }
  });
});
