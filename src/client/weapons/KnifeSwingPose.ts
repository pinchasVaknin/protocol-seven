/**
 * The knife's own arc: three keyframes and the forearm aimed at the fist.
 *
 * Deliberately *not* an offset on the weapon pose the way the M8 bash was: the rifle is hidden
 * while this runs, so there is nothing to offset from, and a knife held in the other hand does
 * not inherit the rifle's ADS, reload or sprint poses. What it does inherit is the player's own
 * motion, which `ViewmodelMotion` adds — a blade that stayed perfectly still while the world
 * bobbed around it would read as a decal on the screen.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type * as THREE from 'three';
import { Vector3 } from 'three';
import { clamp01, lerp, smoothstep } from '../../shared/core/MathUtil';
import type { ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { ViewmodelDrive } from './ViewmodelDrive';
import type { ViewmodelHands } from './ViewmodelHands';
import type { ViewmodelMotion } from './ViewmodelMotion';
import { makeViewmodelPose, type HandsBase, type ViewmodelPose } from './WeaponBasePose';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface KnifePose {
  x: number;
  y: number;
  z: number;
  /** Degrees, matching every other pose constant in `ViewmodelConfig`. */
  pitch: number;
  yaw: number;
  roll: number;
}

/** The three keyframes by name, which is the shape the hand tuner edits and prints. */
export type KnifeSwing = Record<'ready' | 'windup' | 'strike', KnifePose>;
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * The knife swing: three poses and where they land in the swing (round 2).
 *
 * Post-M8 animated this as an offset on the *rifle's* pose, because there was no knife to
 * animate — the melee was a weapon bash. There is a blade now (`weapons/KnifeMesh.ts`), the
 * rifle is hidden for the duration, and the arc below is the knife's own.
 *
 * The two fractions are not free numbers: `Melee` runs a 0.12 s wind-up and a 0.42 s
 * recovery, so the strike tick lands at 0.12 / 0.54 = **0.222** through the swing, and
 * `STRIKE_AT` is that. Anything else and the blade would be somewhere other than extended on
 * the one frame the hitbox test runs — which is the whole contract between an animation and a
 * hit: what you saw is what was tested.
 *
 * `READY` is the lower right of frame. It is where the swing starts and ends, so the blade
 * enters and leaves rather than appearing, and — because the pose is a pure function of a
 * fraction that returns to zero — a swing cut short by a death or a respawn cannot leave the
 * knife stranded on screen.
 *
 * ## These are absolute poses, and round 2 wrote them as if they were offsets
 *
 * The bash they replaced was an *offset* on the rifle's pose, so its numbers were small
 * displacements around a weapon already sitting at `hipZ = -0.33`. The first knife keyframes
 * kept that scale and lost the base, which put the whole wind-up half of the swing outside the
 * viewmodel frustum: at 65° vertical, `READY` sat 13x the half-width off the right edge and
 * `WINDUP` was at **positive Z — behind the camera**. Only the strike instant was ever
 * rasterised, which is exactly the "barely visible" report.
 *
 * ## What the poses below are, measured (2026-09-24)
 *
 * They were re-posed in the hand tuner once the gloved hand was on the handle, and the frame
 * they make is not the one the box fist made. At the viewmodel's 65° and 16:9:
 *
 * - **READY** is 0.36 m deep, and the fist sits 69% of the way to the right edge — in frame,
 *   blade down and across, which is the pose the swing starts and ends on.
 * - **WIND-UP** is 0.245 m deep and the fist is **off frame**, up and to the right (146% of the
 *   half-width, 154% of the half-height). Deliberate, and the change from round 2: the blade
 *   sweeps out of the corner and back through the middle, so the strike arrives from somewhere
 *   rather than growing out of the centre. It lasts 70 ms.
 * - **STRIKE** is 0.68 m deep and 3% off centre: the arm is thrown out straight down the middle
 *   of the view. That is further than the arm is long — 1.09 m from the shoulder against a
 *   0.60 m reach — so `solveArm` slides the shoulder forward to meet it, which is what it is
 *   built to do and what makes the pose read as a lunge rather than a wrist flick.
 */
const WINDUP_AT = 0.13;
const STRIKE_AT = 0.222;

/**
 * Lower right of frame, blade angled in across the view. Where the swing starts and ends.
 *
 * Re-posed by the human in the hand tuner (2026-09-24), with the gloved hand on the handle for
 * the first time: the three keyframes were authored around a box fist, and a hand with a wrist
 * and a forearm behind it wants the blade further out and pitched down rather than rolled over.
 */
const KNIFE_READY: KnifePose = { x: 0.28, y: -0.005, z: -0.36, pitch: -51, yaw: 6, roll: 8 };
/** Cocked back and up to the right, edge turned in. The tip leaves frame; the fist does not. */
const KNIFE_WINDUP: KnifePose = { x: 0.405, y: 0.24, z: -0.245, pitch: -40, yaw: 54, roll: 31 };
/**
 * Driven forward through the centre of the screen: the frame the hitbox test runs on.
 *
 * The yaw is what makes it read. At `yaw: 0` the blade points straight down -Z and the player
 * sees it end-on, which is a short bright line and nothing else; at 40° it sweeps across the
 * middle of the view broadside, which is the whole picture of a slash.
 */
const KNIFE_STRIKE: KnifePose = { x: -0.02, y: -0.05, z: -0.68, pitch: -62, yaw: 11, roll: 48 };

/** The shipped swing, and what a fresh `ViewmodelAnim` poses with. Copied, never handed out. */
export const KNIFE_SWING: Readonly<KnifeSwing> = { ready: KNIFE_READY, windup: KNIFE_WINDUP, strike: KNIFE_STRIKE };

/**
 * Where the forearm comes from. Behind the camera, low and to the right (round 4).
 *
 * Positive Z is *behind* the eye, which is the whole point: the elbow end of the arm is
 * always outside the near plane, so the arm enters frame from the bottom-right corner and
 * has no visible end. The player sees a forearm running off the edge of the screen, which is
 * what an arm attached to a body looks like from inside its own head.
 */
const KNIFE_SHOULDER = new Vector3(0.3, -0.45, 0.28);
/** The axis the forearm geometry is built along. See `KnifeMesh`. */
const ARM_AXIS = new Vector3(0, 0, -1);
//#endregion

// ==================================== CLASS KnifeSwingPose ==================================== \\
//#region Class KnifeSwingPose
export class KnifeSwingPose {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /**
   * The swing this poses, its own copy of `KNIFE_SWING`.
   *
   * A copy and public for one reason: the hand tuner (`probes/hand-tuner.html`) edits these
   * three keyframes live, on the real pipeline, exactly as it edits the hands' holds — and the
   * shipped table must not be what it writes into. A match never touches it.
   */
  readonly swing: KnifeSwing = {
    ready: { ...KNIFE_READY },
    windup: { ...KNIFE_WINDUP },
    strike: { ...KNIFE_STRIKE },
  };
  private knife: THREE.Object3D | null = null;
  /** The forearm, aimed from a fixed shoulder at the fist every frame. See `pose`. */
  private arm: THREE.Object3D | null = null;
  private hands: ViewmodelHands | null = null;
  /** Scratch for the arm's aim. Reused: this runs every frame of a swing. */
  private readonly fistAt = new Vector3();
  /** The blended keyframe, before the player's own motion is added to it. */
  private readonly blended: ViewmodelPose = makeViewmodelPose();
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** Attach the knife viewmodel and its forearm. Called once per match; null unsets them. */
  set(knife: THREE.Object3D | null, arm: THREE.Object3D | null, hands: ViewmodelHands | null): void {
    this.knife = knife;
    this.arm = arm;
    this.hands = hands;
  }

  /** Pose the blade for this frame, if this match built one. */
  pose(base: HandsBase, motion: ViewmodelMotion, drive: ViewmodelDrive, cfg: ViewmodelConfig): void {
    const knife = this.knife;
    if (knife === null) return;

    /**
     * No early-out at `t === 0`, and that is a fix rather than an oversight (round 3).
     *
     * `Melee.fraction` is exactly 0 on the first tick of a wind-up — the timer has not been
     * decremented yet — while `Melee.busy`, which is what `Match` shows the mesh on, is
     * already true. Skipping the pose on that tick left the knife on whatever transform it
     * last had, and on the first swing of a match that is the identity: the blade rendered
     * for one frame at the origin, which in viewmodel space is *inside the camera*. The
     * blend below reduces to exactly `KNIFE_READY` at 0, so posing unconditionally is both
     * correct and simpler than a special case.
     */
    const t = clamp01(drive.melee);
    this.blend(t);
    motion.placeHeldItem(knife, this.blended, drive, cfg);

    /**
     * With the arm rig there is no cylinder to aim: the hand is solved onto the handle and the
     * elbow falls where the arm's own lengths put it, exactly as it does on a rifle. The pose
     * the arm is solved against is the knife's own — position and turn as written above, and
     * the root's scale, so the frame's inverse takes `KNIFE_SCALE` back out and the glove is
     * life size on a knife that is not.
     */
    const hands = this.hands;
    if (hands !== null) {
      hands.update(base.fromObject(knife));
      return;
    }
    this.aimArm(knife);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** Which pair of keyframes `t` falls between, and how far. Writes `blended`. */
  private blend(t: number): void {
    const swing = this.swing;
    let from: KnifePose;
    let to: KnifePose;
    let k: number;

    if (t < WINDUP_AT) {
      from = swing.ready;
      to = swing.windup;
      k = smoothstep(0, WINDUP_AT, t);
    } else if (t < STRIKE_AT) {
      from = swing.windup;
      to = swing.strike;
      // Deliberately not smoothed on the way in: a slash accelerates into the target and the
      // 0.05 s between these two poses is the only part of the animation the player reads.
      k = (t - WINDUP_AT) / (STRIKE_AT - WINDUP_AT);
    } else {
      from = swing.strike;
      to = swing.ready;
      k = smoothstep(STRIKE_AT, 1, t);
    }

    const out = this.blended;
    out.x = lerp(from.x, to.x, k);
    out.y = lerp(from.y, to.y, k);
    out.z = lerp(from.z, to.z, k);
    out.pitch = lerp(from.pitch, to.pitch, k);
    out.yaw = lerp(from.yaw, to.yaw, k);
    out.roll = lerp(from.roll, to.roll, k);
  }

  /**
   * Aim the forearm from the shoulder to wherever the fist ended up.
   *
   * The sleeve is built one unit long down -Z, so rotating -Z onto the shoulder-to-fist
   * direction and scaling Z by the distance spans the two points exactly. Only Z is scaled:
   * stretching the other two axes would fatten the arm as it extends.
   *
   * **Not `Object3D.lookAt`**, which was the first attempt and is silently wrong here:
   * `lookAt` resolves against `matrixWorld` and treats its argument as a *world* position,
   * and these poses are viewmodel-local coordinates on an object parented to a camera that
   * moves with the player. Measured, it aimed the arm at exactly 180° from the fist — the
   * wrist landed twice the arm's length away from the hand it was supposed to join.
   * `setFromUnitVectors` asks the question that is actually being asked, in the space the
   * numbers are actually in.
   *
   * The shoulder is behind the camera, so the elbow end is always outside the near plane
   * and the arm reads as running off the bottom of the screen rather than as ending.
   */
  private aimArm(knife: THREE.Object3D): void {
    const arm = this.arm;
    if (arm === null) return;
    this.fistAt.copy(knife.position).sub(KNIFE_SHOULDER);
    const reach = this.fistAt.length();
    if (reach > 1e-4) this.fistAt.divideScalar(reach);
    else this.fistAt.set(0, 0, -1);
    arm.position.copy(KNIFE_SHOULDER);
    arm.quaternion.setFromUnitVectors(ARM_AXIS, this.fistAt);
    arm.scale.set(1, 1, Math.max(0.05, reach));
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** The three keyframes as source, in the shape they are declared in — the hand tuner prints this. */
export function knifeSwingSource(swing: KnifeSwing): string {
  const line = (name: string, p: KnifePose): string => {
    const n = (v: number): string => String(Math.round(v * 1e4) / 1e4);
    return `const ${name}: KnifePose = { x: ${n(p.x)}, y: ${n(p.y)}, z: ${n(p.z)}, pitch: ${n(p.pitch)}, yaw: ${n(p.yaw)}, roll: ${n(p.roll)} };`;
  };
  return [line('KNIFE_READY', swing.ready), line('KNIFE_WINDUP', swing.windup), line('KNIFE_STRIKE', swing.strike)].join('\n');
}
//#endregion
