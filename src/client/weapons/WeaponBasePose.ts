/**
 * Where the weapon sits before any of the player's own motion is added.
 *
 * Two stages and one order between them. First the **aim**: the hip pose blended toward the
 * ADS pose, which is not a second set of tuned numbers but a landing — the weapon's own sight
 * point put on the camera's axis, so one tuned `adsY` serves twelve sight heights. Then the
 * **lowering**: sprint, tactical sprint, slide, swap and throw, all through the one `raise`
 * value that also gates firing, so the animation and the rule cannot disagree.
 *
 * Everything downstream — bob, drift, sway, recoil — is a small motion added on top of what
 * this file writes, which is why the arms are solved against this pose and not the final one.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type * as THREE from 'three';
import { clamp01, damp, DEG2RAD, lerp } from '../../shared/core/MathUtil';
import type { ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { WeaponModel } from './WeaponMesh';
import type { ViewmodelDrive } from './ViewmodelDrive';
import { easeInOutQuad } from './ViewmodelMotion';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * The pose a frame is building, in metres and degrees, mutated in place by each stage.
 *
 * One record, allocated once per animator and handed down the pipeline, because `update` runs
 * every frame on every weapon on screen and a literal per stage per frame is exactly the
 * allocation R7 forbids. Structurally it is also a `KnifePose` and a `GrenadePose`, which is
 * what lets a held item's blended keyframe go straight into `ViewmodelMotion.placeHeldItem`.
 */
export interface ViewmodelPose {
  x: number;
  y: number;
  z: number;
  /** Degrees, matching every pose constant in `ViewmodelConfig`. */
  pitch: number;
  yaw: number;
  roll: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * The sight height `ViewmodelConfig.adsY` was tuned against — the M2 carbine's.
 *
 * Every other weapon's ADS pose is derived from it by the difference in sight height, so
 * retuning `adsY` moves all twelve together and nothing has to be re-authored per weapon.
 */
const REFERENCE_SIGHT_HEIGHT = 0.0915;

/** How fast the weapon drops for a throw and comes back. Brisk: this is not a swap. */
const THROW_LOWER_RATE = 14;
//#endregion

// ====================================== CLASS HandsBase ======================================= \\
//#region Class HandsBase
/**
 * The one matrix a frame's arms are solved against, and the fact that it is **one**.
 *
 * The weapon composes into it, and then a knife, a grenade or the plate composes into the same
 * object. That sharing is not a convenience: it is the shipped behaviour, down to the defect
 * it carries — a plate posed after a grenade is solved against the grenade's matrix. See
 * BACKLOG #57 and the test that pins it. Keeping one object here is what makes that behaviour
 * visible instead of accidental.
 */
export class HandsBase {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** What `ViewmodelHands.update` is handed. Read it, never keep it. */
  readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly turn = new Quaternion();
  private readonly euler = new Euler();
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** From a pose in metres and degrees, at the given scale. */
  fromPose(pose: ViewmodelPose, scale: THREE.Vector3): Matrix4 {
    return this.matrix.compose(
      this.position.set(pose.x, pose.y, pose.z),
      this.turn.setFromEuler(this.euler.set(pose.pitch * DEG2RAD, pose.yaw * DEG2RAD, pose.roll * DEG2RAD)),
      scale,
    );
  }

  /** From a node already posed — a knife or a grenade, whose transform is the arm's target. */
  fromObject(node: THREE.Object3D): Matrix4 {
    return this.matrix.compose(node.position, this.turn.setFromEuler(node.rotation), node.scale);
  }
  //#endregion
}
//#endregion

// ==================================== CLASS WeaponBasePose ==================================== \\
//#region Class WeaponBasePose
export class WeaponBasePose {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Damped 0..1 throw lower. See `ViewmodelDrive.throwing`. */
  private throwPose = 0;
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  reset(): void {
    this.throwPose = 0;
  }

  /**
   * The sight point is what ADS lands on the camera axis, all three of it (playtest 3).
   *
   * `ads` is the eased pose fraction, which runs a little past 1 on the way in — the
   * overshoot is a picture of a weapon being brought up hard, and it belongs here rather than
   * in anything that decides where a bullet goes.
   */
  aim(pose: ViewmodelPose, model: WeaponModel, cfg: ViewmodelConfig, ads: number): void {
    const sight = model.sightPoint;
    const file = model.source === 'glb';
    // Irons whose line is not parallel to the bore turn the weapon onto it (playtest 6), and
    // the sight point is landed where that turn carries it rather than where it was: the turn
    // is about the root's origin, and the rear sight is well above it.
    const pitch = model.adsPitch;
    const cos = Math.cos(pitch * DEG2RAD);
    const sin = Math.sin(pitch * DEG2RAD);
    const sightY = sight.y * cos - sight.z * sin;
    const sightZ = sight.y * sin + sight.z * cos;
    pose.x = lerp(cfg.hipX, -sight.x, ads);
    // `adsY` was tuned against the carbine's sight line. A weapon whose sights sit higher
    // has to be held correspondingly lower for them to land on the screen centre, so the
    // difference is applied here rather than being a second tuned constant per weapon —
    // there is one ADS pose and twelve sight heights, not twelve poses (M5).
    const sightOffset = sightY - REFERENCE_SIGHT_HEIGHT;
    pose.y = lerp(cfg.hipY, cfg.adsY - sightOffset, ads);
    // Along the barrel a file is placed by its sight: the sight point lands
    // `adsSightDistance` in front of the eye, and the rest of the weapon falls where the
    // weapon's own proportions put it (playtest 3, findings 5 and 6). The primitives keep
    // `adsZ` and the spec's `adsOffsetZ`, the pose they were tuned in.
    const aimZ = file ? -model.adsSightDistance - sightZ : cfg.adsZ + model.adsOffsetZ;
    pose.z = lerp(cfg.hipZ, aimZ, ads);
    pose.pitch = lerp(cfg.hipPitch, pitch, ads);
    pose.yaw = lerp(cfg.hipYaw, 0, ads);
    pose.roll = lerp(cfg.hipRoll, 0, ads);
  }

  /**
   * Blend the aimed pose toward the lowered one: sprint, slide, swap, throw.
   *
   * A throw lowers the weapon the same way a swap does, through a damped factor so the gun
   * swings down and back rather than snapping. Folded into `raise` rather than handled
   * separately, because `raise` is already the one authority for the lowered pose.
   */
  lower(pose: ViewmodelPose, drive: ViewmodelDrive, cfg: ViewmodelConfig, dt: number): void {
    this.throwPose = damp(this.throwPose, drive.throwing ? 1 : 0, THROW_LOWER_RATE, dt);
    const effectiveRaise = clamp01(drive.raise) * (1 - this.throwPose);

    // `raise` is the sprint-to-fire value. Eased so the gun swings rather than slides,
    // but the timing is untouched: at raise = 1 it is exactly on the base pose.
    const lowered = easeInOutQuad(1 - effectiveRaise);
    if (lowered <= 0) return;
    if (drive.swapping || this.throwPose > 0.01) {
      this.putAway(pose, cfg, lowered);
      return;
    }
    this.carryAcrossBody(pose, drive, cfg, lowered);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * Put-away / take-out (S6.4): straight down and rolled out of frame, which reads as
   * "this weapon is going away" rather than "this weapon is being carried".
   */
  private putAway(pose: ViewmodelPose, cfg: ViewmodelConfig, lowered: number): void {
    pose.x = lerp(pose.x, cfg.swapX, lowered);
    pose.y = lerp(pose.y, cfg.swapY, lowered);
    pose.z = lerp(pose.z, cfg.swapZ, lowered);
    pose.pitch = lerp(pose.pitch, cfg.swapPitch, lowered);
    pose.yaw = lerp(pose.yaw, 0, lowered);
    pose.roll = lerp(pose.roll, cfg.swapRoll, lowered);
  }

  /** The sprint pose, with the tactical sprint's and the slide's extras stacked onto it. */
  private carryAcrossBody(pose: ViewmodelPose, drive: ViewmodelDrive, cfg: ViewmodelConfig, lowered: number): void {
    let sy = cfg.sprintY;
    let sp = cfg.sprintPitch;
    let sr = cfg.sprintRoll;
    if (drive.tacSprint) {
      sy += cfg.tacSprintExtraY;
      sp += cfg.tacSprintExtraPitch;
    }
    if (drive.slide) {
      sy += cfg.slideExtraY;
      sr += cfg.slideExtraRoll;
    }
    pose.x = lerp(pose.x, cfg.sprintX, lowered);
    pose.y = lerp(pose.y, sy, lowered);
    pose.z = lerp(pose.z, cfg.sprintZ, lowered);
    pose.pitch = lerp(pose.pitch, sp, lowered);
    pose.yaw = lerp(pose.yaw, cfg.sprintYaw, lowered);
    pose.roll = lerp(pose.roll, sr, lowered);
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** A pose record at rest, for an animator or a held item to build into. */
export function makeViewmodelPose(): ViewmodelPose {
  return { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
}
//#endregion
