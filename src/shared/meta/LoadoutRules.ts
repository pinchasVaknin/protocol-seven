import { EQUIPMENT_DEFS, type EquipmentId, type EquipmentSlot } from '../equipment/EquipmentDefs';
import { isPerkId, perkDef, type PerkId } from '../perks/PerkDefs';
import { STREAK_DEFS, type StreakId } from '../streaks/StreakDefs';
import { ATTACHMENTS, fitsWeapon, type AttachmentId } from '../weapons/Attachments';
import { WEAPON_DEFS, type WeaponDef } from '../weapons/WeaponDefs';
import type { LoadoutSlot, WeaponLoadout } from './Loadouts';

/**
 * The rules a class obeys whatever the profile has earned (security audit 2026-10-04, S1).
 *
 * Two different questions decide whether a class is legal, and until this file only one of
 * them had an answer on both sides of the wire:
 *
 * - **Has this player earned it?** Levels, weapon kills, camo challenges. `Unlocks.sanitiseLoadout`
 *   answers it on the client, and the server cannot — there is no profile on the server (§6.9),
 *   which is the recorded gap in `sanitiseNetLoadout`.
 * - **Is it a class at all?** One perk per tier, a primary in the primary slot, a primary in
 *   the secondary slot only with OVERKILL, a lethal in the lethal slot, one attachment per
 *   attachment slot and only one the weapon can take, each streak on one key. None of these
 *   needs a profile, so the server can and must hold every one of them.
 *
 * The second question was answered by the editor's tiles and, for three of the rules, by the
 * client's sanitiser — and by nothing on the server, which checked only that each id existed.
 * `resolvePerkState` multiplies, so a class naming SLEIGHT OF HAND three times reloaded at
 * 0.65³ = 0.27 of the time, LIGHTWEIGHT three times ran at ×1.225, and the server simulated
 * both. A hand-edited save was enough; no client code had to change.
 *
 * So the rules live here, once, and both doors call them: `sanitiseNetLoadout` on everything a
 * client sends, and `sanitiseLoadout` after its unlock pass. One function means the server
 * cannot refuse a class the editor offers, and the editor cannot offer one the server refuses.
 *
 * **Total.** It never throws, whatever the slot holds — an unknown id is a revert or a removal
 * like any other illegal value — because it is the boundary validation for the one message
 * whose content is a whole class (§4.16).
 */

/** Perk slots on a class: one per tier, indexed 0..2 for tiers 1..3. */
export const PERK_SLOT_COUNT = 3;

/** Streak keys on a class (3, 4 and 5). */
export const STREAK_SLOT_COUNT = 3;

/**
 * What a reverted slot falls back to.
 *
 * Every one is `unlockLevel` 1 and sits in its own slot's class, so a revert — by this pass or
 * by the unlock pass — can never itself need reverting.
 */
export const FALLBACK_PRIMARY = 'ar_carbine';
export const FALLBACK_SECONDARY = 'pistol_talon';
export const FALLBACK_LETHAL: EquipmentId = 'frag';
export const FALLBACK_TACTICAL: EquipmentId = 'flashbang';

/**
 * Whether this attachment exists and the weapon has a slot for it.
 *
 * Exported for the unlock pass, which must not ask whether an attachment is *earned* on a
 * weapon that cannot carry it: the structure pass removes those with the right reason.
 */
export function attachmentFits(def: WeaponDef, id: string): boolean {
  return hasOwn(ATTACHMENTS, id) && fitsWeapon(def, id as AttachmentId);
}

/**
 * Force a class into a legal shape, in place, reporting every change.
 *
 * Returns whether anything changed. The order is part of the contract: perks first, because
 * whether the secondary slot may hold a primary is a question about the perks the class holds
 * *after* they have been made legal — a second tier-3 perk is dropped, and if that was the
 * OVERKILL, the permission goes with it.
 */
export function enforceLoadoutStructure(slot: LoadoutSlot, losses: string[]): boolean {
  let changed = false;
  const label = slot.name;
  const note = (text: string): void => {
    losses.push(`${label}${text}`);
    changed = true;
  };

  // -- perks: one per tier, in that tier's slot ----------------------------------------------

  /**
   * A perk in the wrong slot is **moved** to its own tier rather than dropped. The editor only
   * ever writes `perks[tier - 1]`, so a misplaced perk is a save from somewhere else; keeping
   * the choice costs nothing, and the second perk of a tier is the one that cannot be kept.
   */
  const perks: Array<PerkId | null> = new Array<PerkId | null>(PERK_SLOT_COUNT).fill(null);
  const givenPerks: readonly (string | null | undefined)[] = Array.isArray(slot.perks) ? slot.perks : [];
  for (let i = 0; i < givenPerks.length; i++) {
    const id = givenPerks[i];
    if (id === null || id === undefined) continue;
    if (typeof id !== 'string' || !isPerkId(id)) {
      note(`: unknown perk "${String(id)}"; removed`);
      continue;
    }
    const def = perkDef(id);
    const at = def.tier - 1;
    const held = perks[at];
    if (held !== null && held !== undefined) {
      note(`: ${def.name} is a second tier ${def.tier} perk beside ${perkDef(held).name}; removed`);
      continue;
    }
    perks[at] = id;
    if (at !== i) note(`: ${def.name} moved to the tier ${def.tier} slot`);
  }
  if (!sameList(givenPerks, perks)) {
    slot.perks = perks;
    changed = true;
  }

  // -- streaks: three keys, each streak on at most one ---------------------------------------

  const streaks: Array<StreakId | null> = new Array<StreakId | null>(STREAK_SLOT_COUNT).fill(null);
  const givenStreaks: readonly (string | null | undefined)[] = Array.isArray(slot.streaks) ? slot.streaks : [];
  for (let i = 0; i < Math.min(givenStreaks.length, STREAK_SLOT_COUNT); i++) {
    const id = givenStreaks[i];
    if (id === null || id === undefined) continue;
    if (typeof id !== 'string' || !STREAK_DEFS.some((s) => s.id === id)) {
      note(`: unknown streak "${String(id)}"; removed`);
      continue;
    }
    if (streaks.includes(id as StreakId)) {
      note(`: streak "${id}" is on two keys; kept the first`);
      continue;
    }
    streaks[i] = id as StreakId;
  }
  if (givenStreaks.slice(STREAK_SLOT_COUNT).some((id) => id !== null && id !== undefined)) {
    note(`: more than ${STREAK_SLOT_COUNT} streak keys; the extra removed`);
  }
  if (!sameList(givenStreaks, streaks)) {
    slot.streaks = streaks;
    changed = true;
  }

  // -- equipment: each item in the slot it was made for ---------------------------------------

  const lethal = fixEquipment(slot.lethal, 'lethal', FALLBACK_LETHAL);
  if (lethal !== slot.lethal) {
    note(`: "${String(slot.lethal)}" is not a lethal; reverted to ${lethal}`);
    slot.lethal = lethal;
  }
  const tactical = fixEquipment(slot.tactical, 'tactical', FALLBACK_TACTICAL);
  if (tactical !== slot.tactical) {
    note(`: "${String(slot.tactical)}" is not a tactical; reverted to ${tactical}`);
    slot.tactical = tactical;
  }

  // -- weapons: each in a slot of its class, then its attachments ----------------------------

  const primary = weaponOrNull(slot.primary.weaponId);
  if (primary === null || primary.slot !== 'primary') {
    const what = primary === null ? `unknown weapon "${String(slot.primary.weaponId)}"` : `${primary.name} is a sidearm`;
    note(` primary: ${what}; reverted to ${FALLBACK_PRIMARY}`);
    revertWeapon(slot.primary, FALLBACK_PRIMARY);
  }

  const secondary = weaponOrNull(slot.secondary.weaponId);
  if (secondary === null) {
    note(` secondary: unknown weapon "${String(slot.secondary.weaponId)}"; reverted to ${FALLBACK_SECONDARY}`);
    revertWeapon(slot.secondary, FALLBACK_SECONDARY);
  } else if (secondary.slot === 'primary' && !slot.perks.includes('overkill')) {
    // Overkill is the one rule that makes the secondary slot's *class* legal or not.
    note(`: ${secondary.name} in the secondary slot needs OVERKILL; reverted`);
    revertWeapon(slot.secondary, FALLBACK_SECONDARY);
  }

  if (fixAttachments(slot.primary, 'primary', note)) changed = true;
  if (fixAttachments(slot.secondary, 'secondary', note)) changed = true;

  return changed;
}

/**
 * Only attachments the weapon can carry, at most one per attachment slot, first one kept.
 *
 * One per slot is what stops a hand-edit stacking the same multiplier twice; a duplicate id is
 * the simplest case of it. Today every attachment has a slot of its own, so the rule only bites
 * on a duplicate — it is held anyway, because the sixth attachment will share a slot.
 */
function fixAttachments(
  entry: WeaponLoadout,
  which: 'primary' | 'secondary',
  note: (text: string) => void,
): boolean {
  const def = weaponOrNull(entry.weaponId);
  const given: readonly unknown[] = Array.isArray(entry.attachments) ? entry.attachments : [];
  if (def === null) {
    // Unreachable after the weapon pass above; total anyway.
    if (given.length === 0) return false;
    entry.attachments = [];
    return true;
  }
  const kept: AttachmentId[] = [];
  const used = new Set<string>();
  for (const raw of given) {
    const id = typeof raw === 'string' ? raw : '';
    if (!hasOwn(ATTACHMENTS, id)) {
      note(` ${which}: unknown attachment "${String(raw)}"; removed`);
      continue;
    }
    const att = ATTACHMENTS[id as AttachmentId];
    if (!fitsWeapon(def, att.id)) {
      note(` ${which}: ${att.name} does not fit ${def.name}; removed`);
      continue;
    }
    if (used.has(att.slot)) {
      note(` ${which}: two attachments in the ${att.slot} slot; kept the first`);
      continue;
    }
    used.add(att.slot);
    kept.push(att.id);
  }
  if (sameList(given, kept)) return false;
  entry.attachments = kept;
  return true;
}

function fixEquipment(id: unknown, want: EquipmentSlot, fallback: EquipmentId): EquipmentId {
  if (typeof id === 'string' && hasOwn(EQUIPMENT_DEFS, id) && EQUIPMENT_DEFS[id as EquipmentId].slot === want) {
    return id as EquipmentId;
  }
  return fallback;
}

/** A weapon reverted to its slot's fallback: nothing on it carries over to a different gun. */
function revertWeapon(entry: WeaponLoadout, fallback: string): void {
  entry.weaponId = fallback;
  entry.attachments = [];
  entry.camo = null;
}

function weaponOrNull(id: unknown): WeaponDef | null {
  return typeof id === 'string' && hasOwn(WEAPON_DEFS, id) ? (WEAPON_DEFS[id] ?? null) : null;
}

/**
 * Own keys only. A registry is a plain object, so `"__proto__"` or `"constructor"` would
 * otherwise resolve to something that is not a definition.
 */
function hasOwn(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // An `undefined` hole and a null are the same empty slot.
    if ((a[i] ?? null) !== (b[i] ?? null)) return false;
  }
  return true;
}
