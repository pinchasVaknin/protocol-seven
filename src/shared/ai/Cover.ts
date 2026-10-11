/**
 * Cover points, validated and scored (brief S6.5).
 *
 * The map authors candidate positions; this decides which of them are real. Two filters
 * run once at load and never again: the navmesh must say a bot can stand there, and the
 * point must be inside the world at all. Everything left goes in the index.
 *
 * The scoring pass is where the actual definition of cover lives, and it is not "near an
 * object": **a cover point is cover only if the threat cannot see the body that would be
 * standing in it.** That is one raycast per candidate, from the threat's eye to the pose
 * the bot would adopt — crouched for low cover, standing for high — and a candidate whose
 * line is clear is discarded no matter how close to a crate it is. It is the only test
 * that cannot be fooled by geometry the map author did not think about.
 *
 * Occupancy is tracked so two bots do not pile into the same 0.6 m spot, which is the
 * single most obvious tell that cover selection is per-bot and blind.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { NavGrid } from '../world/Navmesh';
import type { CoverPoint } from '../world/maps/types';
import type { Perception } from './Perception';
import { simCos, simSin } from '../core/SimMath';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface CoverSlot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radians. The direction the cover protects from. */
  readonly facingYaw: number;
  readonly height: CoverPoint['height'];
  /** Navmesh cell, so pathing can be asked for it directly. */
  readonly cellIndex: number;
  /** Entity id of the bot that has claimed this slot, or -1. */
  occupantId: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Torso height a bot presents while using low cover (crouched) and high cover. */
const CROUCH_TORSO = 0.77;
const STAND_TORSO = 1.26;

/** Candidates scored per evaluation. Bounds the raycast spike on one tick. */
const MAX_SCORED = 16;

/**
 * Vertical reach, metres. A cover point further above or below the bot than this is on
 * another level and is not "two metres away" however close it looks from overhead — the
 * grey-box pit floor and the alcove shelf are both within a metre of open floor in plan.
 */
const MAX_HEIGHT_DELTA = 1.6;

const candidateIndex = new Int32Array(MAX_SCORED);
const candidateDist = new Float64Array(MAX_SCORED);

/**
 * The furthest candidate currently held, and where it sits in the two arrays above.
 *
 * Module-level beside the arrays they describe, and written only by `findWorstCandidate`
 * during one `gatherNearest` call. The scan that fills them is written once now; it used to
 * be written twice, identically, which was the whole of that function's complexity.
 */
let worstDist = -Infinity;
let worstAt = -1;
//#endregion

// ====================================== CLASS CoverIndex ====================================== \\
//#region Class CoverIndex
export class CoverIndex {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly slots: CoverSlot[] = [];
  /** Authored points the navmesh rejected. Reported at load so bad data is visible. */
  readonly rejected: number;

  /**
   * The threat one `select` call is hiding from.
   *
   * On the instance between `select` and the per-candidate scorer it calls, rather than passed
   * as three more arguments: a scorer that already takes a slot, a distance and a perception
   * has no room for a position as well.
   */
  private threatX = 0;
  private threatY = 0;
  private threatZ = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(points: readonly CoverPoint[], nav: NavGrid) {
    let rejected = 0;
    for (const p of points) {
      // By height, not just in plan: Foundry's catwalk railings are cover four metres
      // above cover that is also authored on the floor below them, and a lookup that only
      // knows where a point is in plan would silently move one onto the other.
      const cell = nav.cellAtY(p.position.x, p.position.y, p.position.z);
      if (cell < 0) {
        rejected++;
        continue;
      }
      this.slots.push({
        x: nav.centerX(nav.indexOfX(cell)),
        y: nav.heightAt(cell),
        z: nav.centerZ(nav.indexOfZ(cell)),
        facingYaw: p.facingYaw,
        height: p.height,
        cellIndex: cell,
        occupantId: -1,
      });
    }
    this.rejected = rejected;
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get count(): number {
    return this.slots.length;
  }

  get occupiedCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.occupantId >= 0) n++;
    return n;
  }

  /** Drop every claim held by one bot. Called on death, respawn and state change. */
  release(occupantId: number): void {
    for (const slot of this.slots) {
      if (slot.occupantId === occupantId) slot.occupantId = -1;
    }
  }

  claim(slotIndex: number, occupantId: number): void {
    const slot = this.slots[slotIndex];
    if (slot === undefined) return;
    this.release(occupantId);
    slot.occupantId = occupantId;
  }

  releaseAll(): void {
    for (const slot of this.slots) slot.occupantId = -1;
  }

  /**
   * Best cover slot for a bot at `(x, y, z)` hiding from a threat at `(tx, ty, tz)`, or
   * -1 when nothing within `maxRange` actually breaks the line.
   *
   * Nearest candidates are scored first and the rest are not scored at all — a bot does
   * not need the globally optimal piece of cover, it needs a good one this tick.
   */
  select(
    botId: number,
    x: number,
    y: number,
    z: number,
    tx: number,
    ty: number,
    tz: number,
    maxRange: number,
    perception: Perception,
  ): number {
    const nearest = this.gatherNearest(botId, x, y, z, maxRange);
    if (nearest === 0) return -1;

    this.threatX = tx;
    this.threatY = ty;
    this.threatZ = tz;

    let best = -1;
    let bestScore = -Infinity;

    for (let k = 0; k < nearest; k++) {
      const index = candidateIndex[k] ?? -1;
      const slot = this.slots[index];
      if (slot === undefined) continue;
      const score = this.scoreAgainstThreat(slot, candidateDist[k] ?? 0, perception);
      if (score <= bestScore) continue;
      bestScore = score;
      best = index;
    }

    return best;
  }

  /**
   * A position beside `slot` from which the threat *can* be seen — the peek.
   *
   * Cover you cannot shoot from is a corner to hide in, and a bot that only hides is not
   * worth fighting. The peek offset is lateral, along the cover's own face, so leaning out
   * puts the bot at the edge of the object rather than in front of it.
   */
  peekOffsetX(slotIndex: number, side: number): number {
    const slot = this.slots[slotIndex];
    if (slot === undefined) return 0;
    return simCos(slot.facingYaw) * side;
  }

  peekOffsetZ(slotIndex: number, side: number): number {
    const slot = this.slots[slotIndex];
    if (slot === undefined) return 0;
    return -simSin(slot.facingYaw) * side;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * Nearest free slots within range, unsorted beyond "these are the closest few".
   *
   * Four filters and nothing else: a slot somebody else has claimed, one on another level, one
   * out of range, and then whether this one is near enough to displace what is already held.
   */
  private gatherNearest(botId: number, x: number, y: number, z: number, maxRange: number): number {
    let count = 0;
    worstDist = Infinity;
    worstAt = -1;

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot === undefined) continue;
      if (slot.occupantId >= 0 && slot.occupantId !== botId) continue;
      if (Math.abs(slot.y - y) > MAX_HEIGHT_DELTA) continue;
      const dist = Math.hypot(slot.x - x, slot.z - z);
      if (dist > maxRange) continue;
      count = offerCandidate(i, dist, count);
    }
    return count;
  }

  /**
   * What this candidate is worth to a bot `myDist` away from it, or `-Infinity` for one that
   * is not cover at all.
   *
   * Three refusals and then an arithmetic preference. The refusals are the rules: a slot has
   * to be far enough from the threat to be worth walking to, oriented *against* it rather than
   * merely near it, and — the test that matters — it has to actually break the line to the
   * pose the bot would stand in there.
   *
   * What the score then prefers is close to the bot, still facing the fight, and not so far
   * from the threat that taking it means leaving the engagement entirely.
   */
  private scoreAgainstThreat(slot: CoverSlot, myDist: number, perception: Perception): number {
    const toThreatX = this.threatX - slot.x;
    const toThreatZ = this.threatZ - slot.z;
    const threatDist = Math.hypot(toThreatX, toThreatZ);
    if (threatDist < 1.5) return -Infinity;

    // The cover has to be oriented against the threat, not merely near it.
    const fx = -simSin(slot.facingYaw);
    const fz = -simCos(slot.facingYaw);
    const facing = (toThreatX * fx + toThreatZ * fz) / threatDist;
    if (facing < 0.15) return -Infinity;

    // The test that matters: standing here, can the threat see me?
    const torso = slot.height === 'low' ? CROUCH_TORSO : STAND_TORSO;
    if (perception.clearLine(this.threatX, this.threatY, this.threatZ, slot.x, slot.y + torso, slot.z)) {
      return -Infinity;
    }

    return (
      30 - myDist * 1.6 + facing * 8 - Math.abs(threatDist - 12) * 0.35 + (slot.height === 'high' ? 2 : 0)
    );
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * Keep slot `i` if it is one of the nearest few. Returns how many are held afterwards.
 *
 * Two ways in: there is room, or it is nearer than the furthest one held and takes that slot's
 * place. Either way the furthest is re-found, because which candidate is now the one to beat
 * has changed.
 */
function offerCandidate(i: number, dist: number, count: number): number {
  if (count < MAX_SCORED) {
    candidateIndex[count] = i;
    candidateDist[count] = dist;
    const held = count + 1;
    if (held === MAX_SCORED) findWorstCandidate(held);
    return held;
  }

  if (dist >= worstDist || worstAt < 0) return count;
  candidateIndex[worstAt] = i;
  candidateDist[worstAt] = dist;
  // Re-find the worst slot; the array is 16 long so this is cheaper than a heap.
  findWorstCandidate(count);
  return count;
}

/**
 * Find the furthest of the `count` candidates held, into `worstDist`/`worstAt`.
 *
 * Written out twice before — once on filling the array and once on every replacement after
 * that — which was identical both times and the whole of `gatherNearest`'s complexity and
 * depth. A module-level function over the module-level arrays allocates nothing, which is the
 * property the two inline copies were protecting.
 */
function findWorstCandidate(count: number): void {
  worstDist = -Infinity;
  worstAt = -1;
  for (let k = 0; k < count; k++) {
    const d = candidateDist[k] ?? 0;
    if (d > worstDist) {
      worstDist = d;
      worstAt = k;
    }
  }
}
//#endregion
