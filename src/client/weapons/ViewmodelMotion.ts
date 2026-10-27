/**
 * The player's own motion, which belongs to the player and not to what they are holding.
 *
 * Four channels — the ADS curve, the sway, the head bob and the idle drift — and the one thing
 * they have in common is the reason this is a class of its own: a rifle, a knife and a grenade
 * all ride them, and only the rifle has a pose of its own underneath. Before this file, the
 * knife and the grenade each carried their own copy of the bob-and-drift arithmetic and said
 * so in their comments; there is one copy now and it is here.
 *
 * None of it is simulation. Every channel is a pure function of the drive and a damped
 * follower, so the shape is the same at any frame rate and nothing here can disagree with what
 * the player is allowed to do.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type * as THREE from 'three';
import { angleDelta, clamp, clamp01, damp, DEG2RAD, lerp } from '../../shared/core/MathUtil';
import type { ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { ViewmodelDrive } from './ViewmodelDrive';
import type { ViewmodelPose } from './WeaponBasePose';
//#endregion

// =================================== CLASS ViewmodelMotion ==================================== \\
//#region Class ViewmodelMotion
export class ViewmodelMotion {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private swayX = 0;
  private swayY = 0;
  private swayYaw = 0;
  private swayPitch = 0;

  private adsPose = 0;
  private adsRising = false;
  private lastAdsFraction = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private idlePhase = 0;
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * How far through the ADS pose the weapon is, which is **not** `drive.adsFraction`.
   *
   * It is the eased, overshooting version, and it runs a little past 1. The linear one is what
   * spread and recoil scaling read; this one is only ever a picture.
   */
  get ads(): number {
    return this.adsPose;
  }

  /** Seat the angles and empty every channel. A spawn, a respawn, or the first frame. */
  reset(yaw: number, pitch: number): void {
    this.swayX = 0;
    this.swayY = 0;
    this.swayYaw = 0;
    this.swayPitch = 0;
    this.adsPose = 0;
    this.adsRising = false;
    this.lastAdsFraction = 0;
    this.idlePhase = 0;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
  }

  /** Move every channel on by one frame. Nothing is posed here; this only advances state. */
  advance(drive: ViewmodelDrive, cfg: ViewmodelConfig, dt: number): void {
    this.advanceAds(drive.adsFraction, cfg, dt);
    this.advanceSway(drive, cfg, dt);
    this.idlePhase += dt * cfg.idleHz * Math.PI * 2;
  }

  /**
   * Add the four channels to a weapon's pose, in the order they have always been added.
   *
   * `aimed` is the **linear** ADS fraction, not `ads`: the bob and the drift are quietened by
   * how far the player has asked to be aimed, which is a fact about the input and not about
   * where the eased pose has reached.
   */
  applyWeapon(pose: ViewmodelPose, drive: ViewmodelDrive, cfg: ViewmodelConfig, aimed: number): void {
    const bobScale = lerp(1, cfg.bobAdsScale, aimed);
    const speedRatio = speedRatioOf(drive);
    const bobUp = Math.sin(drive.bobPhase * 2) * cfg.bobAmount * speedRatio * bobScale;
    const bobSide = Math.sin(drive.bobPhase) * cfg.bobLateral * speedRatio * bobScale;
    const bobRoll = Math.sin(drive.bobPhase) * cfg.bobRoll * speedRatio * bobScale;
    pose.x += bobSide;
    pose.y += bobUp;
    pose.roll += bobRoll;

    // ---- idle drift: the gun is never perfectly still --------------------
    const idle = cfg.idleAmplitude * lerp(1, 0.25, aimed);
    pose.x += Math.sin(this.idlePhase) * idle;
    pose.y += Math.sin(this.idlePhase * 1.7) * idle * 0.6;

    // ---- sway ---------------------------------------------------------------
    pose.x += this.swayX;
    pose.y += this.swayY;
    pose.yaw += this.swayYaw;
    pose.pitch += this.swayPitch;
  }

  /**
   * Write a held item's blended pose onto its node, with the player's motion added.
   *
   * A knife and a grenade take the bob, the sway and the idle drift and nothing else: they do
   * not inherit the rifle's ADS, reload or sprint poses, because the rifle is off screen while
   * either is out and there is nothing to inherit. A blade that stayed perfectly still while
   * the world bobbed around it would read as a decal on the screen.
   *
   * The bob is unscaled here, unlike the weapon's: there is no ADS while a held item is out.
   * Z takes no bob and the roll takes no sway, exactly as both call sites always had it.
   */
  placeHeldItem(target: THREE.Object3D, blended: ViewmodelPose, drive: ViewmodelDrive, cfg: ViewmodelConfig): void {
    const speedRatio = speedRatioOf(drive);
    const bobUp = Math.sin(drive.bobPhase * 2) * cfg.bobAmount * speedRatio;
    const bobSide = Math.sin(drive.bobPhase) * cfg.bobLateral * speedRatio;
    const idle = cfg.idleAmplitude;

    target.position.set(
      blended.x + this.swayX + bobSide + Math.sin(this.idlePhase) * idle,
      blended.y + this.swayY + bobUp + Math.sin(this.idlePhase * 1.7) * idle * 0.6,
      blended.z,
    );
    target.rotation.set(
      (blended.pitch + this.swayPitch) * DEG2RAD,
      (blended.yaw + this.swayYaw) * DEG2RAD,
      blended.roll * DEG2RAD,
    );
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * ADS easing: a slight overshoot on the way in, none on the way out (S6.6).
   *
   * The overshoot is applied to the *pose* only. `adsFraction` stays linear because it
   * also drives FOV, spread and recoil scaling, and a sight picture that overshot its
   * accuracy would be a lie.
   *
   * The curve is a pure function of `adsFraction`, which is linear in time — so the shape
   * is identical at any frame rate and there is no spring to detune or to blow up on a
   * long frame. The one piece of state is a fast follower, and it exists only to absorb
   * the discontinuity when a player releases the button halfway in and the curve swaps
   * from the overshooting one to the plain one.
   */
  private advanceAds(fraction: number, cfg: ViewmodelConfig, dt: number): void {
    const rising = fraction > this.lastAdsFraction + 1e-6;
    const falling = fraction < this.lastAdsFraction - 1e-6;
    if (rising) this.adsRising = true;
    else if (falling) this.adsRising = false;
    this.lastAdsFraction = fraction;

    const t = clamp01(fraction);
    const target = this.adsRising ? easeOutBack(t, cfg.adsOvershoot) : easeInOutQuad(t);
    this.adsPose = damp(this.adsPose, target, 40, dt);
    this.adsPose = clamp(this.adsPose, 0, 1 + cfg.adsOvershoot);
  }

  private advanceSway(drive: ViewmodelDrive, cfg: ViewmodelConfig, dt: number): void {
    const inv = dt > 1e-5 ? 1 / dt : 0;
    const dYaw = angleDelta(this.lastYaw, drive.yaw) * inv;
    const dPitch = (drive.pitch - this.lastPitch) * inv;
    this.lastYaw = drive.yaw;
    this.lastPitch = drive.pitch;

    const scale = lerp(1, cfg.swayAdsScale, clamp01(drive.adsFraction));
    const cap = cfg.swayMax;
    const targetX = clamp(dYaw * cfg.swayPosition * scale, -cap, cap);
    const targetY = clamp(-dPitch * cfg.swayPosition * scale, -cap, cap);
    const rotCap = cfg.swayRotation * 4;
    const targetYaw = clamp(-dYaw * cfg.swayRotation * scale, -rotCap, rotCap);
    const targetPitch = clamp(dPitch * cfg.swayRotation * scale, -rotCap, rotCap);

    this.swayX = damp(this.swayX, targetX, cfg.swayRate, dt);
    this.swayY = damp(this.swayY, targetY, cfg.swayRate, dt);
    this.swayYaw = damp(this.swayYaw, targetYaw, cfg.swayRate, dt);
    this.swayPitch = damp(this.swayPitch, targetPitch, cfg.swayRate, dt);
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Overshooting ease. Zero at t=0, exactly 1 at t=1, peaking a little above 1 around
 * three-quarters of the way in — `overshoot` is roughly how far above.
 */
export function easeOutBack(t: number, overshoot: number): number {
  const c1 = Math.max(0, overshoot) * 10;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** How much of the full bob this frame earns: nothing in the air, however fast the player is. */
function speedRatioOf(drive: ViewmodelDrive): number {
  return drive.grounded ? clamp01(drive.speed / Math.max(drive.speedRef, 0.1)) : 0;
}
//#endregion
