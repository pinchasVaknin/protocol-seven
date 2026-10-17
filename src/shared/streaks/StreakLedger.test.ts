import { describe, expect, it } from 'vitest';
import { StreakLedger, type StreakLedgerDeps } from './StreakLedger';
import type { StreakId } from './StreakDefs';

/**
 * One pair of hands (2026-09-27, the human).
 *
 * Calling a second carried killstreak while the first was still in the hands left the inventory
 * holding a slot whose streak had already ended: the hands came up empty and the game went on
 * believing a minigun was in them. `'live'` did not catch it because `'live'` is per streak
 * **id** — it refuses a second minigun, and says nothing about a minigun called for while a riot
 * shield is up.
 *
 * These hold the rule at the one door every activation goes through, and the last one holds its
 * edge: a UAV overhead takes nothing from the hands, and a rule that refused it would be a
 * different rule about a different thing.
 */

/** A ledger with money and no cooldowns, whose "is something in the hands" answer is a variable. */
function ledgerWith(hands: { held: boolean }): StreakLedger {
  const deps: StreakLedgerDeps = {
    pricesOf: () => [],
    liveTicksFor: () => 0,
    holdsCarriedWeapon: () => hands.held,
  };
  const ledger = new StreakLedger(deps);
  // Enough banked to afford anything these tests ask for.
  ledger.credit(1, 99);
  return ledger;
}

const buy = (ledger: StreakLedger, id: StreakId): string => ledger.charge(1, id, 1, 0);

describe('a second killstreak weapon in hands that already hold one', () => {
  it('is refused', () => {
    const hands = { held: true };
    expect(buy(ledgerWith(hands), 'minigun')).toBe('handsFull');
  });

  it('is allowed once the hands are empty', () => {
    const hands = { held: false };
    expect(buy(ledgerWith(hands), 'minigun')).toBe('ok');
  });

  it('takes no money when it is refused', () => {
    const hands = { held: true };
    const ledger = ledgerWith(hands);
    const before = ledger.balanceOf(1);
    expect(buy(ledger, 'shield')).toBe('handsFull');
    expect(ledger.balanceOf(1)).toBe(before);
  });

  it('is counted, so a refusal is never silent', () => {
    const hands = { held: true };
    const ledger = ledgerWith(hands);
    buy(ledger, 'flamethrower');
    expect(ledger.report().refusedHandsFull).toBe(1);
  });

  /**
   * The edge the rule is *not* about. A UAV is overhead and a mortar is coming down; neither
   * takes a hand, and a rule that refused them would be about concurrency rather than hands.
   */
  it('does not refuse a streak that is not carried', () => {
    const hands = { held: true };
    expect(buy(ledgerWith(hands), 'uav')).toBe('ok');
  });
});

/**
 * The owner left; their sentry is still standing (2026-10-18).
 *
 * `onOwnerRemoved` banks the row and drops it the moment a player disconnects, but a sentry and
 * a crate are deliberately left in the world — and when one of them expires, up to ninety
 * seconds later, `retire` arms a cooldown against an owner who is no longer there. The ledger
 * has to be able to say "nobody", because the alternative is a row with two Maps that nothing
 * deletes and that the next holder of a reused entity id inherits.
 */
describe('a cooldown armed for an owner who has already left', () => {
  const COOLDOWN_AT = 5400;

  it('does not build them a new row', () => {
    const ledger = ledgerWith({ held: false });
    ledger.forget(1);
    const banked = ledger.report().lives;

    ledger.armCooldown(1, 'sentry', COOLDOWN_AT);

    // `report` folds every open row, so a row built here would show up as a second life.
    expect(ledger.report().lives).toBe(banked);
  });

  it('leaves nothing for the next player on that entity id to inherit', () => {
    const ledger = ledgerWith({ held: false });
    ledger.forget(1);

    ledger.armCooldown(1, 'sentry', COOLDOWN_AT);

    expect(ledger.lockoutsOf(1, 0)).toEqual([]);
  });

  it('still arms the cooldown for an owner who is present', () => {
    const ledger = ledgerWith({ held: false });

    ledger.armCooldown(1, 'sentry', COOLDOWN_AT);

    expect(ledger.lockoutsOf(1, 0)).toEqual([{ id: 'sentry', ticks: COOLDOWN_AT }]);
  });
});
