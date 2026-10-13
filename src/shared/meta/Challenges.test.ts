import { describe, expect, it } from 'vitest';
import { CAMO_IDS, CAMO_PREREQUISITES, type CamoId } from './Camos';
import {
  camoRequirementOf,
  camosEarnedBy,
  challengeDef,
  CHALLENGES,
  type WeaponCamoStats,
} from './Challenges';
import { LONGSHOT_METRES } from './XpRules';

/**
 * Which camos one weapon's own counters have earned (A18).
 *
 * `camosEarnedBy` is two passes over the camo rules, because OBSIDIAN counts the other five —
 * on *this* weapon, so a gun with a hundred kills and no headshots does not inherit an obsidian
 * finish from the one that has them. A18 gives each pass a name, so the pinning here is about
 * the two things that survive that split and would be invisible if it did not: **the order the
 * camos come back in**, which is the declaration order the `Set` preserves, and **the second
 * pass reading only what the first pass put in**.
 */

/** A weapon record with every counter at zero, overridden as a test needs. */
function stats(over: Partial<WeaponCamoStats> = {}): WeaponCamoStats {
  return { kills: 0, headshots: 0, longshots: 0, multikills: 0, ...over };
}

/** The five counters that each award a camo outright, at exactly their thresholds. */
const ALL_FIVE = stats({ kills: 100, headshots: 15, longshots: 10, multikills: 5 });

describe('camos a weapon has earned', () => {
  it('earns none on a fresh weapon', () => {
    expect(camosEarnedBy(stats())).toEqual([]);
  });

  it('earns each counted camo at its own threshold, and not a kill before', () => {
    expect(camosEarnedBy(stats({ kills: 24 }))).toEqual([]);
    expect(camosEarnedBy(stats({ kills: 25 }))).toEqual(['digital']);

    expect(camosEarnedBy(stats({ headshots: 14 }))).toEqual([]);
    expect(camosEarnedBy(stats({ headshots: 15 }))).toEqual(['splinter']);

    expect(camosEarnedBy(stats({ longshots: 9 }))).toEqual([]);
    expect(camosEarnedBy(stats({ longshots: 10 }))).toEqual(['tiger']);

    expect(camosEarnedBy(stats({ multikills: 4 }))).toEqual([]);
    expect(camosEarnedBy(stats({ multikills: 5 }))).toEqual(['fractal']);

    expect(camosEarnedBy(stats({ kills: 99 }))).toEqual(['digital']);
    expect(camosEarnedBy(stats({ kills: 100 }))).toEqual(['digital', 'gold']);
  });

  it('returns them in the order the rules are declared, not the order they were reached', () => {
    // The declaration order is the `Set`'s insertion order, and the picker draws the row in it.
    expect(camosEarnedBy(ALL_FIVE)).toEqual([
      'digital',
      'splinter',
      'tiger',
      'fractal',
      'gold',
      'obsidian',
    ]);
  });

  it('awards OBSIDIAN only once the other five are on this same weapon', () => {
    expect(camosEarnedBy(ALL_FIVE)).toContain('obsidian');

    // One counter short of the five: the set rule counts four and refuses.
    const fourOfFive = stats({ kills: 100, headshots: 15, longshots: 10, multikills: 4 });
    const earned = camosEarnedBy(fourOfFive);
    expect(earned).not.toContain('obsidian');
    expect(earned).toEqual(['digital', 'splinter', 'tiger', 'gold']);
  });

  it('counts only what the first pass earned, never a camo the weapon was handed', () => {
    // A hundred kills earns two camos and no more: the set rule reads the pass above it rather
    // than anything stored on the weapon.
    expect(camosEarnedBy(stats({ kills: 100000 }))).toEqual(['digital', 'gold']);
  });

  it('is pure: the same counters in, the same camos out', () => {
    const input = ALL_FIVE;
    expect(camosEarnedBy(input)).toEqual(camosEarnedBy(input));
    expect(input).toEqual(ALL_FIVE);
  });

  it('awards every shipped camo to a weapon that has done everything', () => {
    const earned = camosEarnedBy(ALL_FIVE);
    expect(new Set(earned)).toEqual(new Set(CAMO_IDS));
  });
});

describe('what a locked camo costs', () => {
  it('reads the counter and the number off the rule that awards it', () => {
    expect(camoRequirementOf('digital')).toEqual({ stat: 'kills', target: 25, unit: 'KILLS' });
    expect(camoRequirementOf('splinter')).toEqual({
      stat: 'headshots',
      target: 15,
      unit: 'HEADSHOTS',
    });
    expect(camoRequirementOf('tiger')).toEqual({ stat: 'longshots', target: 10, unit: 'LONGSHOTS' });
    expect(camoRequirementOf('fractal')).toEqual({
      stat: 'multikills',
      target: 5,
      unit: 'MULTIKILLS',
    });
    expect(camoRequirementOf('gold')).toEqual({ stat: 'kills', target: 100, unit: 'KILLS' });
  });

  it('counts camos rather than kills for OBSIDIAN', () => {
    expect(camoRequirementOf('obsidian')).toEqual({
      stat: null,
      target: CAMO_PREREQUISITES.length,
      unit: 'CAMOS',
    });
  });

  it('throws for a camo nothing can award, rather than inventing a number', () => {
    expect(() => camoRequirementOf('chrome' as CamoId)).toThrow('has no challenge that awards it');
  });

  it('is answerable for every shipped camo', () => {
    for (const id of CAMO_IDS) {
      const requirement = camoRequirementOf(id);
      expect(requirement.target).toBeGreaterThan(0);
      expect(requirement.unit.length).toBeGreaterThan(0);
    }
  });
});

describe('looking a challenge up', () => {
  it('finds every one in the table', () => {
    for (const def of CHALLENGES) expect(challengeDef(def.id)?.id).toBe(def.id);
  });

  it('returns undefined for an id that is not a challenge', () => {
    expect(challengeDef('not_a_challenge')).toBe(undefined);
  });
});

describe('the challenge table’s shape', () => {
  it('lists every id exactly once', () => {
    const ids = CHALLENGES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every challenge a positive target and some XP', () => {
    for (const def of CHALLENGES) {
      expect(def.target, def.id).toBeGreaterThan(0);
      expect(def.xp, def.id).toBeGreaterThan(0);
      expect(def.name.length, def.id).toBeGreaterThan(0);
      expect(def.description.length, def.id).toBeGreaterThan(0);
    }
  });

  it('awards each camo from exactly one challenge', () => {
    for (const camo of CAMO_IDS) {
      expect(CHALLENGES.filter((c) => c.camo === camo), camo).toHaveLength(1);
    }
  });

  it('describes the longshot challenges with the one threshold the game measures', () => {
    // The description is built from the constant rather than spelled out, so the sentence and
    // the rule cannot drift. `XpRules.LONGSHOT_METRES` is that constant.
    const longshot = CHALLENGES.filter((c) => c.description.includes('beyond'));
    expect(longshot.length).toBeGreaterThan(0);
    for (const def of longshot) {
      expect(def.description, def.id).toContain(`${LONGSHOT_METRES} m`);
    }
  });
});
