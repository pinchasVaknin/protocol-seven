import { describe, expect, it } from 'vitest';
import {
  FIELD_UPGRADE_IDS,
  FIELD_UPGRADES,
  fieldUpgradeDef,
  isFieldUpgradeId,
  type FieldUpgradeId,
} from './FieldUpgrades';

/**
 * The four field upgrades, as data (A18).
 *
 * Each one is a single call into a system that already exists, and the def is what decides
 * which call: `FieldUpgradeRuntime.activate` reads `resupply`, `heal`, `overhealth` and
 * `smokeSeconds` and does nothing a zero does not ask for. So "exactly one effect per upgrade,
 * and the others at their zero" is a real invariant of this table rather than tidiness, and it
 * is what stops a second effect appearing on an upgrade nobody priced for two.
 */

describe('looking an upgrade up', () => {
  it('finds every shipped id', () => {
    for (const id of FIELD_UPGRADE_IDS) expect(fieldUpgradeDef(id).id).toBe(id);
  });

  it('returns the table’s own object', () => {
    expect(fieldUpgradeDef('munitions')).toBe(FIELD_UPGRADES.munitions);
  });

  it('tells an upgrade id from any other string, for the save repair', () => {
    expect(isFieldUpgradeId('stim')).toBe(true);
    expect(isFieldUpgradeId('armour')).toBe(true);
    expect(isFieldUpgradeId('')).toBe(false);
    expect(isFieldUpgradeId('STIM')).toBe(false);
    expect(isFieldUpgradeId('armor')).toBe(false);
  });
});

describe('the table', () => {
  it('lists the four', () => {
    expect(FIELD_UPGRADE_IDS).toEqual(['munitions', 'stim', 'smokescreen', 'armour']);
  });

  it('keys every entry by its own id', () => {
    for (const [key, def] of Object.entries(FIELD_UPGRADES)) expect(def.id).toBe(key);
  });

  it('charges every upgrade in a time the runtime can divide by', () => {
    for (const id of FIELD_UPGRADE_IDS) {
      expect(fieldUpgradeDef(id).chargeSeconds, id).toBeGreaterThan(0);
    }
  });

  it('gives every upgrade a name and a blurb for the editor', () => {
    for (const id of FIELD_UPGRADE_IDS) {
      const def = fieldUpgradeDef(id);
      expect(def.name.length, id).toBeGreaterThan(0);
      expect(def.blurb.length, id).toBeGreaterThan(0);
      expect(def.unlockLevel, id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('one effect per upgrade', () => {
  /** How many of the four effects this def asks the runtime to carry out. */
  function effectCount(id: FieldUpgradeId): number {
    const def = fieldUpgradeDef(id);
    let count = 0;
    if (def.resupply) count++;
    if (def.heal) count++;
    if (def.overhealth > 0) count++;
    if (def.smokeSeconds > 0) count++;
    return count;
  }

  it('asks for exactly one, for each of the four', () => {
    for (const id of FIELD_UPGRADE_IDS) expect(effectCount(id), id).toBe(1);
  });

  it('puts each effect on the upgrade named after it', () => {
    expect(fieldUpgradeDef('munitions').resupply).toBe(true);
    expect(fieldUpgradeDef('stim').heal).toBe(true);
    expect(fieldUpgradeDef('armour').overhealth).toBeGreaterThan(0);
    expect(fieldUpgradeDef('smokescreen').smokeSeconds).toBeGreaterThan(0);
  });

  it('gives the smoke a radius whenever it gives it a duration', () => {
    const smoke = fieldUpgradeDef('smokescreen');
    expect(smoke.smokeRadius).toBeGreaterThan(0);
    // And nothing else spawns smoke, so nothing else needs a radius.
    for (const id of FIELD_UPGRADE_IDS.filter((i) => i !== 'smokescreen')) {
      expect(fieldUpgradeDef(id).smokeSeconds, id).toBe(0);
    }
  });
});
