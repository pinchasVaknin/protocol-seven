import { describe, expect, it } from 'vitest';
import type { StreakId } from './StreakDefs';
import { StreakLedger } from './StreakLedger';

/**
 * The killstreak economy, pinned (A17).
 *
 * `StreakLedger.test.ts` beside this holds one rule at the one door — a second carried weapon in
 * hands that already hold one. These hold the wallet itself: the two credit doors and the anchor
 * between them, the four refusals **in the order they are tested**, the lockout as a maximum
 * rather than a sum, what a life boundary clears and what it deliberately leaves running, and the
 * report's three pacing models.
 *
 * A separate file rather than more cases in that one, because that file's own JSDoc is about the
 * hands rule and these are not about it.
 *
 * Everything goes through the public surface: the refactor splits `charge` and `foldInto` and
 * renames two private helpers, and none of that is reachable from here by design.
 */

/** The entity under test. `B` appears only where a second row matters. */
const A = 1;
const B = 2;

interface Stubs {
  /** Ticks the caller's own live instance has left. The concurrency question. */
  live: number;
  /** Whether a killstreak weapon is already in these hands. */
  hands: boolean;
  /** What this entity has equipped, priced. Read once per closed life by the audit. */
  prices: { id: StreakId; price: number }[];
}

function ledger(): { led: StreakLedger; stubs: Stubs } {
  const stubs: Stubs = { live: 0, hands: false, prices: [] };
  const led = new StreakLedger({
    pricesOf: () => stubs.prices,
    liveTicksFor: () => stubs.live,
    holdsCarriedWeapon: () => stubs.hands,
  });
  return { led, stubs };
}

describe('the balance', () => {
  it('is zero for an entity nothing has happened to', () => {
    const { led } = ledger();
    expect(led.balanceOf(A)).toBe(0);
    expect(led.earnedOf(A)).toBe(0);
    expect(led.spentOf(A)).toBe(0);
  });

  it('is what was earned less what was spent, from both credit doors', () => {
    const { led } = ledger();
    led.foldKills(A, 7);
    led.credit(A, 3);
    expect(led.charge(A, 'uav', 4, 0)).toBe('ok');
    expect(led.earnedOf(A)).toBe(10);
    expect(led.spentOf(A)).toBe(4);
    expect(led.balanceOf(A)).toBe(6);
  });

  it('never goes below zero, because the door refuses what it cannot cover', () => {
    const { led } = ledger();
    led.credit(A, 3);
    expect(led.charge(A, 'uav', 4, 0)).toBe('unaffordable');
    expect(led.balanceOf(A)).toBe(3);
    expect(led.report().negativeBalances).toBe(0);
  });

  it('reports the highest it ever reached, per run', () => {
    const { led } = ledger();
    led.credit(A, 12);
    led.charge(A, 'uav', 12, 0);
    expect(led.balanceOf(A)).toBe(0);
    expect(led.report().peakBalance).toBe(12);
  });
});

describe('banking the score’s kills', () => {
  it('banks the delta since the last fold and returns it', () => {
    const { led } = ledger();
    expect(led.foldKills(A, 3)).toBe(3);
    expect(led.foldKills(A, 5)).toBe(2);
    expect(led.balanceOf(A)).toBe(5);
  });

  it('banks nothing when the score has not moved', () => {
    const { led } = ledger();
    led.foldKills(A, 3);
    expect(led.foldKills(A, 3)).toBe(0);
    expect(led.balanceOf(A)).toBe(3);
  });

  it('re-anchors and banks nothing when the count goes backwards, and counts the resync', () => {
    const { led } = ledger();
    led.foldKills(A, 9);
    expect(led.foldKills(A, 2)).toBe(0);
    // The banked nine stay banked; what moved is the anchor, so the next kill banks one.
    expect(led.balanceOf(A)).toBe(9);
    expect(led.report().resyncs).toBe(1);
    expect(led.foldKills(A, 3)).toBe(1);
  });

  it('goes on banking after a purchase: spending moves the spend, not the count', () => {
    const { led } = ledger();
    led.foldKills(A, 8);
    led.charge(A, 'minigun', 8, 0);
    expect(led.balanceOf(A)).toBe(0);
    expect(led.foldKills(A, 12)).toBe(4);
    expect(led.balanceOf(A)).toBe(4);
  });

  it('moves the anchor without banking when a kill is discarded, and counts it', () => {
    const { led } = ledger();
    led.foldKills(A, 4);
    led.discardKills(A, 6);
    expect(led.balanceOf(A)).toBe(4);
    expect(led.report().postMortemKills).toBe(2);
    // The anchor moved, so the discarded kills can never be banked into a later life.
    expect(led.foldKills(A, 6)).toBe(0);
  });

  it('counts a dropped credit without needing a row for it', () => {
    const { led } = ledger();
    led.dropCredit(5);
    led.dropCredit(0);
    expect(led.report().postMortemKills).toBe(5);
  });

  it('ignores a credit of nothing', () => {
    const { led } = ledger();
    led.credit(A, 0);
    led.credit(A, -3);
    expect(led.balanceOf(A)).toBe(0);
    expect(led.report().credited).toBe(0);
  });
});

describe('the four refusals, in the order they are tested', () => {
  it('refuses a streak whose own instance is still up, before anything else', () => {
    const { led, stubs } = ledger();
    stubs.live = 10;
    stubs.hands = true;
    // No money either, and still 'live': the concurrency test is the first one.
    expect(led.quote(A, 'minigun', 99, 0)).toBe('live');
    expect(led.charge(A, 'minigun', 99, 0)).toBe('live');
    expect(led.report().refusedLive).toBe(1);
  });

  it('refuses a carried streak when the hands are full, before the cooldown', () => {
    const { led, stubs } = ledger();
    stubs.hands = true;
    led.armCooldown(A, 'minigun', 500);
    expect(led.quote(A, 'minigun', 99, 0)).toBe('handsFull');
    expect(led.charge(A, 'minigun', 99, 0)).toBe('handsFull');
    expect(led.report().refusedHandsFull).toBe(1);
  });

  it('refuses a cooling streak before asking whether it is affordable', () => {
    const { led } = ledger();
    led.armCooldown(A, 'uav', 500);
    expect(led.quote(A, 'uav', 99, 0)).toBe('cooling');
    expect(led.charge(A, 'uav', 99, 0)).toBe('cooling');
    expect(led.report().refusedCooling).toBe(1);
  });

  it('refuses an unaffordable streak last', () => {
    const { led } = ledger();
    led.credit(A, 3);
    expect(led.quote(A, 'uav', 4, 0)).toBe('unaffordable');
    expect(led.charge(A, 'uav', 4, 0)).toBe('unaffordable');
    expect(led.report().refusedUnaffordable).toBe(1);
  });

  it('takes no money and counts no activation on any of the four', () => {
    const { led, stubs } = ledger();
    led.credit(A, 50);
    stubs.live = 5;
    led.charge(A, 'uav', 4, 0);
    stubs.live = 0;
    stubs.hands = true;
    led.charge(A, 'minigun', 4, 0);
    stubs.hands = false;
    led.armCooldown(A, 'sentry', 500);
    led.charge(A, 'sentry', 4, 0);
    led.charge(A, 'chopper', 999, 0);
    expect(led.balanceOf(A)).toBe(50);
    const report = led.report();
    expect(report.activations).toBe(0);
    expect(report.spent).toBe(0);
    expect(report.refusedLive).toBe(1);
    expect(report.refusedHandsFull).toBe(1);
    expect(report.refusedCooling).toBe(1);
    expect(report.refusedUnaffordable).toBe(1);
  });

  it('says yes, and only then moves money', () => {
    const { led } = ledger();
    led.credit(A, 10);
    expect(led.canAfford(A, 'uav', 4, 0)).toBe(true);
    // A quote is a question: asking it changes nothing.
    expect(led.balanceOf(A)).toBe(10);
    expect(led.charge(A, 'uav', 4, 0)).toBe('ok');
    expect(led.balanceOf(A)).toBe(6);
    expect(led.report().activations).toBe(1);
  });
});

describe('the lockout', () => {
  it('is zero when nothing is cooling and nothing is up', () => {
    const { led } = ledger();
    expect(led.lockoutTicks(A, 'uav', 100)).toBe(0);
    expect(led.lockoutsOf(A, 100)).toEqual([]);
  });

  it('counts down toward the tick the streak is ready on', () => {
    const { led } = ledger();
    led.armCooldown(A, 'uav', 1000);
    expect(led.lockoutTicks(A, 'uav', 400)).toBe(600);
    expect(led.lockoutTicks(A, 'uav', 1000)).toBe(0);
    expect(led.lockoutTicks(A, 'uav', 1200)).toBe(0);
  });

  it('is the larger of the cooldown and the live instance, never their sum', () => {
    const { led, stubs } = ledger();
    led.armCooldown(A, 'uav', 1000);
    stubs.live = 200;
    // 600 against 200 — the cooldown already contains the instance's remaining time.
    expect(led.lockoutTicks(A, 'uav', 400)).toBe(600);
    stubs.live = 900;
    expect(led.lockoutTicks(A, 'uav', 400)).toBe(900);
  });

  it('is replaced by a later arming rather than extended by it', () => {
    const { led } = ledger();
    led.armCooldown(A, 'sentry', 5000);
    led.armCooldown(A, 'sentry', 900);
    // The estimate armed at activation is overwritten by the fact at retire, even when the
    // fact is earlier — a sentry shot down takes its cooldown from when it stopped shooting.
    expect(led.lockoutTicks(A, 'sentry', 400)).toBe(500);
  });

  it('lists every streak that is locked out, and nothing that is not', () => {
    const { led } = ledger();
    led.armCooldown(A, 'uav', 1000);
    led.armCooldown(A, 'sentry', 300);
    expect(led.lockoutsOf(A, 400)).toEqual([{ id: 'uav', ticks: 600 }]);
  });
});

describe('the affordability announcement', () => {
  it('is remembered once per streak, and dropped when the money is taken', () => {
    const { led } = ledger();
    led.credit(A, 20);
    expect(led.hasAnnounced(A, 'uav')).toBe(false);
    led.noteAnnounced(A, 'uav');
    led.noteAnnounced(A, 'uav');
    expect(led.hasAnnounced(A, 'uav')).toBe(true);

    // Charging drops it, so the same streak is announced again once it is earned anew.
    led.charge(A, 'uav', 4, 0);
    expect(led.hasAnnounced(A, 'uav')).toBe(false);
  });

  it('is per entity', () => {
    const { led } = ledger();
    led.noteAnnounced(A, 'uav');
    expect(led.hasAnnounced(B, 'uav')).toBe(false);
  });
});

describe('the life boundary', () => {
  it('zeroes the wallet and re-anchors the fold', () => {
    const { led } = ledger();
    led.foldKills(A, 10);
    led.credit(A, 5);
    led.charge(A, 'uav', 4, 0);
    led.resetLife(A, 10, 100);
    expect(led.balanceOf(A)).toBe(0);
    expect(led.earnedOf(A)).toBe(0);
    expect(led.spentOf(A)).toBe(0);
    // Kills from the life that ended can never be banked into the next one.
    expect(led.foldKills(A, 10)).toBe(0);
  });

  it('leaves the cooldowns running, and counts the ones that crossed', () => {
    const { led } = ledger();
    led.armCooldown(A, 'uav', 1000);
    led.armCooldown(A, 'sentry', 50);
    led.resetLife(A, 0, 100);
    // Dying is not a way to shorten a wait.
    expect(led.lockoutTicks(A, 'uav', 100)).toBe(900);
    expect(led.report().cooldownsCrossingDeath).toBe(1);
  });

  it('clears the announcements, so the next life is told again', () => {
    const { led } = ledger();
    led.noteAnnounced(A, 'uav');
    led.resetLife(A, 0, 100);
    expect(led.hasAnnounced(A, 'uav')).toBe(false);
  });

  it('closes the life into the report, and the row that is left is the next one', () => {
    const { led } = ledger();
    led.foldKills(A, 6);
    led.charge(A, 'uav', 4, 0);
    led.resetLife(A, 6, 100);
    const report = led.report();
    // Two: the life the death closed, plus the zeroed row it left behind, which `report` folds
    // because it is a life in progress. The totals come from the closed one alone.
    expect(report.lives).toBe(2);
    expect(report.killsBanked).toBe(6);
    expect(report.spent).toBe(4);
    expect(report.activations).toBe(1);
  });

  it('anchors a life it has never seen', () => {
    const { led } = ledger();
    led.resetLife(A, 11, 100);
    expect(led.foldKills(A, 11)).toBe(0);
    expect(led.foldKills(A, 13)).toBe(2);
  });

  it('counts a spawn, and whether it inherited a balance', () => {
    const { led } = ledger();
    led.noteLifeStart(A);
    expect(led.report().lifeStarts).toBe(1);
    expect(led.report().walletsAtLifeStart).toBe(0);

    led.credit(A, 5);
    led.noteLifeStart(A);
    expect(led.report().lifeStarts).toBe(2);
    expect(led.report().walletsAtLifeStart).toBe(1);
  });

  it('counts the wallets a round boundary is about to carry over, and changes nothing', () => {
    const { led } = ledger();
    led.credit(A, 5);
    led.foldKills(B, 0);
    led.noteRoundBoundary();
    // A survivor keeps what they banked: a round is not a life.
    expect(led.balanceOf(A)).toBe(5);
    expect(led.report().walletsAtRoundBoundary).toBe(1);
  });

  it('banks the life in progress when an entity leaves, and drops the row', () => {
    const { led } = ledger();
    led.foldKills(A, 7);
    led.armCooldown(A, 'uav', 1000);
    led.forget(A);
    expect(led.balanceOf(A)).toBe(0);
    expect(led.lockoutTicks(A, 'uav', 0)).toBe(0);
    expect(led.report().lives).toBe(1);
    expect(led.report().killsBanked).toBe(7);
  });

  it('forgets nothing it never knew', () => {
    const { led } = ledger();
    led.forget(A);
    expect(led.report().lives).toBe(0);
  });
});

describe('the economy report', () => {
  it('folds the lives still open, and can be taken twice without counting one twice', () => {
    const { led } = ledger();
    led.foldKills(A, 5);
    expect(led.report().lives).toBe(1);
    expect(led.report().lives).toBe(1);
    expect(led.report().killsBanked).toBe(5);
  });

  it('counts the buys per life, and the repeats of one streak', () => {
    const { led } = ledger();
    led.credit(A, 40);
    led.charge(A, 'uav', 4, 0);
    led.charge(A, 'uav', 4, 0);
    led.charge(A, 'sentry', 8, 0);
    const report = led.report();
    expect(report.activations).toBe(3);
    expect(report.maxBuysInOneLife).toBe(3);
    // The rule the pivot removed, as a number: one life bought the same streak twice.
    expect(report.maxRepeatsInOneLife).toBe(2);
  });

  it('prices the three pacing models off one life’s banked kills', () => {
    const { led, stubs } = ledger();
    stubs.prices = [
      { id: 'uav', price: 4 },
      { id: 'sentry', price: 8 },
      { id: 'chopper', price: 12 },
    ];
    led.foldKills(A, 12);
    const report = led.report();
    // A threshold hands over everything it reaches: 4, 8 and 12 are all within twelve kills.
    expect(report.thresholdGrants).toBe(3);
    // Once each, cheapest first: 4 then 8 is twelve, so the chopper is out of budget.
    expect(report.balancePurchases).toBe(2);
    // Repeats allowed, cheapest only: three UAVs.
    expect(report.balanceRepeatPurchases).toBe(3);
  });

  it('prices the models off what was banked, not off what is left', () => {
    const { led, stubs } = ledger();
    stubs.prices = [{ id: 'uav', price: 4 }];
    led.foldKills(A, 8);
    led.charge(A, 'uav', 4, 0);
    const report = led.report();
    expect(report.balanceRepeatPurchases).toBe(2);
    expect(report.spent).toBe(4);
  });

  it('counts only what the kills paid for: a credited wallet buys nothing in the models', () => {
    const { led, stubs } = ledger();
    stubs.prices = [{ id: 'uav', price: 4 }];
    led.credit(A, 20);
    const report = led.report();
    expect(report.credited).toBe(20);
    expect(report.thresholdGrants).toBe(0);
    expect(report.balanceRepeatPurchases).toBe(0);
  });

  it('prices nothing for a life with no equipped streaks', () => {
    const { led } = ledger();
    led.foldKills(A, 20);
    const report = led.report();
    expect(report.thresholdGrants).toBe(0);
    expect(report.balancePurchases).toBe(0);
    expect(report.balanceRepeatPurchases).toBe(0);
  });

  it('sums over every row', () => {
    const { led } = ledger();
    led.foldKills(A, 3);
    led.foldKills(B, 4);
    const report = led.report();
    expect(report.lives).toBe(2);
    expect(report.killsBanked).toBe(7);
  });

  it('is empty before anything happens', () => {
    const { led } = ledger();
    const report = led.report();
    expect(report.lives).toBe(0);
    expect(report.lifeStarts).toBe(0);
    expect(report.killsBanked).toBe(0);
    expect(report.negativeBalances).toBe(0);
    expect(report.resyncs).toBe(0);
  });

  it('loses every row when the ledger is cleared', () => {
    const { led } = ledger();
    led.foldKills(A, 9);
    led.clear();
    expect(led.balanceOf(A)).toBe(0);
    expect(led.report().lives).toBe(0);
  });
});
