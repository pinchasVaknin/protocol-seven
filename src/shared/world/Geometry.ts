// ========================================== IMPORTS =========================================== \\
//#region Imports
import { clamp, clamp01 } from '../core/MathUtil';
import { beginSlab, makeSlabHit, narrowSlab } from '../core/RaySlab';
import type { ColliderSet } from './ColliderSet';
//#endregion
/**
 * Primitive tests against a single oriented box from a ColliderSet.
 *
 * Both routines work by rigid-transforming the query into the box's local space,
 * where the box is an axis-aligned box centred on the origin. A rigid transform
 * preserves capsules and rays exactly, so this costs one dot product per axis and
 * buys arbitrary box orientation for free — which is what lets a ramp be a pitched
 * brush rather than a special case.
 *
 * Nothing here allocates. Results are written into caller-owned records.
 */

// =========================================== TYPES ============================================ \\
//#region Types
export interface Contact {
  /** Penetration depth along `n`, metres. Positive when touching. */
  depth: number;
  /** Unit contact normal in world space, pointing out of the box toward the capsule. */
  nx: number;
  ny: number;
  nz: number;
  /** Contact point on the box surface, world space. */
  px: number;
  py: number;
  pz: number;
  /** Collider index. */
  index: number;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  index: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const EPS = 1e-6;

/**
 * The ray in the box's local frame, plus the basis it was transformed with.
 *
 * Module-level rather than returned, for the reason every scratch in this file is: these run per
 * collider per raycast and must not allocate. The basis is kept as well as the local ray because
 * `rayBox` needs it again to turn its face normal back into world space — so the nine reads
 * happen once per call here instead of once per call in each of the two primitives.
 */
let localOx = 0;
let localOy = 0;
let localOz = 0;
let localDx = 0;
let localDy = 0;
let localDz = 0;
let basis0 = 0;
let basis1 = 0;
let basis2 = 0;
let basis3 = 0;
let basis4 = 0;
let basis5 = 0;
let basis6 = 0;
let basis7 = 0;
let basis8 = 0;

/** `rayBox`'s own slab record. Handed to `core/RaySlab` (BACKLOG #12); never shared. */
const entry = makeSlabHit();

let exitMin = 0;
let exitMax = 0;

/**
 * `capsuleBoxPenetration`'s own scratch: the capsule in the box's local frame, the closest pair
 * of points on it and the contact that came out (BACKLOG #5).
 *
 * Sixteen slots, for the reason the nine above exist: that function is 144 lines of one
 * numerical kernel with about twenty live values, and the two phases carrying its complexity —
 * the alternating-projection solve and the shallowest-face escape — cannot be handed to helpers
 * through parameters without signatures of eight to ten arguments. Module-level `let`s are how
 * the rest of this file already answers that, and they allocate nothing on the path that runs
 * per collider per entity per tick.
 *
 * **Nothing here survives the call that wrote it.** Every slot is written before it is read
 * within one `capsuleBoxPenetration`, and that function is not re-entrant: it calls only the
 * four helpers below it, none of which calls back into it.
 */
let segAx = 0;
let segAy = 0;
let segAz = 0;
let segBx = 0;
let segBy = 0;
let segBz = 0;
/** The closest point on the capsule's segment. */
let onSegX = 0;
let onSegY = 0;
let onSegZ = 0;
/** The closest point on the box, in its own frame. */
let onBoxX = 0;
let onBoxY = 0;
let onBoxZ = 0;
/** The contact, still in the box's frame. */
let localNx = 0;
let localNy = 0;
let localNz = 0;
let localDepth = 0;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function makeContact(): Contact {
  return { depth: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0, index: -1 };
}

export function makeRayHit(): RayHit {
  return { t: 0, nx: 0, ny: 0, nz: 0, index: -1 };
}

/**
 * Capsule (segment A..B, radius r) versus oriented box.
 *
 * The segment endpoints are the centres of the capsule's end spheres, so a capsule of
 * total height `h` standing on `feetY` has A at feetY + r and B at feetY + h - r.
 *
 * Returns true and fills `out` when the shapes overlap.
 */
export function capsuleBoxPenetration(
  set: ColliderSet,
  i: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
  out: Contact,
): boolean {
  const hx = set.halfX(i);
  const hy = set.halfY(i);
  const hz = set.halfZ(i);
  const aligned = toBoxLocalSegment(set, i, ax, ay, az, bx, by, bz);

  // Cheap reject: does the segment's local AABB, grown by r, miss the box?
  if (Math.min(segAx, segBx) - radius > hx || Math.max(segAx, segBx) + radius < -hx) return false;
  if (Math.min(segAy, segBy) - radius > hy || Math.max(segAy, segBy) + radius < -hy) return false;
  if (Math.min(segAz, segBz) - radius > hz || Math.max(segAz, segBz) + radius < -hz) return false;

  solveClosestPoint(hx, hy, hz);

  const vx = onSegX - onBoxX;
  const vy = onSegY - onBoxY;
  const vz = onSegZ - onBoxZ;
  const distSq = vx * vx + vy * vy + vz * vz;

  if (distSq > EPS) {
    if (distSq >= radius * radius) return false;
    const dist = Math.sqrt(distSq);
    const inv = 1 / dist;
    localNx = vx * inv;
    localNy = vy * inv;
    localNz = vz * inv;
    localDepth = radius - dist;
  } else {
    escapeShallowestFace(hx, hy, hz, radius);
  }

  writeContact(out, set.centerX(i), set.centerY(i), set.centerZ(i), i, aligned);
  return true;
}

/**
 * Ray versus oriented box, slab test in local space.
 * `out.t` is distance along the (unit) direction. Returns false past `maxT`.
 */
export function rayBox(
  set: ColliderSet,
  i: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  out: RayHit,
): boolean {
  const aligned = toBoxLocalRay(set, i, ox, oy, oz, dx, dy, dz);
  const lox = localOx;
  const loy = localOy;
  const loz = localOz;
  const ldx = localDx;
  const ldy = localDy;
  const ldz = localDz;

  // Unrolled per axis over module-level state, the same way `rayBoxExit` does it below: this
  // runs per collider per raycast and must not allocate.
  beginSlab(entry, maxT);
  if (!narrowSlab(entry, lox, ldx, set.halfX(i), 0)) return false;
  if (!narrowSlab(entry, loy, ldy, set.halfY(i), 1)) return false;
  if (!narrowSlab(entry, loz, ldz, set.halfZ(i), 2)) return false;

  out.t = entry.min;
  out.index = i;

  if (entry.sign === 0) {
    // Origin was already inside the box: report a normal facing the ray source.
    out.nx = -dx;
    out.ny = -dy;
    out.nz = -dz;
    return true;
  }

  const nlx = entry.axis === 0 ? entry.sign : 0;
  const nly = entry.axis === 1 ? entry.sign : 0;
  const nlz = entry.axis === 2 ? entry.sign : 0;
  if (aligned) {
    out.nx = nlx;
    out.ny = nly;
    out.nz = nlz;
  } else {
    out.nx = nlx * basis0 + nly * basis3 + nlz * basis6;
    out.ny = nlx * basis1 + nly * basis4 + nlz * basis7;
    out.nz = nlx * basis2 + nly * basis5 + nlz * basis8;
  }
  return true;
}

/**
 * Distance at which a ray *leaves* an oriented box, or -1 if it never enters.
 *
 * This is the far slab intersection rather than the near one, and it is what wall
 * penetration is measured with: `exit - entry` is exactly how much material the round
 * has to push through (brief S6.4). Doing it as a second slab test against the same box
 * is both cheaper and more robust than re-casting from inside the geometry, where a
 * ray origin sitting a hair on the wrong side of a face flips the answer.
 */
export function rayBoxExit(
  set: ColliderSet,
  i: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  toBoxLocalRay(set, i, ox, oy, oz, dx, dy, dz);
  const lox = localOx;
  const loy = localOy;
  const loz = localOz;
  const ldx = localDx;
  const ldy = localDy;
  const ldz = localDz;

  // Unrolled per axis rather than looped over a scratch array: this runs once per
  // penetrated surface per shot and must not allocate.
  exitMin = -Infinity;
  exitMax = Infinity;
  if (!exitSlab(lox, ldx, set.halfX(i))) return -1;
  if (!exitSlab(loy, ldy, set.halfY(i))) return -1;
  if (!exitSlab(loz, ldz, set.halfZ(i))) return -1;
  return exitMax;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * Rigid-transform a ray into collider `i`'s local frame, where the box is axis aligned and
 * centred on the origin. Returns whether the box was already axis aligned, which both callers
 * need afterwards.
 *
 * The origin is a point, so the centre comes off it first; the direction is a vector, so it is
 * only rotated. This was written out in full in both `rayBox` and `rayBoxExit`, and the two
 * copies were the whole of why each was over the line limit.
 */
/**
 * The capsule's two endpoints in the box's local frame, plus the basis they came through.
 *
 * `toBoxLocalRay`'s sibling for a segment rather than a point and a vector, which is the third
 * copy of this world-to-local block retired (BACKLOG #5). Returns whether the box is
 * axis-aligned, exactly as that one does, because the caller needs it again on the way out.
 *
 * The basis is read once here and left in `basis0..8` for `writeContact` to turn the local
 * normal and contact point back into world space — the same bargain the ray version makes.
 */
function toBoxLocalSegment(
  set: ColliderSet,
  i: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const cx = set.centerX(i);
  const cy = set.centerY(i);
  const cz = set.centerZ(i);

  const dax = ax - cx;
  const day = ay - cy;
  const daz = az - cz;
  const dbx = bx - cx;
  const dby = by - cy;
  const dbz = bz - cz;

  const aligned = set.isAxisAligned(i);
  basis0 = set.basisAt(i, 0);
  basis1 = set.basisAt(i, 1);
  basis2 = set.basisAt(i, 2);
  basis3 = set.basisAt(i, 3);
  basis4 = set.basisAt(i, 4);
  basis5 = set.basisAt(i, 5);
  basis6 = set.basisAt(i, 6);
  basis7 = set.basisAt(i, 7);
  basis8 = set.basisAt(i, 8);

  if (aligned) {
    segAx = dax;
    segAy = day;
    segAz = daz;
    segBx = dbx;
    segBy = dby;
    segBz = dbz;
  } else {
    segAx = dax * basis0 + day * basis1 + daz * basis2;
    segAy = dax * basis3 + day * basis4 + daz * basis5;
    segAz = dax * basis6 + day * basis7 + daz * basis8;
    segBx = dbx * basis0 + dby * basis1 + dbz * basis2;
    segBy = dbx * basis3 + dby * basis4 + dbz * basis5;
    segBz = dbx * basis6 + dby * basis7 + dbz * basis8;
  }
  return aligned;
}

/**
 * The closest pair of points between the capsule's segment and the box, by alternating
 * projection. Into `onSeg*` and `onBox*`.
 *
 * Seed with the point nearest the box centre (the local origin), then clamp and reproject.
 * Three rounds is well past convergence for a capsule-sized query, and the reprojection after
 * the loop is what makes the two points consistent with the `t` the last round chose rather
 * than with the one before it.
 *
 * A degenerate capsule — both endpoints at one place — has no `t` to solve for, which is what
 * the `segLenSq <= EPS` guards are: the seed stays 0 and the loop breaks before reprojecting.
 */
function solveClosestPoint(hx: number, hy: number, hz: number): void {
  const sx = segBx - segAx;
  const sy = segBy - segAy;
  const sz = segBz - segAz;
  const segLenSq = sx * sx + sy * sy + sz * sz;

  let t = segLenSq > EPS ? clamp01((-segAx * sx - segAy * sy - segAz * sz) / segLenSq) : 0;

  for (let iter = 0; iter < 3; iter++) {
    onSegX = segAx + sx * t;
    onSegY = segAy + sy * t;
    onSegZ = segAz + sz * t;
    onBoxX = clamp(onSegX, -hx, hx);
    onBoxY = clamp(onSegY, -hy, hy);
    onBoxZ = clamp(onSegZ, -hz, hz);
    if (segLenSq <= EPS) break;
    t = clamp01(
      ((onBoxX - segAx) * sx + (onBoxY - segAy) * sy + (onBoxZ - segAz) * sz) / segLenSq,
    );
  }
  onSegX = segAx + sx * t;
  onSegY = segAy + sy * t;
  onSegZ = segAz + sz * t;
  onBoxX = clamp(onSegX, -hx, hx);
  onBoxY = clamp(onSegY, -hy, hy);
  onBoxZ = clamp(onSegZ, -hz, hz);
}

/**
 * The capsule's axis is inside the box: escape along the shallowest face.
 *
 * There is no direction to normalise when the closest points coincide, so the normal is a face
 * normal and the depth is the radius plus how far inside that face the axis sits. The contact
 * point moves onto the face it escapes through, which is the one line of `onBox*` this writes:
 * the clamp that produced it put it *at* the axis, which is inside the box and not a surface.
 */
function escapeShallowestFace(hx: number, hy: number, hz: number, radius: number): void {
  const ox = hx - Math.abs(onSegX);
  const oy = hy - Math.abs(onSegY);
  const oz = hz - Math.abs(onSegZ);
  if (ox <= oy && ox <= oz) {
    localNx = onSegX >= 0 ? 1 : -1;
    localNy = 0;
    localNz = 0;
    localDepth = radius + ox;
    onBoxX = localNx * hx;
  } else if (oy <= oz) {
    localNx = 0;
    localNy = onSegY >= 0 ? 1 : -1;
    localNz = 0;
    localDepth = radius + oy;
    onBoxY = localNy * hy;
  } else {
    localNx = 0;
    localNy = 0;
    localNz = onSegZ >= 0 ? 1 : -1;
    localDepth = radius + oz;
    onBoxZ = localNz * hz;
  }
}

/** The contact, back in world space, through the basis `toBoxLocalSegment` left behind. */
function writeContact(
  out: Contact,
  cx: number,
  cy: number,
  cz: number,
  i: number,
  aligned: boolean,
): void {
  if (aligned) {
    out.nx = localNx;
    out.ny = localNy;
    out.nz = localNz;
    out.px = onBoxX + cx;
    out.py = onBoxY + cy;
    out.pz = onBoxZ + cz;
  } else {
    out.nx = localNx * basis0 + localNy * basis3 + localNz * basis6;
    out.ny = localNx * basis1 + localNy * basis4 + localNz * basis7;
    out.nz = localNx * basis2 + localNy * basis5 + localNz * basis8;
    out.px = cx + onBoxX * basis0 + onBoxY * basis3 + onBoxZ * basis6;
    out.py = cy + onBoxX * basis1 + onBoxY * basis4 + onBoxZ * basis7;
    out.pz = cz + onBoxX * basis2 + onBoxY * basis5 + onBoxZ * basis8;
  }
  out.depth = localDepth;
  out.index = i;
}

function toBoxLocalRay(
  set: ColliderSet,
  i: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): boolean {
  const rx = ox - set.centerX(i);
  const ry = oy - set.centerY(i);
  const rz = oz - set.centerZ(i);

  basis0 = set.basisAt(i, 0);
  basis1 = set.basisAt(i, 1);
  basis2 = set.basisAt(i, 2);
  basis3 = set.basisAt(i, 3);
  basis4 = set.basisAt(i, 4);
  basis5 = set.basisAt(i, 5);
  basis6 = set.basisAt(i, 6);
  basis7 = set.basisAt(i, 7);
  basis8 = set.basisAt(i, 8);

  if (set.isAxisAligned(i)) {
    localOx = rx;
    localOy = ry;
    localOz = rz;
    localDx = dx;
    localDy = dy;
    localDz = dz;
    return true;
  }
  localOx = rx * basis0 + ry * basis1 + rz * basis2;
  localOy = rx * basis3 + ry * basis4 + rz * basis5;
  localOz = rx * basis6 + ry * basis7 + rz * basis8;
  localDx = dx * basis0 + dy * basis1 + dz * basis2;
  localDy = dx * basis3 + dy * basis4 + dz * basis5;
  localDz = dx * basis6 + dy * basis7 + dz * basis8;
  return false;
}

function exitSlab(o: number, d: number, h: number): boolean {
  if (Math.abs(d) < EPS) return o >= -h && o <= h;
  const inv = 1 / d;
  let t1 = (-h - o) * inv;
  let t2 = (h - o) * inv;
  if (t1 > t2) {
    const tmp = t1;
    t1 = t2;
    t2 = tmp;
  }
  if (t1 > exitMin) exitMin = t1;
  if (t2 < exitMax) exitMax = t2;
  return exitMin <= exitMax;
}
//#endregion
