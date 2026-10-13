import { describe, expect, it } from 'vitest';
import {
  ALL_STREAK_IDS,
  DEFAULT_STREAK_CONFIG,
  isStreakId,
  STREAK_COOLDOWN_SECONDS,
  STREAK_DEFS,
  streakDef,
  type StreakId,
} from './StreakDefs';

/**
 * The table every other file in `streaks/` reads (A17).
 *
 * `StreakDefs` is data plus two lookups, and the lookups are what the save repair and nine other
 * call sites go through. These pin them, and they pin the table's own invariants — the ones that
 * are true today and that a tenth streak could break silently, because nothing else checks them.
 *
 * The last block is the one with work behind it: A17 moves "does this streak end with its owner's
 * life" out of two `instanceof` checks in `StreakSystem.onDeath` and onto a field here, so the
 * field is held against the classes it replaced. Written before the field existed, which is why
 * the expected set is spelled out rather than derived.
 */

describe('looking a streak up', () => {
  it('finds every shipped id', () => {
    for (const def of STREAK_DEFS) expect(streakDef(def.id).id).toBe(def.id);
  });

  it('returns the table’s own object rather than a copy', () => {
    // Nine streaks share one def each, and `Killstreak.def` holds it by reference.
    expect(streakDef('uav')).toBe(STREAK_DEFS.find((d) => d.id === 'uav'));
  });

  it('throws on an id that is not a streak', () => {
    expect(() => streakDef('nope' as StreakId)).toThrow('Unknown streak "nope"');
  });

  it('tells a streak id from any other string, for the save repair', () => {
    expect(isStreakId('sentry')).toBe(true);
    expect(isStreakId('chopper')).toBe(true);
    expect(isStreakId('')).toBe(false);
    expect(isStreakId('SENTRY')).toBe(false);
    expect(isStreakId('mortar_strike')).toBe(false);
  });
});

describe('the table’s shape', () => {
  it('lists every id exactly once', () => {
    const ids = STREAK_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is what ALL_STREAK_IDS is, in def order', () => {
    expect(ALL_STREAK_IDS).toEqual(STREAK_DEFS.map((d) => d.id));
  });

  it('prices every streak at a kill or more', () => {
    for (const def of STREAK_DEFS) expect(def.requirement).toBeGreaterThan(0);
  });

  it('gives every streak a name and a blurb for the HUD strip', () => {
    for (const def of STREAK_DEFS) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.blurb.length).toBeGreaterThan(0);
    }
  });

  it('never lets a care package contain another care package', () => {
    expect(streakDef('care_package').fromCarePackage).toBe(false);
    const eligible = STREAK_DEFS.filter((d) => d.fromCarePackage).map((d) => d.id);
    expect(eligible).not.toContain('care_package');
    // And something has to be in it, or the roll has nothing to return.
    expect(eligible.length).toBeGreaterThan(0);
  });

  it('ends the effect at the press only for the two that are dispatched by it', () => {
    const atActivation = STREAK_DEFS.filter((d) => d.effectEnds === 'activation').map((d) => d.id);
    // A crate belongs to the world the instant it leaves the plane and a barrage is already on
    // its way; every other streak keeps working for its owner while it is up.
    expect(atActivation).toEqual(['care_package', 'mortar']);
  });

  it('gives every streak a duration, so the concurrency guard is a guard and not a case', () => {
    for (const def of STREAK_DEFS) expect(def.durationSeconds).toBeGreaterThan(0);
  });

  it('holds the cooldown as one number for all of them', () => {
    expect(STREAK_COOLDOWN_SECONDS).toBe(30);
  });
});

describe('which streaks end with their owner’s life', () => {
  /**
   * The classes the rule used to be written in.
   *
   * `StreakSystem.onDeath` retired `ChopperGunner` and `CarriedWeaponStreak` and left everything
   * else standing. `ChopperGunner` is built for `'chopper'` alone and `CarriedWeaponStreak` for
   * the three carried weapons — see `StreakSystem.build` — so this is that rule, spelled out.
   */
  const ENDS_WITH_THE_OWNER: readonly StreakId[] = ['chopper', 'minigun', 'flamethrower', 'shield'];

  it('is the four the two retired classes covered, and no others', () => {
    const flagged = STREAK_DEFS.filter((d) => d.endsWithOwnersLife).map((d) => d.id);
    expect(flagged).toEqual(STREAK_DEFS.filter((d) => ENDS_WITH_THE_OWNER.includes(d.id)).map((d) => d.id));
    expect(new Set(flagged)).toEqual(new Set(ENDS_WITH_THE_OWNER));
  });

  it('leaves everything that is placed in the world rather than held', () => {
    for (const id of ['uav', 'counter_uav', 'care_package', 'mortar', 'sentry'] as StreakId[]) {
      expect(streakDef(id).endsWithOwnersLife).toBe(false);
    }
  });

  it('is answered by every streak in the table', () => {
    for (const def of STREAK_DEFS) expect(typeof def.endsWithOwnersLife).toBe('boolean');
  });
});

describe('the tuning', () => {
  it('is positive wherever a zero would stop the mechanic working', () => {
    const cfg = DEFAULT_STREAK_CONFIG;
    for (const value of [
      cfg.uavSweepSeconds,
      cfg.uavContactFadeSeconds,
      cfg.packageCaptureSeconds,
      cfg.packageRadius,
      cfg.packageDropHeight,
      cfg.packageDropSpeed,
      cfg.mortarShells,
      cfg.mortarInterval,
      cfg.mortarScatter,
      cfg.mortarDamage,
      cfg.mortarRadius,
      cfg.sentryHealth,
      cfg.sentryRange,
      cfg.sentryTurnRateDeg,
      cfg.sentryArcDeg,
      cfg.sentryRpm,
      cfg.sentryDamage,
      cfg.sentryDismantleSeconds,
      cfg.sentryDismantleRange,
      cfg.chopperOrbitRadius,
      cfg.chopperRpm,
      cfg.chopperMagSize,
      cfg.chopperReloadSeconds,
      cfg.chopperSpinUpSeconds,
    ]) {
      expect(value).toBeGreaterThan(0);
    }
  });

  it('watches an arc rather than a sphere', () => {
    // A half-angle, so anything at or over 180 would make the sentry omniscient.
    expect(DEFAULT_STREAK_CONFIG.sentryArcDeg).toBeLessThan(180);
  });
});
