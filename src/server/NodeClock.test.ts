import { describe, expect, it } from 'vitest';
import { nodeClock } from './NodeClock';

/**
 * Node's implementation of the shared clock (B8).
 *
 * `process.hrtime.bigint()` rather than `performance.now()`, and not only because S3 forbids
 * naming the browser API on the server: `hrtime` is the monotonic high-resolution source Node
 * actually guarantees — unaffected by wall-clock adjustment, with no relationship to
 * `Date.now()` — which is exactly the contract `Clock` states. These three tests are that
 * contract: the unit, the origin and the direction.
 */

describe('nodeClock', () => {
  it('starts near zero, because it measures from its own origin', () => {
    // Not a wall clock: a value anywhere near `Date.now()` would mean the origin was wrong.
    expect(nodeClock.nowMs()).toBeLessThan(60_000);
    expect(nodeClock.nowMs()).toBeGreaterThanOrEqual(0);
  });

  it('reports milliseconds, fractionally', () => {
    const a = nodeClock.nowMs();
    const spin = Date.now() + 2;
    while (Date.now() < spin) {
      /* two milliseconds of real time */
    }
    const b = nodeClock.nowMs();

    expect(b - a).toBeGreaterThan(1);
    expect(b - a).toBeLessThan(1_000);
  });

  it('never goes backwards', () => {
    let previous = nodeClock.nowMs();
    for (let i = 0; i < 500; i++) {
      const next = nodeClock.nowMs();
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });
});
