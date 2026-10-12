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

  it('sweeps the whole domain rather than a sample of it', () => {
    // The deal is a pure function of (teamA, teamB, mix) and there is no seed to vary, so the
    // sweep is every split up to a full roster — which makes one run a fact, not an estimate.
    const audit = auditRosterDeal([{ id: 'two', mix: ['REGULAR', 'VETERAN'] }], 6);
    expect(audit.deals).toBe(7 * 7);
    expect(audit.problems).toEqual([]);
  });

  it('prints one readable line per shipped shape', () => {
    const audit = auditRosterDeal([{ id: 'foundry', mix: FOUNDRY?.tierMix ?? [] }]);
    expect(audit.rows).toHaveLength(4);
    expect(audit.rows.map((r) => `${r.teamA}v${r.teamB}`)).toEqual(['5v5', '4v5', '4v4', '3v4']);
    for (const row of audit.rows) {
      expect(row.id).toBe('foundry');
      expect(row.a.split(' ')).toHaveLength(row.teamA);
      expect(row.b.split(' ')).toHaveLength(row.teamB);
    }
  });

  it('holds an empty mix to the same properties, which is the fallback populate always had', () => {
    const audit = auditRosterDeal([{ id: 'empty', mix: [] }], 4);
    expect(audit.problems).toEqual([]);
    expect(dealTiers(3, 2, []).a).toEqual(['REGULAR', 'REGULAR', 'REGULAR']);
  });
});

/**
 * The four properties the audit checks, asserted here against `dealTiers` directly.
 *
 * The audit's own test can only say "no problems were reported", which stays green if a check
 * silently stops checking. These say what the deal actually does, so the two fail for different
 * reasons — one if the deal breaks, one if the audit stops noticing.
 */
describe('the deal itself', () => {
  const MIXES: ReadonlyArray<readonly BotTier[]> = [
    ['REGULAR'],
    ['REGULAR', 'VETERAN'],
    ['REGULAR', 'HARDENED', 'RECRUIT', 'REGULAR', 'VETERAN'],
    ['VETERAN', 'VETERAN', 'RECRUIT'],
    [],
  ];

  const STRENGTH: Readonly<Record<BotTier, number>> = {
    RECRUIT: 0,
    REGULAR: 1,
    HARDENED: 2,
    VETERAN: 3,
  };

  function tally(roster: readonly BotTier[]): Record<BotTier, number> {
    const out = { RECRUIT: 0, REGULAR: 0, HARDENED: 0, VETERAN: 0 };
    for (const tier of roster) out[tier]++;
    return out;
  }

  it('gives each side exactly the count it asked for', () => {
    for (const mix of MIXES) {
      for (let a = 0; a <= 8; a++) {
        for (let b = 0; b <= 8; b++) {
          const deal = dealTiers(a, b, mix);
          expect([deal.a.length, deal.b.length], `${a}v${b}`).toEqual([a, b]);
        }
      }
    }
  });

  it('is identical on both sides when the sides are even, which is every live match', () => {
    for (const mix of MIXES) {
      for (let n = 0; n <= 8; n++) {
        const deal = dealTiers(n, n, mix);
        expect(deal.a, `${n}v${n}`).toEqual(deal.b);
      }
    }
  });

  it('contains the short side inside the long one, and differs by the fewest bodies possible', () => {
    for (const mix of MIXES) {
      for (let a = 0; a <= 8; a++) {
        for (let b = 0; b <= 8; b++) {
          const deal = dealTiers(a, b, mix);
          const [short, long] = a <= b ? [deal.a, deal.b] : [deal.b, deal.a];
          const cs = tally(short);
          const cl = tally(long);
          let differing = 0;
          for (const tier of Object.keys(cs) as BotTier[]) {
            expect(cs[tier], `${a}v${b} ${tier}`).toBeLessThanOrEqual(cl[tier]);
            differing += Math.abs(cs[tier] - cl[tier]);
          }
          expect(differing, `${a}v${b}`).toBe(Math.abs(a - b));
        }
      }
    }
  });

  it('leaves the short side the stronger half, because a body down is a body replaced', () => {
    // The brief's decision, out loud: a side is short a bot because something else holds that
    // seat — in solo, the player — and a player is on average worse than a REGULAR, so
    // mirroring the tiers exactly would still hand the other side a real edge.
    for (const mix of MIXES) {
      for (let a = 0; a <= 8; a++) {
        for (let b = 0; b <= 8; b++) {
          const deal = dealTiers(a, b, mix);
          const [short, long] = a <= b ? [deal.a, deal.b] : [deal.b, deal.a];
          const cs = tally(short);
          const cl = tally(long);
          const missing: BotTier[] = [];
          for (const tier of Object.keys(cs) as BotTier[]) {
            for (let i = 0; i < cl[tier] - cs[tier]; i++) missing.push(tier);
          }
          for (const gone of missing) {
            for (const kept of short) {
              expect(STRENGTH[gone], `${a}v${b}: dropped ${gone}, kept ${kept}`).toBeLessThanOrEqual(
                STRENGTH[kept],
              );
            }
          }
        }
      }
    }
  });

  it('reads both sides out of the mix in its authored order', () => {
    const mix: readonly BotTier[] = ['REGULAR', 'HARDENED', 'RECRUIT', 'REGULAR', 'VETERAN'];
    expect(dealTiers(5, 5, mix).a).toEqual([...mix]);
    // The long side is the first max(a, b) entries of the cyclic mix.
    expect(dealTiers(7, 0, mix).a).toEqual([...mix, 'REGULAR', 'HARDENED']);
  });

  it('treats a negative or fractional head-count as the nearest honest one', () => {
    expect(dealTiers(-3, 2, ['REGULAR']).a).toEqual([]);
    expect(dealTiers(2.7, 0, ['REGULAR']).a).toHaveLength(2);
  });
});

describe('the tier a replacement comes back as', () => {
  it('restores the roster the deal made, over the whole domain', () => {
    for (const map of MAPS) {
      for (let a = 1; a <= map.teamSize; a++) {
        for (let b = 0; b <= map.teamSize; b++) {
          const deal = dealTiers(a, b, map.tierMix);
          const seat = seatToVacate(deal.a);
          const taken = deal.a[seat];
          if (taken === undefined) continue;
          const afterJoin = deal.a.filter((_, index) => index !== seat);
          expect(tierForExtraBot(afterJoin, deal.b, map.tierMix), `${map.id} ${a}v${b}`).toBe(taken);
        }
      }
    }
  });

  it('hands back the strongest body a drifted side is short of', () => {
    // `BOT_TIERS` is weakest-first, so the last tier still short is the strongest one short.
    const mix: readonly BotTier[] = ['RECRUIT', 'VETERAN'];
    expect(tierForExtraBot([], [], mix)).toBe('RECRUIT');
    expect(tierForExtraBot(['RECRUIT'], ['RECRUIT', 'VETERAN'], mix)).toBe('VETERAN');
  });

  it('still answers for a side that already holds more than the deal would give it', () => {
    // A roster that has drifted past the deal: nothing is short, so the target's last seat is
    // the honest answer rather than a crash or a silent nothing.
    const mix: readonly BotTier[] = ['REGULAR'];
    expect(tierForExtraBot(['VETERAN', 'VETERAN', 'VETERAN'], [], mix)).toBe('REGULAR');
  });

  it('falls back to REGULAR when there is no mix to read at all', () => {
    expect(tierForExtraBot([], [], [])).toBe('REGULAR');
  });
});
