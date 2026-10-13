import { describe, expect, it } from 'vitest';
import { resolveWeaponDef } from '../weapons/Attachments';
import { requireWeapon } from '../weapons/WeaponDefs';
import {
  cloneLoadout,
  defaultLoadouts,
  LOADOUT_SLOT_COUNT,
  resolveLoadout,
  type LoadoutSlot,
} from './Loadouts';
import { perkWeaponEffects, resolvePerkState } from '../perks/PerkState';

/**
 * The five shipped classes, and turning one into what a match consumes (A19).
 *
 * Two of these hold a rule the file argues for at length and nothing else checks.
 *
 * `cloneLoadout` has to be a **deep** copy: the editor hands a clone to the preview and the
 * match keeps its own, and an array shared between the two would let an edit reach a running
 * match. The test pokes the copy and reads the original.
 *
 * `resolveLoadout` is documented as *"pure and cheap enough to call per keystroke"* with
 * *"nothing cached, which is deliberate"* — so two resolves of the same slot must be equal and
 * **not** the same object, which is what `verifyAttachmentPurity` checks from the other side.
 */

function firstSlot(): LoadoutSlot {
  const slot = defaultLoadouts()[0];
  if (slot === undefined) throw new Error('no default loadout');
  return slot;
}

describe('the five shipped classes', () => {
  it('are five, each with a name of its own', () => {
    const slots = defaultLoadouts();
    expect(slots).toHaveLength(LOADOUT_SLOT_COUNT);
    const names = slots.map((s) => s.name);
    expect(new Set(names).size).toBe(LOADOUT_SLOT_COUNT);
    expect(names).toEqual(['ASSAULT', 'SCOUT', 'BREACH', 'SUPPORT', 'MARKSMAN']);
  });

  it('are a fresh set each call, so one caller cannot edit another’s', () => {
    const a = defaultLoadouts();
    const b = defaultLoadouts();
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(b[0]);
    a[0]!.name = 'EDITED';
    expect(b[0]?.name).toBe('ASSAULT');
  });

  it('give every class three perk slots and three streak keys', () => {
    for (const slot of defaultLoadouts()) {
      expect(slot.perks, slot.name).toHaveLength(3);
      expect(slot.streaks, slot.name).toHaveLength(3);
    }
  });

  it('hold each perk in its own tier, or leave the tier empty', () => {
    for (const slot of defaultLoadouts()) {
      for (let tier = 0; tier < 3; tier++) {
        const id = slot.perks[tier];
        if (id === null || id === undefined) continue;
        expect(resolvePerkState([id]).perks, `${slot.name} tier ${tier + 1}`).toEqual([id]);
      }
    }
  });

  it('never put the same streak on two keys', () => {
    for (const slot of defaultLoadouts()) {
      const named = slot.streaks.filter((s) => s !== null);
      expect(new Set(named).size, slot.name).toBe(named.length);
    }
  });
});

describe('cloning a class', () => {
  it('copies every field', () => {
    const original = firstSlot();
    expect(cloneLoadout(original)).toEqual(original);
  });

  it('is deep: no array survives the copy shared', () => {
    const original = firstSlot();
    const copy = cloneLoadout(original);

    expect(copy).not.toBe(original);
    expect(copy.primary).not.toBe(original.primary);
    expect(copy.secondary).not.toBe(original.secondary);
    expect(copy.perks).not.toBe(original.perks);
    expect(copy.streaks).not.toBe(original.streaks);
    expect(copy.primary.attachments).not.toBe(original.primary.attachments);
  });

  it('cannot be edited into the original — the whole reason it exists', () => {
    const original = firstSlot();
    const copy = cloneLoadout(original);

    copy.name = 'COPY';
    copy.perks[0] = null;
    copy.streaks[0] = null;
    copy.primary.weaponId = 'smg_wasp';
    copy.primary.attachments.push('optic_reflex');
    copy.primary.camo = 'gold';
    copy.lethal = 'semtex';

    expect(original.name).toBe('ASSAULT');
    expect(original.perks[0]).toBe('lightweight');
    expect(original.streaks[0]).toBe('uav');
    expect(original.primary.weaponId).toBe('ar_carbine');
    expect(original.primary.attachments).toEqual([]);
    expect(original.primary.camo).toBe(null);
    expect(original.lethal).toBe('frag');
  });
});

describe('resolving a class for a match', () => {
  it('reports the slot it came from and the name it carries', () => {
    const resolved = resolveLoadout(firstSlot(), 3);
    expect(resolved.slotIndex).toBe(3);
    expect(resolved.name).toBe('ASSAULT');
  });

  it('carries the equipment, the field upgrade and the streaks through unchanged', () => {
    const slot = firstSlot();
    const resolved = resolveLoadout(slot, 0);
    expect(resolved.lethal).toBe(slot.lethal);
    expect(resolved.tactical).toBe(slot.tactical);
    expect(resolved.fieldUpgrade).toBe(slot.fieldUpgrade);
    expect(resolved.streaks).toEqual(slot.streaks);
  });

  it('hands over the base defs the bots carry, untouched', () => {
    const slot = firstSlot();
    const resolved = resolveLoadout(slot, 0);
    expect(resolved.primaryBase).toBe(requireWeapon(slot.primary.weaponId));
    expect(resolved.secondaryBase).toBe(requireWeapon(slot.secondary.weaponId));
  });

  it('resolves the held defs through the same chain attachments use', () => {
    const slot = firstSlot();
    const resolved = resolveLoadout(slot, 0);
    const expected = resolveWeaponDef(
      requireWeapon(slot.primary.weaponId),
      slot.primary.attachments,
      perkWeaponEffects(slot.perks.filter((p): p is NonNullable<typeof p> => p !== null)),
    );
    expect(resolved.primary.damage).toEqual(expected.damage);
    expect(resolved.primary.adsTime).toBe(expected.adsTime);
  });

  it('is a new object every call, because nothing is cached on purpose', () => {
    const slot = firstSlot();
    const first = resolveLoadout(slot, 0);
    const second = resolveLoadout(slot, 0);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    // The held def above all: two resolves of one base must not be able to interfere.
    expect(first.primary).not.toBe(second.primary);
  });

  it('copies the attachment ids, so a later edit cannot reach a running match', () => {
    const slot = firstSlot();
    slot.primary.attachments = ['optic_reflex'];
    const resolved = resolveLoadout(slot, 0);
    expect(resolved.primaryAttachments).toEqual(['optic_reflex']);
    slot.primary.attachments.push('muzzle_suppressor');
    expect(resolved.primaryAttachments).toEqual(['optic_reflex']);
  });

  it('carries each weapon’s camo on its own side', () => {
    const slot = firstSlot();
    slot.primary.camo = 'gold';
    slot.secondary.camo = 'digital';
    const resolved = resolveLoadout(slot, 0);
    expect(resolved.primaryCamo).toBe('gold');
    expect(resolved.secondaryCamo).toBe('digital');
  });

  it('folds the perks into one state, dropping the empty tiers', () => {
    const slot = firstSlot();
    const resolved = resolveLoadout(slot, 0);
    // ASSAULT runs LIGHTWEIGHT and QUICKDRAW with tier 2 empty.
    expect(resolved.perkState.perks).toEqual(['lightweight', 'quickdraw']);
    expect(resolved.perkState.moveSpeedMult).toBe(1.07);
  });

  it('resolves all five shipped classes without throwing', () => {
    const slots = defaultLoadouts();
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot === undefined) continue;
      expect(() => resolveLoadout(slot, i), slot.name).not.toThrow();
    }
  });
});
