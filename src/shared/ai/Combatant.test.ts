import { describe, expect, it } from 'vitest';
import { opposingTeam, type BotTeam } from './Combatant';

/**
 * The two-sided substrate, pinned.
 *
 * `Combatant` is an interface and carries no behaviour; the one function beside it is what
 * every mode, spawn selector and roster deal asks when it needs "the other side". Worth a test
 * because it is a total function over a two-member union and the compiler cannot check that the
 * mapping is an involution.
 */

describe('the other side', () => {
  it('swaps the two teams', () => {
    expect(opposingTeam('A')).toBe('B');
    expect(opposingTeam('B')).toBe('A');
  });

  it('is its own inverse, which is what callers assume when they apply it twice', () => {
    for (const team of ['A', 'B'] as BotTeam[]) {
      expect(opposingTeam(opposingTeam(team))).toBe(team);
    }
  });
});
