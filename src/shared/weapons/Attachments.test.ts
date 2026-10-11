import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_IDS,
  ATTACHMENTS,
  attachmentDef,
  fitsWeapon,
  measureAttachment,
  resolveWeaponDef,
  verifyAttachmentPurity,
} from './Attachments';
import { ALL_WEAPONS, AR_DEFAULT, cloneWeaponDef, PISTOL_DEFAULT, requireWeapon } from './WeaponDefs';

/**
 * Attachments, and the two properties the balance table rests on.
 *
 * **Purity.** `resolveWeaponDef` must never touch its base. The base defs are module
 * singletons every weapon in every match reads, so one write through a resolved def would
 * retune the gun for the whole process — and it would do it silently, because the loadout
 * editor would keep showing the right numbers. `verifyAttachmentPurity` is that check as code
 * rather than as a claim, and the test below runs it over all twelve weapons.
 *
 * **Order.** Multipliers compose by multiplication, which is commutative in exact arithmetic
 * and not quite in floating point, and `magSizeMult` has a `Math.round` in it that is not
 * commutative at all. So the apply order is fixed, and two loadouts with the same set in a
 * different order must produce byte-identical defs or the table is a lie about which gun you
 * were holding.
 *
 * The numbers are exact because the costs are the point: S6.2 asked for a cost measurable in
 * the same units as the benefit, and +14% of a 0.28 s ADS is the 39 ms the report quotes.
 */

describe('the attachment table', () => {
  it('is the five from S6.2, each in its own slot', () => {
    expect(ATTACHMENT_IDS).toEqual([
      'optic_reflex',
      'muzzle_suppressor',
      'mag_extended',
      'grip_foregrip',
      'laser_tactical',
    ]);
    // One per slot, so no two can contend for the same place on the weapon.
    const slots = ATTACHMENT_IDS.map((id) => ATTACHMENTS[id].slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('gives every attachment a benefit, a cost and at least one effect', () => {
    for (const id of ATTACHMENT_IDS) {
      const def = attachmentDef(id);
      expect(def.id, id).toBe(id);
      expect(def.name.length, id).toBeGreaterThan(0);
      // Both lines are shown side by side in the panel, so neither may be empty.
      expect(def.benefit.length, id).toBeGreaterThan(0);
      expect(def.cost.length, id).toBeGreaterThan(0);
      expect(Object.keys(def.effects).length, id).toBeGreaterThan(0);
    }
  });

  it('fits a weapon only where the weapon has the slot', () => {
    expect(AR_DEFAULT.attachmentSlots).toEqual([
      'optic',
      'muzzle',
      'barrel',
      'underbarrel',
      'magazine',
      'stock',
      'laser',
    ]);
    expect(ATTACHMENT_IDS.map((id) => fitsWeapon(AR_DEFAULT, id))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    // A pistol has no underbarrel, so the foregrip is the one that does not go on it.
    expect(PISTOL_DEFAULT.attachmentSlots).toEqual(['optic', 'muzzle', 'magazine', 'laser']);
    expect(ATTACHMENT_IDS.map((id) => fitsWeapon(PISTOL_DEFAULT, id))).toEqual([
      true,
      true,
      true,
      false,
      true,
    ]);
  });
});

describe('resolving one attachment', () => {
  it('trades magazine capacity for reload time', () => {
    const on = resolveWeaponDef(AR_DEFAULT, ['mag_extended']);
    // 30 x 1.5, and both reload times by 1.25.
    expect(on.magSize).toBe(45);
    expect(on.reloadTime).toBe(2.5625);
    expect(on.reloadEmptyTime).toBe(3.5625);
    expect(AR_DEFAULT.magSize).toBe(30);
  });

  it('rounds the magazine to a whole round', () => {
    // A pistol's 12 x 1.5 is 18 exactly; the rounding is what keeps an odd base honest.
    expect(resolveWeaponDef(PISTOL_DEFAULT, ['mag_extended']).magSize).toBe(18);
    const odd = cloneWeaponDef(AR_DEFAULT);
    odd.magSize = 25;
    expect(resolveWeaponDef(odd, ['mag_extended']).magSize).toBe(38);
  });

  it('trades range and the minimap ping for a quieter muzzle', () => {
    const on = resolveWeaponDef(AR_DEFAULT, ['muzzle_suppressor']);
    expect(on.damageFalloff.start).toBe(23.400000000000002);
    expect(on.damageFalloff.end).toBe(37.800000000000004);
    // The flag is overridden outright rather than scaled.
    expect(on.minimapPing).toBe(false);
    expect(on.muzzleFlashScale).toBe(0.4);
    expect(AR_DEFAULT.minimapPing).toBe(true);
  });

  it('trades ADS speed for vertical recoil', () => {
    const on = resolveWeaponDef(AR_DEFAULT, ['grip_foregrip']);
    expect(on.recoil.verticalScale).toBe(0.75);
    expect(on.adsTime).toBe(0.30434782608695654);
    expect(on.adsTime).toBeGreaterThan(AR_DEFAULT.adsTime);
  });

  it('trades a visible dot for hip spread', () => {
    const on = resolveWeaponDef(AR_DEFAULT, ['laser_tactical']);
    expect(on.spread.hipStand).toBe(1.52);
    expect(on.spread.hipMove).toBe(2.72);
    expect(on.laserVisible).toBe(true);
  });

  it('trades ADS time for a cleaner sight picture, and the scope sway with it', () => {
    const on = resolveWeaponDef(requireWeapon('sniper_kestrel'), ['optic_reflex']);
    expect(on.spread.ads).toBe(0);
    expect(on.adsTime).toBe(0.39899999999999997);
    // The one effect that reaches inside the optional scope record.
    expect(on.scope?.swayDeg).toBe(0.4675);
    expect(requireWeapon('sniper_kestrel').scope?.swayDeg).toBe(0.55);
  });

  it('ignores an attachment the weapon has no slot for', () => {
    // A loadout may outlive the weapon it was authored against, so this is ignored rather
    // than thrown.
    const on = resolveWeaponDef(PISTOL_DEFAULT, ['grip_foregrip']);
    expect(on.recoil.verticalScale).toBe(PISTOL_DEFAULT.recoil.verticalScale);
    expect(JSON.stringify(on)).toBe(JSON.stringify(cloneWeaponDef(PISTOL_DEFAULT)));
  });
});

describe('resolving a full set', () => {
  it('stacks every multiplier rather than letting the last one win', () => {
    const on = resolveWeaponDef(AR_DEFAULT, ATTACHMENT_IDS);
    // The optic and the foregrip both touch `adsTime`: 0.28 x 1.14 x (1/0.92).
    expect(on.adsTime).toBe(0.3469565217391304);
    expect(on.magSize).toBe(45);
    expect(on.reloadTime).toBe(2.5625);
    expect(on.reloadEmptyTime).toBe(3.5625);
    expect(on.damageFalloff.start).toBe(23.400000000000002);
    expect(on.damageFalloff.end).toBe(37.800000000000004);
    expect(on.recoil.verticalScale).toBe(0.75);
    expect(on.spread.hipStand).toBe(1.52);
    expect(on.spread.hipMove).toBe(2.72);
    expect(on.spread.ads).toBe(0.1296);
    expect(on.minimapPing).toBe(false);
    expect(on.laserVisible).toBe(true);
    expect(on.muzzleFlashScale).toBe(0.4);
  });

  it('gives the same def whatever order the set arrives in', () => {
    // The order is the table's, not the caller's — which is what makes two identical loadouts
    // byte-identical defs.
    const forwards = resolveWeaponDef(AR_DEFAULT, ATTACHMENT_IDS);
    const backwards = resolveWeaponDef(AR_DEFAULT, [...ATTACHMENT_IDS].reverse());
    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });

  it('applies perks after the attachments, through the same pipeline', () => {
    // S6.4: perks arrive as plain effects, so a Quickdraw ADS time is computed by this
    // function and no other — which is what makes the loadout editor's number the real one.
    const on = resolveWeaponDef(AR_DEFAULT, ['mag_extended'], [{ adsTimeMult: 0.8 }]);
    expect(on.adsTime).toBe(0.22400000000000003);
    expect(on.magSize).toBe(45);
  });

  it('returns a plain clone when there is nothing to apply', () => {
    const bare = resolveWeaponDef(AR_DEFAULT, []);
    expect(JSON.stringify(bare)).toBe(JSON.stringify(cloneWeaponDef(AR_DEFAULT)));
    expect(bare).not.toBe(AR_DEFAULT);
  });
});

describe('purity', () => {
  it('passes its own five checks on the carbine', () => {
    expect(verifyAttachmentPurity(AR_DEFAULT).map((f) => `${f.check}:${f.ok}`)).toEqual([
      'base unmodified:true',
      'distinct roots:true',
      'distinct nested records:true',
      'no cross-talk:true',
      'effects landed:true',
    ]);
  });

  it('passes them on all twelve weapons', () => {
    expect(ALL_WEAPONS.length).toBe(12);
    const failures: string[] = [];
    for (const def of ALL_WEAPONS) {
      for (const finding of verifyAttachmentPurity(def)) {
        if (!finding.ok) failures.push(`${def.id}: ${finding.check} — ${finding.detail}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('leaves the base untouched after every single attachment, on every weapon', () => {
    // The check `verifyAttachmentPurity` makes, made again from the outside: the base defs are
    // module singletons, and a write through a resolved def would retune the gun process-wide.
    for (const def of ALL_WEAPONS) {
      const before = JSON.stringify(def);
      for (const id of ATTACHMENT_IDS) resolveWeaponDef(def, [id]);
      resolveWeaponDef(def, ATTACHMENT_IDS, [{ adsTimeMult: 0.5, magSizeMult: 2 }]);
      expect(JSON.stringify(def), def.id).toBe(before);
    }
  });
});

describe('measuring one attachment', () => {
  it('reports the cost in the units the benefit is in', () => {
    // +14% of a 0.28 s ADS is 39 ms, which is a quarter of a tick short of three frames and
    // is exactly what criterion 4 asks to be reported.
    expect(measureAttachment(AR_DEFAULT, 'optic_reflex')).toEqual({
      weaponId: 'ar_carbine',
      attachment: 'optic_reflex',
      adsMs: 319.2,
      adsDeltaMs: 39.19999999999996,
      hipSpreadDeg: 1.9,
      hipSpreadDeltaDeg: 0,
      adsSpreadDeg: 0.1296,
      adsSpreadDeltaDeg: -0.0504,
      magSize: 30,
      reloadS: 2.05,
      rangeEndM: 42,
      recoilVertical: 1,
    });
  });

  it('reports a zero delta for an attachment the weapon cannot take', () => {
    const delta = measureAttachment(PISTOL_DEFAULT, 'grip_foregrip');
    expect(delta.adsDeltaMs).toBe(0);
    expect(delta.recoilVertical).toBe(PISTOL_DEFAULT.recoil.verticalScale);
  });
});
