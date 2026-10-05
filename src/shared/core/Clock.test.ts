import { describe, expect, it } from 'vitest';
import { installClock, nowMs } from './Clock';

/**
 * Pins the installed-clock seam (M9, S3): reading before installation throws rather than
 * falling back, and after installation every read goes through to the runtime's clock.
 *
 * The order of these tests matters. `installed` is module state and there is no uninstall —
 * deliberately, since nothing in the two runtimes ever needs one — so the "throws" case has to
 * run before anything installs. Vitest gives each test file its own module registry, so this
 * file starts with no clock installed however the rest of the suite is ordered.
 */

describe('nowMs before installation', () => {
  it('throws, naming the call that fixes it, rather than falling back silently', () => {
    expect(() => nowMs()).toThrow(/Clock not installed/);
    expect(() => nowMs()).toThrow(/installClock\(\)/);
  });
});

describe('installClock', () => {
  it('routes every read to the installed clock', () => {
    let reads = 0;
    installClock({
      nowMs: () => {
        reads++;
        return 1234.5;
      },
    });

    expect(nowMs()).toBe(1234.5);
    expect(nowMs()).toBe(1234.5);
    expect(reads).toBe(2);
  });

  it('reads through on every call rather than caching the first answer', () => {
    let t = 0;
    installClock({ nowMs: () => (t += 16) });

    expect(nowMs()).toBe(16);
    expect(nowMs()).toBe(32);
    expect(nowMs()).toBe(48);
  });

  it('a second install replaces the first', () => {
    installClock({ nowMs: () => 1 });
    installClock({ nowMs: () => 2 });

    expect(nowMs()).toBe(2);
  });
});
