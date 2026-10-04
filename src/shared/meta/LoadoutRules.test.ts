import { describe, expect, it } from 'vitest';
import { resolvePerkState } from '../perks/PerkState';
import { cloneLoadout, defaultLoadouts, resolveLoadout, type LoadoutSlot } from './Loadouts';
import { enforceLoadoutStructure } from './LoadoutRules';
import { sanitiseLoadout, UnlockState } from './Unlocks';

/**
 * The class shapes no profile can change (security audit 2026-10-04, S1).
 *
 * Every case here is a class the editor cannot produce and the server used to simulate. The
 * first block is the one that matters most and is easiest to forget: nothing a player *can*
 * build is touched.
 */

function base(): LoadoutSlot {
  const slot = defaultLoadouts()[0];
  if (slot === undefined) throw new Error('no default class');
  return cloneLoadout(slot);
}

function enforce(slot: LoadoutSlot): { changed: boolean; losses: string[] } {
  const losses: string[] = [];
  const changed = enforceLoadoutStructure(slot, losses);
  return { changed, losses };
}

describe('a class the editor can build', () => {
  it('passes every shipped default unchanged', () => {
    for (const slot of defaultLoadouts()) {
      const before = JSON.stringify(slot);
      const { changed, losses } = enforce(slot);
      expect(losses).toEqual([]);
      expect(changed).toBe(false);
      expect(JSON.stringify(slot)).toBe(before);
    }
  });

  it('keeps a primary in the secondary slot when the class runs OVERKILL', () => {
    const slot = base();
    slot.perks = [null, null, 'overkill'];
    slot.secondary = { weaponId: 'sniper_kestrel', attachments: [], camo: null };
    expect(enforce(slot).changed).toBe(false);
    expect(slot.secondary.weaponId).toBe('sniper_kestrel');
  });

  it('is idempotent: a corrected class needs no second correction', () => {
    const slot = base();
    slot.perks = ['sleight_of_hand', 'sleight_of_hand', 'sleight_of_hand'];
    slot.streaks = ['uav', 'uav', 'uav'];
    expect(enforce(slot).changed).toBe(true);
    expect(enforce(slot)).toEqual({ changed: false, losses: [] });
  });
});

describe('perks', () => {
  it('drops the second and third copy of a perk, so the effect is counted once', () => {
    const slot = base();
    slot.perks = ['lightweight', 'lightweight', 'lightweight'];
    // The exploit, measured before the fix: 1.07 cubed.
    expect(resolvePerkState(['lightweight', 'lightweight', 'lightweight']).moveSpeedMult).toBeCloseTo(1.225, 3);

    const { losses } = enforce(slot);
    expect(slot.perks).toEqual(['lightweight', null, null]);
    expect(losses).toHaveLength(2);
    expect(resolveLoadout(slot, 0).perkState.moveSpeedMult).toBeCloseTo(1.07, 6);
  });

  it('reloads at the one-perk rate after three copies of SLEIGHT OF HAND', () => {
    const slot = base();
    const clean = resolveLoadout(slot, 0).primary.reloadTime;
    slot.perks = ['sleight_of_hand', 'sleight_of_hand', 'sleight_of_hand'];
    enforce(slot);
    expect(resolveLoadout(slot, 0).primary.reloadTime).toBeCloseTo(clean * 0.65, 6);
  });

  it('holds one perk per tier: a second tier-1 perk is removed, the first kept', () => {
    const slot = base();
    slot.perks = ['lightweight', 'sleight_of_hand', 'scavenger'];
    enforce(slot);
    expect(slot.perks).toEqual(['lightweight', null, null]);
  });

  it('moves a perk saved in the wrong slot to its own tier rather than dropping it', () => {
    const slot = base();
    slot.perks = ['quickdraw', null, null];
    const { changed } = enforce(slot);
    expect(changed).toBe(true);
    expect(slot.perks).toEqual([null, null, 'quickdraw']);
  });

  it('normalises the list to three slots', () => {
    const slot = base();
    slot.perks = ['lightweight'];
    enforce(slot);
    expect(slot.perks).toEqual(['lightweight', null, null]);
  });
});

describe('weapons', () => {
  it('reverts a primary in the secondary slot without OVERKILL to the sidearm', () => {
    const slot = base();
    slot.perks = ['lightweight', null, 'quickdraw'];
    slot.secondary = { weaponId: 'lmg_bastion', attachments: ['mag_extended'], camo: null };
    enforce(slot);
    expect(slot.secondary).toEqual({ weaponId: 'pistol_talon', attachments: [], camo: null });
  });

  it('reads OVERKILL after the perks are legal, so a dropped OVERKILL takes its permission with it', () => {
    const slot = base();
    // Two tier-3 perks: COLD-BLOODED is first and kept, OVERKILL is the one that goes.
    slot.perks = ['cold_blooded', 'overkill', null];
    slot.secondary = { weaponId: 'sniper_kestrel', attachments: [], camo: null };
    enforce(slot);
    expect(slot.perks).toEqual([null, null, 'cold_blooded']);
    expect(slot.secondary.weaponId).toBe('pistol_talon');
  });

  it('reverts a sidearm in the primary slot to the carbine', () => {
    const slot = base();
    slot.primary = { weaponId: 'pistol_talon', attachments: [], camo: null };
    enforce(slot);
    expect(slot.primary.weaponId).toBe('ar_carbine');
  });

  it('keeps one attachment per attachment slot and only ones the weapon can carry', () => {
    const slot = base();
    slot.primary.attachments = ['mag_extended', 'mag_extended', 'optic_reflex'];
    // The TALON has no underbarrel.
    slot.secondary.attachments = ['grip_foregrip', 'laser_tactical'];
    enforce(slot);
    expect(slot.primary.attachments).toEqual(['mag_extended', 'optic_reflex']);
    expect(slot.secondary.attachments).toEqual(['laser_tactical']);
  });
});

describe('equipment and streaks', () => {
  it('puts a lethal in the lethal slot and a tactical in the tactical slot', () => {
    const slot = base();
    slot.lethal = 'flashbang';
    slot.tactical = 'semtex';
    enforce(slot);
    expect(slot.lethal).toBe('frag');
    expect(slot.tactical).toBe('flashbang');
  });

  it('holds each streak to one key', () => {
    const slot = base();
    slot.streaks = ['uav', 'uav', 'mortar'];
    enforce(slot);
    expect(slot.streaks).toEqual(['uav', null, 'mortar']);
  });
});

describe('junk', () => {
  it('never throws, whatever the slot names', () => {
    const slot = base() as unknown as Record<string, unknown>;
    slot['perks'] = ['__proto__', 'constructor', 42, null];
    slot['streaks'] = ['toString', 'uav', 'uav', 'uav', 'sentry'];
    slot['lethal'] = '__proto__';
    slot['tactical'] = undefined;
    slot['primary'] = { weaponId: 'constructor', attachments: ['__proto__', 7], camo: null };
    slot['secondary'] = { weaponId: 'nope', attachments: 'not a list', camo: null };
    const typed = slot as unknown as LoadoutSlot;

    expect(() => enforce(typed)).not.toThrow();
    expect(typed.perks).toEqual([null, null, null]);
    expect(typed.streaks).toEqual([null, 'uav', null]);
    expect(typed.lethal).toBe('frag');
    expect(typed.tactical).toBe('flashbang');
    expect(typed.primary).toEqual({ weaponId: 'ar_carbine', attachments: [], camo: null });
    expect(typed.secondary).toEqual({ weaponId: 'pistol_talon', attachments: [], camo: null });
    // And the result is a class a match can be built from.
    expect(() => resolveLoadout(typed, 0)).not.toThrow();
  });
});

describe('the client sanitiser', () => {
  it('reverts a primary in the secondary slot when OVERKILL is locked, not only when it is absent', () => {
    // Level 22: the KESTREL (11) is open, OVERKILL (23) is not. The unlock pass removes the
    // perk; the secondary must follow it. Before the structure pass ran last, it did not.
    const unlocks = new UnlockState(22, {}, []);
    const slot = base();
    slot.perks = ['lightweight', null, 'overkill'];
    slot.secondary = { weaponId: 'sniper_kestrel', attachments: [], camo: null };

    const losses: string[] = [];
    expect(sanitiseLoadout(slot, unlocks, losses)).toBe(true);
    expect(slot.perks).toEqual(['lightweight', null, null]);
    expect(slot.secondary.weaponId).toBe('pistol_talon');
  });

  it('corrects a hand-edited save of three identical perks', () => {
    const unlocks = new UnlockState(30, {}, []);
    const slot = base();
    slot.perks = ['sleight_of_hand', 'sleight_of_hand', 'sleight_of_hand'];
    sanitiseLoadout(slot, unlocks, []);
    expect(slot.perks).toEqual(['sleight_of_hand', null, null]);
  });
});
