import { describe, expect, it } from 'vitest';
import { DT } from '../core/Loop';
import { BotBlackboard } from './BotBlackboard';

/**
 * What one bot believes, pinned.
 *
 * The rule this class exists to enforce is that nothing in `ai/` may reach into a `PlayerSim`
 * or another bot's transform to find out where a target *actually* is — because the moment
 * anything does, the bot stops being beatable by breaking line of sight, which is the whole
 * game. So the properties worth holding still are all about **staleness**: that the last known
 * position is remembered and not refreshed, that confidence decays from there, and that a
 * target which jinks between two samples is mis-led on purpose.
 */

const DECAY = 0.55;
const NOISE_MEMORY = 6;

/** A fresh blackboard with one sighting already on it, at `(x, 0, z)`. */
function seen(x = 0, z = -10, targetId = 2): BotBlackboard {
  const bb = new BotBlackboard();
  bb.noteSighting(targetId, x, 1.26, z, 0, Math.hypot(x, z), 0.1);
  return bb;
}

describe('a blackboard that has never seen anything', () => {
  it('believes nothing, and says so in every field', () => {
    const bb = new BotBlackboard();
    expect(bb.targetId).toBe(-1);
    expect(bb.hasLos).toBe(false);
    expect(bb.sinceLos).toBe(999);
    expect(bb.losHeld).toBe(0);
    expect(bb.confidence).toBe(0);
    expect(bb.hasKnownTarget).toBe(false);
    expect(bb.investigateValid).toBe(false);
    expect(bb.reactionPaid).toBe(false);
    expect(bb.sinceDamage).toBe(999);
    expect(bb.visibleEnemies).toBe(0);
  });
});

describe('a sighting', () => {
  it('is remembered as a place to aim at, with full confidence', () => {
    const bb = seen(3, -8);
    expect(bb.targetId).toBe(2);
    expect(bb.hasLos).toBe(true);
    expect(bb.sinceLos).toBe(0);
    expect(bb.confidence).toBe(1);
    expect(bb.lastKnownX).toBe(3);
    expect(bb.lastKnownY).toBe(1.26);
    expect(bb.lastKnownZ).toBe(-8);
    expect(bb.hasKnownTarget).toBe(true);
  });

  it('estimates no velocity on the first one, because there is nothing to compare with', () => {
    const bb = seen(0, -10);
    expect(bb.lastKnownVx).toBe(0);
    expect(bb.lastKnownVz).toBe(0);
  });

  it('estimates velocity from the change between two, not from the target itself', () => {
    const bb = seen(0, -10);
    bb.noteSighting(2, 1, 1.26, -10, 0, 10, 0.1);
    // One metre of x in a tenth of a second.
    expect(bb.lastKnownVx).toBe(10);
    expect(bb.lastKnownVz).toBe(0);
  });

  it('forgets the estimate when the target changes', () => {
    const bb = seen(0, -10);
    bb.noteSighting(2, 1, 1.26, -10, 0, 10, 0.1);
    expect(bb.lastKnownVx).toBe(10);
    bb.noteSighting(3, 5, 1.26, -10, 0, 11, 0.1);
    expect(bb.targetId).toBe(3);
    expect(bb.lastKnownVx).toBe(0);
  });

  it('refuses to divide by an interval of nothing', () => {
    const bb = seen(0, -10);
    bb.noteSighting(2, 1, 1.26, -10, 0, 10, 0);
    expect(bb.lastKnownVx).toBe(0);
    expect(Number.isFinite(bb.lastKnownVx)).toBe(true);
  });

  it('resets the damage taken this contact when the contact is a new body', () => {
    const bb = seen(0, -10);
    bb.noteDamage(0, -10, 0, 0, 40);
    expect(bb.damageThisContact).toBe(40);
    bb.noteSighting(2, 1, 1.26, -10, 0, 10, 0.1);
    expect(bb.damageThisContact).toBe(40);
    bb.noteSighting(3, 1, 1.26, -10, 0, 10, 0.1);
    expect(bb.damageThisContact).toBe(0);
  });
});

describe('losing sight', () => {
  it('keeps the memory and drops the flag', () => {
    const bb = seen(3, -8);
    bb.noteNoSighting();
    expect(bb.hasLos).toBe(false);
    expect(bb.visibleEnemies).toBe(0);
    // Still believed, still aimed at: a bot shooting at a doorway you left is not a bug.
    expect(bb.targetId).toBe(2);
    expect(bb.lastKnownX).toBe(3);
    expect(bb.hasKnownTarget).toBe(true);
  });

  it('decays the confidence to nothing, and with it the belief', () => {
    const bb = seen();
    bb.noteNoSighting();
    let ticks = 0;
    while (bb.hasKnownTarget && ticks++ < 1000) bb.age(DECAY, NOISE_MEMORY);
    expect(bb.confidence).toBeLessThanOrEqual(0.05);
    expect(bb.hasKnownTarget).toBe(false);
    // About two seconds at the default decay.
    expect(ticks * DT).toBeGreaterThan(1);
    expect(ticks * DT).toBeLessThan(3);
  });

  it('ages the time since sight by a tick a tick, and forgets the held time', () => {
    const bb = seen();
    bb.losHeld = 4;
    bb.noteNoSighting();
    bb.age(DECAY, NOISE_MEMORY);
    expect(bb.sinceLos).toBe(DT);
    expect(bb.losHeld).toBe(0);
  });

  it('counts how long sight has been held while it still is', () => {
    const bb = seen();
    bb.age(DECAY, NOISE_MEMORY);
    bb.age(DECAY, NOISE_MEMORY);
    expect(bb.losHeld).toBe(DT * 2);
    expect(bb.confidence).toBe(1);
  });
});

describe('the reaction delay', () => {
  it('is unpaid until it has run out', () => {
    const bb = new BotBlackboard();
    bb.armReaction(2 * DT);
    expect(bb.reactionPaid).toBe(false);
    bb.age(DECAY, NOISE_MEMORY);
    expect(bb.reactionPaid).toBe(false);
    bb.age(DECAY, NOISE_MEMORY);
    expect(bb.reactionPaid).toBe(true);
    expect(bb.reactionTimer).toBe(0);
  });

  it('is already paid when a tier asks for none', () => {
    const bb = new BotBlackboard();
    bb.armReaction(0);
    expect(bb.reactionPaid).toBe(true);
  });
});

describe('a noise worth walking toward', () => {
  it('is a place, held for as long as the memory allows', () => {
    const bb = new BotBlackboard();
    bb.noteInvestigate(4, 0, -9);
    expect(bb.investigateValid).toBe(true);
    expect(bb.investigateX).toBe(4);
    expect(bb.investigateZ).toBe(-9);
    expect(bb.investigateAge).toBe(0);
  });

  it('expires once it is older than the memory, and not before', () => {
    const bb = new BotBlackboard();
    bb.noteInvestigate(4, 0, -9);
    const memory = DT * 3;
    bb.age(DECAY, memory);
    bb.age(DECAY, memory);
    bb.age(DECAY, memory);
    expect(bb.investigateValid).toBe(true);
    bb.age(DECAY, memory);
    expect(bb.investigateValid).toBe(false);
  });

  it('is refreshed by a newer noise rather than stacked', () => {
    const bb = new BotBlackboard();
    bb.noteInvestigate(4, 0, -9);
    bb.age(DECAY, NOISE_MEMORY);
    bb.noteInvestigate(1, 0, -2);
    expect(bb.investigateAge).toBe(0);
    expect(bb.investigateX).toBe(1);
  });
});

describe('being shot at', () => {
  it('points back along the direction it came from, normalised', () => {
    const bb = new BotBlackboard();
    bb.noteDamage(0, -10, 0, 0, 34);
    expect(bb.threatDirX).toBe(0);
    expect(bb.threatDirZ).toBe(-1);
    expect(bb.sinceDamage).toBe(0);
    expect(bb.damageThisContact).toBe(34);
  });

  it('accumulates the damage of one contact, which feeds the break for cover', () => {
    const bb = new BotBlackboard();
    bb.noteDamage(0, -10, 0, 0, 34);
    bb.noteDamage(0, -10, 0, 0, 20);
    expect(bb.damageThisContact).toBe(54);
  });

  it('keeps the last direction when the hit came from exactly where it stands', () => {
    const bb = new BotBlackboard();
    bb.noteDamage(5, 0, 0, 0, 10);
    const x = bb.threatDirX;
    bb.noteDamage(1, 1, 1, 1, 10);
    expect(bb.threatDirX).toBe(x);
    expect(bb.sinceDamage).toBe(0);
  });

  it('ages the time since the hit', () => {
    const bb = new BotBlackboard();
    bb.noteDamage(0, -10, 0, 0, 10);
    bb.age(DECAY, NOISE_MEMORY);
    expect(bb.sinceDamage).toBe(DT);
  });
});

describe('a reset', () => {
  it('returns the whole belief to what a fresh bot has', () => {
    const bb = seen(3, -8);
    bb.noteDamage(0, -10, 0, 0, 40);
    bb.noteInvestigate(1, 0, 1);
    bb.armReaction(1);
    bb.visibleEnemies = 3;
    bb.reset();

    const fresh = new BotBlackboard();
    expect(bb.targetId).toBe(fresh.targetId);
    expect(bb.hasLos).toBe(fresh.hasLos);
    expect(bb.sinceLos).toBe(fresh.sinceLos);
    expect(bb.confidence).toBe(fresh.confidence);
    expect(bb.investigateValid).toBe(fresh.investigateValid);
    expect(bb.reactionPaid).toBe(fresh.reactionPaid);
    expect(bb.sinceDamage).toBe(fresh.sinceDamage);
    expect(bb.damageThisContact).toBe(fresh.damageThisContact);
    expect(bb.visibleEnemies).toBe(fresh.visibleEnemies);
    expect(bb.hasKnownTarget).toBe(false);
  });

  it('forgets the sighting count, so the next contact estimates no velocity', () => {
    const bb = seen(0, -10);
    bb.noteSighting(2, 1, 1.26, -10, 0, 10, 0.1);
    expect(bb.lastKnownVx).toBe(10);
    bb.reset();
    bb.noteSighting(2, 0, 1.26, -10, 0, 10, 0.1);
    bb.noteSighting(2, 1, 1.26, -10, 0, 10, 0.1);
    expect(bb.lastKnownVx).toBe(10);
  });
});
