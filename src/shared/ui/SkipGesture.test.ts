import { describe, expect, it } from 'vitest';
import {
  SKIP_FAST_FORWARD,
  SKIP_HOLD_SECONDS,
  SKIP_TAP_WINDOW_SECONDS,
  SKIP_TAPS_TO_LEAVE,
  SkipGesture,
} from './SkipGesture';

/**
 * The eight rules an edit next door would break in silence.
 *
 * The whole feature is timing, and neither consumer can be asked about timing without a
 * browser — the intro's flyover and the debrief's choreography both run off a render frame.
 * So the rules live here, where a wrong threshold is a red test and not a playtest note.
 */
describe('the skip gesture', () => {
  /** A press and a release `seconds` apart, starting at `at`. Returns what the release said. */
  function tap(g: SkipGesture, at: number, seconds = 0.05): boolean {
    g.press(at);
    return g.release(at + seconds);
  }

  it('pays no boost until the hold threshold, and the full rate after it', () => {
    const g = new SkipGesture();
    g.press(10);
    expect(g.holding(10)).toBe(false);
    expect(g.boost(10 + SKIP_HOLD_SECONDS / 2, 0.016)).toBe(0);
    const past = 10 + SKIP_HOLD_SECONDS + 0.01;
    expect(g.holding(past)).toBe(true);
    expect(g.boost(past, 0.016)).toBeCloseTo(0.016 * (SKIP_FAST_FORWARD - 1));
  });

  it('pays nothing at all while the key is up', () => {
    const g = new SkipGesture();
    expect(g.holding(0)).toBe(false);
    expect(g.boost(0, 0.016)).toBe(0);
    tap(g, 1);
    expect(g.boost(2, 0.016)).toBe(0);
  });

  it('leaves on the third quick tap and not on the second', () => {
    const g = new SkipGesture();
    expect(tap(g, 0)).toBe(false);
    expect(tap(g, 0.2)).toBe(false);
    expect(tap(g, 0.4)).toBe(true);
  });

  it('starts a new run when a tap comes too late, so three slow taps do nothing', () => {
    const g = new SkipGesture();
    const slow = SKIP_TAP_WINDOW_SECONDS + 0.1;
    expect(tap(g, 0)).toBe(false);
    expect(tap(g, slow)).toBe(false);
    expect(tap(g, slow * 2)).toBe(false);
    // The run restarted twice; two more inside the window complete this one.
    expect(tap(g, slow * 2 + 0.2)).toBe(false);
    expect(tap(g, slow * 2 + 0.4)).toBe(true);
  });

  it('does not count a hold as a tap, and a hold clears the run behind it', () => {
    const g = new SkipGesture();
    expect(tap(g, 0)).toBe(false);
    expect(tap(g, 0.2)).toBe(false);
    // A scrub, not a third press: the two taps before it are forgotten.
    expect(tap(g, 0.4, SKIP_HOLD_SECONDS + 0.5)).toBe(false);
    expect(tap(g, 1.2)).toBe(false);
    expect(tap(g, 1.4)).toBe(false);
    expect(tap(g, 1.6)).toBe(true);
  });

  it('ignores a release with no press behind it', () => {
    const g = new SkipGesture();
    expect(g.release(0)).toBe(false);
    expect(tap(g, 0.2)).toBe(false);
    expect(g.release(0.3)).toBe(false);
    expect(tap(g, 0.4)).toBe(false);
    expect(tap(g, 0.6)).toBe(true);
  });

  it('ignores a second press with no release between, so a lost keyup cannot shorten a hold', () => {
    const g = new SkipGesture();
    g.press(0);
    g.press(0.5);
    expect(g.holding(0.1 + SKIP_HOLD_SECONDS)).toBe(true);
    expect(g.release(0.55)).toBe(false);
  });

  it('forgets a held key on reset, so the next screen is not fast-forwarded by nobody', () => {
    const g = new SkipGesture();
    g.press(0);
    expect(g.holding(1)).toBe(true);
    g.reset();
    expect(g.holding(1)).toBe(false);
    expect(g.boost(1, 0.016)).toBe(0);
    // And the run is gone with it: three fresh taps are needed.
    expect(tap(g, 2)).toBe(false);
    expect(tap(g, 2.2)).toBe(false);
    expect(tap(g, 2.4)).toBe(true);
  });

  it('is tuned so a tap can never leak boost, and so leaving takes more than a double press', () => {
    expect(SKIP_TAPS_TO_LEAVE).toBeGreaterThan(2);
    expect(SKIP_HOLD_SECONDS).toBeLessThan(SKIP_TAP_WINDOW_SECONDS);
    expect(SKIP_FAST_FORWARD).toBeGreaterThan(1);
  });
});
