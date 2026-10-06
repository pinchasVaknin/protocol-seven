import { describe, expect, it } from 'vitest';
import { DT } from '../core/Loop';
import {
  DEFAULT_HEALTH_CONFIG,
  Health,
  HEALTH_CONFIG_KEYS,
  healthConfigToSource,
  HEALTH_TUNABLES,
  type HealthConfig,
} from './Health';

/**
 * Health, which every combatant in the game is built from.
 *
 * The player, every bot, every target dummy and the dedicated server's players all take their
 * config from `DEFAULT_HEALTH_CONFIG`, so this class is the denominator of every time-to-kill
 * number the weapon tables were tuned against. Three of its rules are the kind that look right
 * in any wrong version:
 *
 *  - **the lethal hit is reported exactly once**, or a burst that overkills fires two kill
 *    events and the killfeed, the streak ledger and the XP ledger all double-count;
 *  - **the armour plate absorbs before health and is never regenerated**, which is the whole
 *    difference between a plate and a raised `max`;
 *  - **`changedThisTick` and `lastDelta` describe the tick they were set on**, because the
 *    owner reads them to decide whether to emit an event at all.
 */

function fresh(over: Partial<HealthConfig> = {}): Health {
  return new Health({ ...DEFAULT_HEALTH_CONFIG, ...over });
}

/** Ticks of regeneration, which is the only thing `step` does. */
function regenerate(health: Health, seconds: number): void {
  const ticks = Math.round(seconds / DT);
  for (let tick = 0; tick < ticks; tick++) health.step();
}

describe('the shipped health config', () => {
  it('is 200, which is where every time-to-kill in the game comes from', () => {
    expect(DEFAULT_HEALTH_CONFIG).toEqual({ max: 200, regenDelay: 4.2, regenRate: 40 });
    // Topping up from nothing therefore takes five seconds, not two and a half.
    expect(DEFAULT_HEALTH_CONFIG.max / DEFAULT_HEALTH_CONFIG.regenRate).toBe(5);
  });

  it('gives every field a slider, so the tuning panel cannot drift', () => {
    expect(HEALTH_CONFIG_KEYS).toEqual(['max', 'regenDelay', 'regenRate']);
    for (const key of HEALTH_CONFIG_KEYS) {
      const meta = HEALTH_TUNABLES[key];
      expect(meta.group, key).toBe('Health');
      expect(meta.min, key).toBeLessThan(meta.max);
      expect(DEFAULT_HEALTH_CONFIG[key], key).toBeGreaterThanOrEqual(meta.min);
      expect(DEFAULT_HEALTH_CONFIG[key], key).toBeLessThanOrEqual(meta.max);
    }
  });

  it('serialises back to pasteable source', () => {
    expect(healthConfigToSource(DEFAULT_HEALTH_CONFIG)).toBe(
      'export const DEFAULT_HEALTH_CONFIG: HealthConfig = {\n' +
        '  max: 200,\n' +
        '  regenDelay: 4.2,\n' +
        '  regenRate: 40,\n' +
        '};',
    );
    // Rounded to four places, which is what keeps a tuned slider from pasting 0.30000000000000004.
    expect(healthConfigToSource({ max: 1 / 3, regenDelay: 0.1 + 0.2, regenRate: 7 })).toContain(
      'max: 0.3333,',
    );
  });
});

describe('a fresh entity', () => {
  it('starts full, alive, and not recovering', () => {
    const health = fresh();
    expect(health.current).toBe(200);
    expect(health.max).toBe(200);
    expect(health.overhealth).toBe(0);
    expect(health.alive).toBe(true);
    expect(health.fraction).toBe(1);
    // `sinceDamage` starts high so a fresh entity is not "recovering" on its first tick.
    expect(health.sinceDamage).toBe(999);
    expect(health.regenerating).toBe(false);
    expect(health.changedThisTick).toBe(false);
    expect(health.lastDelta).toBe(0);
  });

  it('reports a fraction of zero when the config has no maximum', () => {
    expect(fresh({ max: 0 }).fraction).toBe(0);
  });
});

describe('taking damage', () => {
  it('reports the lethal hit exactly once, however far it overkills', () => {
    const health = fresh();
    expect(health.applyDamage(199)).toBe(false);
    expect(health.current).toBe(1);
    expect(health.alive).toBe(true);
    expect(health.applyDamage(500)).toBe(true);
    expect(health.current).toBe(0);
    expect(health.alive).toBe(false);
    // The rest of the burst lands on a corpse and is not a kill.
    expect(health.applyDamage(500)).toBe(false);
    expect(health.applyDamage(1)).toBe(false);
  });

  it('ignores nothing-damage and damage to the dead', () => {
    const health = fresh();
    expect(health.applyDamage(0)).toBe(false);
    expect(health.applyDamage(-10)).toBe(false);
    expect(health.current).toBe(200);
    expect(health.changedThisTick).toBe(false);
  });

  it('records the change and its signed size on the tick it happened', () => {
    const health = fresh();
    health.applyDamage(30);
    expect(health.changedThisTick).toBe(true);
    expect(health.lastDelta).toBe(-30);
    expect(health.sinceDamage).toBe(0);
    // One tick of `step` clears both, because they describe the tick they were set on.
    health.step();
    expect(health.changedThisTick).toBe(false);
    expect(health.lastDelta).toBe(0);
  });
});

describe('the armour plate', () => {
  it('absorbs before health, and a hit it eats whole is not a health change', () => {
    const health = fresh();
    health.grantOverhealth(50);
    expect(health.overhealth).toBe(50);
    // Granting a plate is a change the HUD should see, with no delta: it is not health.
    expect(health.changedThisTick).toBe(true);
    expect(health.lastDelta).toBe(0);

    expect(health.applyDamage(20)).toBe(false);
    expect(health.overhealth).toBe(30);
    expect(health.current).toBe(200);
    expect(health.lastDelta).toBe(0);
    // The damage timer still ran: a plate takes the hit, it does not hide it.
    expect(health.sinceDamage).toBe(0);
  });

  it('passes the remainder through once it is gone', () => {
    const health = fresh();
    health.grantOverhealth(50);
    expect(health.applyDamage(80)).toBe(false);
    expect(health.overhealth).toBe(0);
    expect(health.current).toBe(170);
    expect(health.lastDelta).toBe(-30);
  });

  it('is never refilled by regeneration', () => {
    const health = fresh();
    health.grantOverhealth(50);
    health.applyDamage(60);
    expect(health.overhealth).toBe(0);
    expect(health.current).toBe(190);
    regenerate(health, 10);
    expect(health.current).toBe(200);
    // Regeneration refills health and nothing else. A plate is spent.
    expect(health.overhealth).toBe(0);
  });

  it('refuses a plate to the dead, and a plate of nothing', () => {
    const health = fresh();
    health.grantOverhealth(0);
    health.grantOverhealth(-5);
    expect(health.overhealth).toBe(0);
    health.applyDamage(500);
    health.grantOverhealth(50);
    expect(health.overhealth).toBe(0);
  });
});

describe('regeneration', () => {
  it('waits out the quiet delay before it starts', () => {
    const health = fresh();
    health.applyDamage(100);
    regenerate(health, 4.0);
    expect(health.current).toBe(100);
    expect(health.regenerating).toBe(false);
    // 4.2 s of quiet, then it begins.
    regenerate(health, 0.5);
    expect(health.current).toBeGreaterThan(100);
    expect(health.regenerating).toBe(true);
  });

  it('restarts the delay on every new hit', () => {
    const health = fresh();
    health.applyDamage(100);
    regenerate(health, 4.0);
    health.applyDamage(10);
    regenerate(health, 4.0);
    expect(health.current).toBe(90);
    expect(health.regenerating).toBe(false);
  });

  it('gives back the configured rate per second, and stops at the maximum', () => {
    const health = fresh();
    health.applyDamage(100);
    regenerate(health, 4.2);
    const before = health.current;
    regenerate(health, 1);
    // 40 HP a second, to within one tick of accumulated float.
    expect(health.current - before).toBeCloseTo(40, 6);
    regenerate(health, 10);
    expect(health.current).toBe(200);
    expect(health.regenerating).toBe(false);
    expect(health.changedThisTick).toBe(false);
  });

  it('does nothing for the dead', () => {
    const health = fresh();
    health.applyDamage(500);
    regenerate(health, 20);
    expect(health.current).toBe(0);
    expect(health.alive).toBe(false);
  });
});

describe('a replicated health value', () => {
  it('keeps alive and changedThisTick honest, which a bare assignment would not', () => {
    const health = fresh();
    health.setReplicated(40, true);
    expect(health.current).toBe(40);
    expect(health.changedThisTick).toBe(true);
    expect(health.lastDelta).toBe(-160);
    // A decrease resets the damage timer, so the muffle and the regen read-out behave locally.
    expect(health.sinceDamage).toBe(0);

    // A corpse arrives as a corpse: full health on a dead body is the bug this prevents.
    health.setReplicated(0, false);
    expect(health.alive).toBe(false);
  });

  it('clamps into range and reports no change when the value is the same', () => {
    const health = fresh();
    health.setReplicated(999, true);
    expect(health.current).toBe(200);
    expect(health.changedThisTick).toBe(false);
    health.setReplicated(-50, true);
    expect(health.current).toBe(0);
  });

  it('never starts a local regeneration — the server gives health back', () => {
    const health = fresh();
    health.setReplicated(50, true);
    const before = health.current;
    // The timer was reset by the decrease, so nothing regenerates for the delay; and after it,
    // the client's own `step` is what would — which is why only the server steps this one.
    regenerate(health, 4.0);
    expect(health.current).toBe(before);
  });
});

describe('healing and resetting', () => {
  it('heals to full without pretending the damage never happened', () => {
    const health = fresh();
    health.applyDamage(100);
    health.step();
    health.healFull();
    expect(health.current).toBe(200);
    expect(health.changedThisTick).toBe(true);
    expect(health.lastDelta).toBe(100);
    // The damage timer keeps its meaning: it says when the last hit was, not when health moved.
    expect(health.sinceDamage).toBeGreaterThan(0);
  });

  it('reports nothing when there was nothing to heal, and refuses the dead', () => {
    const health = fresh();
    health.healFull();
    expect(health.changedThisTick).toBe(false);
    health.applyDamage(500);
    health.healFull();
    expect(health.current).toBe(0);
  });

  it('puts a fresh entity back, flags included', () => {
    const health = fresh();
    health.grantOverhealth(25);
    health.applyDamage(500);
    health.reset();
    expect(health.current).toBe(200);
    expect(health.overhealth).toBe(0);
    expect(health.sinceDamage).toBe(999);
    expect(health.alive).toBe(true);
    expect(health.changedThisTick).toBe(false);
    expect(health.lastDelta).toBe(0);
  });

  it('clamps current health down when a new config lowers the maximum', () => {
    const health = fresh();
    health.setConfig({ ...DEFAULT_HEALTH_CONFIG, max: 100 });
    expect(health.current).toBe(100);
    expect(health.max).toBe(100);
    // Raising it does not top the entity up; that is what `healFull` is for.
    health.setConfig({ ...DEFAULT_HEALTH_CONFIG, max: 300 });
    expect(health.current).toBe(100);
    expect(health.fraction).toBeCloseTo(1 / 3, 12);
  });
});
