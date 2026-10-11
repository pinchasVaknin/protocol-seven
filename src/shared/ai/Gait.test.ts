import { describe, expect, it } from 'vitest';
import { HUMANOID_RIG } from '../combat/HitboxRig';
import { simSin } from '../core/SimMath';
import {
  AMPLITUDE_RESPONSE,
  ARM_PITCH,
  LEG_LENGTH,
  LEG_PIVOT_Y,
  MAX_SWING,
  STRIDE_METRES,
  advanceGaitPhase,
  armDivergence,
  gaitAmplitude,
  gaitAt,
  legDivergence,
  slideFraction,
  soleExcursion,
  solePosition,
} from './Gait';

/**
 * The walk cycle, as arithmetic — pinned.
 *
 * This file exists so that `npm run readability` can settle the questions about a gait that are
 * answerable without a screen, and the tests are the same questions: is it periodic, is it
 * symmetric, is the foot on the ground when it should be, and how far does the drawn leg get
 * from the box a shot is tested against.
 *
 * Two of them are properties the design deliberately does *not* satisfy — the foot slides and
 * the sole rises at the extremes of the stride, both because a rigid leg on a fixed hip sweeps
 * an arc. Those are asserted as being non-zero rather than as being small: F4's instruction is
 * that they be *stated*, and a test that demanded they be zero would be a test demanding a knee.
 */

describe('the numbers the gait is built from', () => {
  it('come off the rig, so the animation and the hitboxes cannot drift', () => {
    const leg = HUMANOID_RIG.boxes.find((b) => b.name === 'legL');
    const arm = HUMANOID_RIG.boxes.find((b) => b.name === 'armL');
    expect(leg).toBeDefined();
    expect(arm).toBeDefined();
    expect(LEG_LENGTH).toBe(leg?.sy);
    expect(LEG_PIVOT_Y).toBe((leg?.oy ?? 0) + (leg?.sy ?? 0) * 0.5);
  });

  it('are the authored cadence, swing and arm pose', () => {
    expect(STRIDE_METRES).toBe(3.07);
    expect(MAX_SWING).toBe(0.62);
    expect(ARM_PITCH).toBe(0.55);
    expect(AMPLITUDE_RESPONSE).toBe(9);
  });

  it('put the hip above the sole by half a leg', () => {
    expect(LEG_PIVOT_Y).toBeGreaterThan(LEG_LENGTH * 0.5);
    expect(LEG_PIVOT_Y).toBeLessThan(LEG_LENGTH * 1.5);
  });
});

describe('the phase', () => {
  it('is distance, not time: a body that does not move does not walk', () => {
    expect(advanceGaitPhase(0.3, 0)).toBe(0.3);
  });

  it('advances by one cycle per stride', () => {
    expect(advanceGaitPhase(0, STRIDE_METRES * 0.5)).toBe(0.5);
    expect(advanceGaitPhase(0, STRIDE_METRES * 0.25)).toBe(0.25);
  });

  it('wraps into [0, 1) however far the body was carried', () => {
    for (const metres of [STRIDE_METRES, STRIDE_METRES * 2.5, 400, -37]) {
      const phase = advanceGaitPhase(0.2, metres);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
    // A respawn across the map costs the same as a step.
    expect(advanceGaitPhase(0, STRIDE_METRES * 3)).toBeCloseTo(0, 10);
  });

  it('reads a backward step as a step, not as a rewind', () => {
    expect(advanceGaitPhase(0, -STRIDE_METRES * 0.5)).toBe(0.5);
  });
});

describe('the amplitude', () => {
  it('is nothing at a standstill and full at the run speed', () => {
    expect(gaitAmplitude(0)).toBe(0);
    expect(gaitAmplitude(-1)).toBe(0);
    expect(gaitAmplitude(4)).toBe(1);
    expect(gaitAmplitude(9)).toBe(1);
  });

  it('ramps linearly between them, which is what returns a stopping body to standing', () => {
    expect(gaitAmplitude(2)).toBe(0.5);
    expect(gaitAmplitude(1)).toBe(0.25);
  });
});

describe('the two legs', () => {
  it('stand still at zero amplitude, whatever the phase', () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const pose = gaitAt(phase, 0);
      // Magnitude, because a zero amplitude times a negative sine is a signed zero.
      expect(Math.abs(pose.left.swing)).toBe(0);
      expect(Math.abs(pose.right.swing)).toBe(0);
    }
  });

  it('are half a cycle apart, which is what makes it a walk', () => {
    for (const phase of [0, 0.1, 0.33, 0.7, 0.95]) {
      const pose = gaitAt(phase, 1);
      const shifted = gaitAt(phase + 0.5, 1);
      expect(pose.right.swing).toBeCloseTo(shifted.left.swing, 12);
    }
  });

  it('are periodic: a whole cycle on is the same pose', () => {
    const start = gaitAt(0.3, 1);
    const later = gaitAt(1.3, 1);
    expect(later.left.swing).toBeCloseTo(start.left.swing, 12);
    expect(later.right.swing).toBeCloseTo(start.right.swing, 12);
  });

  it('reach the authored swing at the quarter points and cross at the halves', () => {
    expect(gaitAt(0.25, 1).left.swing).toBeCloseTo(MAX_SWING, 9);
    expect(gaitAt(0.75, 1).left.swing).toBeCloseTo(-MAX_SWING, 9);
    expect(gaitAt(0, 1).left.swing).toBeCloseTo(0, 9);
    expect(gaitAt(0.5, 1).left.swing).toBeCloseTo(0, 9);
  });

  it('scale with the amplitude rather than changing shape', () => {
    const full = gaitAt(0.25, 1).left.swing;
    expect(gaitAt(0.25, 0.5).left.swing).toBeCloseTo(full * 0.5, 12);
  });
});

describe('where the sole ends up', () => {
  it('is on the ground at mid-stride, where the leg hangs straight', () => {
    const flat = solePosition({ swing: 0 });
    expect(flat.forward).toBe(0);
    expect(flat.rise).toBe(0);
  });

  it('carries forward on a positive swing and back on a negative one', () => {
    expect(solePosition({ swing: 0.4 }).forward).toBeGreaterThan(0);
    expect(solePosition({ swing: -0.4 }).forward).toBeLessThan(0);
  });

  it('rises at the extremes, because a rigid leg sweeps an arc', () => {
    // Not compensated anywhere, and that is a decision rather than an omission.
    expect(solePosition({ swing: MAX_SWING }).rise).toBeGreaterThan(0);
    expect(solePosition({ swing: -MAX_SWING }).rise).toBeGreaterThan(0);
    expect(solePosition({ swing: MAX_SWING }).rise).toBe(
      solePosition({ swing: -MAX_SWING }).rise,
    );
  });

  it('never reaches further than the leg is long', () => {
    expect(Math.abs(solePosition({ swing: MAX_SWING }).forward)).toBeLessThan(LEG_LENGTH);
  });
});

describe('the foot slide, stated rather than hidden', () => {
  it('is a real fraction of the stride, because there is no knee', () => {
    const slide = slideFraction(1);
    expect(slide).toBeGreaterThan(0);
    expect(slide).toBeLessThan(1);
    expect(soleExcursion(1)).toBe(2 * LEG_LENGTH * simSin(MAX_SWING));
    expect(soleExcursion(1)).toBeLessThan(STRIDE_METRES);
  });

  it('is total at a standstill, where the sole covers no ground at all', () => {
    expect(soleExcursion(0)).toBe(0);
    expect(slideFraction(0)).toBe(1);
  });

  it('grows as the swing shrinks', () => {
    expect(slideFraction(0.5)).toBeGreaterThan(slideFraction(1));
  });
});

describe('how far a drawn limb gets from its box', () => {
  it('is nothing when the limb is where its box is', () => {
    expect(legDivergence(0)).toBe(0);
  });

  it('grows with the swing, and is the same either way', () => {
    const small = legDivergence(0.2);
    const large = legDivergence(MAX_SWING);
    expect(large).toBeGreaterThan(small);
    expect(legDivergence(-MAX_SWING)).toBe(large);
  });

  it('is the number F4 asks to be stated: a leg at full swing leaves its box', () => {
    expect(legDivergence(MAX_SWING)).toBeGreaterThan(0);
  });

  it('reports the arm as well, which does not move and is not where its box is either', () => {
    expect(armDivergence()).toBeGreaterThan(0);
    expect(armDivergence()).toBe(armDivergence());
  });
});
