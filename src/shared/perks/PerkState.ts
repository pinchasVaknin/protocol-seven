/**
 * A loadout's three perks, resolved.
 *
 * Two outputs, because perks do two different kinds of thing:
 *
 * **`weaponEffects`** is a list of `AttachmentEffects` handed straight to
 * `resolveWeaponDef` alongside the attachments. Quickdraw, Sleight of Hand and Amped go
 * through the identical multiplication chain a foregrip does, which is what makes the
 * loadout editor's numbers and the gameplay's numbers the same numbers by construction —
 * acceptance criterion 3.
 *
 * **`PerkState`** is everything a weapon field cannot express. It is a plain readonly
 * record with sensible neutrals, so "no perks" is a real state rather than a null check
 * at every consumer: `NO_PERKS` has a speed multiplier of 1, audible footsteps and full
 * flash intensity, which is exactly what M1-M5 already did.
 *
 * Nothing here mutates anything. `resolvePerkState` reads the defs and returns a new
 * object; two loadouts holding the same perk cannot interfere.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { AttachmentEffects } from '../weapons/Attachments';
import { perkDef, type PerkId, type PerkStateEffects } from './PerkDefs';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface PerkState {
  readonly perks: readonly PerkId[];
  /** Ground speed cap multiplier. 1 is the M1 behaviour. */
  readonly moveSpeedMult: number;
  /** False when footsteps must not reach the bots' noise field. */
  readonly audibleFootsteps: boolean;
  /** Multiplies incoming flash intensity. 1 is the M5 behaviour. */
  readonly flashResistMult: number;
  readonly scavenger: boolean;
  readonly tracker: boolean;
  readonly overkill: boolean;
  /** Inert until M7. False once Ghost is equipped. */
  readonly visibleToUav: boolean;
  /** Inert until M7. False once Cold-Blooded is equipped. */
  readonly targetedByStreaks: boolean;
  /** Inert until M7. Kills subtracted from every streak requirement. */
  readonly streakDiscount: number;
}

/**
 * The accumulator `resolvePerkState` folds into.
 *
 * Two of the nine are stored as the perk states them — `ghost`, `coldBlooded` — and inverted on
 * the way out, because `PerkState` holds the *absence* (`visibleToUav`) while a perk declares
 * the presence. Keeping the fold in the perk's own vocabulary is what makes `foldPerkEffects`
 * field-for-field with `PerkStateEffects`.
 */
interface PerkFold {
  moveSpeedMult: number;
  audibleFootsteps: boolean;
  flashResistMult: number;
  scavenger: boolean;
  tracker: boolean;
  overkill: boolean;
  ghost: boolean;
  coldBlooded: boolean;
  streakDiscount: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
export const NO_PERKS: PerkState = {
  perks: [],
  moveSpeedMult: 1,
  audibleFootsteps: true,
  flashResistMult: 1,
  scavenger: false,
  tracker: false,
  overkill: false,
  visibleToUav: true,
  targetedByStreaks: true,
  streakDiscount: 0,
};
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Fold a perk list into one state.
 *
 * Multipliers compose by multiplication and flags by OR, so two perks touching the same
 * quantity stack. Nothing in the shipped twelve overlaps, and the composition rule is
 * still the right one — a field upgrade or a killstreak granting a temporary speed boost
 * has somewhere to go that does not overwrite Lightweight.
 */
export function resolvePerkState(ids: readonly PerkId[]): PerkState {
  if (ids.length === 0) return NO_PERKS;

  const fold = blankFold();
  for (const id of ids) foldPerkEffects(fold, perkDef(id).state);

  return {
    perks: [...ids],
    moveSpeedMult: fold.moveSpeedMult,
    audibleFootsteps: fold.audibleFootsteps,
    flashResistMult: fold.flashResistMult,
    scavenger: fold.scavenger,
    tracker: fold.tracker,
    overkill: fold.overkill,
    visibleToUav: !fold.ghost,
    targetedByStreaks: !fold.coldBlooded,
    streakDiscount: fold.streakDiscount,
  };
}

/**
 * The perks' weapon-side modifiers, in perk order.
 *
 * Returned as a list rather than pre-folded because `resolveWeaponDef` applies
 * attachments in a fixed order for reproducibility and perks have to join that same
 * chain; folding them here would put the multiplication in two places.
 */
export function perkWeaponEffects(ids: readonly PerkId[]): AttachmentEffects[] {
  const out: AttachmentEffects[] = [];
  for (const id of ids) {
    const fx = perkDef(id).weapon;
    // An empty effects record would still cost a pass through the applier. Most perks
    // have one, so skipping them is the common case rather than a micro-optimisation.
    if (Object.keys(fx).length > 0) out.push(fx);
  }
  return out;
}

/** Compact one-line description, for the debug panel and the editor's summary row. */
export function describePerkState(state: PerkState): string {
  if (state.perks.length === 0) return 'none';
  return state.perks.map((id) => perkDef(id).name).join(' · ');
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function blankFold(): PerkFold {
  return {
    moveSpeedMult: 1,
    audibleFootsteps: true,
    flashResistMult: 1,
    scavenger: false,
    tracker: false,
    overkill: false,
    ghost: false,
    coldBlooded: false,
    streakDiscount: 0,
  };
}

/**
 * Fold one perk's effects in.
 *
 * Multipliers compose by multiplication, flags by OR and the discount by addition — a count
 * rather than a scale. The order is the caller's `ids` order and the arithmetic is left exactly
 * as it was, because three Lightweights are 1.07 cubed and a reassociated product would not be.
 */
function foldPerkEffects(fold: PerkFold, fx: PerkStateEffects): void {
  if (fx.moveSpeedMult !== undefined) fold.moveSpeedMult *= fx.moveSpeedMult;
  if (fx.silentFootsteps === true) fold.audibleFootsteps = false;
  if (fx.flashResistMult !== undefined) fold.flashResistMult *= fx.flashResistMult;
  if (fx.scavenger === true) fold.scavenger = true;
  if (fx.tracker === true) fold.tracker = true;
  if (fx.overkill === true) fold.overkill = true;
  if (fx.ghost === true) fold.ghost = true;
  if (fx.coldBlooded === true) fold.coldBlooded = true;
  if (fx.streakDiscount !== undefined) fold.streakDiscount += fx.streakDiscount;
}
//#endregion
