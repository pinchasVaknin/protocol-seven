import { angleDelta, clamp, clamp01, damp, DEG2RAD, lerp, smoothstep } from '../../shared/core/MathUtil';
import type { ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type * as THREE from 'three';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { WeaponModel } from './WeaponMesh';
import type { ViewmodelHands } from './ViewmodelHands';

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
 */

export interface ViewmodelDrive {
  /** 0 = fully lowered, 1 = ready. The authority for both pose and fireability. */
  raise: number;
  /** 0 = hip, 1 = aimed. Linear in time; the easing happens here. */
  adsFraction: number;

  reloading: boolean;
  reloadFraction: number;
  reloadEmpty: boolean;

  /** Degrees of accumulated visual recoil. Separate from the aim change (S6.2). */
  visualPunch: number;
  visualLateral: number;

  tacSprint: boolean;
  slide: boolean;
  /**
   * A grenade is being cooked or has just been released (M7 playtest).
   *
   * Lowers the weapon off screen for the duration. The throw used to read as the grenade
   * leaving the player's chest, because the rifle stayed up the whole time and the projectile
   * simply appeared beside it. `ThrowController.busy` is the same flag that blocks firing, so
   * what you see and what you can do cannot disagree.
   */
  throwing: boolean;
  /**
   * A weapon swap is under way (M5, S6.4).
   *
   * `raise` already carries the *timing* of a put-away and a take-out, because `Inventory`
   * drives it. This says which lowered pose to use: a sprint carries the weapon across the
   * body diagonally, a swap drops it straight down and rolls it out of frame. Same value,
   * two keyframed destinations.
   */
  swapping: boolean;
  /**
   * 0..1 through a knife swing, or 0 (post-M8).
   *
   * A single arc rather than a phase enum, for the same reason `reloadFraction` is a number:
   * the pose is a continuous function of how far through the animation the sim says it is,
   * so the picture cannot disagree with the state machine about whether the blade is out.
   */
  melee: number;

  /** Head-bob phase from the player sim, so the gun and the camera share a footfall. */
  bobPhase: number;
  /** Horizontal speed, m/s, and the speed that counts as "full bob". */
  speed: number;
  speedRef: number;
  grounded: boolean;

  /** Absolute view angles this frame; sway is derived from how fast they change. */
  yaw: number;
  pitch: number;
}

export function makeViewmodelDrive(): ViewmodelDrive {
  return {
    raise: 1,
    throwing: false,
    adsFraction: 0,
    reloading: false,
    reloadFraction: 0,
    reloadEmpty: false,
    visualPunch: 0,
    visualLateral: 0,
    tacSprint: false,
    slide: false,
    swapping: false,
    melee: 0,
    bobPhase: 0,
    speed: 0,
    speedRef: 6.9,
    grounded: true,
    yaw: 0,
    pitch: 0,
  };
}

/** Keyframe times as a fraction of the reload, matching WeaponBase's tracks. */
const TACTICAL_TIMES = { down: 0.17, magOut: 0.36, magIn: 0.5, magSeated: 0.66, raise: 0.78 };
const EMPTY_TIMES = { down: 0.15, magOut: 0.34, magIn: 0.42, magSeated: 0.58, raise: 0.86 };
/**
 * The sight height `ViewmodelConfig.adsY` was tuned against — the M2 carbine's.
 *
 * Every other weapon's ADS pose is derived from it by the difference in sight height, so
 * retuning `adsY` moves all twelve together and nothing has to be re-authored per weapon.
 */
const REFERENCE_SIGHT_HEIGHT = 0.0915;

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

/** How fast the weapon drops for a throw and comes back. Brisk: this is not a swap. */
const THROW_LOWER_RATE = 14;

const CHARGE_PULL = 0.68;
const CHARGE_PEAK = 0.75;
const CHARGE_HOME = 0.81;

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

/** The three keyframes as source, in the shape they are declared in — the hand tuner prints this. */
export function knifeSwingSource(swing: KnifeSwing): string {
  const line = (name: string, p: KnifePose): string => {
    const n = (v: number): string => String(Math.round(v * 1e4) / 1e4);
    return `const ${name}: KnifePose = { x: ${n(p.x)}, y: ${n(p.y)}, z: ${n(p.z)}, pitch: ${n(p.pitch)}, yaw: ${n(p.yaw)}, roll: ${n(p.roll)} };`;
  };
  return [line('KNIFE_READY', swing.ready), line('KNIFE_WINDUP', swing.windup), line('KNIFE_STRIKE', swing.strike)].join('\n');
}

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

export class ViewmodelAnim {
  private swayX = 0;
  private swayY = 0;
  private swayYaw = 0;
  private swayPitch = 0;

  private adsPose = 0;
  /** Damped 0..1 throw lower. See `ViewmodelDrive.throwing`. */
  private throwPose = 0;
  private adsRising = false;
  private lastAdsFraction = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private idlePhase = 0;
  private primed = false;

  private model: WeaponModel;
  /**
   * The knife, if this match built one. Posed by `poseKnife`, never by the weapon path.
   *
   * Held here rather than beside the weapon because the swing is *hand* motion, and the sway
   * and idle drift it borrows are this class's state. `Match` owns whether it is visible; this
   * owns where it is.
   */
  private knife: THREE.Object3D | null = null;
  private knifeHands: ViewmodelHands | null = null;

  /**
   * The swing this animator poses, its own copy of `KNIFE_SWING`.
   *
   * A copy and a public field for one reason: the hand tuner (`probes/hand-tuner.html`) edits
   * these three keyframes live, on the real pipeline, exactly as it edits the hands' holds —
   * and the shipped table must not be what it writes into. A match never touches it.
   */
  readonly knifeSwing: KnifeSwing = {
    ready: { ...KNIFE_READY },
    windup: { ...KNIFE_WINDUP },
    strike: { ...KNIFE_STRIKE },
  };
  /** The forearm, aimed from a fixed shoulder at the fist every frame. See `poseKnife`. */
  private knifeArm: THREE.Object3D | null = null;
  /** Scratch for the arm's aim. Reused: this runs every frame of a swing. */
  private readonly fistAt = new Vector3();

  constructor(model: WeaponModel) {
    this.model = model;
  }

  /** Attach the knife viewmodel and its forearm. Called once per match; null unsets them. */
  setKnife(knife: THREE.Object3D | null, arm: THREE.Object3D | null = null, hands: ViewmodelHands | null = null): void {
    this.knife = knife;
    this.knifeArm = arm;
    this.knifeHands = hands;
  }

  /**
   * Point the animator at a different weapon (M5).
   *
   * A swap changes which mesh is on screen, and every pose this class writes is written
   * into that mesh's transforms — so the animator has to move with it rather than each
   * weapon owning an animator. The pose state itself carries over deliberately: sway and
   * the idle phase belong to the *hands*, and resetting them on a swap would make every
   * weapon arrive perfectly still.
   */
  setModel(model: WeaponModel): void {
    this.model = model;
  }

  /** The sight height of the weapon currently posed, so ADS can cancel it. */
  get sightHeight(): number {
    return this.model.sightHeight;
  }

  reset(yaw: number, pitch: number): void {
    this.swayX = 0;
    this.swayY = 0;
    this.swayYaw = 0;
    this.swayPitch = 0;
    this.adsPose = 0;
    this.throwPose = 0;
    this.adsRising = false;
    this.lastAdsFraction = 0;
    this.idlePhase = 0;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.primed = true;
  }

  /** `dt` is a real frame delta: this is presentation, not simulation. */
  update(drive: ViewmodelDrive, cfg: ViewmodelConfig, dtRaw: number): void {
    const dt = Math.min(Math.max(dtRaw, 0), 1 / 20);
    if (!this.primed) this.reset(drive.yaw, drive.pitch);

    this.updateAdsPose(drive.adsFraction, cfg, dt);
    this.updateSway(drive, cfg, dt);
    this.idlePhase += dt * cfg.idleHz * Math.PI * 2;

    const ads = this.adsPose;
    const aimed = clamp01(drive.adsFraction);

    // ---- base pose: hip -> ADS, then blended toward the lowered pose -------
    // The sight point is what ADS lands on the camera axis, all three of it (playtest 3).
    const sight = this.model.sightPoint;
    const file = this.model.source === 'glb';
    // Irons whose line is not parallel to the bore turn the weapon onto it (playtest 6), and
    // the sight point is landed where that turn carries it rather than where it was: the turn
    // is about the root's origin, and the rear sight is well above it.
    const pitch = this.model.adsPitch;
    const cos = Math.cos(pitch * DEG2RAD);
    const sin = Math.sin(pitch * DEG2RAD);
    const sightY = sight.y * cos - sight.z * sin;
    const sightZ = sight.y * sin + sight.z * cos;
    let px = lerp(cfg.hipX, -sight.x, ads);
    // `adsY` was tuned against the carbine's sight line. A weapon whose sights sit higher
    // has to be held correspondingly lower for them to land on the screen centre, so the
    // difference is applied here rather than being a second tuned constant per weapon —
    // there is one ADS pose and twelve sight heights, not twelve poses (M5).
    const sightOffset = sightY - REFERENCE_SIGHT_HEIGHT;
    let py = lerp(cfg.hipY, cfg.adsY - sightOffset, ads);
    // Along the barrel a file is placed by its sight: the sight point lands
    // `adsSightDistance` in front of the eye, and the rest of the weapon falls where the
    // weapon's own proportions put it (playtest 3, findings 5 and 6). The primitives keep
    // `adsZ` and the spec's `adsOffsetZ`, the pose they were tuned in.
    const aimZ = file ? -this.model.adsSightDistance - sightZ : cfg.adsZ + this.model.adsOffsetZ;
    let pz = lerp(cfg.hipZ, aimZ, ads);
    let rx = lerp(cfg.hipPitch, pitch, ads);
    let ry = lerp(cfg.hipYaw, 0, ads);
    let rz = lerp(cfg.hipRoll, 0, ads);

    // A throw lowers the weapon the same way a swap does, through a damped factor so the
    // gun swings down and back rather than snapping. Folded into `raise` rather than handled
    // separately, because `raise` is already the one authority for the lowered pose.
    this.throwPose = damp(this.throwPose, drive.throwing ? 1 : 0, THROW_LOWER_RATE, dt);
    const effectiveRaise = clamp01(drive.raise) * (1 - this.throwPose);

    // `raise` is the sprint-to-fire value. Eased so the gun swings rather than slides,
    // but the timing is untouched: at raise = 1 it is exactly on the base pose.
    const lowered = easeInOutQuad(1 - effectiveRaise);
    if (lowered > 0 && (drive.swapping || this.throwPose > 0.01)) {
      // Put-away / take-out (S6.4): straight down and rolled out of frame, which reads as
      // "this weapon is going away" rather than "this weapon is being carried".
      px = lerp(px, cfg.swapX, lowered);
      py = lerp(py, cfg.swapY, lowered);
      pz = lerp(pz, cfg.swapZ, lowered);
      rx = lerp(rx, cfg.swapPitch, lowered);
      ry = lerp(ry, 0, lowered);
      rz = lerp(rz, cfg.swapRoll, lowered);
    } else if (lowered > 0) {
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
      px = lerp(px, cfg.sprintX, lowered);
      py = lerp(py, sy, lowered);
      pz = lerp(pz, cfg.sprintZ, lowered);
      rx = lerp(rx, sp, lowered);
      ry = lerp(ry, cfg.sprintYaw, lowered);
      rz = lerp(rz, sr, lowered);
    }

    // ---- reload ------------------------------------------------------------
    if (drive.reloading) {
      const times = drive.reloadEmpty ? EMPTY_TIMES : TACTICAL_TIMES;
      const f = clamp01(drive.reloadFraction);
      const down = smoothstep(0, times.down, f) * (1 - smoothstep(times.raise, 1, f));
      px += (file ? FILE_RELOAD.shiftX : cfg.hipX * 0.12) * down;
      py += (file ? FILE_RELOAD.dropY : cfg.reloadDropY) * down;
      pz += (file ? FILE_RELOAD.dropZ : cfg.reloadDropZ) * down;
      rx += (file ? FILE_RELOAD.pitch : cfg.reloadPitch) * down;
      ry += (file ? FILE_RELOAD.yaw : cfg.reloadYaw) * down;
      rz += (file ? FILE_RELOAD.roll * this.wellSide() : cfg.reloadRoll) * down;
      this.poseMagazine(f, times, cfg);
      this.poseSupportHand(f, times);
      this.poseChargingHandle(drive.reloadEmpty ? f : -1, cfg);
    } else {
      this.model.magazine.position.set(0, 0, 0);
      this.model.magazine.rotation.set(0, 0, 0);
      this.model.chargingHandle.position.set(0, 0, 0);
      if (this.model.supportHand !== null) this.model.supportHand.position.set(0, 0, 0);
      if (this.model.hands !== null) this.model.hands.magazineHold = 0;
    }

    // The pose the arms are solved against (stage 4): everything above — hip to ADS, sprint,
    // swap, reload — and nothing below. Bob, idle drift, sway and recoil are small motions of
    // the whole gun-and-arms, and carrying the arms through them rigidly is what keeps a glove
    // on its grip and a sleeve out of the receiver; re-solving them against camera-fixed
    // shoulders swung the elbows 9–15 cm across the gun whenever the view turned.
    const base = this.handsBase.compose(
      this.basePosition.set(px, py, pz),
      this.baseTurn.setFromEuler(this.baseEuler.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD)),
      this.model.root.scale,
    );

    // ---- bob ----------------------------------------------------------------
    const bobScale = lerp(1, cfg.bobAdsScale, aimed);
    const speedRatio = drive.grounded ? clamp01(drive.speed / Math.max(drive.speedRef, 0.1)) : 0;
    const bobUp = Math.sin(drive.bobPhase * 2) * cfg.bobAmount * speedRatio * bobScale;
    const bobSide = Math.sin(drive.bobPhase) * cfg.bobLateral * speedRatio * bobScale;
    const bobRoll = Math.sin(drive.bobPhase) * cfg.bobRoll * speedRatio * bobScale;
    px += bobSide;
    py += bobUp;
    rz += bobRoll;

    // ---- idle drift: the gun is never perfectly still --------------------
    const idle = cfg.idleAmplitude * lerp(1, 0.25, aimed);
    px += Math.sin(this.idlePhase) * idle;
    py += Math.sin(this.idlePhase * 1.7) * idle * 0.6;

    // ---- sway ---------------------------------------------------------------
    px += this.swayX;
    py += this.swayY;
    ry += this.swayYaw;
    rx += this.swayPitch;

    /**
     * ---- recoil kick, and the sight picture it is not allowed to break -------
     *
     * Hip fire is unchanged: the crosshair is painted at the centre of the screen, the rounds
     * leave along the camera's axis, and the gun may do what it likes underneath.
     *
     * **Aimed, the mark the player shoots with is on the weapon** — an iron post, a ring, a
     * dot in an optic's glass — so every millimetre the kick moves the weapon relative to the
     * camera moves that mark off the line the rounds actually leave along. Measured mid-burst
     * on the carbine at full ADS, the sight point sat **1.54° high and 0.49° right of the
     * camera axis — 56 cm at 20 m** while the bullets went down the axis, which is the
     * playtest's report: through the sights, sustained fire, the hits and the reticle disagree.
     *
     * Two halves, and they are different in kind:
     *
     *  - The **translation** (back, up, lateral) has nowhere to go but off the aim line, so it
     *    is scaled by `kickAdsScale` as the sights come up — the same treatment sway and bob
     *    already get, and for the same reason.
     *  - The **rotation** is kept whole and taken **about the sight point** instead of about
     *    the root's origin. The muzzle still rises and the gun still rolls with a lateral kick;
     *    what stays put is the one point the player is looking through. `sightPoint` is the
     *    same point ADS lands on the camera axis above, so this is that alignment held rather
     *    than a second opinion about where the weapon should be.
     */
    const punch = drive.visualPunch;
    const lateral = drive.visualLateral;
    const kickMove = lerp(1, cfg.kickAdsScale, aimed);
    pz += punch * cfg.kickBack * kickMove;
    py += punch * cfg.kickUp * kickMove;
    px += lateral * cfg.kickLateral * kickMove;
    const kickPitch = punch * cfg.kickPitch;
    const kickRoll = -lateral * cfg.kickRoll;
    if (aimed > 1e-3 && (kickPitch !== 0 || kickRoll !== 0)) {
      sightPivotShift(this.model.sightPoint, rx, ry, rz, kickPitch, kickRoll, this.kickShift);
      px += this.kickShift.x * aimed;
      py += this.kickShift.y * aimed;
      pz += this.kickShift.z * aimed;
    }
    rx += kickPitch;
    rz += kickRoll;

    const root = this.model.root;
    root.position.set(px, py, pz);
    root.rotation.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD);
    // The arms: solved against the base pose, carried through the rest with the gun.
    this.model.hands?.update(base);

    this.poseKnife(drive, cfg);
  }

  /**
   * The knife's own arc (round 2). Three keyframes, blended by where the swing is.
   *
   * Deliberately *not* an offset on the weapon pose the way the M8 bash was: the rifle is
   * hidden while this runs, so there is nothing to offset from, and a knife held in the other
   * hand does not inherit the rifle's ADS, reload or sprint poses.
   *
   * It does inherit the bob, the sway and the idle drift, because those belong to the player
   * rather than to whatever they are holding — a blade that stayed perfectly still while the
   * world bobbed around it would read as a decal on the screen. `drive.melee` is
   * `Melee.fraction`, which is 0 whenever the state machine is idle, so a swing interrupted by
   * a death simply stops being drawn.
   */
  private poseKnife(drive: ViewmodelDrive, cfg: ViewmodelConfig): void {
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

    const swing = this.knifeSwing;
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

    const speedRatio = drive.grounded ? clamp01(drive.speed / Math.max(drive.speedRef, 0.1)) : 0;
    const bobUp = Math.sin(drive.bobPhase * 2) * cfg.bobAmount * speedRatio;
    const bobSide = Math.sin(drive.bobPhase) * cfg.bobLateral * speedRatio;
    const idle = cfg.idleAmplitude;

    knife.position.set(
      lerp(from.x, to.x, k) + this.swayX + bobSide + Math.sin(this.idlePhase) * idle,
      lerp(from.y, to.y, k) + this.swayY + bobUp + Math.sin(this.idlePhase * 1.7) * idle * 0.6,
      lerp(from.z, to.z, k),
    );
    knife.rotation.set(
      (lerp(from.pitch, to.pitch, k) + this.swayPitch) * DEG2RAD,
      (lerp(from.yaw, to.yaw, k) + this.swayYaw) * DEG2RAD,
      lerp(from.roll, to.roll, k) * DEG2RAD,
    );

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
    /**
     * With the arm rig there is no cylinder to aim: the hand is solved onto the handle and the
     * elbow falls where the arm's own lengths put it, exactly as it does on a rifle. The pose
     * the arm is solved against is the knife's own — position and turn as written above, and
     * the root's scale, so the frame's inverse takes `KNIFE_SCALE` back out and the glove is
     * life size on a knife that is not.
     */
    const hands = this.knifeHands;
    if (hands !== null) {
      hands.update(
        this.handsBase.compose(knife.position, this.baseTurn.setFromEuler(knife.rotation), knife.scale),
      );
      return;
    }

    const arm = this.knifeArm;
    if (arm === null) return;
    this.fistAt.copy(knife.position).sub(KNIFE_SHOULDER);
    const reach = this.fistAt.length();
    if (reach > 1e-4) this.fistAt.divideScalar(reach);
    else this.fistAt.set(0, 0, -1);
    arm.position.copy(KNIFE_SHOULDER);
    arm.quaternion.setFromUnitVectors(ARM_AXIS, this.fistAt);
    arm.scale.set(1, 1, Math.max(0.05, reach));
  }

  // -- channels -------------------------------------------------------------

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
  private updateAdsPose(fraction: number, cfg: ViewmodelConfig, dt: number): void {
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

  private updateSway(drive: ViewmodelDrive, cfg: ViewmodelConfig, dt: number): void {
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

  private poseMagazine(
    f: number,
    times: { magOut: number; magIn: number; magSeated: number; down: number },
    cfg: ViewmodelConfig,
  ): void {
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
    const falls = this.model.magazineExit.y < -0.5;
    const reach = this.model.source === 'glb' ? (falls ? FILE_RELOAD.magThrow : FILE_RELOAD.magSlide) : cfg.magThrow;
    this.model.magazine.position.copy(this.model.magazineExit).multiplyScalar(drop * reach);
    // The tumble is a falling magazine's; one that lifts off the top (the P90's) slides straight.
    const tumble = falls ? tilt : 0;
    this.model.magazine.rotation.set(tumble, 0, tumble * 0.4);
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
  private poseSupportHand(f: number, times: { down: number; magOut: number; magIn: number; magSeated: number; raise: number }): void {
    // Away from the handguard over the dip, back to it over the raise.
    const held = smoothstep(0, times.down, f) * (1 - smoothstep(times.magSeated, times.raise, f));
    if (this.model.hands !== null) {
      this.model.hands.magazineHold = held;
      return;
    }
    const hand = this.model.supportHand;
    if (hand === null) return;
    if (held <= 0) {
      hand.position.set(0, 0, 0);
      return;
    }
    const target = this.handTarget;
    target.copy(this.model.magazine.position).add(MAG_HAND_OFFSET);
    // The magazine's own home is the weapon's origin, and so is the hand's: the difference
    // between where the hand is built and where the magazine sits is already in the geometry,
    // so the hand only has to travel the magazine's own displacement plus the grip offset.
    hand.position.copy(target).multiplyScalar(held);
  }

  private readonly handTarget = new Vector3();
  /** Where `sightPivotShift` writes the kick's compensating translation. */
  private readonly kickShift = new Vector3();
  private readonly handsBase = new Matrix4();
  private readonly basePosition = new Vector3();
  private readonly baseTurn = new Quaternion();
  private readonly baseEuler = new Euler();

  /**
   * Which way a file's reload rolls the weapon, as the sign of `rz` (playtest 6): whichever
   * turns its magazine well **toward the screen's centre**, where the support hand comes from.
   * A well underneath rolls clockwise from the eye (negative), the top to the right and the
   * well to the left; the P90's, on top, rolls the other way for the same reason. One roll for
   * every weapon turned the AK's well right and away, toward the frame's edge.
   */
  private wellSide(): number {
    return this.model.magazineExit.y > 0 ? 1 : -1;
  }

  /** `f` below zero means "not an empty reload"; the handle stays home. */
  private poseChargingHandle(f: number, cfg: ViewmodelConfig): void {
    let pull = 0;
    if (f >= CHARGE_PULL && f < CHARGE_PEAK) {
      pull = smoothstep(CHARGE_PULL, CHARGE_PEAK, f);
    } else if (f >= CHARGE_PEAK && f < CHARGE_HOME) {
      // Released, not eased back: a charging handle snaps.
      pull = 1 - smoothstep(CHARGE_PEAK, CHARGE_HOME, f) ** 0.5;
    }
    this.model.chargingHandle.position.set(0, 0, pull * cfg.chargeThrow);
  }
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Overshooting ease. Zero at t=0, exactly 1 at t=1, peaking a little above 1 around
 * three-quarters of the way in — `overshoot` is roughly how far above.
 */
function easeOutBack(t: number, overshoot: number): number {
  const c1 = Math.max(0, overshoot) * 10;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

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

const PIVOT_RESTED = new Vector3();
const PIVOT_KICKED = new Vector3();
const PIVOT_EULER = new Euler();
