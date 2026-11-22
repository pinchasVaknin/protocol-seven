import { describe, expect, it } from 'vitest';
import { lookDirection, makeLookDir, simCos, simSin, simTan, verifyAgainstNative } from './SimMath';

/**
 * Characterisation of the deterministic trig: exact values where sine and cosine are known
 * exactly, the symmetries, and the one-ULP claim the file makes against the host's own
 * `Math.sin`/`Math.cos`.
 *
 * The comparison against the natives goes through `verifyAgainstNative` rather than calling
 * `Math.sin` here, because this file sits in `shared/` and the boundary check refuses the
 * engine-dependent functions there — a test is seen like any other file (M14, S7), and the
 * exemption list is the check's, not this file's to widen.
 */

const SQRT3_2 = Math.sqrt(3) / 2;

describe('simSin', () => {
  it('is exact at zero', () => {
    expect(simSin(0)).toBe(0);
  });

  it('returns +0 for -0, where Math.sin keeps the sign (M14 finding; harmless, -0 === 0)', () => {
    expect(Object.is(simSin(-0), 0)).toBe(true);
  });

  it('matches the textbook values', () => {
    expect(simSin(Math.PI / 6)).toBeCloseTo(0.5, 15);
    expect(simSin(Math.PI / 4)).toBeCloseTo(Math.SQRT1_2, 15);
    expect(simSin(Math.PI / 3)).toBeCloseTo(SQRT3_2, 15);
    expect(simSin(Math.PI / 2)).toBeCloseTo(1, 15);
    expect(simSin(Math.PI)).toBeCloseTo(0, 15);
    expect(simSin((3 * Math.PI) / 2)).toBeCloseTo(-1, 15);
    expect(simSin(2 * Math.PI)).toBeCloseTo(0, 15);
  });

  it('is odd', () => {
    for (const x of [0.1, 1, 2.5, 4, 10, 63.9]) expect(simSin(-x)).toBe(-simSin(x));
  });

  it('is periodic to within rounding over a full turn', () => {
    for (const x of [0.1, 1, 2.5]) expect(simSin(x + 2 * Math.PI)).toBeCloseTo(simSin(x), 14);
  });

  it('returns NaN for non-finite input, as Math.sin does', () => {
    expect(simSin(NaN)).toBeNaN();
    expect(simSin(Infinity)).toBeNaN();
    expect(simSin(-Infinity)).toBeNaN();
  });
});

describe('simCos', () => {
  it('is exact at zero', () => {
    expect(simCos(0)).toBe(1);
  });

  it('matches the textbook values', () => {
    expect(simCos(Math.PI / 3)).toBeCloseTo(0.5, 15);
    expect(simCos(Math.PI / 4)).toBeCloseTo(Math.SQRT1_2, 15);
    expect(simCos(Math.PI / 6)).toBeCloseTo(SQRT3_2, 15);
    expect(simCos(Math.PI / 2)).toBeCloseTo(0, 15);
    expect(simCos(Math.PI)).toBeCloseTo(-1, 15);
    expect(simCos((3 * Math.PI) / 2)).toBeCloseTo(0, 15);
  });

  it('is even', () => {
    for (const x of [0.1, 1, 2.5, 4, 10, 63.9]) expect(simCos(-x)).toBe(simCos(x));
  });

  it('satisfies sin^2 + cos^2 = 1 to within rounding', () => {
    for (let i = -64; i <= 64; i++) {
      const x = i * 0.7;
      expect(simSin(x) ** 2 + simCos(x) ** 2).toBeCloseTo(1, 15);
    }
  });

  it('returns NaN for non-finite input', () => {
    expect(simCos(NaN)).toBeNaN();
    expect(simCos(Infinity)).toBeNaN();
  });
});

describe('simTan', () => {
  it('is sin over cos', () => {
    for (const x of [0, 0.3, 1, -1.2, 2.9]) expect(simTan(x)).toBe(simSin(x) / simCos(x));
  });

  it('is 1 at pi/4', () => {
    expect(simTan(Math.PI / 4)).toBeCloseTo(1, 15);
  });
});

describe('verifyAgainstNative', () => {
  it('reports at most one ULP from the host over a 20 000-sample sweep of +/-64 rad', () => {
    const report = verifyAgainstNative(20_000);
    expect(report.samples).toBe(20_000);
    expect(report.maxUlpSin).toBeLessThanOrEqual(1);
    expect(report.maxUlpCos).toBeLessThanOrEqual(1);
  });
});

/**
 * The four lines three shooters used to carry each, pinned against the helper that now holds
 * them (BACKLOG #27).
 *
 * The expressions below are the **old** code, written out: `cp` factored first, then
 * `-simSin(yaw) * cp`, `simSin(pitch)` and `-simCos(yaw) * cp`, in that order and with those
 * signs. That is what makes this a pin rather than a tautology — it does not call the helper
 * to decide what the helper should say, it records what a sentry's round, a chopper gunner's
 * round and the flamethrower's jet were aimed along before the three were folded into one.
 *
 * `toBe`, not `toBeCloseTo`: R5 is about the last bit. A rewrite that factored `cp` out
 * differently, or reached for `Math.sin`, would be correct to fourteen decimals and would put
 * a round somewhere else on another engine, which is the failure this guards.
 */
describe('lookDirection', () => {
  const out = makeLookDir();

  /** Zero, the four quadrants' diagonals, straight up and down, and a pair off the grid. */
  const angles: readonly (readonly [number, number])[] = [
    [0, 0],
    [Math.PI / 4, 0],
    [-Math.PI / 4, 0],
    [Math.PI * 0.75, 0],
    [-Math.PI * 0.75, 0],
    [0, Math.PI / 2],
    [0, -Math.PI / 2],
    [0, 0.3],
    [1.1, -0.45],
    [-2.7, 1.2],
    [17.3, 0.87],
  ];

  for (const [yaw, pitch] of angles) {
    it(`matches the expression it replaced at yaw ${yaw.toFixed(3)}, pitch ${pitch.toFixed(3)}`, () => {
      const cp = simCos(pitch);
      const dx = -simSin(yaw) * cp;
      const dy = simSin(pitch);
      const dz = -simCos(yaw) * cp;

      lookDirection(yaw, pitch, out);
      expect(out.dx).toBe(dx);
      expect(out.dy).toBe(dy);
      expect(out.dz).toBe(dz);
    });
  }

  it('writes in place, into whatever object the caller lent it', () => {
    // The flamethrower lends its own jet record, which carries six fields and not three.
    const jet = { dx: 9, dy: 9, dz: 9, eyeX: 1, eyeY: 2, eyeZ: 3 };
    lookDirection(0, 0, jet);
    // `dx` is negative zero, because the expression is `-simSin(0) * cp` and always was.
    expect(jet).toEqual({ dx: -0, dy: 0, dz: -1, eyeX: 1, eyeY: 2, eyeZ: 3 });
  });

  it('is a unit vector, which is what the ballistics caller assumes', () => {
    for (const [yaw, pitch] of angles) {
      lookDirection(yaw, pitch, out);
      expect(Math.hypot(out.dx, out.dy, out.dz)).toBeCloseTo(1, 15);
    }
  });
});
