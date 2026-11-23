/**
 * Catches a body that is drawn in the air pose while it is really walking along the ground.
 *
 * ## The report this exists for
 *
 * Reported from play on 2026-11-23 (BACKLOG #87): intermittently, across maps, a body gets stuck
 * in the jumping-or-falling pose — knees up toward the belly — while it goes on moving normally.
 * It has never been reproduced on demand, and a session spent looking for it offline could not
 * make it happen: the simulation never strands the stance (6,023 jumps and 6,006 landings in a
 * random search, every landing clearing it), the animator recovers from every stance script a
 * brute force could generate, and the whole replicated chain — real controller, real
 * interpolator with jitter and up to 36 % packet loss, real animator — held the air pose for at
 * most **317 ms**.
 *
 * So the bug happens where it was seen, and not here. This is the instrument that catches it
 * there, on the first occurrence, with the state that says which end is at fault.
 *
 * ## Why the air pose is held at all, and why that makes this cheap to detect
 *
 * `jumpLaunch` clamps on its last frame and that frame **is** the air pose, so a body the
 * animator believes is airborne is *meant* to keep it (`CharacterAnimator.setLocomotion`'s
 * airborne branch, and the matching guard in its `finished` handler). The pose is therefore not
 * evidence of anything by itself — what is evidence is **how long** it lasts on a body that is
 * really moving.
 *
 * ## The threshold, and where it comes from
 *
 * `STUCK_MS` is 1,200. Two measurements put it there, both taken on 2026-11-23:
 *
 * - a live match with 24 bots: an ordinary jump taken while moving holds the air pose for
 *   **at most 567 ms**, over twelve episodes, and nothing exceeded 600 ms;
 * - the replicated chain at 36 % packet loss: **317 ms** worst case, in the `frozen` and
 *   `extrapolated` outcomes, which is the interpolation delay plus `MAX_EXTRAPOLATION_MS`.
 *
 * 1,200 ms is over twice the longest honest episode and nearly four times the worst thing the
 * network can do, so a trip is a defect and not a slow frame. It never has to be exactly right,
 * because the two populations are an order of magnitude apart.
 *
 * ## What it costs when it is off
 *
 * One property read per body per frame, at the single call site. Nothing is allocated and
 * nothing is measured until `setAirPoseWatch(true)`, which is why the guard is at the call site
 * rather than inside `watchAirPose` — see `WATCH`.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { StanceId } from '../../shared/core/Vocabulary';
import type { CharacterAnimationId } from './CharacterCatalog';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * One frame of one body, as the animator saw it.
 *
 * Both the raw and the settled airborne answer are here on purpose: the gap between them is
 * `GROUND_EDGE_GRACE` doing its job, and a trip where they disagree points at the settle while
 * a trip where they agree points at whatever fed the stance.
 */
export interface AirPoseSample {
  readonly entityId: number;
  /** The replicated stance this frame — the fact everything else is derived from. */
  readonly stance: StanceId;
  /** `isAirborne(input)`, before the grace. */
  readonly rawAirborne: boolean;
  /** After the grace: what the animator actually believes. */
  readonly airborne: boolean;
  /** Metres per second, measured from pose deltas by the avatar. */
  readonly planarSpeed: number;
  /** The render delta this frame, seconds. */
  readonly dt: number;
  readonly active: CharacterAnimationId | null;
  readonly transition: CharacterAnimationId | null;
}

/** A body caught past the threshold, kept for the report. */
export interface AirPoseTrip extends AirPoseSample {
  /** How long the body had been airborne-and-moving when it was caught, ms. */
  readonly heldMs: number;
}

export interface AirPoseReport {
  /** Whether the watch is on at all. A report of nothing from a watch that is off says nothing. */
  readonly on: boolean;
  /** Every episode that has ended, in ms, longest first. The honest population to compare against. */
  readonly episodes: readonly number[];
  /** The longest episode seen, ended or still running. */
  readonly worstMs: number;
  /** Bodies caught past `STUCK_MS`. Empty is the expected answer. */
  readonly trips: readonly AirPoseTrip[];
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Longer than this, airborne and moving, is the defect. See the overview for the two numbers. */
const STUCK_MS = 1_200;

/** Below this a body is not moving, and a held air pose is a body standing still in the air. */
const MOVING_SPEED = 0.12;

/** Episodes kept for the report. Enough to see the distribution; not a leak over a long session. */
const MAX_EPISODES = 256;

/**
 * The switch, as an object rather than an exported `let`.
 *
 * The call site in `CharacterAnimator` reads `WATCH.on` once per body per frame and builds the
 * sample only when it is true. An exported `let` could not be read that cheaply from another
 * module without a function call, and a function call per body per frame is the kind of cost R7
 * is about.
 */
export const WATCH = { on: false };

/** Milliseconds each body has been airborne-and-moving, by entity id. */
const held = new Map<number, number>();

/** Bodies already reported for the episode they are in, so one episode warns once. */
const reported = new Set<number>();

const episodes: number[] = [];

const trips: AirPoseTrip[] = [];
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Whether the query string asks for the watch.
 *
 * Pure and taking the search string, like `consoleApiWanted`, so it is testable without a
 * `location`. The key is `airpose`; `?airpose=1` and a bare `?airpose` both turn it on.
 */
export function airPoseWatchWanted(search: string): boolean {
  const params = new URLSearchParams(search);
  const value = params.get('airpose');
  return value !== null && value !== '0';
}

/** Turn the watch on or off. Turning it off clears what it had, so a second run starts clean. */
export function setAirPoseWatch(on: boolean): void {
  WATCH.on = on;
  if (!on) resetAirPoseWatch();
}

/**
 * One frame of one body. Called only when `WATCH.on`, from `CharacterAnimator.setLocomotion`.
 *
 * Counts the episode, ends it when the body stops being airborne-and-moving, and warns once
 * when it runs past `STUCK_MS`.
 */
export function watchAirPose(sample: AirPoseSample): void {
  const moving = sample.planarSpeed > MOVING_SPEED;
  if (!sample.airborne || !moving) {
    endEpisode(sample.entityId);
    return;
  }
  const heldMs = (held.get(sample.entityId) ?? 0) + Math.max(0, sample.dt) * 1000;
  held.set(sample.entityId, heldMs);
  if (heldMs <= STUCK_MS || reported.has(sample.entityId)) return;
  reported.add(sample.entityId);
  const trip: AirPoseTrip = { ...sample, heldMs: Math.round(heldMs) };
  trips.push(trip);
  // eslint-disable-next-line no-console -- the point of the instrument is to say so, loudly.
  console.warn('[air-pose] a body is walking in the air pose', trip);
}

/** What the watch has seen. Read from `__p7.airPose()`. */
export function airPoseReport(): AirPoseReport {
  const running = [...held.values()];
  const worstMs = Math.round(Math.max(0, ...episodes, ...running));
  return {
    on: WATCH.on,
    episodes: [...episodes].sort((a, b) => b - a),
    worstMs,
    trips: [...trips],
  };
}

/** Forget everything measured. The watch stays on. */
export function resetAirPoseWatch(): void {
  held.clear();
  reported.clear();
  episodes.length = 0;
  trips.length = 0;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * Close one body's episode and keep its length.
 *
 * The lengths are the comparison the threshold was chosen against, so they are worth keeping
 * even when nothing trips: a run whose longest episode is 560 ms is a run that saw only jumps.
 */
function endEpisode(entityId: number): void {
  const heldMs = held.get(entityId);
  if (heldMs === undefined) return;
  held.delete(entityId);
  reported.delete(entityId);
  if (heldMs <= 0) return;
  episodes.push(Math.round(heldMs));
  if (episodes.length > MAX_EPISODES) episodes.shift();
}
//#endregion
