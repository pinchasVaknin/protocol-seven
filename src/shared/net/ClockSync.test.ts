import { describe, expect, it } from 'vitest';
import { ClockSync } from './ClockSync';

/**
 * The lead, eased (part 5).
 *
 * The lead is half the window's mean round trip plus twice its mean deviation, recomputed at every
 * ping, and one slow sample moves both — so a spike could put the target tick several ticks on in
 * one step, which the client then read as having stalled. These hold the lead in use to moving a
 * quarter of the way per update, and to arriving.
 */

/** Feed `count` round trips of `rttMs`, 250 ms apart, against a server running in step. */
function feed(clock: ClockSync, rttMs: number, count: number, startMs: number): number {
  let t = startMs;
  for (let i = 0; i < count; i++) {
    clock.sample(t, t + rttMs, t + rttMs / 2, Math.round((t + rttMs / 2) / (1000 / 60)));
    t += 250;
  }
  return t;
}

describe('ClockSync lead', () => {
  it('takes the first lead whole', () => {
    const clock = new ClockSync();
    feed(clock, 88, 1, 0);
    expect(clock.leadMs()).toBeCloseTo(clock.wantedLeadMs(), 6);
  });

  it('moves a quarter of the way to a new lead per update, a tick at a time', () => {
    const clock = new ClockSync();
    let t = feed(clock, 88, 16, 0);
    const settled = clock.leadMs();
    const settledTicks = clock.leadTicks();

    // One round trip at 400 ms: the window's mean and deviation both jump.
    t = feed(clock, 400, 1, t);
    const wanted = clock.wantedLeadMs();
    expect(wanted - settled).toBeGreaterThan(40);
    expect(clock.leadMs() - settled).toBeCloseTo((wanted - settled) * 0.25, 6);
    // What the client sees is its target tick, and that moved by one tick, not by the whole jump.
    expect(clock.leadTicks() - settledTicks).toBeLessThanOrEqual(1);

    // And it gets there: the spike stays in the window, so the wanted lead holds and is reached.
    let previous = clock.leadTicks();
    for (let i = 0; i < 20; i++) {
      clock.noteStarvation(0);
      const now = clock.leadTicks();
      expect(Math.abs(now - previous)).toBeLessThanOrEqual(1);
      previous = now;
    }
    expect(clock.leadMs()).toBeCloseTo(clock.wantedLeadMs(), 0);
    void t;
  });

  it('starts again from nothing after a reset', () => {
    const clock = new ClockSync();
    feed(clock, 300, 8, 0);
    clock.reset();
    feed(clock, 40, 1, 10_000);
    expect(clock.leadMs()).toBeCloseTo(clock.wantedLeadMs(), 6);
  });
});
