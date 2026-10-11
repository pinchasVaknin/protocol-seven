import { describe, expect, it } from 'vitest';
import { ALL_WEAPONS, type WeaponClass } from '../weapons/WeaponDefs';
import { weaponProfileFor } from './WeaponProfile';

/**
 * How a bot fights with the weapon it happens to be holding, pinned.
 *
 * The design claim is that these multipliers **bend the tier's numbers rather than replacing
 * them**: the tier still decides how good a bot is, the weapon decides where it wants to be
 * standing. So what is held still is the shape of the table — every class covered, every
 * multiplier positive, and the ordering that makes a shotgun a shotgun.
 *
 * The shotgun's 0.3 `engageScale` is named in the file as the load-bearing number: at Veteran
 * it cuts a 46 m engage range to 14, which is the difference between a shotgun bot and a bot
 * with a shotgun. It gets its own assertion.
 */

const CLASSES: readonly WeaponClass[] = [
  'SHOTGUN',
  'SMG',
  'PISTOL',
  'AR',
  'LMG',
  'MARKSMAN',
  'SNIPER',
  'LAUNCHER',
];

describe('the profile table', () => {
  it('covers every class a weapon can declare', () => {
    for (const def of ALL_WEAPONS) {
      expect(weaponProfileFor(def.class)).toBeDefined();
    }
    for (const cls of CLASSES) {
      expect(weaponProfileFor(cls)).toBeDefined();
    }
  });

  it('keeps every multiplier positive, so no weapon switches a bot off', () => {
    for (const cls of CLASSES) {
      const p = weaponProfileFor(cls);
      expect(p.pushScale).toBeGreaterThan(0);
      expect(p.engageScale).toBeGreaterThan(0);
      expect(p.adsScale).toBeGreaterThan(0);
      expect(p.preferredRange).toBeGreaterThan(0);
      expect(p.minComfortRange).toBeGreaterThanOrEqual(0);
    }
  });

  it('never prefers a range inside its own discomfort', () => {
    for (const cls of CLASSES) {
      const p = weaponProfileFor(cls);
      expect(p.preferredRange).toBeGreaterThan(p.minComfortRange);
    }
  });

  it('hands a launcher the rifle profile, because nothing deals one', () => {
    expect(weaponProfileFor('LAUNCHER')).toEqual(weaponProfileFor('AR'));
  });
});

describe('where each weapon wants to be standing', () => {
  it('orders the classes from the doorway to the ridge', () => {
    const ranges = CLASSES.filter((c) => c !== 'LAUNCHER').map(
      (c) => weaponProfileFor(c).preferredRange,
    );
    expect(ranges).toEqual([6, 11, 9, 21, 23, 30, 36]);
    expect(weaponProfileFor('SHOTGUN').preferredRange).toBeLessThan(
      weaponProfileFor('AR').preferredRange,
    );
    expect(weaponProfileFor('SNIPER').preferredRange).toBeGreaterThan(
      weaponProfileFor('AR').preferredRange,
    );
  });

  it('pushes hard with a shotgun and holds back with a sniper', () => {
    expect(weaponProfileFor('SHOTGUN').pushScale).toBeGreaterThan(1);
    expect(weaponProfileFor('SMG').pushScale).toBeGreaterThan(1);
    expect(weaponProfileFor('AR').pushScale).toBe(1);
    expect(weaponProfileFor('LMG').pushScale).toBeLessThan(1);
    expect(weaponProfileFor('SNIPER').pushScale).toBeLessThan(
      weaponProfileFor('MARKSMAN').pushScale,
    );
  });

  it('cuts the shotgun engage range to a third, which is the load-bearing number', () => {
    expect(weaponProfileFor('SHOTGUN').engageScale).toBe(0.3);
    // At Veteran's 46 m that is 13.8 — a doorway, not a lane.
    expect(46 * weaponProfileFor('SHOTGUN').engageScale).toBeLessThan(15);
  });

  it('aims early with a sniper and barely at all with a shotgun', () => {
    expect(weaponProfileFor('SNIPER').adsScale).toBeLessThan(0.3);
    expect(weaponProfileFor('MARKSMAN').adsScale).toBeLessThan(1);
    expect(weaponProfileFor('AR').adsScale).toBe(1);
    expect(weaponProfileFor('SHOTGUN').adsScale).toBeGreaterThan(2);
  });

  it('leaves the rifle as the baseline every tier number was measured against', () => {
    expect(weaponProfileFor('AR')).toEqual({
      preferredRange: 21,
      minComfortRange: 4,
      pushScale: 1,
      engageScale: 1,
      adsScale: 1,
    });
  });

  it('gives only the precision weapons a distance they refuse to fight inside', () => {
    expect(weaponProfileFor('SHOTGUN').minComfortRange).toBe(0);
    expect(weaponProfileFor('SMG').minComfortRange).toBe(0);
    expect(weaponProfileFor('PISTOL').minComfortRange).toBe(0);
    expect(weaponProfileFor('SNIPER').minComfortRange).toBeGreaterThan(
      weaponProfileFor('MARKSMAN').minComfortRange,
    );
  });
});
