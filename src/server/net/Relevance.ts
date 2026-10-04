import { EFlag, type EntitySnapshot } from '../../shared/net/Snapshot';
import { DEFAULT_MOVEMENT_CONFIG } from '../../shared/player/MovementConfig';
import { makeRayHit, type RayHit } from '../../shared/world/Geometry';
import type { CollisionWorld } from '../../shared/world/CollisionWorld';

/**
 * Who each player is told about (anti-wallhack phase 1; design: docs/VISIBILITY.md).
 *
 * Every client used to be sent every body's position at 20 Hz, through any wall, and a modified
 * client drew them all. A body is now **relevant** to a viewer — sent as it is — only while the
 * viewer could plausibly see it; otherwise it goes out *dormant*, frozen where it was last
 * relevant, and the client hides it. These are the rules, as functions of two snapshot records
 * and the map's collision, so every one of them is a unit test rather than a playtest.
 *
 * Relevant when any holds:
 *
 * - **R1** the viewer itself, or a teammate (no teammates in free-for-all);
 * - **R2** within `NEAR_RADIUS_M`;
 * - **R3/R4** a clear line from the viewer's eye to one of five points on the body — head,
 *   chest, feet and both shoulders — tested from where both are now, from where either could be
 *   after `lookAheadSec` moving sideways at up to sprint speed, and from where their velocities
 *   take them; the head and the eye as if standing. So nobody rounds a corner, or stands up behind
 *   cover, faster than the data;
 * - **R6** relevant at any time in the last `LINGER_MS`, which stops flicker at the edge of a
 *   doorway and covers a lost snapshot.
 *
 * R8 (free cam sees everything) and `Unseen` (never relevant to anyone else) are decisions about
 * cheats and live with the caller, which knows who holds what; R7 (a dead spectator sees what its
 * team sees) is `RelevanceTracker.relevantToAny`.
 *
 * Bot perception's own primitive does the work — `CollisionWorld.segmentClear` against the static
 * map, measured at 0.47-0.63 µs a ray on the four maps.
 */

/** R2. No corner hides a body this close for long, and melee lives inside it. */
export const NEAR_RADIUS_M = 6;

/** R6. How long a body stays relevant after the last test that found it. */
export const LINGER_MS = 500;

/**
 * The longest look-ahead R4 uses, seconds. A link slow enough to ask for more is past the rewind
 * cap anyway, and an unbounded extrapolation would test a line from somewhere the player could
 * never have reached.
 */
export const MAX_LOOK_AHEAD_S = 0.4;

/** Below this much predicted travel, the look-ahead point is the same point: test it once. */
const STILL_M = 0.05;

/** The eye sits this far below the top of the capsule (1.80 standing → the sim's 1.65). */
const EYE_BELOW_TOP_M = 0.15;

/** Half the shoulders' width, metres, for the two side points. */
const SHOULDER_HALF_M = 0.25;

/**
 * How far a body may get in the look-ahead, per second, whatever its velocity says now — sprint
 * speed (part 3, measured). Extrapolating the current velocity misses the case that matters most:
 * a body standing still behind a corner that starts to move. The audit caught it as late wakes —
 * 0.65% of visible pairs, each a full draw delay short — so both ends are also tested displaced
 * sideways by this reach, which is what moving round a corner is, and a body faster than this
 * (tac-sprint, a slide) reaches as far as its own speed takes it.
 */
const REACH_SPEED = DEFAULT_MOVEMENT_CONFIG.sprintSpeed;

/**
 * The five points on a body: head, chest, feet and the two shoulders, as fractions of its height.
 * The head is measured on a **standing** body even when it crouches, and so is a viewer's eye — a
 * crouched player behind low cover can stand up faster than any snapshot can say so.
 */
const HEAD = 0;
const CHEST = 1;
const FEET = 2;
const POINT_HEIGHTS = [0.92, 0.6, 0.12, 0.72, 0.72] as const;
const POINT_SIDE = [0, 0, 0, 1, -1] as const;

/**
 * Every ray a pair may cost, in the order they are tried: `[eye side, body side, point, ahead]`.
 * Side is -1, 0 or +1 times the reach across the line of sight; `ahead` moves both ends along
 * their velocities instead. The five points now-to-now first, then the displaced ends on head,
 * chest and feet, then the velocity look-ahead. The feet are among the displaced points because
 * the audit found them first: 34 of 40 late wakes on FOUNDRY were a body that came into view
 * feet-first, under a catwalk or past the lip of a ledge, and with head and chest alone the reach
 * never saw them coming.
 */
const RAYS: ReadonlyArray<readonly [number, number, number, boolean]> = (() => {
  const out: Array<[number, number, number, boolean]> = [];
  for (let p = 0; p < POINT_HEIGHTS.length; p++) out.push([0, 0, p, false]);
  for (const eye of [0, 1, -1]) {
    for (const body of [0, 1, -1]) {
      if (eye === 0 && body === 0) continue;
      out.push([eye, body, HEAD, false], [eye, body, CHEST, false], [eye, body, FEET, false]);
    }
  }
  out.push([0, 0, HEAD, true], [0, 0, CHEST, true]);
  return out;
})();

/** Rays one pair can cost at most. */
export const MAX_RAYS_PER_PAIR = RAYS.length;

function bodyHeight(e: EntitySnapshot): number {
  return DEFAULT_MOVEMENT_CONFIG.standHeight * (e.heightScale > 0 ? e.heightScale : 1);
}

/** The height a body could have by the time the client draws it: its own, or standing. */
function reachableHeight(e: EntitySnapshot): number {
  return Math.max(bodyHeight(e), DEFAULT_MOVEMENT_CONFIG.standHeight);
}

/** Where a body's eye is, from its record — the same derivation for a player and a bot. */
export function eyeY(e: EntitySnapshot): number {
  return e.y + reachableHeight(e) - EYE_BELOW_TOP_M;
}

export function teamOf(e: EntitySnapshot): 'A' | 'B' {
  return (e.flags & EFlag.TeamB) !== 0 ? 'B' : 'A';
}

export function isAlive(e: EntitySnapshot): boolean {
  return (e.flags & EFlag.Alive) !== 0;
}

/**
 * R3 and R4: the index of the first clear ray from `viewer`'s eye to a point on `target`, or -1.
 *
 * `hint` is the index that was clear last time for this pair, tried first — a body that was
 * visible a snapshot ago almost always still is along the same line, so a visible pair usually
 * costs one ray. The order otherwise runs from now-to-now outward, cheapest truth first.
 */
export function clearLine(
  world: CollisionWorld,
  viewer: EntitySnapshot,
  target: EntitySnapshot,
  lookAheadSec: number,
  hint: number,
  hit: RayHit = makeRayHit(),
): number {
  const t = Math.min(Math.max(lookAheadSec, 0), MAX_LOOK_AHEAD_S);
  const vdx = viewer.vx * t;
  const vdz = viewer.vz * t;
  const tdx = target.vx * t;
  const tdz = target.vz * t;
  const moving = Math.hypot(vdx, vdz) > STILL_M || Math.hypot(tdx, tdz) > STILL_M;
  const viewerReach = Math.max(Math.hypot(viewer.vx, viewer.vz), REACH_SPEED) * t;
  const targetReach = Math.max(Math.hypot(target.vx, target.vz), REACH_SPEED) * t;
  const reaching = viewerReach > STILL_M || targetReach > STILL_M;

  const ey = eyeY(viewer);
  const h = bodyHeight(target);
  const headY = target.y + reachableHeight(target) * (POINT_HEIGHTS[HEAD] ?? 0.92);
  // Shoulders and reach both lie across the line of sight, along its perpendicular.
  let px = -(target.z - viewer.z);
  let pz = target.x - viewer.x;
  const plen = Math.hypot(px, pz);
  if (plen > 1e-6) {
    px /= plen;
    pz /= plen;
  } else {
    px = 1;
    pz = 0;
  }

  const test = (index: number): boolean => {
    const ray = RAYS[index];
    if (ray === undefined) return false;
    const [eyeSide, bodySide, point, ahead] = ray;
    if (ahead && !moving) return false;
    if ((eyeSide !== 0 || bodySide !== 0) && !reaching) return false;
    const ex = viewer.x + (ahead ? vdx : 0) + px * eyeSide * viewerReach;
    const ez = viewer.z + (ahead ? vdz : 0) + pz * eyeSide * viewerReach;
    const side = (POINT_SIDE[point] ?? 0) * SHOULDER_HALF_M + bodySide * targetReach;
    const bx = target.x + (ahead ? tdx : 0) + px * side;
    const bz = target.z + (ahead ? tdz : 0) + pz * side;
    const by = point === HEAD ? headY : target.y + h * (POINT_HEIGHTS[point] ?? 0.6);
    return world.segmentClear(ex, ey, ez, bx, by, bz, hit);
  };

  if (hint >= 0 && hint < MAX_RAYS_PER_PAIR && test(hint)) return hint;
  for (let i = 0; i < MAX_RAYS_PER_PAIR; i++) {
    if (i === hint) continue;
    if (test(i)) return i;
  }
  return -1;
}

/** What one evaluation needs to know about the world and the match. */
export interface RelevanceContext {
  readonly world: CollisionWorld;
  /** No teammates: every other body is an enemy. */
  readonly freeForAll: boolean;
  /** R4's horizon for this viewer, seconds: RTT/2 + interpolation delay + one snapshot. */
  readonly lookAheadSec: number;
}

/**
 * R1, R2, R3/R4 for one pair, with no memory. The tracker below adds R6.
 */
export function relevantNow(
  ctx: RelevanceContext,
  viewer: EntitySnapshot,
  target: EntitySnapshot,
  hint: number,
  hit: RayHit,
): { readonly relevant: boolean; readonly ray: number } {
  if (viewer.entityId === target.entityId) return ALWAYS;
  if (!ctx.freeForAll && teamOf(viewer) === teamOf(target)) return ALWAYS;
  const dx = target.x - viewer.x;
  const dy = target.y - viewer.y;
  const dz = target.z - viewer.z;
  if (dx * dx + dy * dy + dz * dz <= NEAR_RADIUS_M * NEAR_RADIUS_M) return ALWAYS;
  const ray = clearLine(ctx.world, viewer, target, ctx.lookAheadSec, hint, hit);
  return ray >= 0 ? { relevant: true, ray } : NEVER;
}

const ALWAYS = { relevant: true, ray: -1 } as const;
const NEVER = { relevant: false, ray: -1 } as const;

/**
 * One viewer's memory of who it was told about: R6's linger, and the last clear ray per body.
 *
 * One per seat. Entity ids are reused across a match's life, so `forget` is called when a body
 * leaves; a stale linger on a reused id would show a new player for half a second for free.
 */
export class RelevanceTracker {
  private readonly until = new Map<number, number>();
  private readonly hints = new Map<number, number>();
  private readonly hit = makeRayHit();

  /** Is `target` relevant to `viewer` at `nowMs`? Updates the linger and the ray hint. */
  relevant(nowMs: number, ctx: RelevanceContext, viewer: EntitySnapshot, target: EntitySnapshot): boolean {
    const id = target.entityId;
    const verdict = relevantNow(ctx, viewer, target, this.hints.get(id) ?? -1, this.hit);
    return this.settle(nowMs, id, verdict.relevant, verdict.ray);
  }

  /**
   * R7: relevant to any of `viewers` — the living teammates a dead spectator may be looking
   * through. The linger is the spectator's own; hints are not kept, because the line that was
   * clear belonged to whichever teammate found it.
   */
  relevantToAny(
    nowMs: number,
    ctx: RelevanceContext,
    viewers: readonly EntitySnapshot[],
    target: EntitySnapshot,
  ): boolean {
    let found = false;
    for (const viewer of viewers) {
      if (relevantNow(ctx, viewer, target, -1, this.hit).relevant) {
        found = true;
        break;
      }
    }
    return this.settle(nowMs, target.entityId, found, -1);
  }

  forget(entityId: number): void {
    this.until.delete(entityId);
    this.hints.delete(entityId);
  }

  private settle(nowMs: number, id: number, relevant: boolean, ray: number): boolean {
    if (relevant) {
      this.until.set(id, nowMs + LINGER_MS);
      if (ray >= 0) this.hints.set(id, ray);
      return true;
    }
    this.hints.delete(id);
    return nowMs < (this.until.get(id) ?? -Infinity);
  }
}
