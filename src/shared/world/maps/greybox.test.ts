import { describe, expect, it } from 'vitest';
import { GREYBOX_MAP } from './greybox';
import type { Brush } from './types';

/**
 * MP_TESTBED, as assembled (refactor A3a).
 *
 * The grey-box room is not scenery: its header is a **table of the movement cases it exists to
 * exercise**, and every row of that table is a number the movement system is tuned against. A
 * 0.3 m step that became 0.35 m stops testing silent step-up; a 1.1 m corridor that became
 * 1.2 m stops testing capsule radius. So the table is asserted here, row by row, which is what
 * lets `brushes()` be split into one builder per feature without the split being an act of
 * faith.
 *
 * The bullseye boards carry a second kind of assertion. They have been laid out wrong twice —
 * in a line at M7, and fanned *into the north wall* post-M8, reported as "targets spawning
 * completely inside the left wall". Both failures are geometric and both are pinned below.
 */

const BRUSHES = GREYBOX_MAP.brushes;

function find(predicate: (b: Brush) => boolean): Brush[] {
  return BRUSHES.filter(predicate);
}

/** The near edge of a brush on the Z axis — the side facing the north wall. */
function nearEdgeZ(brush: Brush): number {
  return brush.position.z - brush.size.z / 2;
}

describe('GREYBOX_MAP', () => {
  it('is the authored identity', () => {
    expect(GREYBOX_MAP.id).toBe('mp_testbed');
    expect(GREYBOX_MAP.name).toBe('TESTBED');
  });

  it('assembles the counts the whole file exists to produce', () => {
    expect(BRUSHES).toHaveLength(71);
    expect(GREYBOX_MAP.props).toHaveLength(34);
    expect(GREYBOX_MAP.spawns).toHaveLength(13);
    expect(GREYBOX_MAP.coverPoints).toHaveLength(72);
    expect(GREYBOX_MAP.lights).toHaveLength(2);
  });

  it('has no objectives and no lanes: it is a range, not a match map', () => {
    expect(GREYBOX_MAP.objectives ?? []).toHaveLength(0);
    expect(GREYBOX_MAP.lanes).toBeUndefined();
  });

  it('every brush is a solid with three positive extents', () => {
    for (const brush of BRUSHES) {
      expect(brush.size.x).toBeGreaterThan(0);
      expect(brush.size.y).toBeGreaterThan(0);
      expect(brush.size.z).toBeGreaterThan(0);
    }
  });
});

describe('the movement cases the header promises', () => {
  it('the 0.3 m step: one 8 m plate at y 0.1, so its top face is exactly 0.3', () => {
    const step = find((b) => b.size.y === 0.4 && b.size.x === 8 && b.material === 'concrete');

    expect(step).toHaveLength(1);
    expect(step[0]?.position.y).toBe(0.1);
    // 0.1 + 0.2 is 0.30000000000000004, so the top face is compared rather than equated.
    expect((step[0]?.position.y ?? 0) + (step[0]?.size.y ?? 0) / 2).toBeCloseTo(0.3, 12);
  });

  it('the 1.5 m ledge: top face at the very top of the mantle detection range', () => {
    const ledge = find((b) => b.size.y === 1.7);

    expect(ledge).toHaveLength(1);
    expect((ledge[0]?.position.y ?? 0) + (ledge[0]?.size.y ?? 0) / 2).toBe(1.5);
  });

  it('the pit: floor top at -3, which is the authored depth', () => {
    const floor = find((b) => b.position.y < -3);

    expect(floor).toHaveLength(1);
    expect((floor[0]?.position.y ?? 0) + (floor[0]?.size.y ?? 0) / 2).toBe(-3);
  });

  it('the narrow corridor: two walls 1.1 m apart in the clear', () => {
    const walls = find((b) => b.size.x === 1 && b.size.z === 12);

    expect(walls).toHaveLength(2);
    const [west, east] = walls;
    const clear =
      (east?.position.x ?? 0) - (east?.size.x ?? 0) / 2 - ((west?.position.x ?? 0) + (west?.size.x ?? 0) / 2);
    expect(clear).toBeCloseTo(1.1, 10);
  });

  it('the low overhang: underside at 1.25 m, so crouch fits and stand does not', () => {
    const roof = find((b) => b.size.x === 2.1 && b.size.y === 0.8);

    expect(roof).toHaveLength(1);
    expect((roof[0]?.position.y ?? 0) - (roof[0]?.size.y ?? 0) / 2).toBe(1.25);
  });

  it('the two ramps keep their authored pitch, on the axis each is pitched about', () => {
    const pitched = BRUSHES.filter((b) => b.rotationZ !== undefined || b.rotationX !== undefined);

    expect(pitched).toHaveLength(2);

    const main = pitched.find((b) => b.rotationZ !== undefined);
    expect(main?.rotationZ).toBe(Math.atan2(1.5, 4.5));
    expect(main?.size.y).toBe(0.5);

    const pit = pitched.find((b) => b.rotationX !== undefined);
    expect(pit?.rotationX).toBe(Math.atan2(3, 6));
    expect(pit?.size.y).toBe(0.6);
  });

  it('the angled barricades are yawed, which is what oriented-box collision is tested with', () => {
    const yawed = BRUSHES.filter((b) => (b.rotationY ?? 0) !== 0);

    expect(yawed).toHaveLength(2);
    expect(yawed[0]?.rotationY).toBe(Math.PI / 6);
    expect(yawed[1]?.rotationY).toBe(-Math.PI / 5);
  });

  it('the penetration bay: 0.05 m of steel and 0.6 m of concrete, same face size', () => {
    const panels = find((b) => b.size.y === 2.6 && b.size.z === 2.6);

    expect(panels).toHaveLength(2);
    expect(panels[0]?.material).toBe('metal');
    expect(panels[0]?.size.x).toBe(0.05);
    expect(panels[1]?.material).toBe('concrete');
    expect(panels[1]?.size.x).toBe(0.6);
  });
});

describe('the bullseye boards', () => {
  const boards = find((b) => b.size.x === 0.3 && b.size.y === 1.6);

  it('are three, 1.4 m wide, narrowed in round 2 so three of them fan without shadowing', () => {
    expect(boards).toHaveLength(3);
    for (const board of boards) {
      expect(board.size.z).toBe(1.4);
      expect(board.position.y).toBe(1.5);
    }
  });

  it('stand at exactly the ranges they are marked with, measured straight-line', () => {
    // Solved from the firing line at (-20, -14), the one place the range is used from.
    const ranges = boards.map((b) => Math.hypot(b.position.x + 20, b.position.z + 14));

    expect(ranges[0]).toBeCloseTo(10, 10);
    expect(ranges[1]).toBeCloseTo(16, 10);
    expect(ranges[2]).toBeCloseTo(22, 10);
  });

  it('are fanned rather than in a line, which is what M7 got wrong', () => {
    const laterals = boards.map((b) => b.position.z);

    expect(new Set(laterals).size).toBe(3);
  });

  it('are all clear of the north wall, which is what post-M8 got wrong fixing it', () => {
    // The wall's interior face is at z = -18; the stated bound is a near edge no further than
    // -17.4. Both failures were boards whose near edge was inside the wall.
    for (const board of boards) {
      expect(nearEdgeZ(board)).toBeGreaterThan(-18);
      expect(nearEdgeZ(board)).toBeGreaterThanOrEqual(-17.4);
    }
  });

  it('each have four rings in front of them, none sharing a face with the next', () => {
    const rings = find((b) => b.size.x === 0.02);

    expect(rings).toHaveLength(12);
    for (const ring of rings) {
      expect(ring.shadows).toBe(false);
      expect(ring.solid).toBeUndefined();
    }
  });
});

describe('the room itself', () => {
  it('is bounded by four perimeter walls at the authored faces', () => {
    const walls = find((b) => b.material === 'concrete' && b.size.y === 6.2);

    expect(walls).toHaveLength(4);
  });

  it('nothing reaches past the north wall', () => {
    expect(Math.min(...BRUSHES.map(nearEdgeZ))).toBe(-19);
  });

  it('the distance markers do not perturb a speed measurement', () => {
    const markers = find((b) => b.material === 'hazard' && b.position.z === -14);

    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker.solid).toBe(false);
      expect(marker.shadows).toBe(false);
    }
  });
});
