import { describe, expect, it } from 'vitest';
import { PERK_IDS, perkDef, type PerkId } from './PerkDefs';
import { describePerkState, NO_PERKS, perkWeaponEffects, resolvePerkState } from './PerkState';

/**
 * Folding three perks into one state (A18).
 *
 * `resolvePerkState` carried nine running locals and nine branches in one loop, and A18 folds
 * them into a draft. Two things about it are behaviour rather than style and are pinned first:
 * multipliers **compose by multiplication in the order the ids are given** — so three copies of
 * Lightweight are 1.07 cubed and not 1.07 — and two of the nine outputs are **inversions** of
 * what the perk declares (`ghost` sets `visibleToUav: false`). A fold that got either wrong would
 * still look right in a test that only asked about one perk at a time.
 */

describe('no perks at all', () => {
  it('is the shared neutral, returned by identity', () => {
    // The same object, not a copy: "no perks" is one state the whole match can share.
    expect(resolvePerkState([])).toBe(NO_PERKS);
  });

  it('is neutral in every field, which is what M1-M5 already did', () => {
    expect(NO_PERKS).toEqual({
      perks: [],
      moveSpeedMult: 1,
      audibleFootsteps: true,
      flashResistMult: 1,
      scavenger: false,
      tracker: false,
      overkill: false,
      visibleToUav: true,
      targetedByStreaks: true,
      streakDiscount: 0,
    });
  });
});

describe('the multipliers', () => {
  it('takes Lightweight’s 1.07 straight from the def', () => {
    expect(resolvePerkState(['lightweight']).moveSpeedMult).toBe(1.07);
  });

  it('composes by multiplication, in the order the ids are given', () => {
    // Three of the same perk is 1.07 ** 3 — the stacking rule, not the last-one-wins rule.
    const state = resolvePerkState(['lightweight', 'lightweight', 'lightweight']);
    expect(state.moveSpeedMult).toBe(1.07 * 1.07 * 1.07);
    expect(state.moveSpeedMult).toBeCloseTo(1.225, 3);
  });

  it('multiplies flash resistance the same way', () => {
    expect(resolvePerkState(['battle_hardened']).flashResistMult).toBe(0.4);
    expect(resolvePerkState(['battle_hardened', 'battle_hardened']).flashResistMult).toBe(0.4 * 0.4);
  });

  it('leaves a quantity no equipped perk touches at its neutral', () => {
    const state = resolvePerkState(['lightweight']);
    expect(state.flashResistMult).toBe(1);
    expect(state.streakDiscount).toBe(0);
  });
});

describe('the flags', () => {
  it('turns each one on from its own perk', () => {
    expect(resolvePerkState(['scavenger']).scavenger).toBe(true);
    expect(resolvePerkState(['tracker']).tracker).toBe(true);
    expect(resolvePerkState(['overkill']).overkill).toBe(true);
    expect(resolvePerkState(['dead_silence']).audibleFootsteps).toBe(false);
  });

  it('inverts the two that are stated as the perk and stored as the absence', () => {
    // `ghost: true` on the def means `visibleToUav: false` on the state, and likewise for
    // Cold-Blooded. The inversion is the whole of what the two streak hooks read.
    expect(resolvePerkState(['ghost']).visibleToUav).toBe(false);
    expect(resolvePerkState(['cold_blooded']).targetedByStreaks).toBe(false);
    // And the other one is untouched by either.
    expect(resolvePerkState(['ghost']).targetedByStreaks).toBe(true);
    expect(resolvePerkState(['cold_blooded']).visibleToUav).toBe(true);
  });

  it('ORs rather than overwrites, so a second perk cannot turn one back off', () => {
    const state = resolvePerkState(['scavenger', 'lightweight', 'tracker']);
    expect(state.scavenger).toBe(true);
    expect(state.tracker).toBe(true);
    expect(state.moveSpeedMult).toBe(1.07);
  });
});

describe('the streak discount', () => {
  it('is Hardline’s one kill', () => {
    expect(resolvePerkState(['hardline']).streakDiscount).toBe(1);
  });

  it('sums rather than multiplies, because it is a count and not a scale', () => {
    expect(resolvePerkState(['hardline', 'hardline', 'hardline']).streakDiscount).toBe(3);
  });
});

describe('the resolved list', () => {
  it('is a copy of what was handed in, in the same order', () => {
    const ids: PerkId[] = ['lightweight', 'ghost', 'quickdraw'];
    const state = resolvePerkState(ids);
    expect(state.perks).toEqual(ids);
    expect(state.perks).not.toBe(ids);
  });

  it('cannot be disturbed by a later change to the caller’s array', () => {
    const ids: PerkId[] = ['lightweight'];
    const state = resolvePerkState(ids);
    ids.push('ghost');
    expect(state.perks).toEqual(['lightweight']);
  });

  it('resolves every shipped perk without throwing, and leaves nine fields in shape', () => {
    for (const id of PERK_IDS) {
      const state = resolvePerkState([id]);
      expect(state.perks).toEqual([id]);
      expect(Number.isFinite(state.moveSpeedMult)).toBe(true);
      expect(Number.isFinite(state.flashResistMult)).toBe(true);
      expect(Number.isInteger(state.streakDiscount)).toBe(true);
    }
  });
});

describe('the weapon-side effects', () => {
  it('are returned in perk order, not folded', () => {
    // `resolveWeaponDef` applies them in a fixed order, so folding here would put the
    // multiplication in two places.
    const effects = perkWeaponEffects(['sleight_of_hand', 'quickdraw']);
    expect(effects).toEqual([perkDef('sleight_of_hand').weapon, perkDef('quickdraw').weapon]);
  });

  it('skip a perk with nothing to say to a weapon', () => {
    // Lightweight is a state-only perk: an empty record would still cost a pass.
    expect(perkWeaponEffects(['lightweight'])).toEqual([]);
    expect(perkWeaponEffects([])).toEqual([]);
  });

  it('keep every perk that does have a weapon effect', () => {
    const withWeaponEffects = PERK_IDS.filter((id) => Object.keys(perkDef(id).weapon).length > 0);
    expect(perkWeaponEffects(withWeaponEffects)).toHaveLength(withWeaponEffects.length);
  });
});

describe('the one-line description', () => {
  it('says none for an empty loadout', () => {
    expect(describePerkState(NO_PERKS)).toBe('none');
    expect(describePerkState(resolvePerkState([]))).toBe('none');
  });

  it('joins the perks’ names in order', () => {
    expect(describePerkState(resolvePerkState(['lightweight', 'ghost']))).toBe('LIGHTWEIGHT · GHOST');
  });
});
