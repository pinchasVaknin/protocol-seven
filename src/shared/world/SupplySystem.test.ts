import { describe, expect, it } from 'vitest';
import { createGameBus } from '../core/Events';
import { makeEquipmentInventory, type EquipmentInventory } from '../equipment/EquipmentSystem';
import { equipmentDef } from '../equipment/EquipmentDefs';
import type { StanceId } from '../player/Stance';
import { AR_DEFAULT } from '../weapons/WeaponDefs';
import { Weapon } from '../weapons/WeaponBase';
import type { SupplyPointDef } from './maps/types';
import { NO_SUPPLY_POINT, SUPPLY_CONFIG, SupplySystem, type SupplyBody } from './SupplySystem';

/**
 * The station's rule, which is the half of the feature that can be wrong without anybody seeing
 * it. Where the crate is drawn and what the prompt says are visible the moment a human walks up
 * to one; *how much* it gives, how long it takes, and what cancels it are a set of numbers that
 * look plausible in any wrong version.
 *
 * It matters twice over because both runtimes apply this rule from their own copy of the
 * weapon — a client and a server that disagreed about a magazine would drift for the rest of the
 * life — so these are assertions about a contract, not about one machine.
 */

const AT_CRATE = { x: 0, y: 0, z: 0 } as const;

function points(): SupplyPointDef[] {
  return [{ id: 'ammo_a', position: { x: 0, y: 0, z: 0 }, rotationY: 0, radius: 2 }];
}

function body(over: Partial<SupplyBody> = {}): SupplyBody {
  return { ...AT_CRATE, stance: 'CROUCH' as StanceId, ...over };
}

function emptied(): Weapon {
  const weapon = new Weapon(AR_DEFAULT, createGameBus());
  weapon.reserve = 0;
  return weapon;
}

function pouch(): EquipmentInventory {
  const inventory = makeEquipmentInventory('frag', 'flashbang');
  inventory.lethalCount = 0;
  inventory.tacticalCount = 0;
  return inventory;
}

/** `seconds` of ticks at one station, with the use key in whatever state the caller says. */
function hold(
  system: SupplySystem,
  weapon: Weapon,
  inventory: EquipmentInventory,
  seconds: number,
  over: Partial<SupplyBody> = {},
  holdingUse = true,
  alive = true,
): void {
  const ticks = Math.round(seconds * 60);
  for (let tick = 0; tick < ticks; tick++) {
    system.step(1, body(over), alive, holdingUse, weapon, inventory);
  }
}

describe('a resupply station', () => {
  it('gives four rounds a second to the weapon in the hand', () => {
    const system = new SupplySystem(points());
    const weapon = emptied();
    hold(system, weapon, pouch(), 1);
    expect(weapon.reserve).toBe(4);
  });

  it('takes four seconds over a grenade', () => {
    const system = new SupplySystem(points());
    const inventory = pouch();
    hold(system, emptied(), inventory, 3.9);
    expect(inventory.lethalCount).toBe(0);
    hold(system, emptied(), inventory, 0.2);
    expect(inventory.lethalCount).toBe(1);
  });

  it('fills the lethal slot before the tactical one', () => {
    const system = new SupplySystem(points());
    const inventory = pouch();
    const lethal = equipmentDef(inventory.lethal).count;
    hold(system, emptied(), inventory, 4 * lethal + 0.2);
    expect(inventory.lethalCount).toBe(lethal);
    expect(inventory.tacticalCount).toBe(0);
  });

  it('refuses a body that is not kneeling, and says so', () => {
    const system = new SupplySystem(points());
    const weapon = emptied();
    hold(system, weapon, pouch(), 2, { stance: 'STAND' });
    expect(weapon.reserve).toBe(0);
    expect(system.stateOf(1).needsCrouch).toBe(true);
    expect(system.stateOf(1).working).toBe(false);
  });

  it('refuses a body that is not holding the key', () => {
    const system = new SupplySystem(points());
    const weapon = emptied();
    hold(system, weapon, pouch(), 2, {}, false);
    expect(weapon.reserve).toBe(0);
    expect(system.stateOf(1).pointId).toBe('ammo_a');
  });

  it('is not there for a body out of range, in either axis', () => {
    const system = new SupplySystem(points());
    const weapon = emptied();
    hold(system, weapon, pouch(), 2, { x: 3 });
    expect(system.stateOf(1).pointId).toBe(NO_SUPPLY_POINT);
    // A crate under a catwalk does not resupply the deck above it.
    hold(system, weapon, pouch(), 2, { y: SUPPLY_CONFIG.reachY + 0.5 });
    expect(system.stateOf(1).pointId).toBe(NO_SUPPLY_POINT);
    expect(weapon.reserve).toBe(0);
  });

  it('gives a dead body nothing', () => {
    const system = new SupplySystem(points());
    const weapon = emptied();
    hold(system, weapon, pouch(), 2, {}, true, false);
    expect(weapon.reserve).toBe(0);
  });

  /**
   * The rule that stops a station being worth walking past: partial progress is not banked, so
   * three seconds spent at one in half-second visits is three seconds spent for nothing.
   */
  it('does not bank the part of a round it did not finish', () => {
    const system = new SupplySystem(points());
    const weapon = emptied();
    for (let visit = 0; visit < 6; visit++) {
      // Just under a quarter of a second at a time — never a whole round's worth.
      hold(system, weapon, pouch(), 0.2);
      hold(system, weapon, pouch(), 0.2, { x: 5 });
    }
    expect(weapon.reserve).toBe(0);
  });

  it('stops when there is nothing left to give', () => {
    const system = new SupplySystem(points());
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    const inventory = makeEquipmentInventory('frag', 'flashbang');
    hold(system, weapon, inventory, 1);
    expect(weapon.reserve).toBe(AR_DEFAULT.reserveAmmo);
    expect(system.stateOf(1).full).toBe(true);
    expect(system.stateOf(1).working).toBe(false);
  });

  it('never carries more than the weapon can', () => {
    const system = new SupplySystem(points());
    const weapon = emptied();
    // Long enough to overrun the pouch several times over.
    hold(system, weapon, pouch(), AR_DEFAULT.reserveAmmo / 4 + 10);
    expect(weapon.reserve).toBe(AR_DEFAULT.reserveAmmo);
  });

  it('picks the nearer of two stations whose volumes overlap', () => {
    const system = new SupplySystem([
      { id: 'far', position: { x: 2, y: 0, z: 0 }, rotationY: 0, radius: 3 },
      { id: 'near', position: { x: 0.5, y: 0, z: 0 }, rotationY: 0, radius: 3 },
    ]);
    system.step(1, body(), true, true, emptied(), pouch());
    expect(system.stateOf(1).pointId).toBe('near');
  });

  it('is absent on a map that authored none', () => {
    const system = new SupplySystem([]);
    expect(system.any).toBe(false);
    const weapon = emptied();
    hold(system, weapon, pouch(), 2);
    expect(weapon.reserve).toBe(0);
  });
});
