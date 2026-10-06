import { describe, expect, it } from 'vitest';
import { simCos, simSin } from '../core/SimMath';
import {
  makeScreenPoint,
  perspectiveMatrixFrom,
  projectToScreen,
  type ScreenPoint,
  viewMatrixFrom,
} from './ScreenProjection';

/**
 * World point to screen point, and the conventions getting one of them backwards cost P9.
 *
 * The bug this file was written to kill was two bearing expressions that differed by twice the
 * player yaw and agreed only at yaw 0 — which is where anybody testing a fresh spawn stands. So
 * every assertion below that touches a direction is made **off the axis**, and the bearing sign
 * is pinned on both sides and behind.
 *
 * `simSin`/`simCos` rather than the natives, because `check-boundaries` refuses `Math.sin` in
 * `shared/` at all. The matrix layout is asserted slot by slot against an independently written
 * basis, so a transposed matrix fails even though every number in it is present.
 */

/**
 * The view matrix at the origin facing down -Z.
 *
 * The identity, except that five slots are a **negative** zero: they are written as `-sy`,
 * `-sp` and the three negated dot products, and negating a zero keeps the sign in IEEE 754.
 * Harmless downstream — every use of them is arithmetic and `-0 === 0` — but pinned as it is
 * rather than as it reads, because `toEqual` tells the two apart and so would a reader who
 * assumed this function returns a clean identity.
 */
const IDENTITY_VIEW: readonly number[] = [1, 0, 0, 0, 0, 1, -0, 0, -0, 0, 1, 0, -0, -0, -0, 1];

/** 90 degrees vertical, 16:9, the projection the probes use. */
function wideProjection(): number[] {
  return perspectiveMatrixFrom(90, 16 / 9, 0.1, 1000, []);
}

function project(view: readonly number[], proj: readonly number[], x: number, y: number, z: number): ScreenPoint {
  return projectToScreen(view, proj, x, y, z, 1920, 1080, makeScreenPoint());
}

describe('makeScreenPoint', () => {
  it('starts zeroed, with nothing on screen and nothing behind', () => {
    expect(makeScreenPoint()).toEqual({
      ndcX: 0,
      ndcY: 0,
      x: 0,
      y: 0,
      behind: false,
      onScreen: false,
      bearingRad: 0,
      depth: 0,
    });
  });

  it('returns a fresh record each time, since callers keep one per indicator', () => {
    expect(makeScreenPoint()).not.toBe(makeScreenPoint());
  });
});

describe('viewMatrixFrom', () => {
  it('is the identity at the origin looking down -Z', () => {
    expect(viewMatrixFrom(0, 0, 0, 0, 0, [])).toEqual(IDENTITY_VIEW);
  });

  it('folds the position into the translation column, negated', () => {
    const view = viewMatrixFrom(1, 2, 3, 0, 0, []);

    expect(view[12]).toBe(-1);
    expect(view[13]).toBe(-2);
    expect(view[14]).toBe(-3);
    expect(view[15]).toBe(1);
  });

  it('writes the world basis as columns, which is what makes it the inverse', () => {
    const yaw = 0.7;
    const pitch = -0.3;
    const view = viewMatrixFrom(0, 0, 0, yaw, pitch, []);

    const cy = simCos(yaw);
    const sy = simSin(yaw);
    const cp = simCos(pitch);
    const sp = simSin(pitch);

    // right, up and backward in world space, YXZ, exactly as the file documents them.
    expect(view[0]).toBe(cy);
    expect(view[4]).toBe(0);
    expect(view[8]).toBe(-sy);

    expect(view[1]).toBe(sy * sp);
    expect(view[5]).toBe(cp);
    expect(view[9]).toBe(cy * sp);

    expect(view[2]).toBe(sy * cp);
    expect(view[6]).toBe(-sp);
    expect(view[10]).toBe(cy * cp);

    expect(view[3]).toBe(0);
    expect(view[7]).toBe(0);
    expect(view[11]).toBe(0);
    expect(view[15]).toBe(1);
  });

  it('writes into the array it is given and returns it', () => {
    const out: number[] = [];

    expect(viewMatrixFrom(0, 0, 0, 0, 0, out)).toBe(out);
    expect(out).toHaveLength(16);
  });

  it('puts a point in front of a yawed camera at negative view Z', () => {
    // Facing +X after a yaw of -pi/2: forward is (-sin(yaw), -cos(yaw)).
    const view = viewMatrixFrom(0, 0, 0, -Math.PI / 2, 0, []);
    const point = project(view, wideProjection(), 10, 0, 0);

    expect(point.behind).toBe(false);
    expect(point.depth).toBeCloseTo(10, 10);
    expect(point.bearingRad).toBeCloseTo(0, 10);
  });
});

describe('perspectiveMatrixFrom', () => {
  it('matches a THREE.PerspectiveCamera for the same four parameters', () => {
    expect(wideProjection()).toEqual([
      0.5625000000000001,
      0,
      0,
      0,
      0,
      1.0000000000000002,
      0,
      0,
      0,
      0,
      -1.0002000200020003,
      -1,
      0,
      0,
      -0.20002000200020004,
      0,
    ]);
  });

  it('divides the horizontal term by the aspect and leaves the vertical one alone', () => {
    const square = perspectiveMatrixFrom(90, 1, 0.1, 1000, []);
    const wide = wideProjection();

    expect(square[5]).toBe(wide[5]);
    expect(square[0]).toBeCloseTo(wide[0]! * (16 / 9), 12);
  });

  it('zeroes every slot it does not write', () => {
    const proj = perspectiveMatrixFrom(60, 2, 1, 100, new Array(16).fill(99));

    for (const slot of [1, 2, 3, 4, 6, 7, 8, 9, 12, 13, 15]) {
      expect(proj[slot]).toBe(0);
    }
  });
});

describe('projectToScreen', () => {
  it('puts a point straight ahead at the centre of the viewport', () => {
    const point = project(IDENTITY_VIEW, wideProjection(), 0, 0, -10);

    expect(point.ndcX).toBe(0);
    expect(point.ndcY).toBe(0);
    expect(point.x).toBe(960);
    expect(point.y).toBe(540);
    expect(point.depth).toBe(10);
    expect(point.behind).toBe(false);
    expect(point.onScreen).toBe(true);
    expect(point.bearingRad).toBe(0);
  });

  it('bears positive to the right and negative to the left', () => {
    const right = project(IDENTITY_VIEW, wideProjection(), 5, 0, -10);
    const left = project(IDENTITY_VIEW, wideProjection(), -5, 0, -10);

    expect(right.bearingRad).toBe(0.4636476090008061);
    expect(left.bearingRad).toBe(-0.4636476090008061);
    expect(right.x).toBe(1230);
    expect(left.x).toBe(690);
  });

  it('puts +Y up in ndc and down in pixels', () => {
    const above = project(IDENTITY_VIEW, wideProjection(), 0, 5, -10);

    expect(above.ndcY).toBe(0.5000000000000001);
    expect(above.y).toBe(270);
    expect(above.y).toBeLessThan(540);
  });

  it('flags a point behind the camera, where the ndc is a mirrored lie', () => {
    const behind = project(IDENTITY_VIEW, wideProjection(), 0, 0, 10);

    expect(behind.behind).toBe(true);
    expect(behind.onScreen).toBe(false);
    expect(behind.depth).toBe(-10);
  });

  it('keeps the bearing usable behind the camera, which is what an off-screen arrow needs', () => {
    const behind = project(IDENTITY_VIEW, wideProjection(), 0, 0, 10);

    expect(behind.bearingRad).toBe(Math.PI);
  });

  it('is monotonic in bearing all the way round, not just across the front', () => {
    let previous = -Infinity;
    for (const angle of [-2.5, -2, -1, -0.5, 0, 0.5, 1, 2, 2.5]) {
      const x = simSin(angle) * 10;
      const z = -simCos(angle) * 10;
      const bearing = project(IDENTITY_VIEW, wideProjection(), x, 0, z).bearingRad;
      expect(bearing).toBeGreaterThan(previous);
      previous = bearing;
    }
  });

  it('falls back to the viewport centre when w is zero', () => {
    const degenerate = project(IDENTITY_VIEW, wideProjection(), 0, 0, 0);

    expect(degenerate.x).toBe(960);
    expect(degenerate.y).toBe(540);
    expect(degenerate.ndcX).toBe(0);
    expect(degenerate.ndcY).toBe(0);
    expect(degenerate.onScreen).toBe(false);
    expect(degenerate.behind).toBe(true);
  });

  it('calls a point off the edge of the frame off screen while still in front', () => {
    const offRight = project(IDENTITY_VIEW, wideProjection(), 100, 0, -10);

    expect(offRight.behind).toBe(false);
    expect(offRight.onScreen).toBe(false);
    expect(offRight.ndcX).toBeGreaterThan(1);
  });

  it('writes into the record it is handed and returns that same record', () => {
    const out = makeScreenPoint();
    const returned = projectToScreen(IDENTITY_VIEW, wideProjection(), 0, 0, -10, 1920, 1080, out);

    expect(returned).toBe(out);
    expect(out.depth).toBe(10);
  });
});
