/**
 * The match intro's camera path (M15, Phase C): a plan, not a player.
 *
 * ## What it hides, and what it is
 *
 * The brief called this a hidden loading screen. In this project there is nothing to hide —
 * the connected path builds the next map during the previous match's summary (§6.5), the
 * solo path before `MATCH` — but there *is* the round-one freeze, in which the player stands
 * at spawn unable to move. The intro is client-only presentation over a built world during a
 * freeze the server already runs. Nothing goes on the wire.
 *
 * ## The freeze is sized to the intro, not the other way round (M17, C2)
 *
 * The freeze used to be ten seconds flat, and the plan was fitted into it: 3.5 s of approach,
 * 1.5 of pull-back, 3.5 for the objectives, 0.5 of return and 1.0 of the player's own view.
 * The report was that it was *"too aggressive and disjointed"*, and the human's decision was
 * the other way about: *"the camera should take the exact time it needs; the 5 seconds is
 * strictly the countdown after the camera finishes its overview."* So `matchStartSeconds`
 * is now a function of the map and the mode — `introSeconds` (the phases' own budgets, with
 * the objectives counted) plus the return blend plus `COUNTDOWN_SECONDS` — and the server
 * and the client compute the same number from the same two facts, which is what lets a
 * replicated client back out the freeze's total from the seconds remaining on the wire. The
 * plan still fills its budget and holds the last pose for whatever it did not use, because
 * an approach's length is the player's spawn's and the freeze cannot be.
 *
 * ## Three phases, then the countdown
 *
 * The plan's segments fill `introSeconds`; the return blend follows, and then the countdown
 * in the player's own eyes — a player looking through a cinematic camera when the round goes
 * live has been ambushed by their own UI, and five seconds is the human's number for reading
 * the room and the quick class selector:
 *
 *  1. **The approach** — spawn to the map's centre on the bots' own route (`Pathfinder` over
 *     the match's `NavGrid`, a second instance so the bots' queue is untouched), a filleted
 *     polyline through the waypoints at eye height, the heading the route's own averaged
 *     over a few metres either side so a corner is turned into rather than snapped round,
 *     pitch held a few degrees down. A distance/time profile eased at both ends with a
 *     ceiling: a route longer than the ceiling allows is **trimmed from the spawn end**, not
 *     sped up, because the approach reads as a person moving or it does not read.
 *  2. **The overview** — a pull-back from the centre, **straight back along the heading the
 *     approach arrived on** and up at 45°, so the camera rises away from what it was looking
 *     at and its heading never moves while it climbs (it used to pull back along the spawn's
 *     azimuth while looking past the centre, and the two disagreeing is what was reported as
 *     *"while climbing at 45 degrees, the camera continues to rotate"*); to the distance at
 *     which the map's half-diagonal fits the lens, clamped by the first collider the ray
 *     meets (a roof, a wall), else the *smallest turn* of a fan around it that clears —
 *     computed, never tuned per map. On a turned ray the heading **eases once**, with the
 *     climb, from the approach's to the map's centre, and ends on it: a heading that held
 *     while the ray turned put the camera beside the map looking past it (playtest,
 *     2026-09-20: *"the map is not in the centre of the camera but to the left"* — measured
 *     at 30° to 150° off-axis on twelve of Foundry's sixteen spawns). Straight back, the two
 *     headings are the same and nothing turns, which is the previous report's fix kept.
 *  3. **The objectives**, after a rest on the overview — Domination's flags in label order,
 *     Search & Destroy's two sites:
 *     a snap down to each, a hold with its label, a whip to the next along a nav route with
 *     the speed profile inverted (fast in the middle, eased into the hold). A route the grid
 *     cannot find falls back to an arc above the map, never through it. Team Deathmatch,
 *     Free-for-All and Kill Confirmed hold the overview instead.
 *
 * ## Pure, so it can be proved
 *
 * Loose numbers, `shared/` maths, no `three`, no clock: the same function runs in the client
 * on the freeze's first frame and in `npm run intro` on the server build, where every map ×
 * mode is planned, sampled every 25 cm and tested against the map's own `CollisionWorld`.
 * The plan reports what it trimmed and what it could not route, so the harness prints a
 * number rather than a shrug.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { Path, Pathfinder, type PathClient } from '../ai/Pathing';
import { angleDelta } from '../core/MathUtil';
import { simCos, simSin } from '../core/SimMath';
import type { GameModeId } from '../modes/GameMode';
import type { MovementConfig } from '../player/MovementConfig';
import { makeMoveOutput, type CollisionWorld, type MoveOutput } from '../world/CollisionWorld';
import type { NavGrid } from '../world/NavGrid';
import type { MapDef, ObjectiveDef, Vec3Lit } from '../world/maps/types';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface IntroPose {
  x: number;
  y: number;
  z: number;
  /** three's yaw: 0 faces -Z, +X is -π/2. */
  yaw: number;
  pitch: number;
}

export type IntroSegmentKind = 'approach' | 'pullback' | 'hold' | 'snap' | 'whip';

export interface IntroSegment {
  readonly kind: IntroSegmentKind;
  readonly seconds: number;
  /** An objective's label while the camera is on it, else empty. */
  readonly label: string;
  /** Metres the segment travels, for the harness's report. */
  readonly metres: number;
  /** The pose at `u` in [0, 1]. */
  at(u: number, out: IntroPose): void;
}

export interface IntroPlan {
  readonly segments: readonly IntroSegment[];
  /** The segments' total. The client blends back to the rig for `RETURN_SECONDS` after it. */
  readonly seconds: number;
  readonly approachMetres: number;
  /** Metres cut from the spawn end so the approach fits its budget. */
  readonly trimmedMetres: number;
  /** Objective ids visited, in order. */
  readonly objectives: readonly string[];
  /** Whips that fell back to the arc because the grid had no route. */
  readonly arcs: readonly string[];
  readonly overviewDistance: number;
  /** What the pull-in, the whips and their holds cost. */
  readonly objectiveSeconds: number;
  /** Tabulated points pushed off a collider by `relax` — grazes the route hugs at the bots' clearance. */
  readonly nudged: number;
  /** The raised waypoints each travelling segment was built on, in segment order; empty for the rest. */
  readonly waypoints: readonly (readonly Vec3Lit[])[];
  poseAt(t: number, out: IntroPose): void;
}

export interface IntroInput {
  readonly def: MapDef;
  readonly nav: NavGrid;
  readonly collision: CollisionWorld;
  readonly movement: MovementConfig;
  readonly modeId: GameModeId;
  /** Where the player stands: the spawn the freeze holds them at. */
  readonly spawn: Vec3Lit;
  /** The intro camera's vertical field of view, degrees — what the overview is fitted to. */
  readonly fovDeg: number;
  /** The freeze's length; the plan fits in it less the return and the countdown. */
  readonly freezeSeconds: number;
}

export interface IntroSample extends IntroPose {
  readonly t: number;
  readonly segment: IntroSegmentKind;
}

/** The polyline being accumulated: three parallel arrays, the shape the table wants. */
interface Polyline {
  readonly xs: number[];
  readonly ys: number[];
  readonly zs: number[];
}

/**
 * Everything the three phases share while a plan is being built.
 *
 * `planIntro` is called once, on the freeze's first frame, so a record to carry the phases'
 * shared state costs nothing and is what lets each phase be a function with a name instead of
 * another forty lines of one.
 */
interface PlanBuild {
  readonly input: IntroInput;
  readonly finder: Pathfinder;
  readonly centre: Vec3Lit;
  /** The freeze less the return blend and the countdown: what the segments may fill. */
  readonly budget: number;
  readonly segments: IntroSegment[];
  readonly waypoints: Vec3Lit[][];
  readonly visited: string[];
  readonly arcs: string[];
  nudged: number;
  used: number;
  approachMetres: number;
  trimmedMetres: number;
  overviewDistance: number;
  objectiveSeconds: number;
}

/** Where the pull-back ends, what it looks at, and the one turn it eases through. */
interface OverviewPhase {
  readonly pose: IntroPose;
  readonly target: Vec3Lit;
  readonly turn: number;
}

/** A ray the overview might pull back along, and how far the eye can travel on it. */
interface OverviewRay {
  x: number;
  y: number;
  z: number;
  distance: number;
}

/** One leg of the tour: the whip to an objective's stand-off, and the hold on it. */
interface ObjectiveLeg {
  readonly travel: IntroSegment;
  readonly hold: IntroSegment;
  readonly points: Vec3Lit[];
  readonly stand: IntroPose;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** The blend from the last pose back to the rig's eye. */
export const RETURN_SECONDS = 1.0;

/** The countdown in the player's own eyes before the freeze lifts (M17, decision 6). */
export const COUNTDOWN_SECONDS = 5;

export const APPROACH_MAX_SECONDS = 6;

export const PULLBACK_SECONDS = 3;

/** The rest on the overview once the pull-back lands, before the objectives or the return. */
export const OVERVIEW_HOLD_SECONDS = 1.5;

/** Metres per second at the approach's fastest; a sprint is 6.9, a walk 2.5. */
export const APPROACH_PEAK_SPEED = 5.5;

/** Metres per second at a whip's fastest. */
export const WHIP_PEAK_SPEED = 16;

/** The player's eye above the ground it stands on (`PlayerSnapshot.eyeHeight`). */
export const EYE_HEIGHT = 1.65;

/**
 * The sphere the camera keeps clear, and the one the harness tests: the bots' capsule is
 * 0.35 wide, but at eye height it has narrowed to 0.287 — the eye sits in the capsule's top
 * cap — and the route is pulled to that clearance at every corner, so a larger sphere would
 * flag the route the bots walk. The lens's near plane is 0.12; this is twice it.
 */
export const EYE_RADIUS = 0.25;

const APPROACH_PITCH = (-6 * Math.PI) / 180;

/** A minimum for the approach: shorter than this reads as a cut, not a move. */
const APPROACH_MIN_SECONDS = 2.5;

/** The pull back in from the overview to the centre; the pull-back reversed. */
export const SNAP_SECONDS = 1.2;

export const OBJECTIVE_HOLD_SECONDS = 1.0;

/** A whip's longest. */
export const WHIP_MAX_SECONDS = 1.5;

/** The camera's stand-off from an objective: back along the arrival, and up. */
const OBJECTIVE_BACK = 4;

const OBJECTIVE_UP = 3;

/** How far the overview ray keeps from the collider that stops it. */
const OVERVIEW_CLEARANCE = 1.5;

/**
 * Metres either side of the camera over which the route's tangents are averaged for the
 * heading (M17, C2). A corner the route hugs at the bots' clearance is a right angle in a
 * few centimetres; the eye turns into it over `2 × HEADING_WINDOW` metres instead, which at
 * the approach's pace is a second and a half. It replaced a 0.3 s lag on the position's own
 * tangent, which only delayed the snap.
 */
const HEADING_WINDOW = 2.5;

const WHIP_HEADING_WINDOW = 3;

const HEADING_STEP = 0.25;

/** The overview's sphere march. */
const MARCH_STEP = 0.25;

/**
 * Where the overview may look from: turns off the spawn's azimuth, in two bands, and
 * elevations under 45°. The near band — up to 60° either side — is tried at every elevation
 * before the far band is tried at any: a lower overview from the player's own side beats a
 * 45° one from across the map, because the heading has to turn onto the centre by the size
 * of the turn (see phase 2 in the file comment) and because the player's side is then the
 * near edge of the frame rather than the far one. Foundry B's spawns are the case: at 45°
 * nothing under 120° clears the deck over the centre; at 36° straight back does.
 */
const OVERVIEW_NEAR_TURNS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3];

const OVERVIEW_FAR_TURNS = [Math.PI / 2, -Math.PI / 2, (2 * Math.PI) / 3, (-2 * Math.PI) / 3, (5 * Math.PI) / 6, (-5 * Math.PI) / 6, Math.PI];

const OVERVIEW_ELEVATIONS = [Math.PI / 4, Math.PI / 5, Math.PI / 6];

/** The most a corner is rounded by: a cut of `FILLET × 0.29` at a right angle. See `Spline`. */
const FILLET = 0.12;

/** The most a point may be pushed off a collider before it is a route problem, not a graze. */
const MAX_NUDGE = 0.3;

const SPAN_STEP = 0.125;

const RELAX_ROUNDS = 4;
//#endregion

// ======================================== CLASS Spline ======================================== \\
//#region Class Spline
/**
 * The route as a curve, tabulated by distance.
 *
 * **A polyline with small fillets, not a Catmull-Rom.** The first version was a Catmull-Rom
 * through the waypoints, and `npm run intro` put its first bad sample 0.95 m from the nearest
 * waypoint, inside a crate: a Catmull-Rom overshoots a corner by a good fraction of the spans
 * either side, and the bots' string-pulled route hugs every corner at the capsule's radius,
 * so an overshoot of any size is an overshoot into the thing the route was pulled around.
 * Each corner is rounded with a quadratic fillet of at most `FILLET` metres instead — a cut
 * of `FILLET × 0.29` at a right angle, three and a half centimetres, inside the four the
 * route keeps clear of `EYE_RADIUS` at head height — and the heading, not the position, is
 * what the eye smooths (`yawAt`, and the lag in the approach).
 *
 * The table is what makes a speed profile honest: `at(s)` is a position `s` metres along
 * the curve, so a profile in metres per second moves the camera at that speed rather than at
 * whatever a parameter step happens to cover between two close waypoints and two far ones.
 */
class Spline {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly length: number;

  private readonly px: Float64Array;

  private readonly py: Float64Array;

  private readonly pz: Float64Array;

  private readonly cum: Float64Array;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(points: readonly Vec3Lit[]) {
    if (points.length === 0) throw new Error('a spline needs a point');
    const { xs, ys, zs } = filletedPolyline(points);
    this.px = Float64Array.from(xs);
    this.py = Float64Array.from(ys);
    this.pz = Float64Array.from(zs);
    this.cum = new Float64Array(xs.length);
    this.length = this.retable();
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Push every tabulated point out of whatever the eye's sphere touches — a few centimetres
   * off a crate's corner or a wall the route hugs at exactly the bots' clearance — and retake
   * the table's lengths. One point's push is `nudgePoint`, which is where the rules for it are.
   */
  relax(collision: CollisionWorld, radius: number): number {
    const out = makeMoveOutput();
    let nudged = 0;
    const count = this.px.length;
    // A few rounds: a point pushed off one face of a convex corner can land in the next
    // point's sphere, and the span between two pushed points can still cut the corner.
    for (let round = 0; round < RELAX_ROUNDS; round++) {
      let movedThisRound = 0;
      for (let k = 0; k < count; k++) {
        if (this.nudgePoint(k, collision, radius, out)) movedThisRound++;
      }
      nudged += movedThisRound;
      if (movedThisRound === 0) break;
    }
    if (nudged > 0) (this as { length: number }).length = this.retable();
    return nudged;
  }

  /** Position `s` metres along, clamped to the ends. */
  at(s: number, out: IntroPose): void {
    const cum = this.cum;
    const n = cum.length;
    if (n === 1 || s <= 0) {
      out.x = this.px[0]!;
      out.y = this.py[0]!;
      out.z = this.pz[0]!;
      return;
    }
    if (s >= this.length) {
      out.x = this.px[n - 1]!;
      out.y = this.py[n - 1]!;
      out.z = this.pz[n - 1]!;
      return;
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const span = cum[hi]! - cum[lo]!;
    const f = span > 0 ? (s - cum[lo]!) / span : 0;
    out.x = this.px[lo]! + (this.px[hi]! - this.px[lo]!) * f;
    out.y = this.py[lo]! + (this.py[hi]! - this.py[lo]!) * f;
    out.z = this.pz[lo]! + (this.pz[hi]! - this.pz[lo]!) * f;
  }

  /** The horizontal heading `s` metres along, as three's yaw. */
  yawAt(s: number): number {
    const a: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const b: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const h = Math.min(0.5, Math.max(0.05, this.length * 0.02));
    this.at(Math.max(0, s - h), a);
    this.at(Math.min(this.length, s + h), b);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (Math.hypot(dx, dz) < 1e-6) return 0;
    return yawOf(dx, dz);
  }

  /**
   * The heading `s` metres along, averaged over `span` metres either side (M17, C2): the
   * mean of the unit tangents sampled every `HEADING_STEP`, clamped to the curve's ends so
   * the heading at the start is the first span's and at the end the last's. A corner is a
   * step in `yawAt` and a ramp in this.
   */
  headingAt(s: number, span: number): number {
    if (span <= HEADING_STEP) return this.yawAt(s);
    const a: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const b: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    let sx = 0;
    let sz = 0;
    for (let d = -span; d < span; d += HEADING_STEP) {
      const s0 = Math.max(0, Math.min(this.length, s + d));
      const s1 = Math.max(0, Math.min(this.length, s + d + HEADING_STEP));
      if (s1 - s0 < 1e-6) continue;
      this.at(s0, a);
      this.at(s1, b);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      // Weighted by the sample's length, so a long straight outweighs a short fillet.
      sx += dx;
      sz += dz;
    }
    if (Math.hypot(sx, sz) < 1e-6) return this.yawAt(s);
    return yawOf(sx, sz);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * Push one tabulated point out of whatever the eye's sphere touches, and say whether it
   * moved. `resolveAt` is the movement system's own de-penetration, so the camera is pushed
   * the way a body would be: along the contact normal, by the depth. A point that would move
   * by more than `MAX_NUDGE` is left where it is, because a push that large means the route
   * is wrong, not close, and the harness should say so rather than have it hidden.
   */
  private nudgePoint(k: number, collision: CollisionWorld, radius: number, out: MoveOutput): boolean {
    const x = this.px[k]!;
    const y = this.py[k]!;
    const z = this.pz[k]!;
    if (!collision.overlapCapsule(x, y - radius, z, radius, radius * 2)) return false;
    collision.resolveAt(x, y - radius, z, radius, radius * 2, out);
    const moved = Math.hypot(out.x - x, out.y + radius - y, out.z - z);
    if (moved > MAX_NUDGE || moved < 1e-6) return false;
    this.px[k] = out.x;
    this.py[k] = out.y + radius;
    this.pz[k] = out.z;
    return true;
  }

  /**
   * Re-measure the cumulative lengths from the points, and return the total.
   *
   * The table is what makes a speed profile honest, and it is measured twice — once when the
   * polyline is built and again after `relax` has moved points off the world. One loop.
   */
  private retable(): number {
    let total = 0;
    for (let k = 1; k < this.px.length; k++) {
      total += Math.hypot(this.px[k]! - this.px[k - 1]!, this.py[k]! - this.py[k - 1]!, this.pz[k]! - this.pz[k - 1]!);
      this.cum[k] = total;
    }
    return total;
  }
  //#endregion
}
//#endregion

// ==================================== CLASS OneShotClient ===================================== \\
//#region Class OneShotClient
class OneShotClient implements PathClient {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly pathClientId = -2;

  readonly path = new Path();

  done = false;

  found = false;
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  onPathReady(found: boolean): void {
    this.done = true;
    this.found = found;
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * The intro's own length on this map in this mode: the phases' budgets, with the objectives
 * counted. What the plan fills, holding the last pose for whatever it does not use.
 */
export function introSeconds(def: MapDef, modeId: GameModeId): number {
  const objectives = objectivesFor(def, modeId).length;
  const tour = objectives > 0 ? SNAP_SECONDS + objectives * (WHIP_MAX_SECONDS + OBJECTIVE_HOLD_SECONDS) : 0;
  return APPROACH_MAX_SECONDS + PULLBACK_SECONDS + OVERVIEW_HOLD_SECONDS + tour;
}

/**
 * The round-one freeze: the intro, the blend back to the player's eyes, the countdown. The
 * server's number and the client's, from the same two facts (see the file comment).
 *
 * **None in the Shooting Range** (2026-10-03). `IntroCamera` has never flown the range — there
 * is no fight to introduce — but the freeze was still sized for the flight it skipped, so the
 * testbed opened on sixteen seconds of GET READY with nobody to get ready for. A range is
 * entered to shoot at something; it goes live on its first tick.
 */
export function matchStartSeconds(def: MapDef, modeId: GameModeId): number {
  if (modeId === 'RANGE') return 0;
  return introSeconds(def, modeId) + RETURN_SECONDS + COUNTDOWN_SECONDS;
}

export function planIntro(input: IntroInput): IntroPlan {
  const build: PlanBuild = {
    input,
    finder: new Pathfinder(input.nav, input.movement.stepHeight, input.movement.groundSnapDist),
    centre: mapCentre(input),
    budget: Math.max(0, input.freezeSeconds - RETURN_SECONDS - COUNTDOWN_SECONDS),
    segments: [],
    waypoints: [],
    visited: [],
    arcs: [],
    nudged: 0,
    used: 0,
    approachMetres: 0,
    trimmedMetres: 0,
    overviewDistance: 0,
    objectiveSeconds: 0,
  };

  const approachEnd = planApproach(build);
  const overview = planOverview(build, approachEnd);
  planObjectiveTour(build, approachEnd, overview);
  holdRemainder(build);
  return assemblePlan(build);
}

/** The objectives a mode's intro visits, in order; empty for the deathmatch modes. */
export function objectivesFor(def: MapDef, modeId: GameModeId): ObjectiveDef[] {
  const kind = modeId === 'DOM' ? 'flag' : modeId === 'SND' ? 'bombsite' : null;
  if (kind === null) return [];
  return def.objectives
    .filter((o) => o.kind === kind)
    .slice()
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}


/**
 * The whole path, sampled at most `stepMetres` apart (and at least every 1/64 of a segment,
 * so a hold is still visited). What `npm run intro` tests against the colliders.
 */
export function sampleIntro(plan: IntroPlan, stepMetres: number): IntroSample[] {
  const out: IntroSample[] = [];
  const pose: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  let t0 = 0;
  for (const segment of plan.segments) {
    const steps = Math.max(64, Math.ceil((segment.metres * 1.5) / Math.max(stepMetres, 0.01)));
    for (let i = 0; i <= steps; i++) {
      segment.at(i / steps, pose);
      out.push({ ...pose, t: t0 + (segment.seconds * i) / steps, segment: segment.kind });
    }
    t0 += segment.seconds;
  }
  return out;
}

/** Samples whose camera point sits inside a collider: a sphere of `radius` at the eye. */
export function collidingSamples(plan: IntroPlan, collision: CollisionWorld, stepMetres: number, radius: number): IntroSample[] {
  const bad: IntroSample[] = [];
  for (const s of sampleIntro(plan, stepMetres)) {
    // `overlapCapsule` takes the feet; a capsule of height 2r on feet y - r is a sphere at y.
    if (collision.overlapCapsule(s.x, s.y - radius, s.z, radius, radius * 2)) bad.push(s);
  }
  return bad;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** A smoothstep ease: position, and (for the profile) its peak speed is 1.5× the average. */
function ease(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

/** three's yaw for a horizontal direction. */
function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

function lookAt(from: IntroPose, tx: number, ty: number, tz: number): void {
  const dx = tx - from.x;
  const dy = ty - from.y;
  const dz = tz - from.z;
  from.yaw = yawOf(dx, dz);
  from.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}


function pushPoint(acc: Polyline, x: number, y: number, z: number): void {
  acc.xs.push(x);
  acc.ys.push(y);
  acc.zs.push(z);
}

/**
 * A straight span is subdivided every `SPAN_STEP` metres, so `relax` has a point to push
 * where a graze falls mid-span rather than only at the corners.
 */
function subdivideTo(acc: Polyline, tx: number, ty: number, tz: number): void {
  const fx = acc.xs[acc.xs.length - 1]!;
  const fy = acc.ys[acc.ys.length - 1]!;
  const fz = acc.zs[acc.zs.length - 1]!;
  const len = Math.hypot(tx - fx, ty - fy, tz - fz);
  const steps = Math.max(1, Math.ceil(len / SPAN_STEP));
  for (let j = 1; j < steps; j++) {
    const t = j / steps;
    pushPoint(acc, fx + (tx - fx) * t, fy + (ty - fy) * t, fz + (tz - fz) * t);
  }
}

/** One corner: a quadratic fillet of at most `FILLET` metres, or straight through. */
function pushCorner(acc: Polyline, a: Vec3Lit, p: Vec3Lit, b: Vec3Lit): void {
  const inLen = Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
  const outLen = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
  const r = Math.min(FILLET, inLen / 2, outLen / 2);
  if (r < 1e-4 || inLen < 1e-6 || outLen < 1e-6) {
    subdivideTo(acc, p.x, p.y, p.z);
    pushPoint(acc, p.x, p.y, p.z);
    return;
  }
  // Straight to the fillet's start, a quadratic through the corner to its end.
  const sx = p.x - ((p.x - a.x) / inLen) * r;
  const sy = p.y - ((p.y - a.y) / inLen) * r;
  const sz = p.z - ((p.z - a.z) / inLen) * r;
  const ex = p.x + ((b.x - p.x) / outLen) * r;
  const ey = p.y + ((b.y - p.y) / outLen) * r;
  const ez = p.z + ((b.z - p.z) / outLen) * r;
  subdivideTo(acc, sx, sy, sz);
  pushPoint(acc, sx, sy, sz);
  for (let j = 1; j < 6; j++) {
    const t = j / 6;
    const u = 1 - t;
    pushPoint(acc, u * u * sx + 2 * u * t * p.x + t * t * ex, u * u * sy + 2 * u * t * p.y + t * t * ey, u * u * sz + 2 * u * t * p.z + t * t * ez);
  }
  pushPoint(acc, ex, ey, ez);
}

/** The waypoints as the filleted, subdivided polyline the arc-length table is built on. */
function filletedPolyline(points: readonly Vec3Lit[]): Polyline {
  const n = points.length;
  const acc: Polyline = { xs: [], ys: [], zs: [] };
  pushPoint(acc, points[0]!.x, points[0]!.y, points[0]!.z);
  for (let i = 1; i < n - 1; i++) pushCorner(acc, points[i - 1]!, points[i]!, points[i + 1]!);
  if (n > 1) {
    subdivideTo(acc, points[n - 1]!.x, points[n - 1]!.y, points[n - 1]!.z);
    pushPoint(acc, points[n - 1]!.x, points[n - 1]!.y, points[n - 1]!.z);
  }
  return acc;
}

/**
 * The waypoints from `a` to `b` on the grid, at ground height, or null if there is no route.
 *
 * Solved synchronously with a generous budget on a `Pathfinder` of the plan's own, the shape
 * `ModePanel.measureLanes` uses: the grid is ~27 k nodes and a crossing is a few thousand
 * expansions. The start and the goal are the nearest walkable cells, so an objective that is
 * authored a hand's breadth inside a wall still routes. The list starts at `a` itself, not at
 * its cell's centre: for the approach `a` is where the player stands, and a camera in the
 * player's own eyes is clear by construction where a cell centre half a metre away may not be.
 */
function route(nav: NavGrid, finder: Pathfinder, a: Vec3Lit, b: Vec3Lit): Vec3Lit[] | null {
  const start = nav.nearestCell(a.x, a.y, a.z, 12);
  const goal = nav.nearestCell(b.x, b.y, b.z, 12);
  if (start < 0 || goal < 0) return null;
  const client = new OneShotClient();
  finder.request(client, start, goal);
  for (let i = 0; i < 64 && !client.done; i++) finder.step(4096);
  if (!client.found) return null;
  // `a` itself, then its cell's centre — a hand's breadth away and linked to the path — so
  // the first span is that hand's breadth rather than a straight cut to a string-pulled
  // waypoint several cells on, which `npm run intro` found going through the crate a spawn
  // stood behind.
  const points: Vec3Lit[] = [
    { x: a.x, y: a.y, z: a.z },
    { x: nav.centerX(nav.indexOfX(start)), y: nav.heightAt(start), z: nav.centerZ(nav.indexOfZ(start)) },
  ];
  for (let i = 0; i < client.path.count; i++) {
    points.push({ x: client.path.x[i]!, y: client.path.y[i]!, z: client.path.z[i]! });
  }
  return points;
}

/**
 * How far a sphere can travel from `from` along a direction before it meets a collider —
 * marched at `MARCH_STEP`, with the same sphere the harness tests, because a line ray can
 * pass the edge of a deck that a 30 cm eye cannot. Capped at `maxDist`.
 */
function clearDistance(
  collision: CollisionWorld,
  from: IntroPose,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  radius: number,
): number {
  for (let s = MARCH_STEP; s <= maxDist; s += MARCH_STEP) {
    const x = from.x + dx * s;
    const y = from.y + dy * s;
    const z = from.z + dz * s;
    if (collision.overlapCapsule(x, y - radius, z, radius, radius * 2)) return Math.max(0, s - MARCH_STEP);
  }
  return maxDist;
}

/**
 * The route at eye height — and hopped, where the route climbs or drops.
 *
 * A bot's route mantles: two consecutive waypoints a ledge apart are joined by a straight
 * line the capsule is allowed through because the mantle animation carries it. A camera on
 * that line goes through the ledge's edge at head height (`npm run intro`'s Foundry box 31).
 * So where the rise exceeds `step`, the camera goes *up first* — over the lower waypoint,
 * to the higher one's eye height, which is clear because the bot stands there — and then
 * across at the higher height, over the ledge; a drop is the mirror, across first and then
 * down over the lower waypoint.
 */
function raised(points: readonly Vec3Lit[], by: number, step = 0.5): Vec3Lit[] {
  const out: Vec3Lit[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = out[out.length - 1];
    if (prev !== undefined) {
      const rise = p.y + by - prev.y;
      if (rise > step) out.push({ x: prev.x, y: p.y + by, z: prev.z });
      else if (rise < -step) out.push({ x: p.x, y: prev.y, z: p.z });
    }
    out.push({ x: p.x, y: p.y + by, z: p.z });
  }
  return out;
}

/**
 * Where the camera holds on an objective: back along the arrival and up, looking at it —
 * the first of a few stand-offs that the eye's sphere finds clear, nearer and lower each
 * time, because a flag under a catwalk has no clear point four metres back and three up.
 */
function standOff(collision: CollisionWorld, o: Vec3Lit, from: IntroPose): IntroPose {
  let bx = from.x - o.x;
  let bz = from.z - o.z;
  const blen = Math.hypot(bx, bz);
  if (blen < 1e-3) {
    bx = 0;
    bz = 1;
  } else {
    bx /= blen;
    bz /= blen;
  }
  const tries: readonly (readonly [number, number])[] = [
    [OBJECTIVE_BACK, OBJECTIVE_UP],
    [3, 2.2],
    [2.5, EYE_HEIGHT],
    [1.5, EYE_HEIGHT],
    [0, EYE_HEIGHT],
  ];
  const stand: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  for (const [back, up] of tries) {
    stand.x = o.x + bx * back;
    stand.y = o.y + up;
    stand.z = o.z + bz * back;
    if (!collision.overlapCapsule(stand.x, stand.y - EYE_RADIUS, stand.z, EYE_RADIUS, EYE_RADIUS * 2)) break;
  }
  lookAt(stand, o.x, o.y + 0.5, o.z);
  if (Math.hypot(stand.x - o.x, stand.z - o.z) < 1e-3) {
    // Standing on the objective itself: look along the arrival rather than at the feet.
    stand.yaw = yawOf(-bx, -bz);
    stand.pitch = APPROACH_PITCH;
  }
  return stand;
}

/** Drop waypoints from the front until the polyline is at most `maxMetres` long. */
function trimFront(points: Vec3Lit[], maxMetres: number): { points: Vec3Lit[]; trimmed: number } {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y, points[i]!.z - points[i - 1]!.z);
  }
  let trimmed = 0;
  const out = points.slice();
  while (out.length > 2 && total - trimmed > maxMetres) {
    const a = out[0]!;
    const b = out[1]!;
    const step = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (total - trimmed - step < maxMetres * 0.85) {
      // Cut the first span part-way instead of dropping it whole: the route should end up
      // *at* the limit, not well under it.
      const over = total - trimmed - maxMetres;
      const f = Math.min(1, over / Math.max(step, 1e-6));
      out[0] = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
      trimmed += over;
      break;
    }
    out.shift();
    trimmed += step;
  }
  return { points: out, trimmed };
}


/** The centre: the nav bounds' middle, on the nearest walkable cell. */
function mapCentre(input: IntroInput): Vec3Lit {
  const nav = input.nav;
  const b = input.def.navBounds;
  const guess: Vec3Lit = { x: (b.min.x + b.max.x) / 2, y: input.spawn.y, z: (b.min.z + b.max.z) / 2 };
  const cell = nav.nearestCell(guess.x, guess.y, guess.z, 24);
  return cell >= 0
    ? { x: nav.centerX(nav.indexOfX(cell)), y: nav.heightAt(cell), z: nav.centerZ(nav.indexOfZ(cell)) }
    : guess;
}

/**
 * Phase 1: spawn to the centre on the bots' own route, at eye height, eased at both ends.
 *
 * Returns the pose the approach ends on, which phase 2 pulls back from. Where the player
 * actually stands is the spawn **de-penetrated with the player's own capsule** the way the
 * movement system does it on the first tick: `npm run intro` found two spawn zones authored
 * against a crate — Foundry B (−27, 2) and Depot B (−28, −19), the eye half a metre inside it
 * — and a camera that starts where the *sim* puts the body is right on every map, including
 * those two until their zones are moved.
 */
function planApproach(build: PlanBuild): IntroPose {
  const { input, centre } = build;
  const { nav, collision, movement, spawn } = input;
  const stood = makeMoveOutput();
  collision.resolveAt(spawn.x, spawn.y, spawn.z, movement.capsuleRadius, movement.standHeight, stood);
  const start: Vec3Lit = { x: stood.x, y: stood.y, z: stood.z };
  const approachRoute = route(nav, build.finder, start, centre) ?? [
    { x: start.x, y: start.y, z: start.z },
    { x: centre.x, y: centre.y, z: centre.z },
  ];
  // Average speed is two thirds of the peak under a smoothstep profile.
  const approachMaxMetres = APPROACH_MAX_SECONDS * (APPROACH_PEAK_SPEED / 1.5);
  const trimmedRoute = trimFront(approachRoute, approachMaxMetres);
  const approachPoints = raised(trimmedRoute.points, EYE_HEIGHT);
  const approach = new Spline(approachPoints);
  build.nudged = approach.relax(collision, EYE_RADIUS);
  const approachSeconds = Math.min(
    APPROACH_MAX_SECONDS,
    Math.max(APPROACH_MIN_SECONDS, approach.length / (APPROACH_PEAK_SPEED / 1.5)),
  );
  const approachEnd: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  approach.at(approach.length, approachEnd);
  approachEnd.yaw = approach.headingAt(approach.length, HEADING_WINDOW);
  approachEnd.pitch = APPROACH_PITCH;
  build.approachMetres = approach.length;
  build.trimmedMetres = trimmedRoute.trimmed;
  build.waypoints.push(approachPoints);
  build.segments.push({
    kind: 'approach',
    seconds: approachSeconds,
    label: '',
    metres: approach.length,
    at(u, out) {
      const s = approach.length * ease(u);
      approach.at(s, out);
      // The heading is the route's, averaged either side, so a corner is turned into.
      out.yaw = approach.headingAt(s, HEADING_WINDOW);
      out.pitch = APPROACH_PITCH;
    },
  });
  build.used += approachSeconds;
  return approachEnd;
}

/**
 * The fan the overview is chosen from, in the order it is tried.
 *
 * Turns off the spawn's azimuth, in two bands, and elevations under 45°. The near band — up to
 * 60° either side — is tried at every elevation before the far band is tried at any: a lower
 * overview from the player's own side beats a 45° one from across the map, because the heading
 * has to turn onto the centre by the size of the turn (see phase 2 in the file comment) and
 * because the player's side is then the near edge of the frame rather than the far one.
 * Foundry B's spawns are the case: at 45° nothing under 120° clears the deck over the centre;
 * at 36° straight back does.
 */
function overviewCandidates(spawnAzimuth: number): OverviewRay[] {
  const out: OverviewRay[] = [];
  for (const turns of [OVERVIEW_NEAR_TURNS, OVERVIEW_FAR_TURNS]) {
    for (const elevation of OVERVIEW_ELEVATIONS) {
      for (const turn of turns) {
        const azimuth = spawnAzimuth + turn;
        out.push({
          x: simCos(azimuth) * simCos(elevation),
          y: simSin(elevation),
          z: simSin(azimuth) * simCos(elevation),
          distance: 0,
        });
      }
    }
  }
  return out;
}

/**
 * The ray the overview pulls back along: the spawn's azimuth at 45° when it is clear, else the
 * clearest of the fan.
 *
 * Marched with the eye's own sphere, not a line ray: the first version's line passed the edge
 * of Foundry's deck by a centimetre and the eye did not. The candidates are ordered by the size
 * of the turn and **the first ray that reaches most of the way wins outright** — it used to be
 * the longest ray of the whole fan, which on Foundry B preferred a clear 150° over a 30° that
 * was a few metres short: a heading that has to turn as little as possible to face the centre
 * is worth more than those metres. Nothing clearing means the longest is kept, however short.
 */
function chooseOverviewRay(
  collision: CollisionWorld,
  from: IntroPose,
  wanted: number,
  candidates: readonly OverviewRay[],
): OverviewRay {
  const best: OverviewRay = { x: 0, y: 0, z: 0, distance: 0 };
  for (const candidate of candidates) {
    const clear = clearDistance(collision, from, candidate.x, candidate.y, candidate.z, wanted + OVERVIEW_CLEARANCE, EYE_RADIUS);
    const usable = Math.max(0, Math.min(wanted, clear - OVERVIEW_CLEARANCE));
    if (usable > best.distance) {
      best.distance = usable;
      best.x = candidate.x;
      best.y = candidate.y;
      best.z = candidate.z;
    }
    if (usable >= wanted * 0.8) break;
  }
  return best;
}

/**
 * Phase 2: the pull-back, straight back along the heading the approach arrived on (M17, C2).
 *
 * The camera rises away from what it is looking at, and the heading holds while it climbs. The
 * approach came from the spawn, so the player's own side is still the near edge of the frame.
 * Pushes the pull-back and the rest on the overview that follows it.
 */
function planOverview(build: PlanBuild, approachEnd: IntroPose): OverviewPhase {
  const { input, centre } = build;
  const b = input.def.navBounds;
  const ax = simSin(approachEnd.yaw);
  const az = simCos(approachEnd.yaw);
  const halfDiagonal = Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  const halfFov = ((input.fovDeg / 2) * Math.PI) / 180;
  const tanHalf = simSin(halfFov) / simCos(halfFov);
  const wanted = (halfDiagonal / Math.max(tanHalf, 1e-3)) * 1.05;
  const spawnAzimuth = Math.atan2(az, ax);
  const ray = chooseOverviewRay(input.collision, approachEnd, wanted, overviewCandidates(spawnAzimuth));
  const distance = ray.distance;
  const pose: IntroPose = {
    x: approachEnd.x + ray.x * distance,
    y: approachEnd.y + ray.y * distance,
    z: approachEnd.z + ray.z * distance,
    yaw: 0,
    pitch: 0,
  };
  // The look target: a little past the centre along the approach's heading, so the pull-back
  // starts on the view the approach ended with rather than at the camera's own feet. The
  // pitch comes from it at every point of the climb; the heading does not — it eases from
  // the approach's to the one that puts the map's centre in the middle of the frame at the
  // top of the ray, and on a straight-back ray those two are the same heading.
  const fx = -simSin(approachEnd.yaw);
  const fz = -simCos(approachEnd.yaw);
  const target: Vec3Lit = { x: centre.x + fx * 8, y: centre.y, z: centre.z + fz * 8 };
  lookAt(pose, target.x, target.y, target.z);
  pose.yaw = yawOf(centre.x - pose.x, centre.z - pose.z);
  const turn = angleDelta(approachEnd.yaw, pose.yaw);
  build.overviewDistance = distance;
  const overview: OverviewPhase = { pose, target, turn };
  build.waypoints.push([]);
  build.segments.push(pullbackSegment(build, approachEnd, overview));
  build.used += PULLBACK_SECONDS;

  // The rest on the overview: the map read whole before anything else happens to the camera.
  build.waypoints.push([]);
  build.segments.push(holdSegment(pose, '', OVERVIEW_HOLD_SECONDS));
  build.used += OVERVIEW_HOLD_SECONDS;
  return overview;
}

/** The climb away from what the approach was looking at, easing through its one turn. */
function pullbackSegment(build: PlanBuild, approachEnd: IntroPose, overview: OverviewPhase): IntroSegment {
  const { pose, target, turn } = overview;
  return {
    kind: 'pullback',
    seconds: PULLBACK_SECONDS,
    label: '',
    metres: build.overviewDistance,
    at(u, out) {
      const e = ease(u);
      out.x = approachEnd.x + (pose.x - approachEnd.x) * e;
      out.y = approachEnd.y + (pose.y - approachEnd.y) * e;
      out.z = approachEnd.z + (pose.z - approachEnd.z) * e;
      lookAt(out, target.x, target.y, target.z);
      // One turn, with the climb, onto the centre; none at all when the ray is straight back.
      out.yaw = approachEnd.yaw + turn * e;
      // The pitch: the approach's for the first moments, then the target's as the rise takes it.
      if (u < 0.3) out.pitch = APPROACH_PITCH + (out.pitch - APPROACH_PITCH) * ease(u / 0.3);
    },
  };
}

/** A motionless segment on one pose: the overview's rest, an objective's hold, the remainder. */
function holdSegment(pose: IntroPose, label: string, seconds: number): IntroSegment {
  const held: IntroPose = { ...pose };
  return {
    kind: 'hold',
    seconds,
    label,
    metres: 0,
    at(_u, out) {
      out.x = held.x;
      out.y = held.y;
      out.z = held.z;
      out.yaw = held.yaw;
      out.pitch = held.pitch;
    },
  };
}

/**
 * Phase 3: from the overview, back in to the centre and then objective to objective.
 *
 * The camera **pulls back in** along the way it came — which is clear because the pull-back
 * was — and then whips from objective to objective along the nav routes at eye height. The
 * first version snapped straight from the overview down onto the first objective and
 * `npm run intro` put it through a catwalk on Foundry: a straight line from sixty metres up to
 * three metres over a flag crosses whatever is over the flag, and the whole point of the route
 * is that a route does not.
 *
 * Nothing at all for the deathmatch modes, which hold the overview instead.
 */
function planObjectiveTour(build: PlanBuild, approachEnd: IntroPose, overview: OverviewPhase): void {
  const objectives = objectivesFor(build.input.def, build.input.modeId);
  if (objectives.length === 0) return;

  const pullIn = pullInSegment(build, approachEnd, overview);
  if (build.used + pullIn.seconds > build.budget) return;
  build.segments.push(pullIn);
  build.waypoints.push([]);
  build.used += pullIn.seconds;
  build.objectiveSeconds = pullIn.seconds;

  let previous: IntroPose = { ...approachEnd };
  let previousGround: Vec3Lit = build.centre;
  for (const objective of objectives) {
    const leg = planObjectiveLeg(build, previous, previousGround, objective);
    const cost = leg.travel.seconds + leg.hold.seconds;
    // The freeze was sized for every objective (`introSeconds`); an objective that would
    // still overrun it is left out and the earlier ones kept.
    if (build.used + cost > build.budget + 1e-6) break;
    build.objectiveSeconds += cost;
    build.used += cost;
    build.segments.push(leg.travel, leg.hold);
    build.waypoints.push(leg.points, []);
    build.visited.push(objective.id);
    previous = leg.stand;
    previousGround = objective.position;
  }
}

/** The pull-back, reversed: down to the centre and level again, ready for the first whip. */
function pullInSegment(build: PlanBuild, approachEnd: IntroPose, overview: OverviewPhase): IntroSegment {
  const { pose, target, turn } = overview;
  return {
    kind: 'snap',
    seconds: SNAP_SECONDS,
    label: '',
    metres: build.overviewDistance,
    at(u, out) {
      const e = ease(u);
      out.x = pose.x + (approachEnd.x - pose.x) * e;
      out.y = pose.y + (approachEnd.y - pose.y) * e;
      out.z = pose.z + (approachEnd.z - pose.z) * e;
      lookAt(out, target.x, target.y, target.z);
      // The pull-back's turn, undone with the descent.
      out.yaw = pose.yaw - turn * e;
      // Level out over the last third, onto the approach's own pitch.
      if (u > 0.66) {
        const f = ease((u - 0.66) / 0.34);
        out.pitch = out.pitch + (APPROACH_PITCH - out.pitch) * f;
      }
    },
  };
}

/**
 * The route to one objective, its whip and its hold.
 *
 * A route the grid cannot find falls back to an arc above the map, never through it. The route
 * begins over the previous objective and the camera is at its stand-off, a few metres back and
 * up, so the whip dives to the objective first and then follows the route — a straight cut from
 * the stand-off to the route's second waypoint went through the corner of the building the
 * route turns around.
 */
function planObjectiveLeg(
  build: PlanBuild,
  previous: IntroPose,
  previousGround: Vec3Lit,
  objective: ObjectiveDef,
): ObjectiveLeg {
  const { input } = build;
  const o = objective.position;
  const stand = standOff(input.collision, o, previous);
  const found = route(input.nav, build.finder, previousGround, o);
  let points: Vec3Lit[];
  if (found !== null && found.length >= 2) {
    points = raised(found, EYE_HEIGHT);
    points.unshift({ x: previous.x, y: previous.y, z: previous.z });
  } else {
    build.arcs.push(objective.id);
    const apexY = Math.max(previous.y, stand.y) + 8;
    points = [
      { x: previous.x, y: previous.y, z: previous.z },
      { x: (previous.x + stand.x) / 2, y: apexY, z: (previous.z + stand.z) / 2 },
    ];
  }
  points.push({ x: stand.x, y: stand.y, z: stand.z });
  const spline = new Spline(points);
  build.nudged += spline.relax(input.collision, EYE_RADIUS);
  return {
    travel: whipSegment(spline, previous, stand, objective),
    hold: holdSegment(stand, objective.label, OBJECTIVE_HOLD_SECONDS),
    points,
    stand,
  };
}

/**
 * The flight to one objective: the route's speed profile, and a heading that leaves the last
 * hold's, follows the route through the middle and arrives on the objective's.
 */
function whipSegment(
  spline: Spline,
  previous: IntroPose,
  stand: IntroPose,
  objective: ObjectiveDef,
): IntroSegment {
  const seconds = Math.min(WHIP_MAX_SECONDS, Math.max(0.5, spline.length / (WHIP_PEAK_SPEED / 1.5)));
  const fromYaw = previous.yaw;
  const fromPitch = previous.pitch;
  return {
    kind: 'whip',
    seconds,
    label: objective.label,
    metres: spline.length,
    at(u, out) {
      const sAlong = spline.length * ease(u);
      spline.at(sAlong, out);
      // The heading: from the last hold's into the route's over the first 30 %, along
      // the route (averaged, so its corners are turned) through the middle, onto the
      // objective's over the last 35 %.
      const along = spline.headingAt(sAlong, WHIP_HEADING_WINDOW);
      const enter = u < 0.3 ? ease(u / 0.3) : 1;
      const leave = u > 0.65 ? ease((u - 0.65) / 0.35) : 0;
      const yawAlong = fromYaw + angleDelta(fromYaw, along) * enter;
      out.yaw = yawAlong + angleDelta(yawAlong, stand.yaw) * leave;
      const pitchAlong = fromPitch + (APPROACH_PITCH - fromPitch) * enter;
      out.pitch = pitchAlong + (stand.pitch - pitchAlong) * leave;
    },
  };
}

/**
 * Whatever the budget did not spend is a hold on the last pose: the overview for the
 * deathmatch modes, the last objective for the others. A hold under 0.2 s is not worth a
 * segment.
 */
function holdRemainder(build: PlanBuild): void {
  if (build.used >= build.budget) return;
  const last = build.segments[build.segments.length - 1]!;
  const remainder = build.budget - build.used;
  if (remainder < 0.2) return;
  const pose: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  last.at(1, pose);
  build.waypoints.push([]);
  build.segments.push(holdSegment(pose, last.label, remainder));
  build.used += remainder;
}

/** The finished plan, and the `poseAt` that walks its segments. */
function assemblePlan(build: PlanBuild): IntroPlan {
  const segments = build.segments;
  return {
    segments,
    seconds: segments.reduce((sum, s) => sum + s.seconds, 0),
    approachMetres: build.approachMetres,
    trimmedMetres: build.trimmedMetres,
    objectives: build.visited,
    arcs: build.arcs,
    overviewDistance: build.overviewDistance,
    objectiveSeconds: build.objectiveSeconds,
    nudged: build.nudged,
    waypoints: build.waypoints,
    poseAt(t, out) {
      let cursor = t;
      for (const segment of segments) {
        if (cursor <= segment.seconds || segment === segments[segments.length - 1]) {
          segment.at(segment.seconds > 0 ? Math.min(1, Math.max(0, cursor / segment.seconds)) : 1, out);
          return;
        }
        cursor -= segment.seconds;
      }
    },
  };
}
//#endregion
