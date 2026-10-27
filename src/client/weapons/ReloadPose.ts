/**
 * The reload: the weapon's own displacement, the magazine, the support hand and the handle.
 *
 * Four things on one 0..1 line, and the line is `WeaponBase`'s rather than a clock of this
 * file's own — so a reload the server cut short cannot leave a magazine hanging in the air.
 * Which keyframe times that line is read against is the only branch: an empty reload has a
 * charging handle in it and a tactical one does not, so they are two tracks.
 *
 * The rest state is here too, and deliberately. A weapon that is *not* reloading has to put
 * all four back every frame, because the previous frame may have left them anywhere.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { Vector3 } from 'three';
import { clamp01, smoothstep } from '../../shared/core/MathUtil';
import type { ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { WeaponModel } from './WeaponMesh';
import type { ViewmodelDrive } from './ViewmodelDrive';
import { makeViewmodelPose, type ViewmodelPose } from './WeaponBasePose';
import { easeOutCubic } from './ViewmodelMotion';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** Where each stage of a reload sits on the 0..1 line, as fractions of the whole. */
export interface ReloadTimes {
  readonly down: number;
  readonly magOut: number;
  readonly magIn: number;
  readonly magSeated: number;
  readonly raise: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Keyframe times as a fraction of the reload, matching WeaponBase's tracks. */
const TACTICAL_TIMES: ReloadTimes = { down: 0.17, magOut: 0.36, magIn: 0.5, magSeated: 0.66, raise: 0.78 };
const EMPTY_TIMES: ReloadTimes = { down: 0.15, magOut: 0.34, magIn: 0.42, magSeated: 0.58, raise: 0.86 };

/**
 * The reload on a file: the weapon comes **up**, not down (playtest 4, finding 7).
 *
 * Dipping it is what a shooter does and what the shared pose has always done, and it is also
 * what hides the reload: the magazine well goes below the frame and the player watches an empty
 * screen for two seconds. Raised with the muzzle toward the sky and drawn in a little, the well
 * and the charging handle sit in the middle of the picture where the hand meets them — which
 * is the one thing the animation is for.
 *
 * The roll is `roll` degrees **toward the well's side** (`wellSide`, playtest 6): the AK's well
 * turns left, into the frame, and the magazine leaves and arrives in plain view. It was 26°
 * one way for every weapon, which turned a well underneath to the right and away from the eye.
 */
const FILE_RELOAD = { shiftX: -0.04, dropY: -0.03, dropZ: 0.075, pitch: 42, roll: 35, yaw: 10, magThrow: 0.13, magSlide: 0.09 };

/**
 * Where the support hand meets the magazine, metres in the magazine's own space (M19,
 * playtest 5): a little below it and a little toward the eye, so the glove wraps the
 * magazine's body rather than sitting inside it.
 */
const MAG_HAND_OFFSET = new Vector3(0.02, -0.055, 0.02);

const CHARGE_PULL = 0.68;
const CHARGE_PEAK = 0.75;
const CHARGE_HOME = 0.81;
//#endregion

// ====================================== CLASS ReloadPose ====================================== \\
//#region Class ReloadPose
export class ReloadPose {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly handTarget = new Vector3();
  /** The displacement the weapon takes, reused: a file's and a primitive's are not the same. */
  private readonly dip = makeViewmodelPose();
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Add the reload to `pose` and place the three moving parts — or put them all home.
   *
   * The dip is windowed by `down` and `raise` so it comes on as the weapon drops and is gone
   * before it is back up; the parts read the raw fraction, because each has its own window
   * inside it.
   */
  apply(pose: ViewmodelPose, model: WeaponModel, drive: ViewmodelDrive, cfg: ViewmodelConfig): void {
    if (!drive.reloading) {
      this.rest(model);
      return;
    }
    const times = drive.reloadEmpty ? EMPTY_TIMES : TACTICAL_TIMES;
    const f = clamp01(drive.reloadFraction);
    const down = smoothstep(0, times.down, f) * (1 - smoothstep(times.raise, 1, f));
    const dip = this.displacement(model, cfg);
    pose.x += dip.x * down;
    pose.y += dip.y * down;
    pose.z += dip.z * down;
    pose.pitch += dip.pitch * down;
    pose.yaw += dip.yaw * down;
    pose.roll += dip.roll * down;
    this.poseMagazine(f, times, model, cfg);
    this.poseSupportHand(f, times, model);
    poseChargingHandle(drive.reloadEmpty ? f : -1, model, cfg);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** Nothing is reloading, so every part the reload moves goes back where it belongs. */
  private rest(model: WeaponModel): void {
    model.magazine.position.set(0, 0, 0);
    model.magazine.rotation.set(0, 0, 0);
    model.chargingHandle.position.set(0, 0, 0);
    if (model.supportHand !== null) model.supportHand.position.set(0, 0, 0);
    if (model.hands !== null) model.hands.magazineHold = 0;
  }

  /** How far the weapon moves at the bottom of the dip, which way depending on what it is. */
  private displacement(model: WeaponModel, cfg: ViewmodelConfig): ViewmodelPose {
    const dip = this.dip;
    if (model.source === 'glb') {
      dip.x = FILE_RELOAD.shiftX;
      dip.y = FILE_RELOAD.dropY;
      dip.z = FILE_RELOAD.dropZ;
      dip.pitch = FILE_RELOAD.pitch;
      dip.yaw = FILE_RELOAD.yaw;
      dip.roll = FILE_RELOAD.roll * wellSide(model);
      return dip;
    }
    dip.x = cfg.hipX * 0.12;
    dip.y = cfg.reloadDropY;
    dip.z = cfg.reloadDropZ;
    dip.pitch = cfg.reloadPitch;
    dip.yaw = cfg.reloadYaw;
    dip.roll = cfg.reloadRoll;
    return dip;
  }

  private poseMagazine(f: number, times: ReloadTimes, model: WeaponModel, cfg: ViewmodelConfig): void {
    let drop = 0;
    let tilt = 0;
    if (f < times.down) {
      drop = 0;
    } else if (f < times.magOut) {
      // Out of the well and falling away, tipping as it goes.
      const t = smoothstep(times.down, times.magOut, f);
      drop = t;
      tilt = t * 0.55;
    } else if (f < times.magIn) {
      drop = 1;
      tilt = 0.55;
    } else if (f < times.magSeated) {
      // A fresh magazine comes up from below and seats.
      const t = smoothstep(times.magIn, times.magSeated, f);
      drop = 1 - easeOutCubic(t);
      tilt = (1 - t) * 0.35;
    }
    // Along the weapon's own exit direction (M19): down for all but the P90. A file's
    // magazine travels a hand's length — it stays in the picture — and one that leaves along
    // the receiver rather than out of the well travels less.
    const falls = model.magazineExit.y < -0.5;
    const reach = model.source === 'glb' ? (falls ? FILE_RELOAD.magThrow : FILE_RELOAD.magSlide) : cfg.magThrow;
    model.magazine.position.copy(model.magazineExit).multiplyScalar(drop * reach);
    // The tumble is a falling magazine's; one that lifts off the top (the P90's) slides straight.
    const tumble = falls ? tilt : 0;
    model.magazine.rotation.set(tumble, 0, tumble * 0.4);
  }

  /**
   * The support hand changes the magazine (M19, playtest 5).
   *
   * The trigger hand never leaves the grip — it is merged into the body and cannot — so this
   * is the hand that does the work: it leaves the handguard as the weapon comes up, rides the
   * magazine out and back (`poseMagazine` has already put the magazine where it is going, so
   * following it is one vector rather than a second animation to keep in step), and returns to
   * the handguard as the weapon comes down. The blend at each end is what keeps it from
   * snapping between the two places.
   *
   * The arms (stage 4) take the blend and go to the magazine itself — a target on the magazine's
   * node at `socket_mag_grip` — rather than following its displacement from the handguard,
   * which kept the glove 10–20 cm ahead of the magazine it was meant to be holding. The box
   * gloves keep the old way.
   */
  private poseSupportHand(f: number, times: ReloadTimes, model: WeaponModel): void {
    // Away from the handguard over the dip, back to it over the raise.
    const held = smoothstep(0, times.down, f) * (1 - smoothstep(times.magSeated, times.raise, f));
    if (model.hands !== null) {
      model.hands.magazineHold = held;
      return;
    }
    const hand = model.supportHand;
    if (hand === null) return;
    if (held <= 0) {
      hand.position.set(0, 0, 0);
      return;
    }
    const target = this.handTarget;
    target.copy(model.magazine.position).add(MAG_HAND_OFFSET);
    // The magazine's own home is the weapon's origin, and so is the hand's: the difference
    // between where the hand is built and where the magazine sits is already in the geometry,
    // so the hand only has to travel the magazine's own displacement plus the grip offset.
    hand.position.copy(target).multiplyScalar(held);
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * Which way a file's reload rolls the weapon, as the sign of `roll` (playtest 6): whichever
 * turns its magazine well **toward the screen's centre**, where the support hand comes from.
 * A well underneath rolls clockwise from the eye (negative), the top to the right and the
 * well to the left; the P90's, on top, rolls the other way for the same reason. One roll for
 * every weapon turned the AK's well right and away, toward the frame's edge.
 */
function wellSide(model: WeaponModel): number {
  return model.magazineExit.y > 0 ? 1 : -1;
}

/** `f` below zero means "not an empty reload"; the handle stays home. */
function poseChargingHandle(f: number, model: WeaponModel, cfg: ViewmodelConfig): void {
  let pull = 0;
  if (f >= CHARGE_PULL && f < CHARGE_PEAK) {
    pull = smoothstep(CHARGE_PULL, CHARGE_PEAK, f);
  } else if (f >= CHARGE_PEAK && f < CHARGE_HOME) {
    // Released, not eased back: a charging handle snaps.
    pull = 1 - smoothstep(CHARGE_PEAK, CHARGE_HOME, f) ** 0.5;
  }
  model.chargingHandle.position.set(0, 0, pull * cfg.chargeThrow);
}
//#endregion
