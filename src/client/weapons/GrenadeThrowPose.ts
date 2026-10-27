/**
 * The grenade throw (2026-09-24), in the same shape and for the same reasons as the swing.
 *
 * Four keyframes on one 0..1 line, blended the way the knife's three are. The line is not
 * time: `ViewmodelAnim` maps it from the two numbers the simulation already holds, so the
 * first half is as long as the player holds the button and the second is the follow-through.
 *
 * - **READY**, t 0 — the grenade comes up into the lower right of frame, pin in, both hands on
 *   it: the right round the body, the left hooked in the ring.
 * - **PULL**, t 0.26 — the ring is clear. From here the pin and the hand holding it travel on
 *   together, off the bottom-left of the frame, which is why the pull's own offset is large.
 * - **WIND-UP**, t 0.5 — cocked back and up beside the head. The cook holds here for as long
 *   as the fire button is down, which is what makes a cooked grenade read as a held one.
 * - **RELEASE**, t 1 — thrown out down the middle of the view. The grenade is in the hand for
 *   every frame up to this one and gone on it: t reaches 1 exactly when `ThrowController`
 *   spawns the projectile, and `EquipmentFx` draws it from there. The hand comes back empty
 *   over the follow-through.
 *
 * **Per grenade** (2026-09-24). One throw for all four was the first shape and it was wrong:
 * a 15 cm lemon held in a fist, a 13 cm can held upright and a flat mine carried edge-on are
 * three different objects at three different angles, and the human posed a throw for each in
 * the tuner. `GRENADE_THROW` below is the shape and the fallback — what a piece of equipment
 * with no row in `GRENADE_THROWS` is posed with.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { clamp01, DEG2RAD, lerp, smoothstep } from '../../shared/core/MathUtil';
import type { ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { GrenadeModel } from './GrenadeMesh';
import type { ViewmodelDrive } from './ViewmodelDrive';
import type { ViewmodelMotion } from './ViewmodelMotion';
import { makeViewmodelPose, type HandsBase, type ViewmodelPose } from './WeaponBasePose';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface GrenadePose {
  x: number;
  y: number;
  z: number;
  /** Degrees, matching every other pose constant here. */
  pitch: number;
  yaw: number;
  roll: number;
}

/** The four keyframes by name, which is the shape the hand tuner edits and prints. */
export type GrenadeThrow = Record<'ready' | 'pull' | 'windup' | 'release', GrenadePose>;
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Where on the 0..1 line each keyframe sits. `ready` is 0 and `release` is 1. */
export const GRENADE_PULL_AT = 0.26;
export const GRENADE_WINDUP_AT = 0.5;

/**
 * Seconds of cook that carry the hand from READY to WIND-UP.
 *
 * The fuse starts the instant the button goes down, so this is not a delay on anything: it is
 * how long the arm takes to do what it is doing while the fuse burns. A frag's `cookLimit` is
 * several times this, so the held pose is what a cooked grenade looks like.
 */
const GRENADE_COCK_SECONDS = 0.34;

const GRENADE_READY: GrenadePose = { x: 0.24, y: -0.22, z: -0.44, pitch: -10, yaw: 12, roll: 0 };
const GRENADE_PULL: GrenadePose = { x: 0.24, y: -0.18, z: -0.42, pitch: -6, yaw: 16, roll: -8 };
const GRENADE_WINDUP: GrenadePose = { x: 0.34, y: 0.1, z: -0.3, pitch: 24, yaw: 28, roll: -16 };
const GRENADE_RELEASE: GrenadePose = { x: 0.06, y: -0.04, z: -0.66, pitch: -28, yaw: 6, roll: 6 };

/** The shipped throw, and what a fresh `ViewmodelAnim` poses with. Copied, never handed out. */
export const GRENADE_THROW: Readonly<GrenadeThrow> = {
  ready: GRENADE_READY,
  pull: GRENADE_PULL,
  windup: GRENADE_WINDUP,
  release: GRENADE_RELEASE,
};

/**
 * Where the pin ends up, in the grenade's own space, once it is wholly pulled.
 *
 * Down, back and across to the left: away from the fuze and out of the frame, which is where a
 * hand that has just pulled a ring goes. It carries the glove with it, because the pulling
 * hand's target is inside the same carrier — see `GrenadeMesh`.
 */
export const GRENADE_PIN_OUT: Readonly<GrenadePose> = { x: -0.26, y: -0.2, z: 0.12, pitch: 0, yaw: 0, roll: -40 };


/**
 * Each piece of equipment's own throw, posed by the human in the hand tuner (2026-09-24),
 * keyed by the file's id as `HAND_POSES` is.
 *
 * The claymore's is a carry rather than a throw — it is held flat, turned face-out and pushed
 * away — and its `pinOut` is the default because it has no pin to pull.
 */
const GRENADE_THROWS: Readonly<Record<string, { readonly table: Readonly<GrenadeThrow>; readonly pinOut: Readonly<GrenadePose> }>> = {
  eq_frag: {
    table: {
      ready: { x: 0.24, y: -0.22, z: -0.42, pitch: 8, yaw: -180, roll: -28 },
      pull: { x: 0.215, y: -0.075, z: -0.3, pitch: 2, yaw: -180, roll: -33 },
      windup: { x: 0.22, y: 0.12, z: -0.23, pitch: 104, yaw: -180, roll: -80 },
      release: { x: 0.06, y: -0.04, z: -0.67, pitch: 59, yaw: -180, roll: -78 },
    },
    pinOut: { x: 0.18, y: 0.5, z: -0.5, pitch: 98, yaw: 20, roll: -85 },
  },
  /** A charge, carried flat and pushed away rather than lobbed; no pin, so `pinOut` is unused. */
  eq_semtex: {
    table: {
      ready: { x: 0.24, y: -0.22, z: -0.535, pitch: 34, yaw: 61, roll: 0 },
      pull: { x: 0.24, y: -0.18, z: -0.42, pitch: 43, yaw: 79, roll: -8 },
      windup: { x: 0.34, y: 0.15, z: -0.3, pitch: 137, yaw: 82, roll: -16 },
      release: { x: 0.06, y: -0.04, z: -0.66, pitch: 48, yaw: 105, roll: 6 },
    },
    pinOut: GRENADE_PIN_OUT,
  },
  eq_flashbang: {
    table: {
      ready: { x: 0.24, y: -0.22, z: -0.42, pitch: 8, yaw: -180, roll: -28 },
      pull: { x: 0.215, y: 0, z: -0.3, pitch: 2, yaw: -180, roll: -33 },
      windup: { x: 0.34, y: 0.21, z: -0.215, pitch: 104, yaw: -180, roll: -80 },
      release: { x: 0.06, y: -0.04, z: -0.67, pitch: 59, yaw: -180, roll: -78 },
    },
    pinOut: { x: 0.18, y: 0.5, z: -0.5, pitch: 98, yaw: 20, roll: -85 },
  },
  /** The same throw as the flashbang's: two cans of the same shape, held the same way. */
  eq_smoke: {
    table: {
      ready: { x: 0.24, y: -0.22, z: -0.42, pitch: 8, yaw: -180, roll: -28 },
      pull: { x: 0.215, y: 0, z: -0.3, pitch: 2, yaw: -180, roll: -33 },
      windup: { x: 0.34, y: 0.21, z: -0.215, pitch: 104, yaw: -180, roll: -80 },
      release: { x: 0.06, y: -0.04, z: -0.67, pitch: 59, yaw: -180, roll: -78 },
    },
    pinOut: { x: 0.18, y: 0.5, z: -0.5, pitch: 98, yaw: 20, roll: -85 },
  },
  eq_claymore: {
    table: {
      ready: { x: 0.24, y: -0.22, z: -0.44, pitch: -10, yaw: 12, roll: 0 },
      pull: { x: 0.24, y: -0.18, z: -0.42, pitch: -10, yaw: -1, roll: 11 },
      windup: { x: 0.34, y: 0.235, z: -0.3, pitch: 148, yaw: 24, roll: 61 },
      release: { x: 0.12, y: 0.05, z: -0.8, pitch: 82, yaw: -5, roll: 72 },
    },
    pinOut: GRENADE_PIN_OUT,
  },
};
//#endregion

// =================================== CLASS GrenadeThrowPose =================================== \\
//#region Class GrenadeThrowPose
export class GrenadeThrowPose {
  // ========================================== STATIC ========================================== \\
  //#region Static
  /**
   * How far through the throw the hand is, 0..1, from the simulation's two numbers.
   *
   * Public because the hand tuner drives the same pose from a slider and has to speak the same
   * language, and because it is the one place the mapping from seconds to keyframes lives.
   */
  static throwFraction(cook: number, release: number): number {
    if (release > 0) return GRENADE_WINDUP_AT + (1 - GRENADE_WINDUP_AT) * clamp01(release);
    if (cook < 0) return 0;
    return GRENADE_WINDUP_AT * clamp01(cook / GRENADE_COCK_SECONDS);
  }
  //#endregion

  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /**
   * The throw this poses, its own copy of the row for whatever is in the hand, plus the pin's
   * travel.
   *
   * A copy and public for the reason the knife's swing is: the hand tuner edits these live on
   * the real pipeline, and the shipped table must not be what it writes into.
   */
  readonly table: GrenadeThrow = {
    ready: { ...GRENADE_READY },
    pull: { ...GRENADE_PULL },
    windup: { ...GRENADE_WINDUP },
    release: { ...GRENADE_RELEASE },
  };
  readonly pinOut: GrenadePose = { ...GRENADE_PIN_OUT };
  /**
   * The grenade in the hand, if this match built one for the slot being thrown.
   *
   * Held here for the same reason the knife is: a throw is hand motion, and the sway and idle
   * drift it borrows are the player's. Which grenade, and whether it is on screen at all, is
   * `ClientMatch`'s answer.
   */
  private grenade: GrenadeModel | null = null;
  /** The blended keyframe, before the player's own motion is added to it. */
  private readonly blended: ViewmodelPose = makeViewmodelPose();
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Attach the grenade being thrown, or null for none.
   *
   * Called when a throw starts rather than once per match, because which grenade is in the
   * hand is the loadout's lethal or its tactical and the player chooses per throw.
   */
  set(grenade: GrenadeModel | null): void {
    this.grenade = grenade;
    if (grenade === null) return;
    // Each grenade carries its own throw, so the table this poses is the one for whatever is
    // now in the hand. Copied, so the hand tuner can edit a live throw without writing into
    // the shipped one.
    const mine = grenadeThrowFor(grenade.poseId);
    for (const which of ['ready', 'pull', 'windup', 'release'] as const) {
      Object.assign(this.table[which], mine.table[which]);
    }
    Object.assign(this.pinOut, mine.pinOut);
  }

  /**
   * The grenade's own arc: four keyframes blended by where the throw is, and a pin that comes
   * out of it on the way.
   *
   * Like the knife's, and unlike the M8 bash, these are absolute poses in viewmodel space
   * rather than offsets on the weapon: the weapon is off screen for the whole of a throw, so
   * there is nothing to offset from. The bob, the sway and the idle drift are still added,
   * because they belong to the player rather than to what the player is holding.
   */
  pose(base: HandsBase, motion: ViewmodelMotion, drive: ViewmodelDrive, cfg: ViewmodelConfig): void {
    const grenade = this.grenade;
    if (grenade === null) return;
    const t = GrenadeThrowPose.throwFraction(drive.throwCook, drive.throwRelease);
    this.blend(t);

    const root = grenade.root;
    motion.placeHeldItem(root, this.blended, drive, cfg);

    /**
     * The pull. It starts a little after the grenade is up and is complete at the wind-up, so
     * the pin and the glove on it travel on out of frame rather than stopping where the ring
     * stopped being useful.
     */
    const pull = smoothstep(0.1, GRENADE_WINDUP_AT, t);
    const out = this.pinOut;
    grenade.pinCarrier.position.set(out.x * pull, out.y * pull, out.z * pull);
    grenade.pinCarrier.rotation.set(out.pitch * pull * DEG2RAD, out.yaw * pull * DEG2RAD, out.roll * pull * DEG2RAD);

    /**
     * What is still in the hand.
     *
     * The grenade is drawn for the **whole** of the release and leaves on the frame the arm
     * reaches RELEASE, because that is the frame `ThrowController` spawns the projectile on
     * (`THROW_RELEASE_TIME`; the human's brief §2). It used to vanish at the wind-up and the
     * throw was an empty arm swinging at nothing.
     */
    const held = t < 1 - 1e-4;
    grenade.setHeld(held);
    if (grenade.lever !== null) grenade.lever.visible = held;

    const hands = grenade.hands;
    if (hands === null) return;
    hands.update(base.fromObject(root));
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** Which pair of keyframes `t` falls between, and how far. Writes `blended`. */
  private blend(t: number): void {
    const table = this.table;
    let from: GrenadePose;
    let to: GrenadePose;
    let k: number;
    if (t < GRENADE_PULL_AT) {
      from = table.ready;
      to = table.pull;
      k = smoothstep(0, GRENADE_PULL_AT, t);
    } else if (t < GRENADE_WINDUP_AT) {
      from = table.pull;
      to = table.windup;
      k = smoothstep(GRENADE_PULL_AT, GRENADE_WINDUP_AT, t);
    } else {
      from = table.windup;
      to = table.release;
      // Not smoothed on the way in: a throw accelerates into the release, and those 200 ms are
      // the only part of this the player reads.
      k = (t - GRENADE_WINDUP_AT) / (1 - GRENADE_WINDUP_AT);
    }

    const out = this.blended;
    out.x = lerp(from.x, to.x, k);
    out.y = lerp(from.y, to.y, k);
    out.z = lerp(from.z, to.z, k);
    out.pitch = lerp(from.pitch, to.pitch, k);
    out.yaw = lerp(from.yaw, to.yaw, k);
    out.roll = lerp(from.roll, to.roll, k);
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * The inverse of `ViewmodelAnim.throwFraction`: the drive that poses a throw at `t`.
 *
 * The hand tuner has a slider where a match has a button being held, and this is what turns
 * one into the other — so the page poses the throw through exactly the same path a match
 * does, rather than reaching into the animator and writing the blend itself.
 */
export function grenadeDriveAt(t: number): { cook: number; release: number } {
  if (t <= GRENADE_WINDUP_AT) return { cook: (t / GRENADE_WINDUP_AT) * GRENADE_COCK_SECONDS, release: 0 };
  return { cook: -1, release: (t - GRENADE_WINDUP_AT) / (1 - GRENADE_WINDUP_AT) };
}

/** This thing's throw and pin travel, or the shipped default for one with no row. */
export function grenadeThrowFor(poseId: string): { table: Readonly<GrenadeThrow>; pinOut: Readonly<GrenadePose> } {
  return GRENADE_THROWS[poseId] ?? { table: GRENADE_THROW, pinOut: GRENADE_PIN_OUT };
}

/** One row of `GRENADE_THROWS` as source, for the hand tuner's output box. */
export function grenadeThrowSource(poseId: string, swing: GrenadeThrow, pinOut: GrenadePose): string {
  const n = (v: number): string => String(Math.round(v * 1e4) / 1e4);
  const one = (p: GrenadePose): string =>
    `{ x: ${n(p.x)}, y: ${n(p.y)}, z: ${n(p.z)}, pitch: ${n(p.pitch)}, yaw: ${n(p.yaw)}, roll: ${n(p.roll)} }`;
  const rows = (['ready', 'pull', 'windup', 'release'] as const)
    .map((k) => `      ${k}: ${one(swing[k])},`)
    .join('\n');
  return [`  ${poseId}: {`, '    table: {', rows, '    },', `    pinOut: ${one(pinOut)},`, '  },'].join('\n');
}
//#endregion
