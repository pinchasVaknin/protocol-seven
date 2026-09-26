import { describe, expect, it } from 'vitest';
import { createGameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { minigunWeapon } from '../streaks/StreakWeapons';
import { Inventory } from './Inventory';
import { AR_DEFAULT, PISTOL_DEFAULT } from './WeaponDefs';

/**
 * The carried killstreak weapon, which is the one thing in here that is *asked for* every tick
 * rather than pressed once.
 *
 * That is what these assert. Both runtimes call `holdStreakWeapon` from their own copy of the
 * live streak list and neither tells the other, so the method has to be safe to call with the
 * same answer sixty times a second, safe to call with a *different* answer at any moment, and
 * incapable of leaving the body holding something that is over. The loadout is the other half:
 * a streak takes the hands for thirty seconds and must give back exactly what it took.
 */

function loadout(): Inventory {
  return new Inventory(AR_DEFAULT, PISTOL_DEFAULT, createGameBus(), 1);
}

/** Run the swap machine for `seconds`, as `WeaponSystem.step` does once per tick. */
function run(inventory: Inventory, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) inventory.step();
}

/** Long enough for any put-away plus any take-out in the arsenal. */
const SWAP = 3;

describe('a carried killstreak weapon', () => {
  it('arrives in the hands and says so', () => {
    const inventory = loadout();
    inventory.holdStreakWeapon(minigunWeapon());
    expect(inventory.streakWeaponHeld).toBe(true);
    run(inventory, SWAP);
    expect(inventory.active.definition.id).toBe('streak_minigun');
  });

  it('costs the loadout nothing — same guns, same magazines', () => {
    const inventory = loadout();
    const primary = inventory.at(0);
    const secondary = inventory.at(1);
    if (primary !== undefined) primary.mag -= 7;
    const magBefore = primary?.mag;
    const reserveBefore = primary?.reserve;

    inventory.holdStreakWeapon(minigunWeapon());
    run(inventory, SWAP);
    inventory.holdStreakWeapon(null);
    run(inventory, SWAP);
    inventory.holdStreakWeapon(null);

    expect(inventory.at(0)).toBe(primary);
    expect(inventory.at(1)).toBe(secondary);
    expect(primary?.mag).toBe(magBefore);
    expect(primary?.reserve).toBe(reserveBefore);
  });

  it('gives back the slot it took, not slot zero', () => {
    const inventory = loadout();
    inventory.requestSwap(1);
    run(inventory, SWAP);
    expect(inventory.activeSlotIndex).toBe(1);

    inventory.holdStreakWeapon(minigunWeapon());
    run(inventory, SWAP);
    expect(inventory.active.definition.id).toBe('streak_minigun');

    inventory.holdStreakWeapon(null);
    run(inventory, SWAP);
    inventory.holdStreakWeapon(null);
    expect(inventory.activeSlotIndex).toBe(1);
    expect(inventory.streakWeaponHeld).toBe(false);
  });

  it('is the same answer whether it is asked once or every tick', () => {
    const inventory = loadout();
    for (let t = 0; t < SWAP; t += DT) {
      inventory.holdStreakWeapon(minigunWeapon());
      inventory.step();
    }
    expect(inventory.active.definition.id).toBe('streak_minigun');
    expect(inventory.slotCount).toBe(3);

    for (let t = 0; t < SWAP; t += DT) {
      inventory.holdStreakWeapon(null);
      inventory.step();
    }
    inventory.holdStreakWeapon(null);
    expect(inventory.streakWeaponHeld).toBe(false);
    expect(inventory.slotCount).toBe(2);
    expect(inventory.active.definition.id).toBe(AR_DEFAULT.id);
  });

  /**
   * The case the tick-by-tick ask exists for: a streak that ends while the hands are already
   * busy. `requestSwap` refuses during a swap, and the refusal has to be harmless.
   */
  it('never raises a streak weapon whose streak is already over', () => {
    const inventory = loadout();
    inventory.holdStreakWeapon(minigunWeapon());
    // One tick into the put-away, the streak is over. The hands are already moving.
    inventory.step();
    for (let t = 0; t < SWAP * 2; t += DT) {
      inventory.holdStreakWeapon(null);
      inventory.step();
      // The expired weapon is never the one in the hands, on any tick of the way back.
      expect(inventory.active.definition.id).not.toBe('streak_minigun');
    }
    inventory.holdStreakWeapon(null);
    expect(inventory.streakWeaponHeld).toBe(false);
    expect(inventory.active.definition.id).toBe(AR_DEFAULT.id);
  });

  it('does not survive a life', () => {
    const inventory = loadout();
    inventory.holdStreakWeapon(minigunWeapon());
    run(inventory, SWAP);
    inventory.reset();
    expect(inventory.streakWeaponHeld).toBe(false);
    expect(inventory.slotCount).toBe(2);
    expect(inventory.activeSlotIndex).toBe(0);
    expect(inventory.active.definition.id).toBe(AR_DEFAULT.id);
  });

  it('is belt-fed: no reserve to reload from', () => {
    // The streak is the ammunition. A minigun that could be topped up at a crate — or by
    // MUNITIONS, which resupplies every slot — would outlive its own clock.
    expect(minigunWeapon().reserveAmmo).toBe(0);
    expect(minigunWeapon().magSize).toBeGreaterThan(100);
  });
});

describe('a spent belt', () => {
  it('gives the hands back without waiting for the clock', () => {
    const inventory = loadout();
    inventory.holdStreakWeapon(minigunWeapon());
    run(inventory, SWAP);
    expect(inventory.active.definition.id).toBe('streak_minigun');

    // Fired dry. The streak is still live — it is asked for every tick, as it would be.
    inventory.active.mag = 0;
    expect(inventory.streakWeaponSpent).toBe(true);

    inventory.requestSwap(0);
    for (let t = 0; t < SWAP; t += DT) {
      inventory.holdStreakWeapon(minigunWeapon());
      inventory.step();
    }
    // Back on the rifle, and not dragged onto the empty weapon again.
    expect(inventory.active.definition.id).toBe(AR_DEFAULT.id);
  });
});
