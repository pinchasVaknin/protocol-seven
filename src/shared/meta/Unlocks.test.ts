import { describe, expect, it } from 'vitest';
import { camoRequirementOf } from './Challenges';
import { CAMO_IDS, CAMO_PREREQUISITES } from './Camos';
import { makeWeaponSave, type WeaponSaveData } from './SaveData';
import { UnlockState, WEAPON_MASTERY_XP, WEAPON_MAX_LEVEL, weaponLevelForXp } from './Unlocks';

/**
 * What a locked chip says (the human's brief §6, 2026-09-24), and the ceiling `ATT7777`
 * writes (§3).
 *
 * The rule under every case here is one sentence: **a locked chip names the target and the
 * progress towards it.** `scripts/check-unlocks.mjs` holds the accessors to the formatter;
 * this holds the formatter to the numbers, which is the half a regex cannot see.
 */

const WEAPON = 'ar_carbine'; // unlockLevel 1, takes every attachment.
const LOCKED_WEAPON = 'ar_vulcan'; // unlockLevel 2 — the cheapest gate above level one.

function weapons(over: Partial<WeaponSaveData> = {}): Record<string, WeaponSaveData> {
  return { [WEAPON]: { ...makeWeaponSave(), ...over } };
}

describe('a locked chip', () => {
  it('prints the account level the player is at, over the one the gate wants', () => {
    const state = new UnlockState(1, weapons(), []);
    expect(state.weaponRequirement(LOCKED_WEAPON)).toBe('LEVEL 1 / 2');
    // Perks, equipment and field upgrades are the same gate and say so the same way.
    expect(state.equipmentRequirement('claymore')).toBe('LEVEL 1 / 16');
    expect(state.equipmentRequirement('smoke')).toBe('LEVEL 1 / 3');
  });

  it('says nothing at all once the item is available', () => {
    const state = new UnlockState(20, weapons(), []);
    expect(state.weaponRequirement(LOCKED_WEAPON)).toBe('');
    expect(state.equipmentRequirement('claymore')).toBe('');
    expect(state.equipmentRequirement('frag')).toBe('');
  });

  it('prints kills against the threshold, not the distance to it', () => {
    const state = new UnlockState(1, weapons({ kills: 18 }), []);
    // mag_extended is 25 kills. The old line said "7 MORE KILLS", which reads the same at 0.
    expect(state.attachmentRequirement(WEAPON, 'mag_extended')).toBe('18 / 25 KILLS');
    expect(state.attachmentRequirement(WEAPON, 'muzzle_suppressor')).toBe('18 / 60 KILLS');
    // And one already earned draws no chip.
    expect(state.attachmentRequirement(WEAPON, 'laser_tactical')).toBe('');
  });

  it('counts from zero for a weapon the save has never seen', () => {
    const state = new UnlockState(1, {}, []);
    expect(state.attachmentRequirement(WEAPON, 'mag_extended')).toBe('0 / 25 KILLS');
  });

  it('prints each camo against the counter its own challenge reads', () => {
    const state = new UnlockState(1, weapons({ kills: 30, headshots: 4, longshots: 9 }), []);
    expect(state.camoRequirement(WEAPON, 'gold')).toBe('30 / 100 KILLS');
    expect(state.camoRequirement(WEAPON, 'splinter')).toBe('4 / 15 HEADSHOTS');
    expect(state.camoRequirement(WEAPON, 'tiger')).toBe('9 / 10 LONGSHOTS');
    expect(state.camoRequirement(WEAPON, 'fractal')).toBe('0 / 5 MULTIKILLS');
  });

  it('draws no chip on a camo the weapon owns, whatever its counters say', () => {
    // Ownership is the save's, written by `ChallengeTracker.grantCamos` — not re-derived
    // here, which is what lets `ATT7777` grant a finish a weapon has not shot for.
    const state = new UnlockState(1, weapons({ kills: 0, camos: { gold: true } }), []);
    expect(state.camoRequirement(WEAPON, 'gold')).toBe('');
    expect(state.camoRequirement(WEAPON, 'digital')).toBe('0 / 25 KILLS');
  });

  it('counts OBSIDIAN over the camos this one weapon owns', () => {
    const owned = { digital: true, splinter: true, tiger: true };
    const state = new UnlockState(1, weapons({ camos: owned }), []);
    expect(state.camoRequirement(WEAPON, 'obsidian')).toBe(
      `3 / ${CAMO_PREREQUISITES.length} CAMOS`,
    );
    // A weapon the player has not touched is at nothing, whatever the rest of the arsenal holds.
    expect(state.camoRequirement('smg_wasp', 'obsidian')).toBe(
      `0 / ${CAMO_PREREQUISITES.length} CAMOS`,
    );
  });

  it('never reads past its own bar', () => {
    // A counter can pass a bar the save has not paid out yet — the tracker grants a camo at
    // the end of a match, not at the kill — and `400 / 100 KILLS` on a locked chip reads as a
    // broken gate rather than as one waiting for the summary screen.
    const state = new UnlockState(1, weapons({ kills: 400, camos: { digital: true } }), []);
    for (const id of CAMO_IDS) {
      const line = state.camoRequirement(WEAPON, id);
      if (line === '') continue;
      const [have, need] = line.split(' / ');
      expect(Number(have)).toBeLessThanOrEqual(Number.parseInt(need ?? '0', 10));
    }
  });

  it('is empty for every category in the Shooting Range, which gates nothing', () => {
    const state = new UnlockState(1, {}, [], true);
    expect(state.weaponRequirement(LOCKED_WEAPON)).toBe('');
    expect(state.attachmentRequirement(WEAPON, 'muzzle_suppressor')).toBe('');
    expect(state.camoRequirement(WEAPON, 'gold')).toBe('');
    expect(state.equipmentRequirement('claymore')).toBe('');
  });
});

describe('every camo', () => {
  it('has a rule behind it that the chip can read', () => {
    for (const id of CAMO_IDS) {
      const need = camoRequirementOf(id);
      expect(need.target).toBeGreaterThan(0);
      expect(need.unit).not.toBe('');
    }
  });
});

describe('the weapon ladder', () => {
  it('has a ceiling `ATT7777` can write, and writing it is the top level', () => {
    expect(weaponLevelForXp(WEAPON_MASTERY_XP)).toBe(WEAPON_MAX_LEVEL);
    expect(weaponLevelForXp(WEAPON_MASTERY_XP - 1)).toBe(WEAPON_MAX_LEVEL - 1);
    // And it does not overshoot: the maximum is the maximum.
    expect(weaponLevelForXp(WEAPON_MASTERY_XP * 2)).toBe(WEAPON_MAX_LEVEL);
  });
});
