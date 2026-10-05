import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  clamp,
  clamp01,
  damp,
  DEG2RAD,
  lerp,
  moveTowards,
  RAD2DEG,
  shortestAngle,
  smoothstep,
  TAU,
  wrapAngle,
} from './MathUtil';

/**
 * Characterization of the numeric helpers, pinned with exact `toBe` throughout.
 *
 * These feed `shared/ai`, `shared/net` and `shared/streaks`, so a value that moved by one bit
 * is a simulation divergence rather than a rounding detail — which is why nothing here is
 * asserted with `toBeCloseTo`.
 *
 * `angleDelta` and `shortestAngle` are given the **same** argument table and asserted equal on
 * every row, because the two are one function under two names and the refactor makes the second
 * delegate to the first.
 */

/** Argument rows chosen to cover both wrap branches, the (-PI, PI] boundary and -0. */
const ANGLE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, Math.PI],
  [0, -Math.PI],
  [0, TAU],
  [0, -TAU],
  [Math.PI * 1.5, 0],
  [0, Math.PI * 1.5],
  [-3, 3],
  [3, -3],
  [0, 7],
  [0, -7],
  [10, -10],
  [0.5, 0.25],
  [Math.PI / 2, -Math.PI / 2],
  [100, 100.5],
];

describe('constants', () => {
  it('are the exact doubles downstream code multiplies by', () => {
    expect(TAU).toBe(6.283185307179586);
    expect(DEG2RAD).toBe(0.017453292519943295);
    expect(RAD2DEG).toBe(57.29577951308232);
  });
});

describe('clamp', () => {
  it('passes a value inside the range through untouched', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns the bound it crossed', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('returns the bounds themselves unchanged', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('with an inverted range the low test wins, because it is first', () => {
    expect(clamp(5, 10, 0)).toBe(10);
  });
});

describe('clamp01', () => {
  it('clamps to the unit interval and keeps what is already inside it', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(1.5)).toBe(1);
  });
});

describe('lerp', () => {
  it('hits both endpoints exactly', () => {
    expect(lerp(2, 10, 0)).toBe(2);
    expect(lerp(2, 10, 1)).toBe(10);
  });

  it('interpolates the midpoint', () => {
    expect(lerp(2, 10, 0.5)).toBe(6);
  });

  it('extrapolates past the endpoints rather than clamping', () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });
});

describe('damp', () => {
  it('approaches the target by the frame-rate independent fraction', () => {
    expect(damp(0, 1, 10, 1 / 60)).toBe(0.15351827510938598);
  });

  it('does not move at rate zero', () => {
    expect(damp(0, 1, 0, 1 / 60)).toBe(0);
  });

  it('stays put when it is already there', () => {
    expect(damp(5, 5, 10, 1 / 60)).toBe(5);
  });

  it('saturates at the target for an enormous rate', () => {
    expect(damp(0, 1, 1e9, 1 / 60)).toBe(1);
  });
});

describe('moveTowards', () => {
  it('steps by maxDelta while the gap is larger', () => {
    expect(moveTowards(0, 10, 1)).toBe(1);
    expect(moveTowards(10, 0, 1)).toBe(9);
  });

  it('lands on the target exactly once the gap fits in one step', () => {
    expect(moveTowards(0, 10, 100)).toBe(10);
    expect(moveTowards(0, 0, 1)).toBe(0);
  });

  it('with maxDelta zero it reaches the target only when already there', () => {
    expect(moveTowards(0, 10, 0)).toBe(0);
    expect(moveTowards(7, 7, 0)).toBe(7);
  });
});

describe('smoothstep', () => {
  it('is 0 below the low edge and 1 above the high one', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it('is one half at the midpoint, for any pair of edges', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(2, 4, 3)).toBe(0.5);
  });

  it('eases rather than interpolating linearly', () => {
    expect(smoothstep(0, 1, 0.25)).toBe(0.15625);
  });

  it('returns NaN when the two edges coincide (0/0); pins current behaviour', () => {
    expect(smoothstep(1, 1, 1)).toBe(NaN);
  });
});

describe('angleDelta', () => {
  it('returns +PI at both ends of the half turn, so the range is (-PI, PI]', () => {
    expect(angleDelta(0, Math.PI)).toBe(3.141592653589793);
    expect(angleDelta(0, -Math.PI)).toBe(3.141592653589793);
  });

  it('turns the short way round', () => {
    expect(angleDelta(-3, 3)).toBe(-0.28318530717958623);
    expect(angleDelta(3, -3)).toBe(0.28318530717958623);
    expect(angleDelta(Math.PI * 1.5, 0)).toBe(1.5707963267948966);
    expect(angleDelta(0, Math.PI * 1.5)).toBe(-1.5707963267948966);
  });

  it('reduces a whole turn to zero, keeping the sign of the zero', () => {
    expect(angleDelta(0, TAU)).toBe(0);
    expect(angleDelta(0, -TAU)).toBe(-0);
  });

  it('reduces arguments far outside one turn', () => {
    expect(angleDelta(0, 7)).toBe(0.7168146928204138);
    expect(angleDelta(0, -7)).toBe(-0.7168146928204138);
    expect(angleDelta(10, -10)).toBe(-1.1504440784612413);
    expect(angleDelta(100, 100.5)).toBe(0.5);
  });

  it('is exact for a small difference', () => {
    expect(angleDelta(0.5, 0.25)).toBe(-0.25);
  });
});

describe('shortestAngle', () => {
  it('agrees with angleDelta bit for bit on every argument row', () => {
    for (const [from, to] of ANGLE_PAIRS) {
      expect(shortestAngle(from, to)).toBe(angleDelta(from, to));
    }
  });

  it('pins the same values independently of angleDelta', () => {
    expect(shortestAngle(0, Math.PI)).toBe(3.141592653589793);
    expect(shortestAngle(0, -Math.PI)).toBe(3.141592653589793);
    expect(shortestAngle(0, -TAU)).toBe(-0);
    expect(shortestAngle(-3, 3)).toBe(-0.28318530717958623);
    expect(shortestAngle(10, -10)).toBe(-1.1504440784612413);
    expect(shortestAngle(0.5, 0.25)).toBe(-0.25);
  });
});

describe('wrapAngle', () => {
  it('is angleDelta from zero', () => {
    for (const [, to] of ANGLE_PAIRS) {
      expect(wrapAngle(to)).toBe(angleDelta(0, to));
    }
  });

  it('wraps into (-PI, PI]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBe(3.141592653589793);
    expect(wrapAngle(-Math.PI)).toBe(3.141592653589793);
    expect(wrapAngle(TAU)).toBe(0);
    expect(wrapAngle(7)).toBe(0.7168146928204138);
    expect(wrapAngle(-7)).toBe(-0.7168146928204138);
    expect(wrapAngle(100)).toBe(-0.5309649148733797);
  });
});
