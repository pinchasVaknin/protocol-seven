import { describe, expect, it } from 'vitest';
import { CROSSHAIR_LINE_LENGTH, CROSSHAIR_MIN_GAP, crosshairGapPx, crosshairOpacity } from './Crosshair';

/**
 * The reticle as arithmetic (playtest round 4, B2).
 *
 * The gap is the spread cone projected onto the screen, so these numbers are a claim about what
 * the player is shown. `npm run readability` measures them over the shipped roster; this pins
 * the function itself, including the two clamps and the field-of-view guard that the roster
 * never reaches and a future weapon would.
 *
 * Exact `toBe` throughout: the result is rounded to a whole pixel, so there is nothing
 * approximate left to allow for.
 */

describe('CROSSHAIR_MIN_GAP', () => {
  it('is a legibility floor, not zero, so a perfect weapon still has a reticle', () => {
    expect(CROSSHAIR_MIN_GAP).toBe(3);
    expect(CROSSHAIR_LINE_LENGTH).toBe(7);
  });
});

describe('crosshairGapPx', () => {
  it('projects the cone: a wider spread opens the gap', () => {
    expect(crosshairGapPx(0.9, 90, 1080)).toBe(8);
    expect(crosshairGapPx(2, 90, 1080)).toBe(19);
    expect(crosshairGapPx(10, 90, 1080)).toBe(95);
  });

  it('scales with the viewport, because it is a ratio against the half-height', () => {
    expect(crosshairGapPx(1, 75, 720)).toBe(8);
  });

  it('sits on the floor for a perfectly accurate weapon rather than collapsing to a plus sign', () => {
    expect(crosshairGapPx(0, 90, 1080)).toBe(CROSSHAIR_MIN_GAP);
    expect(crosshairGapPx(0.001, 90, 1080)).toBe(CROSSHAIR_MIN_GAP);
  });

  it('clamps at the far end, where the cross has left the screen', () => {
    expect(crosshairGapPx(45, 90, 1080)).toBe(220);
    expect(crosshairGapPx(89, 90, 1080)).toBe(220);
  });

  it('falls to the floor rather than dividing by a degenerate field of view', () => {
    expect(crosshairGapPx(2, 0, 1080)).toBe(CROSSHAIR_MIN_GAP);
  });

  it('falls to the floor on a zero-height viewport', () => {
    expect(crosshairGapPx(2, 90, 0)).toBe(CROSSHAIR_MIN_GAP);
  });

  it('is a whole number of pixels for every state on the roster scale', () => {
    for (let spread = 0; spread <= 12; spread += 0.1) {
      const gap = crosshairGapPx(spread, 90, 1080);
      expect(Number.isInteger(gap)).toBe(true);
      expect(gap).toBeGreaterThanOrEqual(CROSSHAIR_MIN_GAP);
      expect(gap).toBeLessThanOrEqual(220);
    }
  });

  it('never shrinks as the cone widens', () => {
    let previous = 0;
    for (let spread = 0; spread <= 20; spread += 0.25) {
      const gap = crosshairGapPx(spread, 90, 1080);
      expect(gap).toBeGreaterThanOrEqual(previous);
      previous = gap;
    }
  });
});

describe('crosshairOpacity', () => {
  it('is fully opaque at the hip', () => {
    expect(crosshairOpacity(0)).toBe(1);
  });

  it('fades through the ADS transition', () => {
    expect(crosshairOpacity(0.1)).toBe(0.87);
    expect(crosshairOpacity(0.37)).toBe(0.5);
    expect(crosshairOpacity(0.5)).toBe(0.32);
    expect(crosshairOpacity(0.7)).toBe(0.06);
  });

  it('is gone by 0.74, which is before the scope overlay takes over at 0.8', () => {
    expect(crosshairOpacity(0.74)).toBe(0);
    expect(crosshairOpacity(0.8)).toBe(0);
    expect(crosshairOpacity(1)).toBe(0);
  });

  it('never leaves a frame in which both the cross and a scope overlay are drawn', () => {
    for (let ads = 0.8; ads <= 1; ads += 0.01) {
      expect(crosshairOpacity(ads)).toBe(0);
    }
  });

  it('clamps rather than going negative or above one', () => {
    expect(crosshairOpacity(-1)).toBe(1);
    expect(crosshairOpacity(99)).toBe(0);
  });

  it('is quantised to two decimals, so a style write never churns', () => {
    for (let ads = 0; ads <= 1; ads += 0.013) {
      const opacity = crosshairOpacity(ads);
      // Compared the way the function builds it. Multiplying back out by 100 would reintroduce
      // the float error the rounding just took out: 0.58 * 100 is 57.99999999999999.
      expect(opacity).toBe(Math.round(opacity * 100) / 100);
    }
  });
});
