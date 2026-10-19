import { describe, expect, it } from 'vitest';
import { Btn, LIVE_BUTTONS, type MutableInputCommand } from '../../shared/core/InputCommand';
import { MAX_TICK_SKEW } from '../../shared/net/Protocol';
import { RateLimiter, Reject, RejectCounters, TokenBucket, validateCommand } from './Validation';

describe('TokenBucket', () => {
  it('allows the burst at once and refuses the next', () => {
    const b = new TokenBucket(3, 1);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
  });

  it('refills at its rate, and never past the burst', () => {
    const b = new TokenBucket(2, 2);
    b.take(0);
    b.take(0);
    expect(b.take(400)).toBe(false); // 0.8 of a token
    expect(b.take(500)).toBe(true); // 1.0
    // A long silence refills to the burst, not beyond it.
    expect([b.take(60_000), b.take(60_000), b.take(60_000)]).toEqual([true, true, false]);
  });

  it('earns nothing from a clock that steps backwards', () => {
    const b = new TokenBucket(1, 1);
    b.take(10_000);
    expect(b.take(0)).toBe(false);
    expect(b.take(500)).toBe(false);
  });
});

/**
 * The buttons mask at the server's door (2026-09-28).
 *
 * It was a literal, eighteen bits wide because `Btn.Melee` was the highest bit — so the first bit
 * added after it, `Btn.Targeting`, would have been dropped on arrival and the server would have gone
 * on firing the click that confirms a mortar mark, with nothing anywhere to say why. The mask is
 * `Btn`'s own union now; these hold it there.
 */

function command(buttons: number): MutableInputCommand {
  return { seq: 1, tickIndex: 100, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons, sampledAtMs: 0 };
}

describe('validateCommand, the buttons', () => {
  it('keeps every bit Btn names, the newest included', () => {
    for (const bit of Object.values(Btn)) {
      const cmd = command(bit);
      expect(validateCommand(cmd, 100)).toBe(Reject.None);
      expect(cmd.buttons).toBe(bit);
    }
    const all = command(LIVE_BUTTONS);
    validateCommand(all, 100);
    expect(all.buttons & Btn.Targeting).toBe(Btn.Targeting);
  });

  it('drops the bits nothing names', () => {
    const cmd = command(Btn.Fire | (1 << 30));
    validateCommand(cmd, 100);
    expect(cmd.buttons).toBe(Btn.Fire);
  });
});

/**
 * The rest of the boundary (B1).
 *
 * `TokenBucket` and the buttons mask were covered; the sliding window, the counters and the
 * clamping half of `validateCommand` were not. The nine reason *names* are pinned here too,
 * because they are what the S7 metrics report and they used to be a second hand-written table
 * beside the codes.
 */

function cmd(fields: Partial<MutableInputCommand> = {}): MutableInputCommand {
  return { seq: 1, tickIndex: 100, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, sampledAtMs: 0, ...fields };
}

describe('RateLimiter', () => {
  it('allows the rate and refuses the message past it', () => {
    const limiter = new RateLimiter(3);
    expect([limiter.allow(0), limiter.allow(0), limiter.allow(0)]).toEqual([true, true, true]);
    expect(limiter.allow(0)).toBe(false);
  });

  it('cannot be reset by timing a burst across the second boundary', () => {
    const limiter = new RateLimiter(3);
    limiter.allow(0);
    limiter.allow(0);
    limiter.allow(0);
    // A fresh bucket, but the previous one is still whole inside the trailing second.
    expect(limiter.allow(1000)).toBe(false);
  });

  it('weights the previous bucket by how much of it is still in the window', () => {
    const limiter = new RateLimiter(3);
    limiter.allow(0);
    limiter.allow(0);
    limiter.allow(0);
    // Half of the previous second has left the window: 1 + 3 * 0.5 = 2.5.
    expect(limiter.allow(1500)).toBe(true);
  });

  it('treats a gap of more than a second as a fresh start, not an adjacent bucket', () => {
    const limiter = new RateLimiter(3);
    limiter.allow(0);
    limiter.allow(0);
    limiter.allow(0);
    expect(limiter.allow(5000)).toBe(true);
  });

  it('forgets everything on a reset', () => {
    const limiter = new RateLimiter(1);
    limiter.allow(0);
    expect(limiter.allow(0)).toBe(false);

    limiter.reset();
    expect(limiter.allow(0)).toBe(true);
  });
});

describe('RejectCounters', () => {
  it('reports every reason by the name the metrics print', () => {
    const counters = new RejectCounters();
    for (const reason of Object.values(Reject)) counters.note(reason);

    expect(counters.report()).toEqual({
      'tick-skew': 1,
      'not-finite': 1,
      'out-of-range': 1,
      'yaw-rate': 1,
      'rate-limit': 1,
      oversize: 1,
      malformed: 1,
      'out-of-order': 1,
    });
  });

  it('counts nothing for None, which is not a rejection', () => {
    const counters = new RejectCounters();
    counters.note(Reject.None);

    expect(counters.total).toBe(0);
    expect(counters.report()).toEqual({});
  });

  it('totals the reasons and leaves the zero ones out of the report', () => {
    const counters = new RejectCounters();
    counters.note(Reject.TickSkew);
    counters.note(Reject.TickSkew);
    counters.note(Reject.Oversize);

    expect(counters.total).toBe(3);
    expect(counters.report()).toEqual({ 'tick-skew': 2, oversize: 1 });
  });

  it('empties on a reset', () => {
    const counters = new RejectCounters();
    counters.note(Reject.Malformed);
    counters.reset();

    expect(counters.total).toBe(0);
    expect(counters.report()).toEqual({});
  });
});

describe('validateCommand', () => {
  it('refuses a non-finite number anywhere in the struct', () => {
    expect(validateCommand(cmd({ moveX: Number.NaN }), 100)).toBe(Reject.NotFinite);
    expect(validateCommand(cmd({ moveZ: Number.POSITIVE_INFINITY }), 100)).toBe(Reject.NotFinite);
    expect(validateCommand(cmd({ yaw: Number.NaN }), 100)).toBe(Reject.NotFinite);
    expect(validateCommand(cmd({ pitch: Number.NaN }), 100)).toBe(Reject.NotFinite);
    expect(validateCommand(cmd({ seq: Number.NaN }), 100)).toBe(Reject.NotFinite);
    // A tick that is not a number is answered as what it is, not as skew.
    expect(validateCommand(cmd({ tickIndex: Number.NaN }), 100)).toBe(Reject.NotFinite);
  });

  it('accepts a tick exactly on the skew limit and refuses the one past it', () => {
    expect(validateCommand(cmd({ tickIndex: 100 + MAX_TICK_SKEW }), 100)).toBe(Reject.None);
    expect(validateCommand(cmd({ tickIndex: 100 - MAX_TICK_SKEW }), 100)).toBe(Reject.None);
    expect(validateCommand(cmd({ tickIndex: 100 + MAX_TICK_SKEW + 1 }), 100)).toBe(Reject.TickSkew);
    expect(validateCommand(cmd({ tickIndex: 100 - MAX_TICK_SKEW - 1 }), 100)).toBe(Reject.TickSkew);
  });

  it('refuses a pitch no sampler could have produced, and allows the one it clamps to', () => {
    expect(validateCommand(cmd({ pitch: Math.PI / 2 }), 100)).toBe(Reject.OutOfRange);
    expect(validateCommand(cmd({ pitch: -Math.PI / 2 }), 100)).toBe(Reject.OutOfRange);
    expect(validateCommand(cmd({ pitch: (89 * Math.PI) / 180 }), 100)).toBe(Reject.None);
  });

  it('refuses a yaw that is not an angle, and allows a full turn in either direction', () => {
    expect(validateCommand(cmd({ yaw: Math.PI * 2 }), 100)).toBe(Reject.None);
    expect(validateCommand(cmd({ yaw: -Math.PI * 2 }), 100)).toBe(Reject.None);
    expect(validateCommand(cmd({ yaw: 7 }), 100)).toBe(Reject.OutOfRange);
    expect(validateCommand(cmd({ yaw: -7 }), 100)).toBe(Reject.OutOfRange);
  });

  it('normalises an over-length move vector rather than refusing the player', () => {
    const over = cmd({ moveX: 3, moveZ: 4 });
    expect(validateCommand(over, 100)).toBe(Reject.None);
    expect(over.moveX).toBeCloseTo(0.6, 12);
    expect(over.moveZ).toBeCloseTo(0.8, 12);
  });

  it('leaves a move vector inside the unit circle exactly as it is', () => {
    const under = cmd({ moveX: 0.5, moveZ: -0.25 });
    validateCommand(under, 100);
    expect([under.moveX, under.moveZ]).toEqual([0.5, -0.25]);
  });

  it('coerces the two integer fields the wire carries', () => {
    const negative = cmd({ seq: -1 });
    validateCommand(negative, 100);
    expect(negative.seq).toBe(0xffff_ffff);

    const fractional = cmd({ tickIndex: 100.7 });
    validateCommand(fractional, 100);
    expect(fractional.tickIndex).toBe(100);
  });

  it('leaves a refused command untouched, because nothing downstream will read it', () => {
    const refused = cmd({ tickIndex: 100 + MAX_TICK_SKEW + 1, moveX: 5, buttons: 1 << 30 });
    expect(validateCommand(refused, 100)).toBe(Reject.TickSkew);
    expect([refused.moveX, refused.buttons]).toEqual([5, 1 << 30]);
  });
});
