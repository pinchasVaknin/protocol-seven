import { describe, expect, it } from 'vitest';
import type { EquipmentInventory, EquipmentSystem } from '../equipment/EquipmentSystem';
import { createGameBus, EV, type GameBus } from '../core/Events';
import { Btn, type InputCommand } from '../core/InputCommand';
import { DT } from '../core/Loop';
import { fieldUpgradeDef, FIELD_UPGRADE_IDS, type FieldUpgradeId } from '../meta/FieldUpgrades';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import type { PlayerSim } from '../player/PlayerState';
import type { Inventory } from '../weapons/Inventory';
import { FieldUpgradeRuntime } from './FieldUpgrade';

/**
 * The charge, the key and the four effects (A18).
 *
 * Two rules here are the reason the class exists rather than a timer somewhere: the charge
 * **pauses while dead**, so dying never hands you a free activation, and the key is read as a
 * *press* rather than a hold, so leaning on it does not spend the upgrade the instant it fills.
 * Both are pinned before anything else.
 *
 * `setUpgrade` keeping the charge is the third: it is the player's progress, not the item's, so
 * swapping in the editor mid-match cannot be a way to refill.
 */

function command(buttons: number): InputCommand {
  return { seq: 0, tickIndex: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons, sampledAtMs: 0 };
}

const AT_ORIGIN = { x: 1, y: 2, z: 3 } as unknown as PlayerSim;

function rig(id: FieldUpgradeId = 'munitions') {
  const bus: GameBus = createGameBus();
  const health = new Health(DEFAULT_HEALTH_CONFIG);

  const refilled: number[] = [];
  const weapons = {
    all: [
      { definition: { reserveAmmo: 120 }, addReserve: (n: number) => refilled.push(n) },
      { definition: { reserveAmmo: 60 }, addReserve: (n: number) => refilled.push(n) },
    ],
  } as unknown as Inventory;

  const smoked: { radius: number; seconds: number; y: number }[] = [];
  const equipment = {
    smoke: {
      spawn: (_x: number, y: number, _z: number, radius: number, seconds: number) =>
        smoked.push({ radius, seconds, y }),
    },
  } as unknown as EquipmentSystem;

  const inventory = {
    lethal: 'frag',
    tactical: 'flashbang',
    lethalCount: 0,
    tacticalCount: 0,
  } as unknown as EquipmentInventory;

  const ready: string[] = [];
  const used: { upgradeId: string; x: number }[] = [];
  bus.on(EV.FieldUpgradeReady, (p) => ready.push(p.upgradeId));
  bus.on(EV.FieldUpgradeUsed, (p) => used.push({ upgradeId: p.upgradeId, x: p.x }));

  const runtime = new FieldUpgradeRuntime({ bus, equipment, inventory, weapons, health });
  runtime.setUpgrade(id);

  /** Hold nothing for `ticks` sim ticks, alive unless told otherwise. */
  const idle = (ticks: number, alive = true): void => {
    for (let i = 0; i < ticks; i++) runtime.step(command(0), AT_ORIGIN, alive);
  };
  /** Charge all the way, then stop short of pressing. */
  const chargeFully = (): void => {
    idle(Math.ceil(fieldUpgradeDef(id).chargeSeconds / DT) + 2);
  };
  const press = (alive = true): void => {
    runtime.step(command(Btn.FieldUpgrade), AT_ORIGIN, alive);
  };
  return { runtime, health, refilled, smoked, inventory, ready, used, idle, chargeFully, press };
}

describe('the charge', () => {
  it('starts empty and not ready', () => {
    const r = rig();
    expect(r.runtime.charge).toBe(0);
    expect(r.runtime.ready).toBe(false);
    expect(r.runtime.uses).toBe(0);
  });

  it('fills at the def’s own rate', () => {
    const r = rig('stim');
    r.idle(1);
    expect(r.runtime.charge).toBeCloseTo(DT / fieldUpgradeDef('stim').chargeSeconds, 10);
  });

  it('stops at full rather than running past it', () => {
    const r = rig();
    r.chargeFully();
    expect(r.runtime.charge).toBe(1);
    r.idle(60);
    expect(r.runtime.charge).toBe(1);
  });

  it('pauses while dead, so dying is not a free activation', () => {
    const r = rig();
    r.idle(120, false);
    expect(r.runtime.charge).toBe(0);
    r.idle(60, true);
    expect(r.runtime.charge).toBeGreaterThan(0);
  });

  it('announces ready once, not every tick after', () => {
    const r = rig();
    r.chargeFully();
    expect(r.ready).toEqual(['munitions']);
    r.idle(120);
    expect(r.ready).toEqual(['munitions']);
  });
});

describe('the key', () => {
  it('does nothing until the charge is full', () => {
    const r = rig();
    r.press();
    expect(r.runtime.uses).toBe(0);
    expect(r.used).toEqual([]);
  });

  it('does nothing while dead, however full the charge', () => {
    const r = rig();
    r.chargeFully();
    r.press(false);
    expect(r.runtime.uses).toBe(0);
    expect(r.runtime.charge).toBe(1);
  });

  it('activates on the press, and spends the charge', () => {
    const r = rig();
    r.chargeFully();
    r.press();
    expect(r.runtime.uses).toBe(1);
    expect(r.runtime.charge).toBe(0);
    expect(r.runtime.ready).toBe(false);
    expect(r.used).toEqual([{ upgradeId: 'munitions', x: 1 }]);
  });

  it('is a press and not a hold: a held key spends one charge, not every refill', () => {
    const r = rig();
    r.chargeFully();
    r.press();
    // Still holding it down while the charge builds again.
    for (let i = 0; i < Math.ceil(fieldUpgradeDef('munitions').chargeSeconds / DT) + 2; i++) {
      r.runtime.step(command(Btn.FieldUpgrade), AT_ORIGIN, true);
    }
    expect(r.runtime.uses).toBe(1);
    expect(r.runtime.ready).toBe(true);
  });

  it('can be used again once the charge comes back', () => {
    const r = rig();
    r.chargeFully();
    r.press();
    r.chargeFully();
    r.press();
    expect(r.runtime.uses).toBe(2);
  });

  it('announces ready again for the second charge', () => {
    const r = rig();
    r.chargeFully();
    r.press();
    r.chargeFully();
    expect(r.ready).toEqual(['munitions', 'munitions']);
  });
});

describe('the four effects', () => {
  it('resupplies both weapon slots and the equipment, not just the gun in hand', () => {
    const r = rig('munitions');
    r.chargeFully();
    r.press();
    // Both reserves, by each weapon's own capacity.
    expect(r.refilled).toEqual([120, 60]);
    expect(r.inventory.lethalCount).toBeGreaterThan(0);
    expect(r.inventory.tacticalCount).toBeGreaterThan(0);
  });

  it('heals outright for STIM', () => {
    const r = rig('stim');
    r.health.applyDamage(80);
    expect(r.health.current).toBeLessThan(DEFAULT_HEALTH_CONFIG.max);
    r.chargeFully();
    r.press();
    expect(r.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
  });

  it('grants overhealth for ARMOUR PLATE, as a pool beside the health rather than more of it', () => {
    const r = rig('armour');
    const before = r.health.current;
    r.chargeFully();
    r.press();
    // Not capped by `max` and not health: it is an absorbing pool that takes the next damage.
    expect(r.health.overhealth).toBe(fieldUpgradeDef('armour').overhealth);
    expect(r.health.current).toBe(before);
    r.health.applyDamage(30);
    expect(r.health.current).toBe(before);
    expect(r.health.overhealth).toBe(fieldUpgradeDef('armour').overhealth - 30);
  });

  it('spawns the same smoke a thrown canister does, lifted off the feet', () => {
    const r = rig('smokescreen');
    const def = fieldUpgradeDef('smokescreen');
    r.chargeFully();
    r.press();
    expect(r.smoked).toEqual([{ radius: def.smokeRadius, seconds: def.smokeSeconds, y: 2.6 }]);
  });

  it('asks for nothing an upgrade does not declare', () => {
    const r = rig('stim');
    r.chargeFully();
    r.press();
    expect(r.refilled).toEqual([]);
    expect(r.smoked).toEqual([]);
  });

  it('activates every shipped upgrade without throwing', () => {
    for (const id of FIELD_UPGRADE_IDS) {
      const r = rig(id);
      r.chargeFully();
      expect(() => r.press()).not.toThrow();
      expect(r.runtime.uses, id).toBe(1);
    }
  });
});

describe('swapping and resetting', () => {
  it('reports the equipped upgrade’s id and name', () => {
    const r = rig('armour');
    expect(r.runtime.id).toBe('armour');
    expect(r.runtime.name).toBe(fieldUpgradeDef('armour').name);
  });

  it('keeps the charge across a swap: it is the player’s, not the item’s', () => {
    const r = rig('munitions');
    r.idle(600);
    const charged = r.runtime.charge;
    expect(charged).toBeGreaterThan(0);
    r.runtime.setUpgrade('stim');
    expect(r.runtime.charge).toBe(charged);
    expect(r.runtime.id).toBe('stim');
  });

  it('announces ready again after a swap at full charge, for the upgrade now equipped', () => {
    const r = rig('munitions');
    r.chargeFully();
    expect(r.ready).toEqual(['munitions']);
    r.runtime.setUpgrade('stim');
    r.idle(1);
    // Still full, and the new upgrade has not said it is ready — until the charge ticks again.
    expect(r.runtime.ready).toBe(true);
  });

  it('empties everything on reset', () => {
    const r = rig();
    r.chargeFully();
    r.runtime.reset();
    expect(r.runtime.charge).toBe(0);
    expect(r.runtime.ready).toBe(false);
    // And the next press does nothing, because the press state went with it.
    r.press();
    expect(r.runtime.uses).toBe(0);
  });
});
