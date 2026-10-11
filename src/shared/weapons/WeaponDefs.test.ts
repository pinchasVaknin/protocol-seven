import { describe, expect, it } from 'vitest';
import { Btn } from '../core/InputCommand';
import { flamethrowerWeapon, minigunWeapon } from '../streaks/StreakWeapons';
import {
  ALL_WEAPONS,
  AR_DEFAULT,
  cloneWeaponDef,
  heldMoveScale,
  MAX_PELLETS,
  PISTOL_DEFAULT,
  requireWeapon,
  shotInterval,
  WEAPON_DEFS,
} from './WeaponDefs';

/**
 * The arsenal's schema and the four functions around it.
 *
 * The *values* in the table are pinned elsewhere and better: `readability.txt` carries the
 * spread figures for all twelve weapons and the scope list, and the oracle compares it
 * byte-for-byte, so a balance change is already a red harness. What is not pinned anywhere is
 * the machinery — and `cloneWeaponDef` is the piece that matters most, because every resolved
 * loadout in the game starts with it and the base defs it copies are module singletons shared
 * by every match in the process.
 *
 * The one deliberate sharing is `recoil.kicks`: a `readonly` array of `readonly` records that
 * nothing writes. Copying thirty objects per resolve to protect data nobody mutates would be a
 * cost with no benefit — but it is a decision, so it is asserted rather than assumed.
 */

describe('the arsenal', () => {
  it('is the twelve weapons, class by class', () => {
    expect(ALL_WEAPONS.length).toBe(12);
    expect(ALL_WEAPONS.map((def) => def.id)).toEqual([
      'ar_carbine',
      'ar_vulcan',
      'ar_halcyon',
      'ar_longbow',
      'smg_wasp',
      'smg_meridian',
      'shotgun_breacher',
      'lmg_bastion',
      'lmg_monolith',
      'sniper_kestrel',
      'sniper_vantage',
      'pistol_talon',
    ]);
    // Order is the order they appear in the debug picker and the range read-out.
    expect(ALL_WEAPONS.map((def) => def.class)).toEqual([
      'AR',
      'AR',
      'AR',
      'AR',
      'SMG',
      'SMG',
      'SHOTGUN',
      'LMG',
      'LMG',
      'SNIPER',
      'SNIPER',
      'PISTOL',
    ]);
  });

  it('is indexed by id, with nothing lost or doubled', () => {
    expect(Object.keys(WEAPON_DEFS).length).toBe(ALL_WEAPONS.length);
    for (const def of ALL_WEAPONS) expect(WEAPON_DEFS[def.id], def.id).toBe(def);
  });

  it('puts exactly one weapon in the secondary slot', () => {
    const secondaries = ALL_WEAPONS.filter((def) => def.slot === 'secondary');
    expect(secondaries.map((def) => def.id)).toEqual(['pistol_talon']);
    // Every loadout carries one, and it is this one.
    expect(PISTOL_DEFAULT.id).toBe('pistol_talon');
    expect(AR_DEFAULT.id).toBe('ar_carbine');
  });

  it('keeps every weapon inside the bounds the schema implies', () => {
    for (const def of ALL_WEAPONS) {
      expect(def.pellets, def.id).toBeGreaterThanOrEqual(1);
      expect(def.pellets, def.id).toBeLessThanOrEqual(MAX_PELLETS);
      expect(def.magSize, def.id).toBeGreaterThan(0);
      expect(def.rpm, def.id).toBeGreaterThan(0);
      // The falloff is an interval, and `damageAtRange` divides by its width.
      expect(def.damageFalloff.end, def.id).toBeGreaterThan(def.damageFalloff.start);
      // Far damage is never above near damage: the falloff only ever takes away.
      expect(def.damage.far, def.id).toBeLessThanOrEqual(def.damage.near);
      expect(def.recoil.kicks.length, def.id).toBeGreaterThan(0);
      expect(def.attachmentSlots.length, def.id).toBeGreaterThan(0);
    }
  });

  it('gives a scope to exactly the two snipers', () => {
    const scoped = ALL_WEAPONS.filter((def) => def.scope !== undefined).map((def) => def.id);
    expect(scoped).toEqual(['sniper_kestrel', 'sniper_vantage']);
  });
});

describe('looking a weapon up', () => {
  it('returns the def for an id in the table', () => {
    expect(requireWeapon('ar_carbine')).toBe(AR_DEFAULT);
  });

  it('throws on an id that is not, rather than handing back undefined', () => {
    // A def is where every balance number comes from, so an unknown id is a programming
    // error and not a case to fall back from.
    expect(() => requireWeapon('ar_nonexistent')).toThrow('Unknown weapon id "ar_nonexistent"');
  });
});

describe('cloning a def', () => {
  it('copies every nested record, so a resolve cannot reach the base', () => {
    const clone = cloneWeaponDef(AR_DEFAULT);
    expect(clone).not.toBe(AR_DEFAULT);
    expect(clone.damage).not.toBe(AR_DEFAULT.damage);
    expect(clone.damageFalloff).not.toBe(AR_DEFAULT.damageFalloff);
    expect(clone.spread).not.toBe(AR_DEFAULT.spread);
    expect(clone.recoil).not.toBe(AR_DEFAULT.recoil);
    expect(clone.voice).not.toBe(AR_DEFAULT.voice);
    expect(clone.attachmentSlots).not.toBe(AR_DEFAULT.attachmentSlots);
    // And it is the same weapon: a copy, not a different gun.
    expect(JSON.stringify(clone)).toBe(JSON.stringify(AR_DEFAULT));
  });

  it('shares the recoil kicks on purpose', () => {
    // A readonly array of readonly records that nothing writes. Thirty object copies per
    // resolve to protect data nobody mutates would be a cost with no benefit.
    const clone = cloneWeaponDef(AR_DEFAULT);
    expect(clone.recoil.kicks).toBe(AR_DEFAULT.recoil.kicks);
  });

  it('copies the scope only when there is one', () => {
    const sniper = requireWeapon('sniper_kestrel');
    const scopedClone = cloneWeaponDef(sniper);
    expect(scopedClone.scope).not.toBe(sniper.scope);
    expect(scopedClone.scope).toEqual(sniper.scope);
    // An unscoped weapon stays unscoped rather than gaining an empty record.
    expect(cloneWeaponDef(AR_DEFAULT).scope).toBeUndefined();
    expect('scope' in cloneWeaponDef(AR_DEFAULT)).toBe(false);
  });

  it('survives a write to every field of the clone', () => {
    const base = requireWeapon('sniper_kestrel');
    const before = JSON.stringify(base);
    const clone = cloneWeaponDef(base);
    clone.damage.near = 1;
    clone.damageFalloff.end = 2;
    clone.spread.ads = 3;
    clone.recoil.verticalScale = 4;
    clone.voice.level = 5;
    clone.magSize = 6;
    if (clone.scope !== undefined) clone.scope.swayDeg = 7;
    clone.attachmentSlots.push('stock');
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('the held weapon speed scale', () => {
  it('is the weapon multiplier, and the firing one only while the trigger is down', () => {
    // It reads `buttons` and not the weapon's firing state: a client replaying a correction has
    // the command but not the weapon, and a speed read off the weapon could not be reproduced.
    expect(heldMoveScale(AR_DEFAULT, 0)).toBe(1);
    expect(heldMoveScale(AR_DEFAULT, Btn.Fire)).toBe(1);

    const minigun = minigunWeapon();
    expect(minigun.moveSpeedMultFiring).toBe(0.4);
    expect(heldMoveScale(minigun, 0)).toBe(0.8);
    expect(heldMoveScale(minigun, Btn.Fire)).toBe(0.4);
    // Another button down is not the trigger.
    expect(heldMoveScale(minigun, Btn.Ads)).toBe(0.8);

    // A weapon that does not ask for it is not slowed by firing.
    const flamer = flamethrowerWeapon();
    expect(flamer.moveSpeedMultFiring).toBeUndefined();
    expect(heldMoveScale(flamer, Btn.Fire)).toBe(flamer.moveSpeedMult);
  });

  it('is a scale every weapon in the arsenal declares', () => {
    for (const def of ALL_WEAPONS) {
      expect(def.moveSpeedMult, def.id).toBeGreaterThan(0);
      expect(def.moveSpeedMult, def.id).toBeLessThanOrEqual(1.3);
    }
  });
});

describe('the shot interval', () => {
  it('is sixty over the rate, which is what the fire timer accumulates', () => {
    expect(shotInterval(AR_DEFAULT)).toBe(0.08571428571428572);
    expect(shotInterval({ ...AR_DEFAULT, rpm: 60 })).toBe(1);
    expect(shotInterval(AR_DEFAULT) * AR_DEFAULT.rpm).toBeCloseTo(60, 12);
  });

  it('guards against a rate of zero rather than returning infinity', () => {
    // The tuning panel's slider floor is 60, but a def read off a save or a streak weapon is
    // not bounded by the panel.
    expect(shotInterval({ ...AR_DEFAULT, rpm: 0 })).toBe(60);
    expect(Number.isFinite(shotInterval({ ...AR_DEFAULT, rpm: 0 }))).toBe(true);
  });
});
