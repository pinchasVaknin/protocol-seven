import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { ClockSync } from './ClockSync';

/**
 * The lead, eased (part 5).
 *
 * The lead is half the window's mean round trip plus twice its mean deviation, recomputed at every
 * ping, and one slow sample moves both — so a spike could put the target tick several ticks on in
 * one step, which the client then read as having stalled. These hold the lead in use to moving a
 * quarter of the way per update, and to arriving.
 */

/** The clock the estimator reads. A23's tick tests move it; the lead tests do not read it. */
let now = 0;
installClock({ nowMs: () => now });

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

/**
 * The offset, the margin and the starvation feed (A23).
 *
 * The lead above was the only thing pinned here. These cover the two decisions the estimator
 * is actually built around — the offset comes from the *fastest* sample in the window, and the
 * handshake's seed is a guess that the first real sample replaces rather than averages with —
 * because both of them were playtest bugs, and both are invisible until a client rubberbands.
 */
describe('the offset', () => {
  it('takes the seed as a guess, with no round trip claimed', () => {
    const clock = new ClockSync();
    clock.seed(20_000, 1200, 1000);
    expect(clock.synced).toBe(true);
    // serverMs - receivedAtMs, and nothing else: a one-way timestamp says no more than that.
    expect(clock.offsetMs).toBe(19_000);
    expect(clock.rttMs).toBe(0);
    expect(clock.jitterMs).toBe(0);
  });

  it('replaces the seed with the first real sample rather than easing toward it', () => {
    const clock = new ClockSync();
    clock.seed(20_000, 1200, 1000);
    // One round trip of 100 ms, whose own offset is 19_050.
    clock.sample(1000, 1100, 20_100, 1206);
    // Had the guess been averaged with the measurement, this would sit between the two.
    expect(clock.offsetMs).toBe(19_050);
    expect(clock.rttMs).toBe(100);
  });

  it('elects the offset of the fastest round trip in the window', () => {
    const clock = new ClockSync();
    // A slow sample first, then a fast one. The fast one's offset must win outright.
    clock.sample(0, 400, 20_200, 1200);
    const slowOffset = clock.offsetMs;
    clock.sample(1000, 1020, 21_060, 1260);
    const fastOffset = 21_060 + 10 - 1020;
    expect(fastOffset).not.toBe(slowOffset);
    // Moved a quarter of the way toward it rather than snapped, so the tick number does not jerk.
    expect(clock.offsetMs).toBeCloseTo(slowOffset + (fastOffset - slowOffset) * 0.25, 6);
  });

  it('reports the mean round trip and its mean absolute deviation', () => {
    const clock = new ClockSync();
    clock.sample(0, 100, 10_050, 600);
    clock.sample(1000, 1200, 11_100, 660);
    expect(clock.rttMs).toBe(150);
    expect(clock.jitterMs).toBe(50);
  });

  it('refuses a round trip that cannot be one', () => {
    const clock = new ClockSync();
    clock.sample(0, 100, 10_050, 600);
    const rtt = clock.rttMs;
    clock.sample(1000, 900, 11_000, 660);
    clock.sample(0, 20_000, 11_000, 660);
    clock.sample(0, Number.NaN, 11_000, 660);
    expect(clock.rttMs).toBe(rtt);
  });
});

describe('the margin', () => {
  it('never falls below a tick of slack, however perfect the link', () => {
    const clock = new ClockSync();
    clock.sample(0, 0, 10_000, 600);
    expect(clock.marginMs()).toBeCloseTo(1000 / 60, 6);
  });

  it('is capped, so a pathological link cannot push the client absurdly far ahead', () => {
    const clock = new ClockSync();
    let t = 0;
    for (let i = 0; i < 16; i++) {
      const rtt = i % 2 === 0 ? 20 : 2000;
      clock.sample(t, t + rtt, t + rtt / 2, Math.round((t + rtt / 2) / (1000 / 60)));
      t += 250;
    }
    expect(clock.jitterMs * 2).toBeGreaterThan(150);
    expect(clock.marginMs()).toBe(150);
  });

  it('earns lead quickly from reported starvation and gives it back slowly', () => {
    const clock = new ClockSync();
    clock.sample(0, 100, 10_050, 600);
    clock.noteStarvation(3);
    expect(clock.adaptiveMs).toBe(18);
    clock.noteStarvation(0);
    expect(clock.adaptiveMs).toBeCloseTo(17.85, 6);
    for (let i = 0; i < 200; i++) clock.noteStarvation(0);
    expect(clock.adaptiveMs).toBe(0);
  });

  it('caps the earned lead at the margin ceiling', () => {
    const clock = new ClockSync();
    clock.sample(0, 100, 10_050, 600);
    clock.noteStarvation(60);
    expect(clock.adaptiveMs).toBe(150);
  });
});

describe('the tick the client runs at', () => {
  it('is the server’s tick plus the lead, derived and never incremented', () => {
    const clock = new ClockSync();
    clock.seed(20_000, 1200, 1000);
    now = 1000;
    expect(clock.serverTickFractional()).toBeCloseTo(1200, 6);
    expect(clock.estimatedServerTick()).toBe(1200);
    expect(clock.targetTick()).toBe(Math.ceil(1200 + clock.leadTicks()));

    // A tenth of a second later the estimate has moved on by six ticks, with no sample.
    now = 1100;
    expect(clock.serverTickFractional()).toBeCloseTo(1206, 6);
  });

  it('answers nothing until it has been told anything', () => {
    const clock = new ClockSync();
    expect(clock.synced).toBe(false);
    expect(clock.targetTick()).toBe(0);
    expect(clock.serverTickFractional()).toBe(0);
    expect(clock.estimatedServerTick()).toBe(0);
  });

  it('forgets the window, the seed and the earned lead on a reset', () => {
    const clock = new ClockSync();
    clock.seed(20_000, 1200, 1000);
    clock.sample(0, 100, 10_050, 600);
    clock.noteStarvation(5);
    clock.reset();
    expect(clock.synced).toBe(false);
    expect(clock.rttMs).toBe(0);
    expect(clock.jitterMs).toBe(0);
    expect(clock.offsetMs).toBe(0);
    expect(clock.adaptiveMs).toBe(0);
  });
});
