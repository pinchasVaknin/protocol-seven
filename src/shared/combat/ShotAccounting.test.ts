import { describe, expect, it } from 'vitest';
import { MAX_PELLETS } from '../weapons/WeaponDefs';
import { hitsFrom, shotsFrom } from './ShotAccounting';

/**
 * The one definition of a shot and a hit, pinned.
 *
 * These are two clamps over two fields of one event, and every bound in them is a decoder
 * guard: both numbers can arrive from a socket or from the tuning panel. The figure they exist
 * to make impossible is the 267% accuracy B5 reported, so the test that matters most is the
 * last one — `hitsFrom` can never exceed `shotsFrom` of the same pull.
 */

describe('how many shots a pull is worth', () => {
  it('is the pellet count for anything sane', () => {
    expect(shotsFrom({ pellets: 1 })).toBe(1);
    expect(shotsFrom({ pellets: 8 })).toBe(8);
    expect(shotsFrom({ pellets: MAX_PELLETS })).toBe(MAX_PELLETS);
  });

  it('is never zero, however the denominator arrived', () => {
    expect(shotsFrom({ pellets: 0 })).toBe(1);
    expect(shotsFrom({ pellets: -4 })).toBe(1);
    expect(shotsFrom({ pellets: 0.4 })).toBe(1);
  });

  it('is capped at the clamp the fire loop uses', () => {
    expect(shotsFrom({ pellets: MAX_PELLETS + 1 })).toBe(MAX_PELLETS);
    expect(shotsFrom({ pellets: 9999 })).toBe(MAX_PELLETS);
  });

  it('rounds a fractional count the way the fire loop does', () => {
    expect(shotsFrom({ pellets: 7.4 })).toBe(7);
    expect(shotsFrom({ pellets: 7.5 })).toBe(8);
  });
});

describe('how many of them connected', () => {
  it('is the hit count when it is inside the pull', () => {
    expect(hitsFrom({ pellets: 8, pelletsHit: 0 })).toBe(0);
    expect(hitsFrom({ pellets: 8, pelletsHit: 3 })).toBe(3);
    expect(hitsFrom({ pellets: 8, pelletsHit: 8 })).toBe(8);
  });

  it('is never negative and never more than the shots', () => {
    expect(hitsFrom({ pellets: 8, pelletsHit: -2 })).toBe(0);
    expect(hitsFrom({ pellets: 8, pelletsHit: 12 })).toBe(8);
    expect(hitsFrom({ pellets: 1, pelletsHit: 6 })).toBe(1);
  });

  it('is bounded by the clamped shot count, not the raw field', () => {
    // A decoder that claimed 99 pellets and 99 hits cannot make the ratio exceed one.
    expect(hitsFrom({ pellets: 99, pelletsHit: 99 })).toBe(MAX_PELLETS);
    // Nor can one that claimed none of either.
    expect(hitsFrom({ pellets: 0, pelletsHit: 5 })).toBe(1);
  });

  it('rounds the same way', () => {
    expect(hitsFrom({ pellets: 8, pelletsHit: 2.4 })).toBe(2);
    expect(hitsFrom({ pellets: 8, pelletsHit: 2.5 })).toBe(3);
  });
});
