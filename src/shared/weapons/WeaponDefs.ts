/**
 * Weapon data (brief S6.1). Plain objects, no subclass per weapon.
 *
 * M2 said "M5 adds eleven more entries to this file and writes no new classes to do it".
 * That held: the eleven new weapons are data, and the only new *code* in M5's weapon layer
 * is the pellet loop, the scope, the swap and the attachment resolver — none of which is a
 * subclass and all of which are driven from the fields below.
 *
 * The data itself moved to `defs/`, one file per class, because twelve authored recoil
 * patterns is four hundred lines of content on its own. This file is the schema, the
 * registry and the helpers.
 *
 * Angles are in degrees throughout, because that is the unit these get tuned in.
 * Conversion happens once, at the point of use.
 *
 * The debug panel's slider metadata and accessors live in `WeaponTuning.ts`, derived from
 * these types rather than hand-listed alongside them.
 */

import { Btn, isDown } from '../core/InputCommand';
import { ASSAULT_RIFLES } from './defs/assaultRifles';
import { LMGS } from './defs/lmgs';
import { PISTOLS } from './defs/pistols';
import { SHOTGUNS } from './defs/shotguns';
import { SMGS } from './defs/smgs';
import { SNIPERS } from './defs/snipers';

export type WeaponClass = 'AR' | 'SMG' | 'LMG' | 'MARKSMAN' | 'SNIPER' | 'SHOTGUN' | 'PISTOL' | 'LAUNCHER';

/** Which inventory slot a weapon occupies (S6.4). */
export type WeaponSlot = 'primary' | 'secondary';

export type AttachmentSlot =
  | 'optic'
  | 'muzzle'
  | 'barrel'
  | 'underbarrel'
  | 'magazine'
  | 'stock'
  | 'laser'
  | 'rearGrip';

/** One authored recoil step, degrees. +y is up, +x is right. */
interface RecoilKick {
  readonly x: number;
  readonly y: number;
}

export interface RecoilPattern {
  /** Authored per-shot kicks, cycling once the array ends (S6.2). */
  readonly kicks: readonly RecoilKick[];

  verticalScale: number;
  horizontalScale: number;
  /** The opening shot is punchier than the pattern alone; this scales only shot 1. */
  firstShotScale: number;
  /**
   * Fraction of each kick the camera takes back during recovery. The remainder is
   * permanent aim drift — the residual that makes a spray feel earned (S6.2).
   */
  recoverFraction: number;
  /** Exponential recovery rate toward the settled aim, per second. */
  recoverRate: number;
  /** Quiet time after the last shot before recovery starts, seconds. */
  recoverDelay: number;
  /** Aim-recoil multiplier while fully aimed down sights. */
  adsScale: number;

  /** Viewmodel kick, independent of the aim change (S6.2 ships both). */
  visualScale: number;
  /** Viewmodel kick attack time, seconds. Fast. */
  visualAttack: number;
  /** Viewmodel kick settle time, seconds. Slower. */
  visualSettle: number;
}

/** Random cone on top of the pattern, degrees of half-angle. */
export interface SpreadProfile {
  hipStand: number;
  hipMove: number;
  ads: number;
  /** Multiplier while crouched. */
  crouchScale: number;
  /** Multiplier while airborne. */
  airScale: number;
  /** Added per shot fired, degrees. */
  perShot: number;
  /** Ceiling on the per-shot bloom, degrees. */
  perShotMax: number;
  /** Bloom recovery, degrees per second. */
  recover: number;
}

/**
 * Synthesis parameters for this weapon's voice (S6.7).
 *
 * The three character controls the brief names — filter cutoff, body resonance and tail
 * length — are `bodyFreq`, `bodyQ` and `tailDecay`. `bodyRatio` and `tailFreq` were added
 * in M5: with twelve weapons sharing one synthesis path, a fixed sweep target and a fixed
 * tail cutoff made the big guns and the small guns converge on the same shape no matter
 * what the other numbers said.
 */
export interface WeaponVoice {
  level: number;
  /** Body noise band centre, Hz. The single biggest character control. */
  bodyFreq: number;
  bodyQ: number;
  bodyDecay: number;
  /** Where the body sweeps down to, as a fraction of `bodyFreq`. */
  bodyRatio: number;
  /** Tail length, seconds. Long tails read as big rooms and big calibres. */
  tailDecay: number;
  tailLevel: number;
  /** Tail low-pass starting cutoff, Hz. Bright tails crack, dark tails boom. */
  tailFreq: number;
  clickFreq: number;
  clickLevel: number;
  thumpFreq: number;
  thumpLevel: number;
  /** Reverb send, 0..1. */
  wet: number;
}

/**
 * A telescopic sight (S6.1, snipers).
 *
 * Present only on weapons that have one. Everything else aims with irons or a red dot and
 * uses `adsTime` alone.
 */
export interface ScopeProfile {
  /** Idle breath sway amplitude at full scope, degrees. */
  swayDeg: number;
  /** Breath cycles per second. */
  swayRate: number;
  /** Seconds of held breath available from full. */
  breathSeconds: number;
  /** Seconds to refill the breath meter from empty. */
  breathRecovery: number;
  /** Sway multiplier while the breath is held. */
  breathHoldScale: number;
  /** Magnification, for the FOV pull and the scope overlay. */
  magnification: number;
  /** Whether the objective lens throws a glint an enemy can see. */
  glint: boolean;
}

/**
 * The most rays one trigger pull may send.
 *
 * The shotgun's 8 is the only value above 1 in the shipped table, but `pellets` is writable —
 * the M5 tuning panel moves it live — and it is the denominator of every accuracy figure in
 * the game, so the number that bounds it lives beside the field rather than inside the one
 * subsystem that happened to need it first. `WeaponSystem` clamps the fire loop to it, and
 * `combat/ShotAccounting` clamps everything that counts what came out.
 */
export const MAX_PELLETS = 16;

export interface WeaponDef {
  id: string;
  name: string;
  class: WeaponClass;
  slot: WeaponSlot;

  damage: { near: number; far: number };
  /** Metres. Damage is `near` at or below `start` and `far` at or beyond `end`. */
  damageFalloff: { start: number; end: number };
  headshotMult: number;
  limbMult: number;
  /**
   * Multiplier for a hit on the chest specifically, as opposed to the abdomen.
   *
   * M2 had one torso zone and one multiplier of exactly 1, and every M2 number was verified
   * against that. This is added rather than substituted: 1.0 reproduces M2 exactly, and only
   * the snipers move off it — which is the whole of "one-shot to upper torso" (S6.1).
   */
  upperTorsoMult: number;

  rpm: number;
  magSize: number;
  reserveAmmo: number;
  reloadTime: number;
  reloadEmptyTime: number;
  /** Seconds from ADS press to fully aimed. */
  adsTime: number;
  /** Sprint-to-fire, seconds. A core balance lever (S6.6). */
  sprintOutTime: number;
  /**
   * How fast the body carrying this weapon **in its hands** moves, as a multiple of the
   * movement config (2026-09-28). Every ground speed — walk, sprint, tac-sprint, crouch, aimed
   * walk — and never the slide, which is committed and one length for everybody.
   *
   * The carbine is 1.00, so every movement number measured since M1 still describes it. The
   * table, checked against the series: SMG, pistol and shotgun 1.05, rifles 1.00, the light sniper
   * 0.95, the heavy one and the LMGs 0.90 — the same order as CoD4 (1.0 / 0.95 / 0.875) and MW3
   * (1.0 / 0.9 / 0.8), and a 17% gap between the fastest and slowest class, between theirs. A
   * required field so a new weapon cannot ship without an answer. Composed with the perks'
   * `speedScale` in `PlayerController`, never written into it — see `weaponSpeedScale` there.
   */
  moveSpeedMult: number;
  /**
   * The same, while the trigger is held — for a weapon whose firing is itself the weight. Absent
   * for everything but the minigun. Read off the command's fire bit rather than off the weapon's
   * state, so the prediction replay and the server arrive at it from the same fact.
   */
  moveSpeedMultFiring?: number;
  /** Seconds to bring this weapon up when swapped to (S6.4). */
  swapInTime: number;
  /** Seconds to put this weapon away when swapping off it. */
  swapOutTime: number;

  /**
   * Hitscan rays per trigger pull. 1 for everything but the shotgun, which fires 8 and
   * resolves each one against the hitbox rig separately (S6.1).
   *
   * Capped at `MAX_PELLETS` wherever it is read, because the tuning panel writes this field
   * live and the wire carries the connected count in six bits.
   */
  pellets: number;
  /** Extra cone applied to pellets 2..n, degrees of half-angle. 0 for a single ray. */
  pelletSpread: number;

  spread: SpreadProfile;
  recoil: RecoilPattern;

  /** Penetration budget, in metres of poured concrete. See world/maps/materials.ts. */
  penetration: number;
  /** Absent = hitscan (S4.4). Only launchers and thrown equipment set this. */
  projectileSpeed?: number;

  unlockLevel: number;
  attachmentSlots: AttachmentSlot[];

  // -- extensions beyond the S6.1 list, all feel numbers ------------------
  /** World FOV multiplier at full ADS. */
  adsFovScale: number;
  /** Viewmodel FOV multiplier at full ADS. */
  adsViewmodelFovScale: number;
  /** Fraction of shots that draw a tracer (S6.5 asks for roughly 1 in 3). */
  tracerFraction: number;
  /** Camera shake trauma added per shot, 0..1. */
  shakePerShot: number;
  /** Muzzle rise felt as a kick on the weapon's own axis; scales the flash too. */
  muzzleFlashScale: number;

  /** False once a suppressor is fitted: firing stops pinging the minimap (S6.2). */
  minimapPing: boolean;
  /** True once a laser is fitted: the dot is visible to enemies while aimed (S6.2). */
  laserVisible: boolean;

  scope?: ScopeProfile;

  /**
   * This weapon throws a **cone of fire** instead of a ray (2026-09-26). Absent for every
   * weapon anybody can equip; present on exactly one killstreak.
   *
   * It is a field on the def rather than a `WeaponClass`, because a class is what a weapon *is*
   * to a loadout — a picker groups by it, a camo challenge counts by it, `rigLayoutFor` reads
   * it — and a flamethrower is none of those things. What this changes is one branch in
   * `fireOne`: what a shot *does*. Everything around it stays: the trigger, the fuel in the
   * magazine, the dry click, the HUD's counter, the killfeed's attribution.
   */
  flame?: FlameProfile;

  /**
   * This weapon carries a **riot shield in the other hand** (2026-09-27).
   *
   * Like `flame`, a field rather than a class: what it changes is not what the weapon fires but
   * what happens to damage aimed at whoever is holding it, and that decision is made at the one
   * damage door. `DamageSystem.shieldOf` is how the door finds this — the weapon is never read
   * from the inventory by the door, because a shield is a fact about a *body* and both runtimes
   * already ask which body is holding which carried streak every tick.
   */
  shield?: ShieldProfile;

  /**
   * This weapon **cannot be aimed down** (2026-09-27).
   *
   * Set on the minigun, and so far only there. Until now "no sights" was said by leaving
   * `adsFovScale` and `adsViewmodelFovScale` at 1, which made aiming do nothing *visible* —
   * but `adsFraction` still ran up to 1 on the trigger, so the gun still swung to the eye, the
   * spread still took its ADS value, and the recoil still took `adsScale`. A weapon fired from
   * the hip because it has no sights should not have an aimed pose at all.
   *
   * Read in `WeaponBase.stepAds`, which is the one place `adsFraction` is allowed to move, so
   * the whole chain below it — spread, recoil, the FOV, the viewmodel's ADS blend, the
   * `WeaponAdsChanged` event — sees a weapon that is never aimed rather than each having to
   * ask. Both runtimes step the same function, so this cannot make them disagree.
   */
  noAds?: boolean;

  /**
   * The damage arrives as a **blast** rather than along a line (2026-09-27).
   *
   * True for the grenades and for a mortar shell; false, and absent, for every bullet, pellet,
   * blade and jet in the game. It is a property of the weapon rather than of the shot because
   * nothing about a frag stops being an explosion depending on who threw it.
   *
   * The riot shield is the first thing that asks: a wall in front of you stops a bullet and does
   * not stop a pressure wave, so a blast is halved where a bullet is refused.
   */
  explosive?: boolean;

  voice: WeaponVoice;
}

/**
 * A continuous jet: how far it reaches, how wide it opens, and what it leaves behind.
 *
 * Range and falloff are **not** duplicated here — `damageAtRange` already reads
 * `damageFalloff`, and a second distance term would be two rules about the same metre. What is
 * here is only what a ray has no answer for.
 */
export interface FlameProfile {
  /** Metres the jet reaches. Beyond it, nothing is touched. */
  readonly rangeM: number;
  /** Half-angle of the cone, degrees: the jet opens to twice this. */
  readonly halfAngleDeg: number;
  /** Seconds a body keeps burning after it was last touched by the jet. */
  readonly burnSeconds: number;
  /** Damage per second while burning, applied on the sim tick by `BurnSystem`. */
  readonly burnDps: number;
}

/**
 * A wall the width of a body, held in front of it.
 *
 * Two numbers, because a shield is two decisions: **how much of the world is behind it**, and
 * **what it cannot stop**. Everything else the shield does — that it lasts twenty seconds, that
 * it dies with its owner, that it leaves a pistol in the other hand — is the killstreak's, not
 * the profile's.
 *
 * The arc is measured from the body's facing on the horizontal plane only. A shield does not
 * care whether the shot came from a rooftop or a stairwell; it cares whether the body turned
 * towards it, which is the decision the player is actually making.
 */
export interface ShieldProfile {
  /**
   * Half-angle of the protected arc, degrees. The shield covers twice this, centred on the
   * body's facing; anything outside it arrives as if there were no shield at all.
   */
  readonly halfAngleDeg: number;
  /**
   * What a blast still costs through the shield, 0..1 — the one thing it does not refuse
   * outright. A bullet, a pellet, a blade and a jet inside the arc are all stopped whole.
   */
  readonly blastRetain: number;
}

/**
 * The arsenal (S6.1). Twelve weapons across five classes plus a sidearm.
 *
 * Order is the order they appear in the debug picker and the range read-out, which is
 * class by class rather than by power.
 */
export const ALL_WEAPONS: readonly WeaponDef[] = [
  ...ASSAULT_RIFLES,
  ...SMGS,
  ...SHOTGUNS,
  ...LMGS,
  ...SNIPERS,
  ...PISTOLS,
];

export const WEAPON_DEFS: Readonly<Record<string, WeaponDef>> = Object.fromEntries(
  ALL_WEAPONS.map((def) => [def.id, def]),
);

/** The AR the project has shipped since M2. Still the baseline every other gun is read against. */
export const AR_DEFAULT: WeaponDef = requireWeapon('ar_carbine');

/** The default secondary. Every loadout carries one. */
export const PISTOL_DEFAULT: WeaponDef = requireWeapon('pistol_talon');

export function requireWeapon(id: string): WeaponDef {
  const def = WEAPON_DEFS[id];
  if (def === undefined) throw new Error(`Unknown weapon id "${id}"`);
  return def;
}

export function cloneWeaponDef(src: WeaponDef): WeaponDef {
  const out: WeaponDef = {
    ...src,
    damage: { ...src.damage },
    damageFalloff: { ...src.damageFalloff },
    spread: { ...src.spread },
    recoil: { ...src.recoil, kicks: src.recoil.kicks },
    attachmentSlots: [...src.attachmentSlots],
    voice: { ...src.voice },
  };
  if (src.scope !== undefined) out.scope = { ...src.scope };
  return out;
}

/**
 * The movement multiplier a body gets from the weapon in its hands this tick — the one function
 * every runtime asks, just before `PlayerController.step`, with the command about to be stepped.
 *
 * It is `buttons` and not the weapon's firing state for the reason the field gives: a client
 * replaying a correction has the command but not the weapon (`Prediction` never replays it), and
 * a speed read off the weapon would be a speed the replay cannot reproduce.
 */
export function heldMoveScale(def: WeaponDef, buttons: number): number {
  if (def.moveSpeedMultFiring !== undefined && isDown(buttons, Btn.Fire)) return def.moveSpeedMultFiring;
  return def.moveSpeedMult;
}

/** Seconds between shots. */
export function shotInterval(def: WeaponDef): number {
  return 60 / Math.max(def.rpm, 1);
}
