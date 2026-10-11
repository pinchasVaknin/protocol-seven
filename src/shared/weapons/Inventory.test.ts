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

describe('an infinite reserve (the Shooting Range, 2026-10-03)', () => {
  it('covers both of the class slots and never the streak weapon', () => {
    const inventory = loadout();
    inventory.infiniteReserve = true;
    expect(inventory.at(0)?.infiniteReserve).toBe(true);
    expect(inventory.at(1)?.infiniteReserve).toBe(true);
    inventory.holdStreakWeapon(minigunWeapon());
    expect(inventory.at(2)?.infiniteReserve).toBe(false);
  });

  it('reaches a secondary added after it was switched on', () => {
    const inventory = new Inventory(AR_DEFAULT, null, createGameBus(), 1);
    inventory.infiniteReserve = true;
    inventory.setSlot(1, PISTOL_DEFAULT);
    expect(inventory.at(1)?.infiniteReserve).toBe(true);
  });
});

/**
 * The swap machine itself, which every path above rides on.
 *
 * `requestSwap` refuses while a swap is already running, and that refusal is what makes
 * `holdStreakWeapon` safe to ask sixty times a second — so the refusal is a contract and not an
 * implementation detail.
 */
describe('the swap machine', () => {
  it('starts on the rifle and toggles to the sidearm and back', () => {
    const inventory = loadout();
    expect(inventory.activeSlotIndex).toBe(0);
    expect(inventory.slotCount).toBe(2);
    expect(inventory.swapping).toBe(false);

    inventory.requestToggle();
    expect(inventory.swapping).toBe(true);
    run(inventory, SWAP);
    expect(inventory.activeSlotIndex).toBe(1);
    expect(inventory.active.definition.id).toBe(PISTOL_DEFAULT.id);
    expect(inventory.swapping).toBe(false);

    inventory.requestToggle();
    run(inventory, SWAP);
    expect(inventory.activeSlotIndex).toBe(0);
  });

  it('refuses a second swap while one is running, which is what makes a retry harmless', () => {
    const inventory = loadout();
    inventory.requestSwap(1);
    inventory.step();
    // Asked again mid-swap: ignored, and the first one still lands.
    inventory.requestSwap(0);
    run(inventory, SWAP);
    expect(inventory.activeSlotIndex).toBe(1);
  });

  it('ignores a swap to the slot already in hand, and to one that does not exist', () => {
    const inventory = loadout();
    inventory.requestSwap(0);
    expect(inventory.swapping).toBe(false);
    inventory.requestSwap(7);
    expect(inventory.swapping).toBe(false);
    expect(inventory.activeSlotIndex).toBe(0);
  });

  it('lowers the weapon for the whole swap, which is what the caller gates firing on', () => {
    const inventory = loadout();
    inventory.requestToggle();
    let loweredTicks = 0;
    for (let t = 0; t < SWAP; t += DT) {
      if (inventory.step()) loweredTicks++;
    }
    // `step` returns "the weapon is on its way somewhere", and it is true for a real stretch
    // of the swap rather than for one tick.
    expect(loweredTicks).toBeGreaterThan(10);
    expect(inventory.swapping).toBe(false);
  });

  it('retunes a slot in place without resetting its magazine, unlike setSlot', () => {
    const inventory = loadout();
    const rifle = inventory.at(0);
    rifle?.consumeShot();
    inventory.active.step({
      fireHeld: true,
      firePressed: true,
      adsHeld: false,
      reloadPressed: false,
      reloadBlocked: false,
      lowering: false,
    });
    inventory.active.consumeShot();
    const mag = inventory.active.mag;
    expect(mag).toBeLessThan(AR_DEFAULT.magSize);

    // A live retune from the debug panel: the same gun with different numbers.
    inventory.retuneSlot(0, { ...AR_DEFAULT, rpm: 900 });
    expect(inventory.active.definition.rpm).toBe(900);
    expect(inventory.active.mag).toBe(mag);

    // `setSlot` is a different gun, so it resets ammo.
    inventory.setSlot(0, AR_DEFAULT);
    expect(inventory.active.mag).toBe(AR_DEFAULT.magSize);
  });

  it('puts everything back on reset', () => {
    const inventory = loadout();
    inventory.holdStreakWeapon(minigunWeapon());
    run(inventory, SWAP);
    expect(inventory.streakWeaponHeld).toBe(true);

    inventory.reset();
    // A reset is a fresh life: the streak slot goes with it.
    expect(inventory.streakWeaponHeld).toBe(false);
    expect(inventory.activeSlotIndex).toBe(0);
    expect(inventory.swapping).toBe(false);
    expect(inventory.active.definition.id).toBe(AR_DEFAULT.id);
    expect(inventory.active.mag).toBe(AR_DEFAULT.magSize);
  });
});

describe('asking for the same streak weapon twice', () => {
  it('costs nothing, which is the whole point of it being asked every tick', () => {
    const inventory = loadout();
    const minigun = minigunWeapon();
    inventory.holdStreakWeapon(minigun);
    run(inventory, SWAP);
    const held = inventory.at(2);
    const magBefore = held?.mag;

    // Sixty more asks with the same answer.
    for (let i = 0; i < 60; i++) {
      inventory.holdStreakWeapon(minigun);
      inventory.step();
    }
    expect(inventory.at(2)).toBe(held);
    expect(inventory.at(2)?.mag).toBe(magBefore);
    expect(inventory.active.definition.id).toBe('streak_minigun');
  });

  it('swaps once when the answer changes late', () => {
    const inventory = loadout();
    inventory.holdStreakWeapon(minigunWeapon());
    run(inventory, SWAP);
    expect(inventory.active.definition.id).toBe('streak_minigun');

    // Null is "give the body back what it was carrying".
    for (let i = 0; i < 4; i++) inventory.holdStreakWeapon(null);
    run(inventory, SWAP);
    expect(inventory.active.definition.id).toBe(AR_DEFAULT.id);
    expect(inventory.activeSlotIndex).toBe(0);
    // `streakWeaponHeld` is "a streak slot exists", not "it is in the hands" — the slot stays
    // so a streak that comes back does not rebuild the weapon and its magazine.
    expect(inventory.streakWeaponHeld).toBe(true);
  });
});
