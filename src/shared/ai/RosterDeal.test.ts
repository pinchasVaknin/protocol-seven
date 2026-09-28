import { describe, expect, it } from 'vitest';
import { MAPS } from '../modes/ModeRegistry';
import type { BotTier } from './DifficultyTiers';
import { auditRosterDeal, dealTiers, seatToVacate, tierForExtraBot } from './RosterDeal';

/**
 * The seat a human takes on a live server (playtest 2026-09-28).
 *
 * Every live match is dealt an even 5v5 and humans then take seats through
 * `ServerMatch.removeBotForSeat`. The deal was fair; the seat was not — it displaced the newest
 * bot, and Foundry and Dunes put their VETERAN fifth, so the player's side lost it in every
 * match and the other side kept theirs. These pin the rule that replaced it to the deal the solo
 * game already makes, so the two runtimes cannot drift apart again.
 */

/** A live side after `humans` joined it: the deal's even roster with that many seats vacated. */
function afterJoins(roster: readonly BotTier[], humans: number): BotTier[] {
  const out = [...roster];
  for (let i = 0; i < humans; i++) {
    const seat = seatToVacate(out);
    if (seat < 0) break;
    out.splice(seat, 1);
  }
  return out;
}

const FOUNDRY = MAPS.find((m) => m.id === 'mp_foundry');

describe('seatToVacate', () => {
  it('displaces the RECRUIT on a live Foundry side, not the VETERAN', () => {
    expect(FOUNDRY).toBeDefined();
    const side = dealTiers(5, 5, FOUNDRY?.tierMix ?? []).a;
    expect(side).toEqual(['REGULAR', 'HARDENED', 'RECRUIT', 'REGULAR', 'VETERAN']);
    expect(side[seatToVacate(side)]).toBe('RECRUIT');
    expect(afterJoins(side, 1)).toContain('VETERAN');
  });

  it('takes the latest among equals, the tie-break the deal drops by', () => {
    expect(seatToVacate(['REGULAR', 'VETERAN', 'REGULAR'])).toBe(2);
    expect(seatToVacate(['RECRUIT', 'RECRUIT'])).toBe(1);
  });

  it('has nothing to give on an empty side', () => {
    expect(seatToVacate([])).toBe(-1);
  });

  it('leaves every map’s live side on the roster the deal makes one body shorter', () => {
    for (const map of MAPS) {
      const even = dealTiers(map.teamSize, map.teamSize, map.tierMix);
      for (let humans = 1; humans <= map.teamSize; humans++) {
        const live = afterJoins(even.a, humans);
        const dealt = dealTiers(map.teamSize - humans, map.teamSize, map.tierMix).a;
        expect([...live].sort(), `${map.id} with ${humans} human(s)`).toEqual([...dealt].sort());
      }
    }
  });

  it('gets the same tier back when the human leaves', () => {
    for (const map of MAPS) {
      const even = dealTiers(map.teamSize, map.teamSize, map.tierMix);
      const seat = seatToVacate(even.a);
      const taken = even.a[seat];
      const back = tierForExtraBot(afterJoins(even.a, 1), even.b, map.tierMix);
      expect(back, map.id).toBe(taken);
    }
  });
});

describe('auditRosterDeal', () => {
  it('passes over every authored spread', () => {
    const audit = auditRosterDeal(MAPS.map((m) => ({ id: m.id, mix: m.tierMix })));
    expect(audit.problems).toEqual([]);
  });
});
