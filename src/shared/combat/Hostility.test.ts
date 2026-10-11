import { describe, expect, it } from 'vitest';
import { isHostile } from './Hostility';

/**
 * The one hostility test, pinned.
 *
 * Three answers and a rule about which of them the mode decides, which is the whole of the
 * function — and the whole of the defect it was written to end: half an FFA lobby shares a
 * side with any given player and none of them is a team-mate.
 */

describe('with teams', () => {
  it('calls the other side hostile and its own side not', () => {
    expect(isHostile('A', 'B', false)).toBe(true);
    expect(isHostile('B', 'A', false)).toBe(true);
    expect(isHostile('A', 'A', false)).toBe(false);
    expect(isHostile('B', 'B', false)).toBe(false);
  });
});

describe('without teams', () => {
  it('calls everybody hostile, including the viewer\'s own substrate side', () => {
    expect(isHostile('A', 'B', true)).toBe(true);
    expect(isHostile('A', 'A', true)).toBe(true);
    expect(isHostile('B', 'B', true)).toBe(true);
  });
});
