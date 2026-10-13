import { describe, expect, it } from 'vitest';
import { WEAPON_DEFS } from '../weapons/WeaponDefs';
import { camoRequirementOf } from './Challenges';
import { CAMO_IDS, CAMO_PREREQUISITES } from './Camos';
import { levelForXp, MAX_LEVEL, XP_TO_MAX } from './Levels';
import { defaultSave, defaultSettings, makeWeaponSave, type SaveV2, type WeaponSaveData } from './SaveData';
import { defaultLoadouts, type LoadoutSlot } from './Loadouts';
import { FALLBACK_PRIMARY, FALLBACK_SECONDARY } from './LoadoutRules';
import {
  attachmentsForWeapon,
  grantEverything,
  sanitiseLoadout,
  UnlockState,
  WEAPON_MASTERY_XP,
  WEAPON_MAX_LEVEL,
  weaponLevelForXp,
} from './Unlocks';

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

/**
 * `ATT7777` (the human, 2026-09-24): *"when I run the code I need full access to everything
 * in the game."*
 *
 * The test is the sentence, not the implementation: apply the grant to a level-one save and
 * then ask **the gates** whether anything is still shut. That is what makes it survive a
 * category being added — a sixth gated thing with no line in `grantEverything` fails here
 * without anybody remembering to come back, which is the failure the first two versions of
 * this cheat shipped with (attachments only, then everything but the equipment and the perks).
 */
describe('grantEverything', () => {
  /** A level-one save. The callsign is generated, so two of these are never byte-identical. */
  function freshSave(): SaveV2 {
    const save = defaultSave(defaultSettings('TDM', 'mp_foundry', 90));
    save.profile.level = 1;
    save.profile.xp = 0;
    return save;
  }

  /** The five writes `grantEverything` makes, applied to one save document. */
  function applyTo(save: SaveV2): SaveV2 {
    const weapon = (id: string): WeaponSaveData => (save.weapons[id] ??= makeWeaponSave());
    grantEverything({
      maxAccountLevel: () => {
        save.profile.xp = XP_TO_MAX;
        save.profile.level = levelForXp(save.profile.xp);
      },
      unlockPermanently: (id) => {
        if (!save.profile.permanentUnlocks.includes(id)) save.profile.permanentUnlocks.push(id);
      },
      masterWeapon: (id) => {
        weapon(id).xp = Math.max(weapon(id).xp, WEAPON_MASTERY_XP);
      },
      unlockAttachment: (id, attachment) => {
        const held = weapon(id).unlockedAttachments;
        if (!held.includes(attachment)) held.push(attachment);
      },
      grantCamo: (id, camo) => {
        weapon(id).camos[camo] = true;
      },
    });
    return save;
  }

  const applyToFreshSave = (): SaveV2 => applyTo(freshSave());

  it('leaves nothing in the game locked', () => {
    const state = UnlockState.fromSave(applyToFreshSave());
    // `tokenCandidates` is the game's own list of what a prestige token could still be spent
    // on: every weapon, perk, equipment and field upgrade that is not open. Empty is the claim.
    expect(state.tokenCandidates()).toEqual([]);
    for (const def of Object.values(WEAPON_DEFS)) {
      expect(state.weaponRequirement(def.id)).toBe('');
      for (const attachment of attachmentsForWeapon(def)) {
        expect(state.attachmentRequirement(def.id, attachment)).toBe('');
      }
      for (const camo of CAMO_IDS) expect(state.camoRequirement(def.id, camo)).toBe('');
    }
  });

  it('names every gated category permanently, so a prestige does not take it back', () => {
    /**
     * The same question asked at **level 1**, which is where a prestige puts the player, with
     * only `permanentUnlocks` standing between them and a locked game.
     *
     * This is the assertion that actually catches a missing category. At `MAX_LEVEL` the level
     * alone opens every level-gated thing, so the test above would pass with `grantEverything`
     * granting nothing but the level — which is exactly the version the human reported as
     * *"it does not open the grenades and the equipment"* wearing a different disguise.
     */
    const save = applyToFreshSave();
    const afterPrestige = new UnlockState(1, save.weapons, save.profile.permanentUnlocks);
    expect(afterPrestige.tokenCandidates()).toEqual([]);
  });

  it('takes the account to the cap and every weapon to its own', () => {
    const save = applyToFreshSave();
    expect(save.profile.level).toBe(MAX_LEVEL);
    for (const def of Object.values(WEAPON_DEFS)) {
      expect(weaponLevelForXp(save.weapons[def.id]?.xp ?? 0)).toBe(WEAPON_MAX_LEVEL);
    }
  });

  it('is idempotent, and does not invent kills', () => {
    const save = applyToFreshSave();
    const once = JSON.stringify(save);
    expect(save.weapons[WEAPON]?.kills).toBe(0);
    // Again over the *same* document — a second save would differ on its generated callsign
    // alone, which is a fact about `defaultSave` and not about this function.
    expect(JSON.stringify(applyTo(save))).toBe(once);
  });
});

/**
 * Sanitising a class against what the account has earned (A19).
 *
 * Acceptance criterion 5 in one function, and A19 breaks its sixty-three lines into one helper
 * per kind of lock. Three things about it are behaviour and are pinned here rather than left to
 * the structure pass beside it: a reverted weapon **loses its attachments**, because they were
 * earned on the gun it is no longer holding; the three equipment slots revert to three named
 * fallbacks; and the **order** matters — the unlock pass runs first and
 * `enforceLoadoutStructure` runs last, which is what makes a locked OVERKILL take its
 * permission with it.
 *
 * Every loss line is matched on substring rather than in full, because these carry a
 * requirement sentence from the formatter the suite above already pins exactly.
 */

/** A save at level 1 with nothing earned, which is the strictest `UnlockState` there is. */
function freshUnlocks(): UnlockState {
  return UnlockState.fromSave(defaultSave(defaultSettings('TDM', 'mp_foundry', 90)));
}

/** A save with everything, so only the structure rules can bite. */
function everything(): UnlockState {
  const save = defaultSave(defaultSettings('TDM', 'mp_foundry', 90));
  save.profile.xp = XP_TO_MAX;
  save.profile.level = MAX_LEVEL;
  for (const id of Object.keys(WEAPON_DEFS)) {
    const owned: Partial<Record<string, true>> = {};
    for (const camo of CAMO_IDS) owned[camo] = true;
    save.weapons[id] = {
      ...makeWeaponSave(),
      xp: WEAPON_MASTERY_XP,
      kills: 10_000,
      camos: owned as WeaponSaveData['camos'],
    };
  }
  return UnlockState.fromSave(save);
}

/** One loadout slot, shaped as the editor writes it. */
function slotWith(over: Partial<LoadoutSlot> = {}): LoadoutSlot {
  const slot = defaultLoadouts()[0];
  if (slot === undefined) throw new Error('no default loadout');
  return { ...slot, ...over };
}

describe('sanitiseLoadout: weapons', () => {
  it('passes the shipped default at level 1 unchanged', () => {
    const losses: string[] = [];
    const slot = slotWith();
    expect(sanitiseLoadout(slot, freshUnlocks(), losses)).toBe(false);
    expect(losses).toEqual([]);
  });

  it('reverts a locked primary to the carbine and names the requirement', () => {
    const losses: string[] = [];
    // VANTAGE SR is a level-38 sniper; a fresh account cannot hold it.
    const slot = slotWith({ primary: { weaponId: 'sniper_vantage', attachments: [], camo: null } });
    expect(sanitiseLoadout(slot, freshUnlocks(), losses)).toBe(true);
    expect(slot.primary.weaponId).toBe(FALLBACK_PRIMARY);
    expect(losses.some((l) => l.includes('is locked') && l.includes('reverted to'))).toBe(true);
  });

  it('takes the attachments with the weapon it reverted, because they were earned on that gun', () => {
    const losses: string[] = [];
    const slot = slotWith({
      primary: { weaponId: 'sniper_vantage', attachments: ['optic_reflex'], camo: null },
    });
    sanitiseLoadout(slot, freshUnlocks(), losses);
    expect(slot.primary.attachments).toEqual([]);
  });

  it('removes an attachment the weapon can carry but has not earned', () => {
    const losses: string[] = [];
    const slot = slotWith({
      primary: { weaponId: FALLBACK_PRIMARY, attachments: ['optic_reflex'], camo: null },
    });
    expect(sanitiseLoadout(slot, freshUnlocks(), losses)).toBe(true);
    expect(slot.primary.attachments).toEqual([]);
    expect(losses.some((l) => l.includes('not yet earned on'))).toBe(true);
  });

  it('keeps an attachment the weapon has earned', () => {
    const losses: string[] = [];
    const slot = slotWith({
      primary: { weaponId: FALLBACK_PRIMARY, attachments: ['optic_reflex'], camo: null },
    });
    expect(sanitiseLoadout(slot, everything(), losses)).toBe(false);
    expect(slot.primary.attachments).toEqual(['optic_reflex']);
  });

  it('clears a camo the weapon never earned, and keeps one it did', () => {
    const losses: string[] = [];
    const slot = slotWith({
      primary: { weaponId: FALLBACK_PRIMARY, attachments: [], camo: 'gold' },
    });
    expect(sanitiseLoadout(slot, freshUnlocks(), losses)).toBe(true);
    expect(slot.primary.camo).toBe(null);
    expect(losses.some((l) => l.includes('not earned on') && l.includes('cleared'))).toBe(true);

    const earned: string[] = [];
    const owned = slotWith({ primary: { weaponId: FALLBACK_PRIMARY, attachments: [], camo: 'gold' } });
    sanitiseLoadout(owned, everything(), earned);
    expect(owned.primary.camo).toBe('gold');
  });

  it('sanitises the secondary by its own fallback', () => {
    const losses: string[] = [];
    const slot = slotWith({ secondary: { weaponId: 'sniper_vantage', attachments: [], camo: null } });
    sanitiseLoadout(slot, freshUnlocks(), losses);
    expect(slot.secondary.weaponId).toBe(FALLBACK_SECONDARY);
  });
});

describe('sanitiseLoadout: equipment, perks and streaks', () => {
  it('reverts each locked slot to its own named fallback', () => {
    const losses: string[] = [];
    const slot = slotWith({ lethal: 'claymore', tactical: 'smoke', fieldUpgrade: 'armour' });
    expect(sanitiseLoadout(slot, freshUnlocks(), losses)).toBe(true);
    expect(slot.lethal).toBe('frag');
    expect(slot.tactical).toBe('flashbang');
    expect(slot.fieldUpgrade).toBe('munitions');
    expect(losses.some((l) => l.includes('lethal') && l.includes('reverted to frag'))).toBe(true);
    expect(losses.some((l) => l.includes('tactical') && l.includes('reverted to flashbang'))).toBe(true);
    expect(losses.some((l) => l.includes('field upgrade') && l.includes('reverted to munitions'))).toBe(true);
  });

  it('keeps every slot once the account has earned them', () => {
    const losses: string[] = [];
    const slot = slotWith({ lethal: 'claymore', tactical: 'smoke', fieldUpgrade: 'armour' });
    expect(sanitiseLoadout(slot, everything(), losses)).toBe(false);
    expect(slot.lethal).toBe('claymore');
  });

  it('removes a locked perk and names the level it wants', () => {
    const losses: string[] = [];
    // BATTLE HARDENED unlocks at 14; a fresh account is level 1.
    const slot = slotWith({ perks: ['battle_hardened', null, null] });
    expect(sanitiseLoadout(slot, freshUnlocks(), losses)).toBe(true);
    expect(slot.perks[0]).toBe(null);
    expect(losses.some((l) => l.includes('is locked (level 14)'))).toBe(true);
  });

  it('keeps a perk the account has reached', () => {
    const losses: string[] = [];
    const slot = slotWith({ perks: ['battle_hardened', null, null] });
    expect(sanitiseLoadout(slot, everything(), losses)).toBe(false);
    expect(slot.perks[0]).toBe('battle_hardened');
  });

  it('is idempotent once nothing is left to revert', () => {
    const slot = slotWith({ lethal: 'claymore', perks: ['battle_hardened', null, null] });
    const first: string[] = [];
    expect(sanitiseLoadout(slot, freshUnlocks(), first)).toBe(true);
    const second: string[] = [];
    expect(sanitiseLoadout(slot, freshUnlocks(), second)).toBe(false);
    expect(second).toEqual([]);
  });

  it('takes two passes to clear a camo off a weapon it reverted', () => {
    // Pins current behaviour; suspected bug: a reverted weapon keeps its camo for one pass.
    // The revert path clears `attachments` and returns, so the camo check below it never runs
    // on that call — a save naming a locked sniper with a camo on it comes back holding the
    // carbine *and* the camo, and only a second pass clears it.
    const slot = slotWith({
      primary: { weaponId: 'sniper_vantage', attachments: ['optic_reflex'], camo: 'gold' },
    });
    const first: string[] = [];
    expect(sanitiseLoadout(slot, freshUnlocks(), first)).toBe(true);
    expect(slot.primary.weaponId).toBe(FALLBACK_PRIMARY);
    expect(slot.primary.attachments).toEqual([]);
    // Still wearing a camo it never earned on the gun it is now holding.
    expect(slot.primary.camo).toBe('gold');

    const second: string[] = [];
    expect(sanitiseLoadout(slot, freshUnlocks(), second)).toBe(true);
    expect(slot.primary.camo).toBe(null);
    expect(second).toEqual(['ASSAULT primary: camo "gold" not earned on ar_carbine; cleared']);

    const third: string[] = [];
    expect(sanitiseLoadout(slot, freshUnlocks(), third)).toBe(false);
  });

  it('runs the structure pass last, so a locked OVERKILL takes its permission with it', () => {
    const losses: string[] = [];
    // A primary in the secondary slot is legal only with OVERKILL, which level 1 cannot hold.
    const slot = slotWith({
      secondary: { weaponId: FALLBACK_PRIMARY, attachments: [], camo: null },
      perks: [null, null, 'overkill'],
    });
    expect(sanitiseLoadout(slot, freshUnlocks(), losses)).toBe(true);
    expect(slot.perks[2]).toBe(null);
    // The permission went with the perk, so the secondary reverted too.
    expect(slot.secondary.weaponId).toBe(FALLBACK_SECONDARY);
  });

  it('keeps a primary in the secondary slot when OVERKILL is earned', () => {
    const losses: string[] = [];
    const slot = slotWith({
      secondary: { weaponId: FALLBACK_PRIMARY, attachments: [], camo: null },
      perks: [null, null, 'overkill'],
    });
    sanitiseLoadout(slot, everything(), losses);
    expect(slot.perks[2]).toBe('overkill');
    expect(slot.secondary.weaponId).toBe(FALLBACK_PRIMARY);
  });

  it('gates nothing in the Shooting Range, where the testbed rules apply', () => {
    const save = defaultSave(defaultSettings('TDM', 'mp_foundry', 90));
    const unrestricted = UnlockState.fromSave(save, true);
    const losses: string[] = [];
    const slot = slotWith({
      primary: { weaponId: 'sniper_vantage', attachments: [], camo: null },
      lethal: 'claymore',
      perks: ['battle_hardened', null, null],
    });
    expect(sanitiseLoadout(slot, unrestricted, losses)).toBe(false);
    expect(slot.primary.weaponId).toBe('sniper_vantage');
    expect(losses).toEqual([]);
  });

  it('assumes ids that normaliseSlot has already made real, and throws rather than guessing', () => {
    // The gate table has no default on purpose — a missing row would silently unlock an item at
    // level one, "the quietest possible failure for a progression system" (round 4, B7). So an
    // id that is not equipment at all is a programming error here, not a runtime condition:
    // `normaliseSlot` runs first on every load path and has already replaced it.
    const losses: string[] = [];
    const slot = slotWith({ lethal: 'nope' as never });
    expect(() => sanitiseLoadout(slot, freshUnlocks(), losses)).toThrow('has no row in');
  });

  it('assumes a real weapon id too, for the same reason', () => {
    // `weaponUnlocked` answers for a name it does not know, and `requireWeapon` below it does
    // not — so the contract is the same as the equipment table's: `normaliseSlot` has already
    // turned an unknown id into the shipped default before this function is ever reached.
    const losses: string[] = [];
    const slot = slotWith({ primary: { weaponId: 'not_a_weapon', attachments: [], camo: null } });
    expect(() => sanitiseLoadout(slot, freshUnlocks(), losses)).toThrow('Unknown weapon id');
  });
});
