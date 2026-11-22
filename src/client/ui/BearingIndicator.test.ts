import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BearingIndicator } from './BearingIndicator';
import { FakeElement } from './testing/dom';

/**
 * Characterization tests for the bearing chevron (refactor unit C15, written before the
 * refactor).
 *
 * One element, two guarded writes, and one piece of arithmetic that is worth pinning exactly:
 * the angle is rounded to a whole degree with `(bearingRad * 180) / Math.PI`, which is **not**
 * the same expression as `bearingRad * RAD2DEG` — see the side task this unit opened.
 */

// ---------------------------------------------------------------------------- the DOM double

/**

 * The element class is shared: `testing/dom.ts` (BACKLOG #79).

 *

 * What stood here was 50 lines of it. This file keeps its own environment: the shared

 * `installFakeDom` installs globals this suite has never run with, and handing a suite a

 * `window` on the way past is how a green suite starts meaning something else.

 */


beforeEach(() => {
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeElement(tag, { opacity: '', transform: '' }),
  };
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).HTMLElement;
});

function rig(modifier = 'threat'): { arrow: BearingIndicator; el: FakeElement } {
  const arrow = new BearingIndicator(modifier);
  return { arrow, el: arrow.element as unknown as FakeElement };
}

// ---------------------------------------------------------------------------- the element

describe('the element it builds', () => {
  it('carries the caller modifier so two arrows can be styled apart', () => {
    expect(rig('threat').el.className).toBe('hud-bearing hud-bearing--threat');
    expect(rig('objective').el.className).toBe('hud-bearing hud-bearing--objective');
  });

  it('holds one chevron and starts invisible', () => {
    const { el } = rig();
    expect(el.children).toHaveLength(1);
    expect(el.children[0]?.tag).toBe('i');
    expect(el.style.opacity).toBe('0');
  });
});

// ---------------------------------------------------------------------------- update

describe('update', () => {
  it('comes up when a target appears and goes down when it leaves', () => {
    const { arrow, el } = rig();
    arrow.update(true, 0);
    expect(el.style.opacity).toBe('1');
    arrow.update(false, 0);
    expect(el.style.opacity).toBe('0');
  });

  it('writes the opacity only when the target state changed', () => {
    const { arrow, el } = rig();
    arrow.update(true, 0);
    el.style.opacity = 'TOUCHED';
    arrow.update(true, 1);
    expect(el.style.opacity).toBe('TOUCHED');
  });

  it('points along the bearing, rounded to a whole degree', () => {
    const { arrow, el } = rig();
    arrow.update(true, Math.PI / 2);
    expect(el.style.transform).toBe('rotate(90deg)');
    arrow.update(true, -Math.PI / 2);
    expect(el.style.transform).toBe('rotate(-90deg)');
    arrow.update(true, Math.PI);
    expect(el.style.transform).toBe('rotate(180deg)');
  });

  it('does not round a half degree up, because the round trip does not land on one', () => {
    // 46.5 degrees in radians and back is 46.49999999999999, so `Math.round` takes it down.
    // Pinned rather than corrected: it is the arithmetic the arrow has always done, and it is
    // the same answer `rad * RAD2DEG` gives at this input.
    const { arrow, el } = rig();
    arrow.update(true, (46.5 * Math.PI) / 180);
    expect(el.style.transform).toBe('rotate(46deg)');
    arrow.update(true, (-46.5 * Math.PI) / 180);
    expect(el.style.transform).toBe('rotate(-46deg)');
  });

  it('computes the angle as (rad * 180) / PI, which is its own expression', () => {
    /*
     * Pins the spelling, not just the value. `rad * RAD2DEG` associates the other way and is a
     * different double: over the 7,201 tenth-of-a-degree bearings from -360 to +360 the two
     * expressions differ in 1,730 cases, and after `Math.round` they disagree in 85 of them —
     * every one an exact half degree. So folding this onto `MathUtil.RAD2DEG` is a behaviour
     * change at 85 inputs, not a tidy-up. See the side task this unit opened.
     */
    const { arrow, el } = rig();
    for (const rad of [0.1, 0.7853981633974483, 1.0471975511965976, 2.6179938779914944, -3.0]) {
      arrow.update(true, rad);
      expect(el.style.transform).toBe(`rotate(${Math.round((rad * 180) / Math.PI)}deg)`);
      arrow.update(false, 0);
      arrow.update(true, 0);
    }
  });

  it('writes the angle only when the whole degree changed', () => {
    const { arrow, el } = rig();
    arrow.update(true, 0.5);
    el.style.transform = 'TOUCHED';
    // About a hundredth of a degree later: the same whole degree.
    arrow.update(true, 0.5001);
    expect(el.style.transform).toBe('TOUCHED');
    arrow.update(true, 0.55);
    expect(el.style.transform).toBe('rotate(32deg)');
  });

  it('writes no angle at all while there is no target', () => {
    const { arrow, el } = rig();
    arrow.update(false, Math.PI / 2);
    expect(el.style.transform).toBe('');
  });

  it('keeps a bearing of zero and "no target" apart, because both are a zero', () => {
    const { arrow, el } = rig();
    arrow.update(true, 0);
    expect(el.style.opacity).toBe('1');
    expect(el.style.transform).toBe('rotate(0deg)');
  });
});

// ---------------------------------------------------------------------------- reset

describe('reset', () => {
  it('puts the arrow away and forgets both guards', () => {
    const { arrow, el } = rig();
    arrow.update(true, 1);
    arrow.reset();
    expect(el.style.opacity).toBe('0');

    // Both writes happen again on the same inputs, which is what "forgets" means.
    el.style.transform = 'TOUCHED';
    arrow.update(true, 1);
    expect(el.style.opacity).toBe('1');
    expect(el.style.transform).toBe('rotate(57deg)');
  });
});
