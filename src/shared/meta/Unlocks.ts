import { ALL_EQUIPMENT, type EquipmentId } from '../equipment/EquipmentDefs';
import { PERK_IDS, perkDef, type PerkId } from '../perks/PerkDefs';
import { ATTACHMENT_IDS, attachmentDef, fitsWeapon, type AttachmentId } from '../weapons/Attachments';
import { requireWeapon, WEAPON_DEFS, type WeaponDef } from '../weapons/WeaponDefs';
import { CAMO_PREREQUISITES, type CamoId } from './Camos';
import { camoRequirementOf } from './Challenges';
import { fieldUpgradeDef, FIELD_UPGRADE_IDS, type FieldUpgradeId } from './FieldUpgrades';
import type { LoadoutSlot } from './Loadouts';
import type { SaveV2, WeaponSaveData } from './SaveData';

/**
 * What is unlocked, and what it takes (brief S6.2).
 *
 * Three gates, and they are deliberately different from one another because they answer
 * different questions:
 *
 * **Account level** gates weapons, perks, equipment and field upgrades. Weapons use the
 * `unlockLevel` values on the defs — S6.2's "enforce the `unlockLevel` values" is this file.
 * M5 authored those numbers and nothing questioned them until playtest round 5's F10, which
 * is the one place the ladder has since been re-cut; the paragraph below is what it was cut
 * against.
 *
 * ## The weapon ladder, and the two rules it is spaced by (playtest round 5, F10)
 *
 * F10 was *"at level 1 there is exactly one primary and all five classes show it"*. The
 * levels moved; the mechanism did not. Two rules decided where they moved to, and both are
 * asserted by `npm run progression` rather than left as intent:
 *
 * **1. Level 1 is a choice between feels, not a single gun.** Three primaries open there —
 * the carbine, the WASP and the BREACHER — chosen so that `docs/BALANCE.md`'s band table
 * gives each of them a different band and a different way of losing the others. Neither
 * sniper nor either LMG is among them, because both cost a mechanic nobody has been taught
 * yet. The set itself is written down in the probe, where changing it is an argument.
 *
 * **2. The remaining eight are spaced in matches, not in levels.** A level is not a unit of
 * play here: `LEVEL_XP` is front-loaded hard enough that levels 2 through 5 all land inside
 * the first match, so two unlocks three levels apart can arrive on one summary screen and
 * "re-spaced" would be a claim about arithmetic nobody experiences. The probe converts each
 * `unlockLevel` into the match an average player reaches it in and fails if two rungs share
 * one. The ordering underneath is **archetype before variant**: the KESTREL and the BASTION
 * are the fourth and fifth *kinds* of weapon, so they sit at 11 and 15, ahead of the two
 * remaining ARs at 21 and 25. All five archetypes are owned inside the first ten matches and
 * the long tail is variants.
 *
 * The VULCAN at 2 is the one deliberate exception to that ordering, and it is not about the
 * weapon. Levels 2 to 5 are the first summary screen a new player ever sees; a flourish that
 * names nothing there is the report's *"three separate systems all answer not yet"* said a
 * fourth time. It is the cheapest thing on the ladder to pay that moment with.
 *
 * **Per-weapon kills** gate that weapon's attachments. A suppressor is something you earn
 * *with the gun*, not something you are handed for playing at all, and tying it to kills
 * rather than to the account level is what makes picking up an unfamiliar weapon a project.
 *
 * **Per-weapon XP** drives a weapon level, which is what the editor prints and what the
 * end-of-match summary rewards. It is derived from the same XP the account earns, scaled
 * by `WEAPON_XP_FRACTION`, so a weapon can never level from something the player was not
 * paid for.
 *
 * A **permanent unlock token** overrides all three for one item id. S6.1: prestige "grants
 * one permanent unlock token that permanently unlocks any single item across resets", so
 * `permanentUnlocks` survives the level reset and is consulted first everywhere below.
 *
 * `sanitiseLoadout` is acceptance criterion 5. It runs after `normaliseSave` on every load
 * and after every edit, and it is the reason a hand-edited save cannot equip a locked
 * weapon: the loadout the match consumes has been through it.
 */

/** Kills with a weapon that unlock each of its attachments, in unlock order. */
const ATTACHMENT_KILL_THRESHOLDS: Readonly<Record<AttachmentId, number>> = {
  laser_tactical: 5,
  optic_reflex: 12,
  mag_extended: 25,
  grip_foregrip: 40,
  muzzle_suppressor: 60,
};

/**
 * Account level each piece of equipment becomes selectable at.
 *
 * The one gated category whose level lives in a side table rather than on the def, which is
 * half of why B7 happened: everything else answers `def.unlockLevel` and this has to be looked
 * up. It stays here — this file is the one about gates — and `equipmentUnlockLevel` below is
 * the only reader, so the lookup has exactly one place to be wrong.
 */
const EQUIPMENT_UNLOCK_LEVEL: Readonly<Record<EquipmentId, number>> = {
  frag: 1,
  flashbang: 1,
  smoke: 3,
  semtex: 8,
  claymore: 16,
};

/**
 * The level, or a throw. **Not a default** (playtest round 4, B7).
 *
 * `EQUIPMENT_UNLOCK_LEVEL[id] ?? 1` is what both readers used to say, and a `?? 1` on a table
 * of gates means a missing row silently unlocks the item at level one — the quietest possible
 * failure for a progression system. `noUncheckedIndexedAccess` forces *something* to be
 * written there; this is the version that is loud, in the same shape as `requireWeapon`.
 */
function equipmentUnlockLevel(id: EquipmentId): number {
  const level = EQUIPMENT_UNLOCK_LEVEL[id];
  if (level === undefined) {
    throw new Error(`Equipment "${id}" has no row in EQUIPMENT_UNLOCK_LEVEL.`);
  }
  return level;
}

/**
 * Per-weapon XP for each weapon level, 1..10.
 *
 * Flatter than the account curve on purpose: a weapon should reach its ceiling inside a
 * few sessions of using it, or nobody ever tries the eleventh gun.
 */
const WEAPON_LEVEL_XP: readonly number[] = [
  400, 700, 1100, 1600, 2200, 2900, 3700, 4600, 5600,
];

/** The top of a weapon's own ladder: one level, then one step per row above. Ten. */
export const WEAPON_MAX_LEVEL = WEAPON_LEVEL_XP.length + 1;

/**
 * Per-weapon XP that buys `WEAPON_MAX_LEVEL`. 22,800 on the table above.
 *
 * Derived rather than written down, so a row added to the ladder moves the ceiling with it.
 * `ATT7777` is the only thing that writes it — a cheat that "brings every weapon to the
 * maximum level" has to name a number, and the honest number is the one the ladder implies.
 */
export const WEAPON_MASTERY_XP = WEAPON_LEVEL_XP.reduce((sum, step) => sum + step, 0);

/** The weapon level a per-weapon XP total buys. */
export function weaponLevelForXp(xp: number): number {
  let remaining = Math.max(0, xp);
  let level = 1;
  for (const step of WEAPON_LEVEL_XP) {
    if (remaining < step) break;
    remaining -= step;
    level++;
  }
  return level;
}

/** XP into the current weapon level, and what the level costs. */
export function weaponLevelProgress(xp: number): { level: number; into: number; span: number } {
  let remaining = Math.max(0, xp);
  let level = 1;
  for (const step of WEAPON_LEVEL_XP) {
    if (remaining < step) return { level, into: remaining, span: step };
    remaining -= step;
    level++;
  }
  return { level, into: 0, span: 0 };
}

/**
 * The unlock state a level and a save produce.
 *
 * Built once per edit rather than queried piecemeal: the editor asks "is this locked" for
 * every weapon, every attachment and every perk on every repaint, and a snapshot is both
 * faster and impossible to answer inconsistently mid-frame.
 */
export class UnlockState {
  private readonly permanent: ReadonlySet<string>;

  constructor(
    readonly level: number,
    private readonly weapons: Readonly<Record<string, WeaponSaveData>>,
    permanentUnlocks: readonly string[],
    /** Set by the Shooting Range, where S9's testbed rules apply. See `Range.ts`. */
    readonly unrestricted = false,
  ) {
    this.permanent = new Set(permanentUnlocks);
  }

  /** Built from a save. The one constructor anything outside this file should use. */
  static fromSave(save: SaveV2, unrestricted = false): UnlockState {
    return new UnlockState(save.profile.level, save.weapons, save.profile.permanentUnlocks, unrestricted);
  }

  /** A token spent on this id overrides every other gate, at any prestige. */
  isPermanent(id: string): boolean {
    return this.permanent.has(id);
  }

  weaponUnlocked(weaponId: string): boolean {
    if (this.unrestricted || this.isPermanent(weaponId)) return true;
    const def = WEAPON_DEFS[weaponId];
    if (def === undefined) return false;
    return this.level >= def.unlockLevel;
  }

  /** Kills still needed with this weapon before the attachment is available. */
  attachmentKillsRemaining(weaponId: string, attachment: AttachmentId): number {
    if (this.unrestricted || this.isPermanent(attachmentKey(weaponId, attachment))) return 0;
    const needed = ATTACHMENT_KILL_THRESHOLDS[attachment];
    const stats = this.weapons[weaponId];
    const explicit = stats?.unlockedAttachments.includes(attachment) ?? false;
    if (explicit) return 0;
    return Math.max(0, needed - (stats?.kills ?? 0));
  }

  attachmentUnlocked(weaponId: string, attachment: AttachmentId): boolean {
    return this.attachmentKillsRemaining(weaponId, attachment) === 0;
  }

  perkUnlocked(id: PerkId): boolean {
    if (this.unrestricted || this.isPermanent(id)) return true;
    return this.level >= perkDef(id).unlockLevel;
  }

  equipmentUnlocked(id: EquipmentId): boolean {
    if (this.unrestricted || this.isPermanent(id)) return true;
    return this.level >= equipmentUnlockLevel(id);
  }

  fieldUpgradeUnlocked(id: FieldUpgradeId): boolean {
    if (this.unrestricted || this.isPermanent(id)) return true;
    return this.level >= fieldUpgradeDef(id).unlockLevel;
  }

  /**
   * A camo belongs to the weapon that earned it (2026-09-23), so this takes one.
   *
   * The Shooting Range is the exception it is everywhere else on this class: `unrestricted`
   * opens every finish, because the range exists to look at weapons.
   */
  camoUnlocked(weaponId: string, id: CamoId): boolean {
    if (this.unrestricted) return true;
    return this.weapons[weaponId]?.camos[id] === true;
  }

  /**
   * What a locked item says on its chip. Empty when the item is available.
   *
   * ## Every one of them prints where the player *is* (the human's brief §6, 2026-09-24)
   *
   * They used to print the bar and nothing else — `LEVEL 16`, `12 MORE KILLS`, `25 KILLS
   * WITH THE WEAPON` — and the report was that a locked chip tells you what it costs and
   * never what you have paid. Two of those three are worse than they look: `12 MORE KILLS`
   * is a *distance*, so the same chip reads the same at 0 kills of 12 and at 88 of 100, and
   * the camo line is authored prose with no number in it at all.
   *
   * So every requirement below is now `have / need`, in the same shape the challenge list
   * has always used, and `scripts/check-unlocks.mjs` refuses one that is not — a category
   * that grows a gate and prints only its target is the round-four defect (B7) told the
   * other way round: the number reaches the screen, and it is the wrong number.
   *
   * **One of these per gated category, and the editor asks for all of them** (playtest round
   * 4, B7). The report was *"the gas grenade shows no unlock level"* — SMOKE, whose row in
   * `EQUIPMENT_UNLOCK_LEVEL` has said 3 since M6. The table was never the problem: there was
   * no `equipmentRequirement` to ask, so `LoadoutEditor` passed the literal `'LOCKED'` and the
   * level the gate was enforcing never reached the screen. Semtex and the claymore had exactly
   * the same hole, and perks and field upgrades were reading `unlockLevel` off the def
   * themselves — three ways of answering one question, one of which answered nothing.
   *
   * They all live here now, beside the predicates they are the explanation for, so a gate and
   * its caption cannot say different things. `scripts/check-unlocks.mjs` fails if a category
   * gains a gate without one, or if the editor stops asking.
   */
  weaponRequirement(weaponId: string): string {
    if (this.weaponUnlocked(weaponId)) return '';
    return levelProgressLabel(this.level, requireWeapon(weaponId).unlockLevel);
  }

  attachmentRequirement(weaponId: string, attachment: AttachmentId): string {
    if (this.attachmentKillsRemaining(weaponId, attachment) === 0) return '';
    const kills = this.weapons[weaponId]?.kills ?? 0;
    return progressLabel(kills, ATTACHMENT_KILL_THRESHOLDS[attachment], 'KILLS');
  }

  equipmentRequirement(id: EquipmentId): string {
    if (this.equipmentUnlocked(id)) return '';
    return levelProgressLabel(this.level, equipmentUnlockLevel(id));
  }

  perkRequirement(id: PerkId): string {
    if (this.perkUnlocked(id)) return '';
    return levelProgressLabel(this.level, perkDef(id).unlockLevel);
  }

  fieldUpgradeRequirement(id: FieldUpgradeId): string {
    if (this.fieldUpgradeUnlocked(id)) return '';
    return levelProgressLabel(this.level, fieldUpgradeDef(id).unlockLevel);
  }

  /**
   * Camos are earned by a challenge rather than by a level, so the chip is the challenge.
   *
   * This used to quote `CamoDef.requirement` — the authored prose the picker's blurb already
   * carries — which meant the chip repeated the line under it and neither of them said how
   * far along the player was. It reads the **rule** now (`camoRequirementOf`), so the number
   * on the chip is the number the tracker is counting towards and cannot drift from it.
   *
   * OBSIDIAN is the one that counts camos instead of kills, and it counts the ones **this
   * weapon** owns: since 2026-09-23 a camo belongs to the weapon that earned it, so a rifle
   * with four finishes and a pistol with one are 4 / 5 and 1 / 5, which is the whole point
   * of that change said on a chip.
   */
  camoRequirement(weaponId: string, id: CamoId): string {
    if (this.camoUnlocked(weaponId, id)) return '';
    const need = camoRequirementOf(id);
    const stats = this.weapons[weaponId];
    const have =
      need.stat === null
        ? CAMO_PREREQUISITES.filter((pre) => stats?.camos[pre] === true).length
        : (stats?.[need.stat] ?? 0);
    return progressLabel(have, need.target, need.unit);
  }

  /** Everything a token could still be spent on, for the prestige screen. */
  tokenCandidates(): string[] {
    const out: string[] = [];
    for (const def of Object.values(WEAPON_DEFS)) {
      if (!this.weaponUnlocked(def.id)) out.push(def.id);
    }
    for (const id of PERK_IDS) {
      if (!this.perkUnlocked(id)) out.push(id);
    }
    for (const eq of ALL_EQUIPMENT) {
      if (!this.equipmentUnlocked(eq.id)) out.push(eq.id);
    }
    for (const id of FIELD_UPGRADE_IDS) {
      if (!this.fieldUpgradeUnlocked(id)) out.push(id);
    }
    return out;
  }

  /** Human label for a token candidate id. */
  static labelFor(id: string): string {
    const weapon = WEAPON_DEFS[id];
    if (weapon !== undefined) return weapon.name;
    for (const perk of PERK_IDS) {
      if (perk === id) return perkDef(perk).name;
    }
    for (const eq of ALL_EQUIPMENT) {
      if (eq.id === id) return eq.name;
    }
    for (const upgrade of FIELD_UPGRADE_IDS) {
      if (upgrade === id) return fieldUpgradeDef(upgrade).name;
    }
    return id;
  }
}

/** Attachments are unlocked per weapon, so a token has to name the pair. */
function attachmentKey(weaponId: string, attachment: AttachmentId): string {
  return `${weaponId}:${attachment}`;
}

/**
 * `have / need UNIT`, the one shape every locked chip prints (§6, 2026-09-24).
 *
 * Clamped at the top, because a counter can pass a bar that another condition is still
 * holding shut — a permanent unlock spent elsewhere, an attachment granted explicitly — and
 * `31 / 25 KILLS` on a locked chip reads as a bug in the gate rather than as the gate being
 * about something else.
 *
 * One function so the spacing is one decision: `18 / 25 KILLS` and `LEVEL 9 / 16` are the
 * same sentence with the noun in different places, and the challenge list's `18 / 25` is
 * where both of them get their rhythm.
 */
function progressLabel(have: number, need: number, unit: string): string {
  return `${Math.max(0, Math.min(have, need))} / ${need} ${unit}`;
}

/** The same, for the four gates that are an account level. */
function levelProgressLabel(level: number, need: number): string {
  return `LEVEL ${Math.max(0, Math.min(level, need))} / ${need}`;
}

/**
 * Force a loadout to be legal, reporting everything it had to change.
 *
 * Acceptance criterion 5 in one function. Every path into a match goes through it: load,
 * every editor edit, and `Game.buildWorld`. Editing `localStorage` to name a locked
 * weapon therefore cannot put that weapon in the player's hands — the equipped loadout is
 * a sanitised one, and the reversion is reported rather than silent.
 */
export function sanitiseLoadout(slot: LoadoutSlot, unlocks: UnlockState, losses: string[]): boolean {
  let changed = false;
  const label = slot.name;

  const fixWeapon = (which: 'primary' | 'secondary'): void => {
    const entry = slot[which];
    if (!unlocks.weaponUnlocked(entry.weaponId)) {
      const was = entry.weaponId;
      entry.weaponId = which === 'primary' ? FALLBACK_PRIMARY : FALLBACK_SECONDARY;
      entry.attachments = [];
      losses.push(
        `${label} ${which} "${was}" is locked (${unlocks.weaponRequirement(was)}); reverted to ${entry.weaponId}`,
      );
      changed = true;
      return;
    }
    const def = requireWeapon(entry.weaponId);
    const kept: AttachmentId[] = [];
    for (const id of entry.attachments) {
      if (!fitsWeapon(def, id)) {
        losses.push(`${label} ${which}: ${attachmentDef(id).name} does not fit ${def.name}; removed`);
        changed = true;
        continue;
      }
      if (!unlocks.attachmentUnlocked(def.id, id)) {
        losses.push(
          `${label} ${which}: ${attachmentDef(id).name} not yet earned on ${def.name} ` +
            `(${unlocks.attachmentRequirement(def.id, id)}); removed`,
        );
        changed = true;
        continue;
      }
      kept.push(id);
    }
    // One attachment per slot. A save naming two optics is not something the editor can
    // produce, and honouring it would let a hand-edit stack the same multiplier twice.
    const bySlot = new Set<string>();
    entry.attachments = kept.filter((id) => {
      const key = attachmentDef(id).slot;
      if (bySlot.has(key)) {
        losses.push(`${label} ${which}: two attachments in the ${key} slot; kept the first`);
        changed = true;
        return false;
      }
      bySlot.add(key);
      return true;
    });
    if (entry.camo !== null && !unlocks.camoUnlocked(entry.weaponId, entry.camo)) {
      losses.push(`${label} ${which}: camo "${entry.camo}" not earned on ${entry.weaponId}; cleared`);
      entry.camo = null;
      changed = true;
    }
  };

  fixWeapon('primary');
  fixWeapon('secondary');

  // Overkill is the one rule that makes the secondary slot's *class* legal or not.
  const hasOverkill = slot.perks.includes('overkill');
  const secondary = requireWeapon(slot.secondary.weaponId);
  if (secondary.slot === 'primary' && !hasOverkill) {
    losses.push(`${label}: ${secondary.name} in the secondary slot needs OVERKILL; reverted`);
    slot.secondary.weaponId = FALLBACK_SECONDARY;
    slot.secondary.attachments = [];
    changed = true;
  }

  if (!unlocks.equipmentUnlocked(slot.lethal)) {
    losses.push(`${label}: lethal "${slot.lethal}" is locked; reverted to frag`);
    slot.lethal = 'frag';
    changed = true;
  }
  if (!unlocks.equipmentUnlocked(slot.tactical)) {
    losses.push(`${label}: tactical "${slot.tactical}" is locked; reverted to flashbang`);
    slot.tactical = 'flashbang';
    changed = true;
  }
  if (!unlocks.fieldUpgradeUnlocked(slot.fieldUpgrade)) {
    losses.push(`${label}: field upgrade "${slot.fieldUpgrade}" is locked; reverted to munitions`);
    slot.fieldUpgrade = 'munitions';
    changed = true;
  }

  for (let tier = 0; tier < 3; tier++) {
    const id = slot.perks[tier];
    if (id === null || id === undefined) continue;
    if (unlocks.perkUnlocked(id)) continue;
    losses.push(`${label}: ${perkDef(id).name} is locked (level ${perkDef(id).unlockLevel}); removed`);
    slot.perks[tier] = null;
    changed = true;
  }

  return changed;
}

/** What a locked slot falls back to. Both are `unlockLevel` 1 and cannot themselves fail. */
const FALLBACK_PRIMARY = 'ar_carbine';
const FALLBACK_SECONDARY = 'pistol_talon';

/** Everything unlocked exactly at this level, for the level-up flourish's caption. */
export function unlocksAtLevel(level: number): string[] {
  const out: string[] = [];
  for (const def of Object.values(WEAPON_DEFS) as WeaponDef[]) {
    if (def.unlockLevel === level) out.push(def.name);
  }
  for (const id of PERK_IDS) {
    if (perkDef(id).unlockLevel === level) out.push(perkDef(id).name);
  }
  for (const eq of ALL_EQUIPMENT) {
    if (equipmentUnlockLevel(eq.id) === level) out.push(eq.name);
  }
  for (const id of FIELD_UPGRADE_IDS) {
    if (fieldUpgradeDef(id).unlockLevel === level) out.push(fieldUpgradeDef(id).name);
  }
  return out;
}

/** Every attachment a weapon can take, in unlock order. Drives the editor's rows. */
export function attachmentsForWeapon(def: WeaponDef): AttachmentId[] {
  return ATTACHMENT_IDS.filter((id) => fitsWeapon(def, id)).sort(
    (a, b) => ATTACHMENT_KILL_THRESHOLDS[a] - ATTACHMENT_KILL_THRESHOLDS[b],
  );
}

