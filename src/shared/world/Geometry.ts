// ========================================== IMPORTS =========================================== \\
//#region Imports
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

let entryMin = 0;
let entryMax = 0;
let entryAxis = 0;
let entrySign = 0;

let exitMin = 0;
let exitMax = 0;
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
  const cx = set.centerX(i);
  const cy = set.centerY(i);
  const cz = set.centerZ(i);
  const hx = set.halfX(i);
  const hy = set.halfY(i);
  const hz = set.halfZ(i);

  // World -> local.
  let lax: number;
  let lay: number;
  let laz: number;
  let lbx: number;
  let lby: number;
  let lbz: number;

  const aligned = set.isAxisAligned(i);
  const b0 = set.basisAt(i, 0);
  const b1 = set.basisAt(i, 1);
  const b2 = set.basisAt(i, 2);
  const b3 = set.basisAt(i, 3);
  const b4 = set.basisAt(i, 4);
  const b5 = set.basisAt(i, 5);
  const b6 = set.basisAt(i, 6);
  const b7 = set.basisAt(i, 7);
  const b8 = set.basisAt(i, 8);

  const dax = ax - cx;
  const day = ay - cy;
  const daz = az - cz;
  const dbx = bx - cx;
  const dby = by - cy;
  const dbz = bz - cz;

  if (aligned) {
    lax = dax;
    lay = day;
    laz = daz;
    lbx = dbx;
    lby = dby;
    lbz = dbz;
  } else {
    lax = dax * b0 + day * b1 + daz * b2;
    lay = dax * b3 + day * b4 + daz * b5;
    laz = dax * b6 + day * b7 + daz * b8;
    lbx = dbx * b0 + dby * b1 + dbz * b2;
    lby = dbx * b3 + dby * b4 + dbz * b5;
    lbz = dbx * b6 + dby * b7 + dbz * b8;
  }

  // Cheap reject: does the segment's local AABB, grown by r, miss the box?
  if (Math.min(lax, lbx) - radius > hx || Math.max(lax, lbx) + radius < -hx) return false;
  if (Math.min(lay, lby) - radius > hy || Math.max(lay, lby) + radius < -hy) return false;
  if (Math.min(laz, lbz) - radius > hz || Math.max(laz, lbz) + radius < -hz) return false;

  const sx = lbx - lax;
  const sy = lby - lay;
  const sz = lbz - laz;
  const segLenSq = sx * sx + sy * sy + sz * sz;

  // Closest point between the segment and the box, by alternating projection.
  // Seed with the point nearest the box centre (the local origin), then clamp/reproject.
  // Three rounds is well past convergence for a capsule-sized query.
  let t = segLenSq > EPS ? clamp01((-lax * sx - lay * sy - laz * sz) / segLenSq) : 0;
  let pxL = 0;
  let pyL = 0;
  let pzL = 0;
  let qx = 0;
  let qy = 0;
  let qz = 0;

  for (let iter = 0; iter < 3; iter++) {
    pxL = lax + sx * t;
    pyL = lay + sy * t;
    pzL = laz + sz * t;
    qx = clamp(pxL, -hx, hx);
    qy = clamp(pyL, -hy, hy);
    qz = clamp(pzL, -hz, hz);
    if (segLenSq <= EPS) break;
    t = clamp01(((qx - lax) * sx + (qy - lay) * sy + (qz - laz) * sz) / segLenSq);
  }
  pxL = lax + sx * t;
  pyL = lay + sy * t;
  pzL = laz + sz * t;
  qx = clamp(pxL, -hx, hx);
  qy = clamp(pyL, -hy, hy);
  qz = clamp(pzL, -hz, hz);

  const vx = pxL - qx;
  const vy = pyL - qy;
  const vz = pzL - qz;
  const distSq = vx * vx + vy * vy + vz * vz;

  let nlx: number;
  let nly: number;
  let nlz: number;
  let depth: number;

  if (distSq > EPS) {
    if (distSq >= radius * radius) return false;
    const dist = Math.sqrt(distSq);
    const inv = 1 / dist;
    nlx = vx * inv;
    nly = vy * inv;
    nlz = vz * inv;
    depth = radius - dist;
  } else {
    // Capsule axis is inside the box. Escape along the shallowest face.
    const ox = hx - Math.abs(pxL);
    const oy = hy - Math.abs(pyL);
    const oz = hz - Math.abs(pzL);
    if (ox <= oy && ox <= oz) {
      nlx = pxL >= 0 ? 1 : -1;
      nly = 0;
      nlz = 0;
      depth = radius + ox;
      qx = nlx * hx;
    } else if (oy <= oz) {
      nlx = 0;
      nly = pyL >= 0 ? 1 : -1;
      nlz = 0;
      depth = radius + oy;
      qy = nly * hy;
    } else {
      nlx = 0;
      nly = 0;
      nlz = pzL >= 0 ? 1 : -1;
      depth = radius + oz;
      qz = nlz * hz;
    }
  }

  // Local -> world.
  if (aligned) {
    out.nx = nlx;
    out.ny = nly;
    out.nz = nlz;
    out.px = qx + cx;
    out.py = qy + cy;
    out.pz = qz + cz;
  } else {
    out.nx = nlx * b0 + nly * b3 + nlz * b6;
    out.ny = nlx * b1 + nly * b4 + nlz * b7;
    out.nz = nlx * b2 + nly * b5 + nlz * b8;
    out.px = cx + qx * b0 + qy * b3 + qz * b6;
    out.py = cy + qx * b1 + qy * b4 + qz * b7;
    out.pz = cz + qx * b2 + qy * b5 + qz * b8;
  }
  out.depth = depth;
  out.index = i;
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
  entryMin = 0;
  entryMax = maxT;
  entryAxis = 0;
  entrySign = 0;
  if (!entrySlab(lox, ldx, set.halfX(i), 0)) return false;
  if (!entrySlab(loy, ldy, set.halfY(i), 1)) return false;
  if (!entrySlab(loz, ldz, set.halfZ(i), 2)) return false;

  out.t = entryMin;
  out.index = i;

  if (entrySign === 0) {
    // Origin was already inside the box: report a normal facing the ray source.
    out.nx = -dx;
    out.ny = -dy;
    out.nz = -dz;
    return true;
  }

  const nlx = entryAxis === 0 ? entrySign : 0;
  const nly = entryAxis === 1 ? entrySign : 0;
  const nlz = entryAxis === 2 ? entrySign : 0;
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

/**
 * One slab of `rayBox`: narrows `entryMin`/`entryMax` and remembers which face the near
 * intersection came from. False once the interval has closed and the ray has missed.
 *
 * The same test as `exitSlab` below, with the entry face tracked as well — a hit needs to know
 * which way its normal points and an exit distance does not. It was written out three times,
 * once per axis, and the stated reason was allocation; module-level state and a module-level
 * function allocate nothing, which is the argument `exitSlab` already makes for itself. Three
 * copies of a slab test is three places for an epsilon to drift apart.
 */
function entrySlab(o: number, d: number, h: number, axis: number): boolean {
  if (Math.abs(d) < EPS) return o >= -h && o <= h;
  const inv = 1 / d;
  let t1 = (-h - o) * inv;
  let t2 = (h - o) * inv;
  let s = -1;
  if (t1 > t2) {
    const tmp = t1;
    t1 = t2;
    t2 = tmp;
    s = 1;
  }
  if (t1 > entryMin) {
    entryMin = t1;
    entryAxis = axis;
    entrySign = s;
  }
  if (t2 < entryMax) entryMax = t2;
  return entryMin <= entryMax;
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
//#endregion
