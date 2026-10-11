import { describe, expect, it } from 'vitest';
import { ALL_WEAPONS, AR_DEFAULT, cloneWeaponDef, PISTOL_DEFAULT, requireWeapon } from './WeaponDefs';
import {
  readWeaponNumber,
  WEAPON_NUMBER_KEYS,
  WEAPON_TUNABLES,
  weaponDefToSource,
  writeWeaponNumber,
  type WeaponNumberKey,
} from './WeaponTuning';

/**
 * The live tuning surface, and the property it exists to have.
 *
 * This file's whole claim is that the panel **cannot drift out of date with the weapon**: the
 * key union is derived from the schema, so a numeric field added to `WeaponDef` with no slider
 * is a type error at `WEAPON_TUNABLES`, and a key no accessor handles is a type error at the
 * accessors. The compiler enforces the first half. The second half is what the round trip
 * below enforces at runtime, key by key, by name — a key the accessors miss fails here saying
 * which one it was.
 *
 * It is worth having as a test and not only as a type because the failure mode is silent: a
 * slider that reads 0 and writes nowhere looks like a slider with nothing behind it, and the
 * panel is how every balance number in the game was chosen.
 */

/** A value no weapon field is, distinct per key, so a key that did not travel is visible. */
function probeValue(index: number): number {
  return index * 0.25 + 0.125;
}

const SCOPE_KEYS = WEAPON_NUMBER_KEYS.filter((key) => key.startsWith('scope.'));
const PLAIN_KEYS = WEAPON_NUMBER_KEYS.filter((key) => !key.startsWith('scope.'));

describe('the tunable key set', () => {
  it('is the sixty-three numbers the panel offers', () => {
    expect(WEAPON_NUMBER_KEYS.length).toBe(63);
    // The keys and the slider table are the same set, in the same order: the array is derived
    // from the table by `Object.keys`, and the panel walks the array.
    expect(WEAPON_NUMBER_KEYS).toEqual(Object.keys(WEAPON_TUNABLES));
    expect(SCOPE_KEYS.length).toBe(6);
  });

  it('groups them the way the panel lays them out', () => {
    const groups: string[] = [];
    for (const key of WEAPON_NUMBER_KEYS) {
      const group = WEAPON_TUNABLES[key].group;
      if (groups[groups.length - 1] !== group) groups.push(group);
    }
    // Each group is contiguous, so `weaponDefToSource` emits one header per group rather than
    // one per run of keys.
    expect(groups).toEqual(['Damage', 'Handling', 'Spread', 'Recoil', 'Optics', 'Voice', 'Scope']);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('gives every key a usable slider', () => {
    for (const key of WEAPON_NUMBER_KEYS) {
      const meta = WEAPON_TUNABLES[key];
      expect(meta.label.length, key).toBeGreaterThan(0);
      expect(meta.min, key).toBeLessThan(meta.max);
      expect(meta.step, key).toBeGreaterThan(0);
      expect(meta.step, key).toBeLessThanOrEqual(meta.max - meta.min);
    }
  });

  /**
   * Pins current behaviour; suspected bug: two of the Kestrel's shipped numbers sit outside
   * the slider that is supposed to tune them. `rpm` is 48 against a minimum of 60, and
   * `adsFovScale` is 0.34 against a minimum of 0.4 — so touching either slider in the F1 panel
   * snaps the weapon to a value it does not ship with, and the panel cannot restore what it
   * replaced. A bolt-action at 48 RPM and a 4.5x scope at 0.34 are both deliberate; it is the
   * two slider floors that were never widened for them.
   */
  it('puts every shipped value inside its own slider range, bar the two that do not', () => {
    // A default outside its slider is a number the panel cannot show, let alone restore.
    const outside: string[] = [];
    for (const def of ALL_WEAPONS) {
      for (const key of WEAPON_NUMBER_KEYS) {
        if (def.scope === undefined && key.startsWith('scope.')) continue;
        const meta = WEAPON_TUNABLES[key];
        const value = readWeaponNumber(def, key);
        if (value < meta.min || value > meta.max) outside.push(`${def.id} ${key}=${value}`);
      }
    }
    expect(outside).toEqual(['sniper_kestrel rpm=48', 'sniper_kestrel adsFovScale=0.34']);
  });
});

describe('reading and writing every key', () => {
  it('round-trips all sixty-three on a scoped weapon', () => {
    // The whole contract in one assertion: write a distinct value through every key, read it
    // back through the same key, and name any that did not survive.
    const def = cloneWeaponDef(requireWeapon('sniper_kestrel'));
    const lost: string[] = [];
    WEAPON_NUMBER_KEYS.forEach((key, index) => {
      const want = probeValue(index + 1);
      writeWeaponNumber(def, key, want);
      if (readWeaponNumber(def, key) !== want) lost.push(key);
    });
    expect(lost).toEqual([]);
  });

  it('round-trips every non-scope key on a weapon with no scope', () => {
    const def = cloneWeaponDef(AR_DEFAULT);
    const lost: string[] = [];
    PLAIN_KEYS.forEach((key, index) => {
      const want = probeValue(index + 1);
      writeWeaponNumber(def, key, want);
      if (readWeaponNumber(def, key) !== want) lost.push(key);
    });
    expect(lost).toEqual([]);
  });

  it('writes one key without disturbing any other', () => {
    const def = cloneWeaponDef(AR_DEFAULT);
    const before = new Map<WeaponNumberKey, number>();
    for (const key of PLAIN_KEYS) before.set(key, readWeaponNumber(def, key));

    writeWeaponNumber(def, 'rpm', 123.5);
    const moved = PLAIN_KEYS.filter((key) => readWeaponNumber(def, key) !== before.get(key));
    // Exactly one slider moved. Two keys sharing an accessor would show up here.
    expect(moved).toEqual(['rpm']);
  });

  it('gives every key its own field, so no two keys are the same number', () => {
    const def = cloneWeaponDef(requireWeapon('sniper_kestrel'));
    // Stamp them all, then check that reading them back gives 63 distinct values: two keys
    // pointing at one field would collide.
    WEAPON_NUMBER_KEYS.forEach((key, index) => writeWeaponNumber(def, key, probeValue(index + 1)));
    const values = WEAPON_NUMBER_KEYS.map((key) => readWeaponNumber(def, key));
    expect(new Set(values).size).toBe(WEAPON_NUMBER_KEYS.length);
  });
});

describe('a weapon with no scope', () => {
  it('reads zero from the scope sliders, and one for magnification', () => {
    // `WeaponDebug` hides the whole group when `def.scope` is undefined rather than showing
    // sliders that do nothing, so these are the values behind a group nobody sees.
    expect(SCOPE_KEYS.map((key) => readWeaponNumber(AR_DEFAULT, key))).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('swallows a write to them rather than inventing a scope', () => {
    const def = cloneWeaponDef(AR_DEFAULT);
    for (const key of SCOPE_KEYS) writeWeaponNumber(def, key, 7.5);
    // No scope was created, and nothing else moved either.
    expect(def.scope).toBeUndefined();
    expect(SCOPE_KEYS.map((key) => readWeaponNumber(def, key))).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('reads the real numbers on a weapon that has one', () => {
    expect(SCOPE_KEYS.map((key) => readWeaponNumber(requireWeapon('sniper_kestrel'), key))).toEqual([
      0.55, 0.42, 3.2, 4.5, 0.08, 4.5,
    ]);
  });
});

describe('serialising a tuned weapon back to source', () => {
  it('emits the carbine exactly as it is pasted back', () => {
    expect(weaponDefToSource(AR_DEFAULT)).toBe(
      [
        '// M4 CARBINE (ar_carbine) — tuned values',
        'const tuned = {',
        '  // -- damage --',
        "  'damage.near': 34,",
        "  'damage.far': 25,",
        "  'falloff.start': 26,",
        "  'falloff.end': 42,",
        "  'headshotMult': 1.5,",
        "  'limbMult': 0.9,",
        "  'upperTorsoMult': 1,",
        "  'penetration': 0.28,",
        "  'pellets': 1,",
        "  'pelletSpread': 0,",
        '',
        '  // -- handling --',
        "  'rpm': 700,",
        "  'magSize': 30,",
        "  'reserveAmmo': 240,",
        "  'reloadTime': 2.05,",
        "  'reloadEmptyTime': 2.85,",
        "  'adsTime': 0.28,",
        "  'sprintOutTime': 0.22,",
        "  'moveSpeedMult': 1,",
        "  'swapInTime': 0.52,",
        "  'swapOutTime': 0.4,",
        '',
        '  // -- spread --',
        "  'spread.hipStand': 1.9,",
        "  'spread.hipMove': 3.4,",
        "  'spread.ads': 0.18,",
        "  'spread.crouchScale': 0.74,",
        "  'spread.airScale': 2.1,",
        "  'spread.perShot': 0.085,",
        "  'spread.perShotMax': 1.4,",
        "  'spread.recover': 3.6,",
        '',
        '  // -- recoil --',
        "  'recoil.verticalScale': 1,",
        "  'recoil.horizontalScale': 1,",
        "  'recoil.firstShotScale': 1.15,",
        "  'recoil.recoverFraction': 0.82,",
        "  'recoil.recoverRate': 9.5,",
        "  'recoil.recoverDelay': 0.12,",
        "  'recoil.adsScale': 0.78,",
        "  'recoil.visualScale': 1,",
        "  'recoil.visualAttack': 0.028,",
        "  'recoil.visualSettle': 0.13,",
        '',
        '  // -- optics --',
        "  'adsFovScale': 0.76,",
        "  'adsViewmodelFovScale': 0.82,",
        "  'tracerFraction': 0.34,",
        "  'shakePerShot': 0.055,",
        "  'muzzleFlashScale': 1,",
        "  'unlockLevel': 1,",
        '',
        '  // -- voice --',
        "  'voice.level': 0.62,",
        "  'voice.bodyFreq': 1150,",
        "  'voice.bodyQ': 0.85,",
        "  'voice.bodyDecay': 0.085,",
        "  'voice.bodyRatio': 0.32,",
        "  'voice.tailDecay': 0.32,",
        "  'voice.tailLevel': 0.2,",
        "  'voice.tailFreq': 2600,",
        "  'voice.clickFreq': 5200,",
        "  'voice.clickLevel': 0.4,",
        "  'voice.thumpFreq': 88,",
        "  'voice.thumpLevel': 0.5,",
        "  'voice.wet': 0.3,",
        '};',
      ].join('\n'),
    );
  });

  it('leaves the scope group out of a weapon that has none', () => {
    // A pistol has no scope numbers to paste back.
    const pistol = weaponDefToSource(PISTOL_DEFAULT);
    expect(pistol).not.toContain('scope.');
    expect(pistol).not.toContain('-- scope --');
    expect(pistol.split('\n').length).toBe(71);

    const sniper = weaponDefToSource(requireWeapon('sniper_kestrel'));
    expect(sniper).toContain('  // -- scope --');
    expect(sniper).toContain("  'scope.magnification': 4.5,");
    // Eight more lines: the blank, the header and the six sliders.
    expect(sniper.split('\n').length).toBe(79);
  });

  it('rounds to four places, so a dragged slider does not paste a float artefact', () => {
    const def = cloneWeaponDef(AR_DEFAULT);
    writeWeaponNumber(def, 'adsTime', 0.1 + 0.2);
    expect(weaponDefToSource(def)).toContain("  'adsTime': 0.3,");
    writeWeaponNumber(def, 'adsTime', 1 / 3);
    expect(weaponDefToSource(def)).toContain("  'adsTime': 0.3333,");
  });

  it('round-trips through the source it emits', () => {
    // The panel's reset button is `write(def, key, read(AR_DEFAULT, key))` for every key, and
    // this is the same path: what comes out of a def goes back into a def unchanged.
    const def = cloneWeaponDef(requireWeapon('smg_wasp'));
    for (const key of WEAPON_NUMBER_KEYS) writeWeaponNumber(def, key, readWeaponNumber(AR_DEFAULT, key));
    expect(weaponDefToSource(def)).toBe(
      weaponDefToSource(AR_DEFAULT).replace('// M4 CARBINE (ar_carbine)', '// WASP 9 (smg_wasp)'),
    );
  });
});
