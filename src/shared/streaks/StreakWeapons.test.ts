import { describe, expect, it } from 'vitest';
import { damageAtRange } from '../combat/DamageSystem';
import { DEFAULT_HEALTH_CONFIG } from '../player/Health';
import { flamethrowerWeapon, minigunWeapon } from './StreakWeapons';

/**
 * The carried streaks' lethality, held to the health pool rather than to a number (2026-09-28).
 *
 * The first buff to both was described in hits against 100 HP when every body had had 200 for five
 * days, and nothing noticed: a damage figure on its own is true in any wrong version. These tie the
 * figures to `DEFAULT_HEALTH_CONFIG`, so a change to either side of the division says what it did.
 */

const POOL = DEFAULT_HEALTH_CONFIG.max;

function hitsToKill(damage: number): number {
  return Math.ceil(POOL / damage);
}

describe('the minigun', () => {
  it('kills in four to the body up close and six at range', () => {
    const def = minigunWeapon();
    expect(hitsToKill(damageAtRange(def, 0))).toBe(4);
    expect(hitsToKill(damageAtRange(def, 60))).toBe(6);
  });
});

describe('the flamethrower', () => {
  /** Seconds of a body held in the root of the jet until it is dead, with the burn ticking alongside. */
  function contactKillSeconds(): number {
    const def = flamethrowerWeapon();
    const perTick = damageAtRange(def, 0);
    const interval = 60 / def.rpm;
    const burnDps = def.flame?.burnDps ?? 0;
    for (let tick = 1; tick < 100; tick++) {
      const seconds = (tick - 1) * interval;
      if (tick * perTick + seconds * burnDps >= POOL) return seconds;
    }
    return Infinity;
  }

  it('kills a body held in the root of the jet in about 1.3 s', () => {
    expect(contactKillSeconds()).toBeCloseTo(1.3, 5);
  });

  it('does not kill with half a second of contact, even once the burn has run out', () => {
    const def = flamethrowerWeapon();
    const ticks = Math.round(0.5 / (60 / def.rpm));
    const burn = (def.flame?.burnDps ?? 0) * (0.5 + (def.flame?.burnSeconds ?? 0));
    expect(ticks * damageAtRange(def, 0) + burn).toBeLessThan(POOL);
  });
});
