import { describe, expect, it } from 'vitest';
import { modelSpecFor, type WeaponModelSpec } from './WeaponModelSpecs';
import { WEAPON_ASSET_IDS } from './WeaponAssetCatalog';

/**
 * The numbers the procedural viewmodel, the killfeed glyph and the ADS pose are all built from.
 *
 * `check:optics` reads this file as *text* and compares the modelled optic against the
 * simulation's; nothing until now read it as a module. So the whole table is pinned field for
 * field below: every silhouette difference a player can see is one of these numbers, and a
 * refactor that moves one moves a weapon on the screen.
 */

const FIELDS: ReadonlyArray<keyof WeaponModelSpec> = [
  'receiverLength',
  'receiverHeight',
  'receiverWidth',
  'handguardLength',
  'handguardHeight',
  'barrelLength',
  'barrelRadius',
  'muzzleRadius',
  'muzzleLength',
  'stock',
  'stockLength',
  'magazine',
  'magazineLength',
  'optic',
  'opticLength',
  'sightHeight',
  'bipod',
  'pump',
  'scale',
  'adsOffsetZ',
];

/** One weapon as a single line, so the table below reads as a table. */
function row(id: string): string {
  const spec = modelSpecFor(id);
  return `${id}: ${FIELDS.map((f) => `${f}=${String(spec[f])}`).join(' ')}`;
}

describe('the spec table', () => {
  it('is what it is, weapon by weapon and field by field', () => {
    const ids = [...WEAPON_ASSET_IDS];
    expect(ids.map(row).join('\n')).toMatchInlineSnapshot(`
      "ar_carbine: receiverLength=0.3 receiverHeight=0.082 receiverWidth=0.058 handguardLength=0.25 handguardHeight=0.062 barrelLength=0.2 barrelRadius=0.0105 muzzleRadius=0.017 muzzleLength=0.052 stock=full stockLength=0.16 magazine=curved magazineLength=0.155 optic=irons opticLength=0 sightHeight=0.0915 bipod=false pump=false scale=1 adsOffsetZ=0
      ar_vulcan: receiverLength=0.33 receiverHeight=0.09 receiverWidth=0.058 handguardLength=0.2 handguardHeight=0.062 barrelLength=0.24 barrelRadius=0.0122 muzzleRadius=0.021 muzzleLength=0.052 stock=full stockLength=0.185 magazine=curved magazineLength=0.185 optic=irons opticLength=0 sightHeight=0.0915 bipod=false pump=false scale=1 adsOffsetZ=0
      ar_halcyon: receiverLength=0.36 receiverHeight=0.086 receiverWidth=0.062 handguardLength=0.16 handguardHeight=0.062 barrelLength=0.14 barrelRadius=0.0105 muzzleRadius=0.017 muzzleLength=0.052 stock=none stockLength=0 magazine=box magazineLength=0.12 optic=reddot opticLength=0 sightHeight=0.098 bipod=false pump=false scale=1 adsOffsetZ=0
      ar_longbow: receiverLength=0.34 receiverHeight=0.082 receiverWidth=0.058 handguardLength=0.3 handguardHeight=0.062 barrelLength=0.3 barrelRadius=0.0115 muzzleRadius=0.019 muzzleLength=0.052 stock=skeleton stockLength=0.2 magazine=curved magazineLength=0.13 optic=reddot opticLength=0 sightHeight=0.106 bipod=false pump=false scale=1 adsOffsetZ=0
      smg_wasp: receiverLength=0.22 receiverHeight=0.07 receiverWidth=0.05 handguardLength=0.14 handguardHeight=0.05 barrelLength=0.08 barrelRadius=0.008 muzzleRadius=0.013 muzzleLength=0.035 stock=folding stockLength=0.11 magazine=curved magazineLength=0.14 optic=reddot opticLength=0 sightHeight=0.085 bipod=false pump=false scale=0.94 adsOffsetZ=0
      smg_meridian: receiverLength=0.26 receiverHeight=0.074 receiverWidth=0.052 handguardLength=0.17 handguardHeight=0.054 barrelLength=0.1 barrelRadius=0.0085 muzzleRadius=0.014 muzzleLength=0.052 stock=skeleton stockLength=0.14 magazine=curved magazineLength=0.18 optic=reddot opticLength=0 sightHeight=0.088 bipod=false pump=false scale=0.97 adsOffsetZ=0
      shotgun_breacher: receiverLength=0.26 receiverHeight=0.088 receiverWidth=0.062 handguardLength=0.24 handguardHeight=0.055 barrelLength=0.26 barrelRadius=0.019 muzzleRadius=0.023 muzzleLength=0.03 stock=full stockLength=0.18 magazine=tube magazineLength=0.36 optic=irons opticLength=0 sightHeight=0.094 bipod=false pump=true scale=1 adsOffsetZ=0
      lmg_bastion: receiverLength=0.4 receiverHeight=0.1 receiverWidth=0.072 handguardLength=0.22 handguardHeight=0.07 barrelLength=0.34 barrelRadius=0.015 muzzleRadius=0.024 muzzleLength=0.06 stock=full stockLength=0.2 magazine=drum magazineLength=0.2 optic=irons opticLength=0 sightHeight=0.108 bipod=true pump=false scale=1.06 adsOffsetZ=0
      lmg_monolith: receiverLength=0.44 receiverHeight=0.104 receiverWidth=0.078 handguardLength=0.26 handguardHeight=0.072 barrelLength=0.3 barrelRadius=0.014 muzzleRadius=0.022 muzzleLength=0.055 stock=full stockLength=0.21 magazine=drum magazineLength=0.23 optic=reddot opticLength=0 sightHeight=0.112 bipod=true pump=false scale=1.08 adsOffsetZ=0
      sniper_kestrel: receiverLength=0.36 receiverHeight=0.086 receiverWidth=0.056 handguardLength=0.3 handguardHeight=0.056 barrelLength=0.42 barrelRadius=0.013 muzzleRadius=0.024 muzzleLength=0.07 stock=skeleton stockLength=0.24 magazine=box magazineLength=0.09 optic=scope opticLength=0.28 sightHeight=0.118 bipod=true pump=false scale=1.04 adsOffsetZ=0
      sniper_vantage: receiverLength=0.38 receiverHeight=0.09 receiverWidth=0.06 handguardLength=0.26 handguardHeight=0.06 barrelLength=0.34 barrelRadius=0.0125 muzzleRadius=0.022 muzzleLength=0.06 stock=full stockLength=0.2 magazine=curved magazineLength=0.15 optic=scope opticLength=0.23 sightHeight=0.114 bipod=false pump=false scale=1.02 adsOffsetZ=0
      pistol_talon: receiverLength=0.17 receiverHeight=0.062 receiverWidth=0.03 handguardLength=0 handguardHeight=0 barrelLength=0.03 barrelRadius=0.008 muzzleRadius=0.009 muzzleLength=0.012 stock=none stockLength=0 magazine=grip magazineLength=0.1 optic=irons opticLength=0 sightHeight=0.062 bipod=false pump=false scale=1 adsOffsetZ=-0.13
      streak_minigun: receiverLength=0.3 receiverHeight=0.082 receiverWidth=0.058 handguardLength=0.25 handguardHeight=0.062 barrelLength=0.2 barrelRadius=0.0105 muzzleRadius=0.017 muzzleLength=0.052 stock=full stockLength=0.16 magazine=curved magazineLength=0.155 optic=irons opticLength=0 sightHeight=0.0915 bipod=false pump=false scale=1 adsOffsetZ=0
      streak_flamethrower: receiverLength=0.3 receiverHeight=0.082 receiverWidth=0.058 handguardLength=0.25 handguardHeight=0.062 barrelLength=0.2 barrelRadius=0.0105 muzzleRadius=0.017 muzzleLength=0.052 stock=full stockLength=0.16 magazine=curved magazineLength=0.155 optic=irons opticLength=0 sightHeight=0.0915 bipod=false pump=false scale=1 adsOffsetZ=0
      streak_shield: receiverLength=0.17 receiverHeight=0.062 receiverWidth=0.03 handguardLength=0 handguardHeight=0 barrelLength=0.03 barrelRadius=0.008 muzzleRadius=0.009 muzzleLength=0.012 stock=none stockLength=0 magazine=grip magazineLength=0.1 optic=irons opticLength=0 sightHeight=0.062 bipod=false pump=false scale=1 adsOffsetZ=-0.13"
    `);
  });

  it('answers for every id in the asset catalogue', () => {
    for (const id of WEAPON_ASSET_IDS) expect(modelSpecFor(id)).toBeDefined();
  });

  it('falls back to the carbine for a weapon with no entry, rather than throwing', () => {
    const carbine = modelSpecFor('ar_carbine');
    expect(modelSpecFor('unknown_weapon')).toBe(carbine);
    expect(modelSpecFor('')).toBe(carbine);
    // The minigun and the flamethrower have no entry on purpose: the comment on the shield's
    // entry says so, and this is the line that would notice one being added.
    expect(modelSpecFor('streak_minigun')).toBe(carbine);
    expect(modelSpecFor('streak_flamethrower')).toBe(carbine);
  });

  it('gives the shield-pistol an entry of its own, because it genuinely is a pistol', () => {
    const shield = modelSpecFor('streak_shield');
    expect(shield).not.toBe(modelSpecFor('ar_carbine'));
    expect(shield.magazine).toBe('grip');
    expect(shield.adsOffsetZ).toBe(-0.13);
  });
});

describe('the invariants the rest of the client reads these numbers under', () => {
  it('puts every sight line above the origin, which is what ADS cancels', () => {
    for (const id of WEAPON_ASSET_IDS) expect(modelSpecFor(id).sightHeight).toBeGreaterThan(0);
  });

  it('gives a scope a tube length and irons none', () => {
    for (const id of WEAPON_ASSET_IDS) {
      const spec = modelSpecFor(id);
      if (spec.optic === 'scope') expect(spec.opticLength).toBeGreaterThan(0);
      if (spec.optic === 'irons') expect(spec.opticLength).toBe(0);
    }
  });

  it('corrects the ADS pose along Z only, and only where it has to', () => {
    const corrected = [...WEAPON_ASSET_IDS].filter((id) => modelSpecFor(id).adsOffsetZ !== 0);
    expect(corrected).toEqual(['pistol_talon', 'streak_shield']);
    for (const id of corrected) expect(modelSpecFor(id).adsOffsetZ).toBeLessThan(0);
  });

  it('scopes exactly the two snipers, which is the half check:optics reads as text', () => {
    const scoped = [...WEAPON_ASSET_IDS].filter((id) => modelSpecFor(id).optic === 'scope');
    expect(scoped).toEqual(['sniper_kestrel', 'sniper_vantage']);
  });

  it('bipods the two LMGs and the bolt sniper, and pumps the shotgun alone', () => {
    const bipods = [...WEAPON_ASSET_IDS].filter((id) => modelSpecFor(id).bipod);
    const pumps = [...WEAPON_ASSET_IDS].filter((id) => modelSpecFor(id).pump);
    expect(bipods).toEqual(['lmg_bastion', 'lmg_monolith', 'sniper_kestrel']);
    expect(pumps).toEqual(['shotgun_breacher']);
  });

  // `WeaponModelSpec.scale`'s own doc says the pistol is the only weapon that is genuinely a
  // different size. It is not: the pistol is at 1 and six others are not, the SMGs under it and
  // the heavy weapons over it. Pinned as it is; see BACKLOG #62.
  it('scales the two SMGs down and the four heavy weapons up, and leaves the pistol at one', () => {
    const scaled = [...WEAPON_ASSET_IDS].map((id) => [id, modelSpecFor(id).scale] as const).filter(([, s]) => s !== 1);
    expect(scaled).toEqual([
      ['smg_wasp', 0.94],
      ['smg_meridian', 0.97],
      ['lmg_bastion', 1.06],
      ['lmg_monolith', 1.08],
      ['sniper_kestrel', 1.04],
      ['sniper_vantage', 1.02],
    ]);
    expect(modelSpecFor('pistol_talon').scale).toBe(1);
  });

  it('gives every weapon a receiver, a barrel and a magazine with a positive size', () => {
    for (const id of WEAPON_ASSET_IDS) {
      const spec = modelSpecFor(id);
      expect(spec.receiverLength).toBeGreaterThan(0);
      expect(spec.receiverHeight).toBeGreaterThan(0);
      expect(spec.receiverWidth).toBeGreaterThan(0);
      expect(spec.barrelRadius).toBeGreaterThan(0);
      expect(spec.magazineLength).toBeGreaterThan(0);
    }
  });

  it('leaves a stockless weapon with no stock length, and the reverse', () => {
    for (const id of WEAPON_ASSET_IDS) {
      const spec = modelSpecFor(id);
      if (spec.stock === 'none') expect(spec.stockLength).toBe(0);
      else expect(spec.stockLength).toBeGreaterThan(0);
    }
  });
});
