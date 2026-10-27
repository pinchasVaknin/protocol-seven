/**
 * The recoil kick, and the sight picture it is not allowed to break.
 *
 * Hip fire is unchanged: the crosshair is painted at the centre of the screen, the rounds
 * leave along the camera's axis, and the gun may do what it likes underneath.
 *
 * **Aimed, the mark the player shoots with is on the weapon** — an iron post, a ring, a dot in
 * an optic's glass — so every millimetre the kick moves the weapon relative to the camera
 * moves that mark off the line the rounds actually leave along. Measured mid-burst on the
 * carbine at full ADS, the sight point sat **1.54° high and 0.49° right of the camera axis —
 * 56 cm at 20 m** while the bullets went down the axis, which is the playtest's report:
 * through the sights, sustained fire, the hits and the reticle disagree.
 *
 * Two halves, and they are different in kind:
 *
 *  - The **translation** (back, up, lateral) has nowhere to go but off the aim line, so it is
 *    scaled by `kickAdsScale` as the sights come up — the same treatment sway and bob already
 *    get, and for the same reason.
 *  - The **rotation** is kept whole and taken **about the sight point** instead of about the
 *    root's origin. The muzzle still rises and the gun still rolls with a lateral kick; what
 *    stays put is the one point the player is looking through. `sightPoint` is the same point
 *    ADS lands on the camera axis, so this is that alignment held rather than a second opinion
 *    about where the weapon should be.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { Euler, Vector3 } from 'three';
import { clamp01, DEG2RAD, lerp } from '../../shared/core/MathUtil';
import type { ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { WeaponModel } from './WeaponMesh';
import type { ViewmodelDrive } from './ViewmodelDrive';
import type { ViewmodelPose } from './WeaponBasePose';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Scratch for the two placements `sightPivotShift` compares. Reused: it runs every shot. */
const PIVOT_RESTED = new Vector3();
const PIVOT_KICKED = new Vector3();
const PIVOT_EULER = new Euler();
//#endregion

// ====================================== CLASS RecoilKick ====================================== \\
//#region Class RecoilKick
export class RecoilKick {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Where `sightPivotShift` writes the kick's compensating translation. */
  private readonly shift = new Vector3();
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** Add this frame's kick to the pose, with the sight held still whenever the player is aiming. */
  apply(pose: ViewmodelPose, model: WeaponModel, drive: ViewmodelDrive, cfg: ViewmodelConfig): void {
    const aimed = clamp01(drive.adsFraction);
    const punch = drive.visualPunch;
    const lateral = drive.visualLateral;
    const kickMove = lerp(1, cfg.kickAdsScale, aimed);
    pose.z += punch * cfg.kickBack * kickMove;
    pose.y += punch * cfg.kickUp * kickMove;
    pose.x += lateral * cfg.kickLateral * kickMove;
    const kickPitch = punch * cfg.kickPitch;
    const kickRoll = -lateral * cfg.kickRoll;
    if (aimed > 1e-3 && (kickPitch !== 0 || kickRoll !== 0)) {
      sightPivotShift(model.sightPoint, pose.pitch, pose.yaw, pose.roll, kickPitch, kickRoll, this.shift);
      pose.x += this.shift.x * aimed;
      pose.y += this.shift.y * aimed;
      pose.z += this.shift.z * aimed;
    }
    pose.pitch += kickPitch;
    pose.roll += kickRoll;
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * The translation that turns a kick's rotation into a rotation **about the sight point**.
 *
 * Every rotation of the viewmodel root is about the root's own origin, which for a weapon file
 * is on its bore near the eye — so a kick that pitches the gun 0.7° also carries the sight
 * point away from the camera axis, and aimed, that is the player's mark leaving the line the
 * rounds go down. Add this shift to the position and the sight point ends up exactly where it
 * was: the gun turns under it.
 *
 * `rx`/`ry`/`rz` are the pose's rotation and `kickPitch`/`kickRoll` the kick's addition to it,
 * all in **degrees**, in the same XYZ Euler order the root is set from. Writes and returns
 * `out`; allocation free, which is why it takes one.
 */
export function sightPivotShift(
  sight: Vector3,
  rx: number,
  ry: number,
  rz: number,
  kickPitch: number,
  kickRoll: number,
  out: Vector3,
): Vector3 {
  PIVOT_RESTED.copy(sight).applyEuler(PIVOT_EULER.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD));
  PIVOT_KICKED.copy(sight).applyEuler(
    PIVOT_EULER.set((rx + kickPitch) * DEG2RAD, ry * DEG2RAD, (rz + kickRoll) * DEG2RAD),
  );
  return out.copy(PIVOT_RESTED).sub(PIVOT_KICKED);
}
//#endregion
