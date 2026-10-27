/**
 * Procedural viewmodel animation (brief S6.6). No imported animations; eased tweens,
 * never linear.
 *
 * This runs at render rate because none of it is gameplay — it reads the interpolated
 * weapon state and writes transforms. The one thing it is not allowed to do is *decide*
 * anything: `raise` comes from `WeaponBase` and is the same number that gates firing, so
 * the sprint-to-fire animation and the sprint-to-fire rule are the same value read twice.
 *
 * Everything composes additively on top of a base pose, so each channel can be tuned or
 * switched off in the debug panel without disturbing the others.
 *
 * ## What is where
 *
 * This file is the conductor and the surface. The stages live beside it, one per file, and
 * `update` is the order they run in — which is the only thing about them that is not local:
 *
 * | file | what it owns |
 * |---|---|
 * | `ViewmodelDrive.ts` | the record a frame hands in |
 * | `WeaponBasePose.ts` | hip → ADS by the sight point, then sprint / slide / swap / throw |
 * | `ReloadPose.ts` | the dip, the magazine, the support hand, the charging handle |
 * | `ViewmodelMotion.ts` | the player's own motion: the ADS curve, sway, bob, idle drift |
 * | `RecoilKick.ts` | the kick, and the sight picture it may not break |
 * | `KnifeSwingPose.ts` | the blade's three keyframes and the forearm |
 * | `GrenadeThrowPose.ts` | the throw's four keyframes, the pin, and when it leaves the hand |
 *
 * The shield stays here: it is the weapon's own pose written into a second object with a
 * second offset, and it needs the whole pose plus the base matrix to do it.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type * as THREE from 'three';
import { clamp01, DEG2RAD } from '../../shared/core/MathUtil';
import type { ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { WeaponModel } from './WeaponMesh';
import type { GrenadeModel } from './GrenadeMesh';
import type { ShieldModel } from './ShieldMesh';
import { SHIELD_PLATE_OFFSET_ID, viewmodelOffsetFor } from './HandPoses';
import type { ViewmodelHands } from './ViewmodelHands';
import type { ViewmodelDrive } from './ViewmodelDrive';
import { ViewmodelMotion } from './ViewmodelMotion';
import { HandsBase, WeaponBasePose, makeViewmodelPose, type ViewmodelPose } from './WeaponBasePose';
import { ReloadPose } from './ReloadPose';
import { RecoilKick } from './RecoilKick';
import { KnifeSwingPose, type KnifeSwing } from './KnifeSwingPose';
import { GrenadeThrowPose, type GrenadePose, type GrenadeThrow } from './GrenadeThrowPose';

/*
 * The surface this file has always had, kept whole where every caller already imports it.
 * `ClientMatch` takes the animator and the drive; the hand tuner takes the two pose tables,
 * their source printers and the throw's two fractions; the tests take `sightPivotShift`. Each
 * name now lives with the stage that poses it, and nothing about what a caller writes changes
 * — which is the one thing a split of this file was not allowed to do.
 */
export { makeViewmodelDrive, type ViewmodelDrive } from './ViewmodelDrive';
export { sightPivotShift } from './RecoilKick';
export { KNIFE_SWING, knifeSwingSource, type KnifePose, type KnifeSwing } from './KnifeSwingPose';
export {
  GRENADE_PIN_OUT,
  GRENADE_PULL_AT,
  GRENADE_THROW,
  GRENADE_WINDUP_AT,
  grenadeDriveAt,
  grenadeThrowFor,
  grenadeThrowSource,
  type GrenadePose,
  type GrenadeThrow,
} from './GrenadeThrowPose';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * A row of `VIEWMODEL_OFFSETS`, as this class holds it: mutable, because the hand tuner writes
 * into the one it is given rather than handing a new one back.
 */
interface ViewmodelOffset {
  position: [number, number, number];
  rotation: [number, number, number];
}
//#endregion

// ==================================== CLASS ViewmodelAnim ===================================== \\
//#region Class ViewmodelAnim
export class ViewmodelAnim {
  // ========================================== STATIC ========================================== \\
  //#region Static
  /**
   * How far through the throw the hand is, 0..1, from the simulation's two numbers.
   *
   * The same function object `GrenadeThrowPose` poses from, not a call through to it: the hand
   * tuner reaches it by this name and has done since before the throw had a file of its own.
   */
  static readonly throwFraction = GrenadeThrowPose.throwFraction;
  //#endregion

  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly motion = new ViewmodelMotion();
  private readonly basePose = new WeaponBasePose();
  private readonly reload = new ReloadPose();
  private readonly kick = new RecoilKick();
  private readonly knives = new KnifeSwingPose();
  private readonly grenades = new GrenadeThrowPose();
  /** The pose this frame is building, metres and degrees. One record, never a literal (R7). */
  private readonly pose = makeViewmodelPose();
  /** The one matrix a frame's arms are solved against. Shared on purpose; see BACKLOG #57. */
  private readonly handsBase = new HandsBase();

  private model: WeaponModel;
  private shield: ShieldModel | null = null;
  private primed = false;

  /**
   * The swing this animator poses, its own copy of `KNIFE_SWING`.
   *
   * The collaborator's own object rather than a copy of it: the hand tuner
   * (`probes/hand-tuner.html`) edits these three keyframes live, on the real pipeline, and it
   * reaches them through this field. Handing out the same object is what keeps the tuner's
   * slider and the pose it changes the same thing.
   */
  readonly knifeSwing: KnifeSwing = this.knives.swing;
  /** The throw this animator poses, and the pin's travel. The tuner's, exactly as above. */
  readonly grenadeThrow: GrenadeThrow = this.grenades.table;
  readonly grenadePinOut: GrenadePose = this.grenades.pinOut;

  /**
   * This weapon's correction on the shared hip pose, read once when the animator is built.
   *
   * Live rather than frozen for the hand tuner's sake: the tuner replaces this object's
   * contents as the sliders move, and a copy taken per frame would be a lookup in the hot
   * path for a number that changes once a session in a match.
   */
  readonly offset: ViewmodelOffset = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
  /**
   * The shield's own place on screen, read when it is handed over.
   *
   * Separate from `offset` because the weapon under `this.model` in shield mode is **not the
   * shield** — it is the pistol the killstreak gives you with it, or, in the hand tuner, a
   * hidden carbine standing in. Reading one offset for both put the plate wherever the pistol
   * was told to go, which is exactly on top of the pistol.
   */
  readonly shieldOffset: ViewmodelOffset = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(model: WeaponModel) {
    this.model = model;
    // Copied rather than referenced: the tuner writes into this object as its sliders move,
    // and the table it came from is the shipped constant every other instance reads.
    const shipped = viewmodelOffsetFor(model.weaponId);
    this.offset.position = [...shipped.position] as [number, number, number];
    this.offset.rotation = [...shipped.rotation] as [number, number, number];
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Attach the grenade being thrown, or null for none.
   *
   * Called when a throw starts rather than once per match, because which grenade is in the
   * hand is the loadout's lethal or its tactical and the player chooses per throw.
   */
  setGrenade(grenade: GrenadeModel | null): void {
    this.grenades.set(grenade);
  }

  /**
   * The shield this animator is carrying, or null.
   *
   * Set the same way the knife and the grenade are, and for the same reason: all three are
   * held without being weapons, so the weapon under `this.model` is a stand-in and the thing
   * the player actually sees has to be handed over separately.
   */
  setShield(shield: ShieldModel | null): void {
    this.shield = shield;
    if (shield === null) return;
    const shipped = viewmodelOffsetFor(SHIELD_PLATE_OFFSET_ID);
    this.shieldOffset.position = [...shipped.position] as [number, number, number];
    this.shieldOffset.rotation = [...shipped.rotation] as [number, number, number];
  }

  /** Attach the knife viewmodel and its forearm. Called once per match; null unsets them. */
  setKnife(knife: THREE.Object3D | null, arm: THREE.Object3D | null = null, hands: ViewmodelHands | null = null): void {
    this.knives.set(knife, arm, hands);
  }

  /**
   * Swap the weapon being posed — a slot change, or a streak arriving in the hands.
   *
   * A swap changes which mesh is on screen, and every pose this class writes is written into
   * that mesh's transforms, so the animator moves with it rather than each weapon owning one.
   * The pose state itself carries over deliberately: sway and the idle phase belong to the
   * *hands*, and resetting them on a swap would make every weapon arrive perfectly still.
   *
   * The offset is re-read here and not only in the constructor (2026-09-27). One animator lives
   * for the whole match and every weapon passes through it, so a table read once at
   * construction is the *first* weapon's row applied to all of them: the minigun's placement
   * never reached the minigun, because the animator had been built around the primary before
   * the streak existed. Every other per-weapon fact this class uses comes off `this.model`
   * on the frame it is needed; this one could not, because the tuner writes into it.
   */
  setModel(model: WeaponModel): void {
    this.model = model;
    const shipped = viewmodelOffsetFor(model.weaponId);
    this.offset.position = [...shipped.position] as [number, number, number];
    this.offset.rotation = [...shipped.rotation] as [number, number, number];
  }

  /** The sight height of the weapon currently posed, so ADS can cancel it. */
  get sightHeight(): number {
    return this.model.sightHeight;
  }

  reset(yaw: number, pitch: number): void {
    this.motion.reset(yaw, pitch);
    this.basePose.reset();
    this.primed = true;
  }

  /**
   * One frame, in the order the stages have always run in.
   *
   * `dt` is a real frame delta: this is presentation, not simulation. It is clamped at both
   * ends, because every follower below integrates it and a stalled tab hands in a second.
   */
  update(drive: ViewmodelDrive, cfg: ViewmodelConfig, dtRaw: number): void {
    const dt = Math.min(Math.max(dtRaw, 0), 1 / 20);
    if (!this.primed) this.reset(drive.yaw, drive.pitch);
    this.motion.advance(drive, cfg, dt);

    const pose = this.pose;
    const aimed = clamp01(drive.adsFraction);
    this.basePose.aim(pose, this.model, cfg, this.motion.ads);
    this.basePose.lower(pose, drive, cfg, dt);
    this.reload.apply(pose, this.model, drive, cfg);

    // The pose the arms are solved against (stage 4): everything above — hip to ADS, sprint,
    // swap, reload — and nothing below. Bob, idle drift, sway and recoil are small motions of
    // the whole gun-and-arms, and carrying the arms through them rigidly is what keeps a glove
    // on its grip and a sleeve out of the receiver; re-solving them against camera-fixed
    // shoulders swung the elbows 9–15 cm across the gun whenever the view turned.
    const base = this.handsBase.fromPose(pose, this.model.root.scale);

    this.motion.applyWeapon(pose, drive, cfg, aimed);
    this.kick.apply(pose, this.model, drive, cfg);

    /**
     * The weapon's own correction on the shared hip pose (`VIEWMODEL_OFFSETS`).
     *
     * Scaled out of ADS because ADS lands the weapon's sight point on the camera axis and a
     * constant added there would push it off by exactly that constant. See the table's own
     * comment; the minigun is why it exists.
     */
    const hipOnly = 1 - aimed;
    placeWithOffset(this.model.root, pose, this.offset, hipOnly);
    // The arms: solved against the base pose, carried through the rest with the gun.
    this.model.hands?.update(base);

    this.knives.pose(this.handsBase, this.motion, drive, cfg);
    this.grenades.pose(this.handsBase, this.motion, drive, cfg);
    // The plate takes the same base pose with **its own** offset on top, never the weapon's.
    this.poseShield(pose, hipOnly);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * The shield: placed where the weapon would be, and its one glove solved on it.
   *
   * It is not a weapon and does not go through `this.model` — the model in shield mode is a
   * hidden carbine standing in, because this class is built around a weapon and poses one
   * every frame. So the plate takes the same pose the gun just took, its own
   * `VIEWMODEL_OFFSETS` row on top (that row is the *only* way to place it, since a plate has
   * no sight to land and no hip pose of its own), and its hands are updated against the same
   * base the weapon's would have been.
   *
   * Without this the shield hung at the origin and neither it nor the hand answered a slider,
   * which is exactly what it looked like: a model that had been loaded and not connected.
   *
   * **The base it is handed is not always the weapon's** — a knife or a grenade posed just
   * above has composed its own into the shared matrix by now. That is the shipped behaviour
   * and a defect; see BACKLOG #57 and the test that pins it.
   */
  private poseShield(pose: ViewmodelPose, hipOnly: number): void {
    const shield = this.shield;
    if (shield === null) return;
    placeWithOffset(shield.root, pose, this.shieldOffset, hipOnly);
    shield.hands?.update(this.handsBase.matrix);
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** Write a pose onto a node, with a `VIEWMODEL_OFFSETS` row faded in by `hipOnly`. */
function placeWithOffset(node: THREE.Object3D, pose: ViewmodelPose, offset: ViewmodelOffset, hipOnly: number): void {
  node.position.set(
    pose.x + offset.position[0] * hipOnly,
    pose.y + offset.position[1] * hipOnly,
    pose.z + offset.position[2] * hipOnly,
  );
  node.rotation.set(
    (pose.pitch + offset.rotation[0] * hipOnly) * DEG2RAD,
    (pose.yaw + offset.rotation[1] * hipOnly) * DEG2RAD,
    (pose.roll + offset.rotation[2] * hipOnly) * DEG2RAD,
  );
}
//#endregion
