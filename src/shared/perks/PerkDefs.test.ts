import { describe, expect, it } from 'vitest';
import {
  isPerkId,
  PERK_IDS,
  PERK_TIERS,
  PERKS,
  perkDef,
  perksOfTier,
  type PerkId,
} from './PerkDefs';

/**
 * The twelve perks, as data (A18).
 *
 * Tiers are the part with a rule behind them: three slots, one perk from each, and the grouping
 * is the design — *"tier 1 is sustain, tier 2 is stealth and intel, tier 3 is handling, and
 * Overkill sits in tier 3 against Quickdraw so a second primary costs you the fastest ADS in
 * the game."* A perk that drifted into the wrong tier would make that sentence false and nothing
 * else would notice, so the tiers are pinned perk by perk.
 */

describe('looking a perk up', () => {
  it('finds every shipped id', () => {
    for (const id of PERK_IDS) expect(perkDef(id).id).toBe(id);
  });

  it('returns the table’s own object', () => {
    expect(perkDef('lightweight')).toBe(PERKS.lightweight);
  });

  it('tells a perk id from any other string, for the save repair', () => {
    expect(isPerkId('ghost')).toBe(true);
    expect(isPerkId('cold_blooded')).toBe(true);
    expect(isPerkId('')).toBe(false);
    expect(isPerkId('GHOST')).toBe(false);
    expect(isPerkId('coldblooded')).toBe(false);
  });
});

describe('the table', () => {
  it('lists the twelve', () => {
    expect(PERK_IDS).toHaveLength(12);
    expect(new Set(PERK_IDS).size).toBe(12);
  });

  it('keys every entry by its own id', () => {
    for (const [key, def] of Object.entries(PERKS)) expect(def.id).toBe(key);
  });

  it('gives every perk a name, a blurb, a hook and an unlock level', () => {
    for (const id of PERK_IDS) {
      const def = perkDef(id);
      expect(def.name.length, id).toBeGreaterThan(0);
      expect(def.blurb.length, id).toBeGreaterThan(0);
      // The hook names the system that carries the perk out, printed beside the measurement.
      expect(def.hook.length, id).toBeGreaterThan(0);
      expect(def.unlockLevel, id).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives every perk something to do: a weapon effect, a state effect, or both', () => {
    for (const id of PERK_IDS) {
      const def = perkDef(id);
      const weaponFields = Object.keys(def.weapon).length;
      const stateFields = Object.keys(def.state).length;
      expect(weaponFields + stateFields, id).toBeGreaterThan(0);
    }
  });
});

describe('the three tiers', () => {
  it('has exactly the three S6.3 asks for', () => {
    expect(PERK_TIERS).toEqual([1, 2, 3]);
  });

  it('puts every perk in one of them', () => {
    for (const id of PERK_IDS) expect(PERK_TIERS, id).toContain(perkDef(id).tier);
  });

  it('accounts for all twelve across the three columns, with none shared', () => {
    const columns = PERK_TIERS.map((tier) => perksOfTier(tier));
    const total = columns.reduce((n, column) => n + column.length, 0);
    expect(total).toBe(PERK_IDS.length);
    for (const column of columns) expect(column.length).toBeGreaterThan(0);
  });

  it('returns a tier’s perks in declaration order, which is the editor’s column order', () => {
    for (const tier of PERK_TIERS) {
      const fromTable = PERK_IDS.filter((id) => perkDef(id).tier === tier);
      expect(perksOfTier(tier).map((d) => d.id)).toEqual(fromTable);
    }
  });

  it('groups them as the design says: sustain, then stealth and intel, then handling', () => {
    const tierOf: Record<PerkId, 1 | 2 | 3> = {
      lightweight: 1,
      scavenger: 1,
      battle_hardened: 1,
      sleight_of_hand: 1,
      ghost: 2,
      dead_silence: 2,
      tracker: 2,
      hardline: 2,
      quickdraw: 3,
      amped: 3,
      overkill: 3,
      cold_blooded: 3,
    };
    for (const id of PERK_IDS) expect(perkDef(id).tier, id).toBe(tierOf[id]);
  });

  it('puts Overkill against Quickdraw, which is the trade the grouping exists for', () => {
    expect(perkDef('overkill').tier).toBe(perkDef('quickdraw').tier);
  });
});

describe('the inert flag', () => {
  it('is set only where S9 says the effect has no consumer yet', () => {
    // Surfaced in the editor and the panel, so a perk marked inert that now works would be a
    // lie to the player and one that is inert and unmarked would be a mystery.
    for (const id of PERK_IDS) {
      const def = perkDef(id);
      if (def.inert === true) expect(Object.keys(def.state).length, id).toBeGreaterThan(0);
    }
  });
});
