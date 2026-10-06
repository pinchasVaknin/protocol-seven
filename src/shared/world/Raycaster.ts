// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { ColliderSet } from './ColliderSet';
import { makeRayHit, rayBox, type RayHit } from './Geometry';
import type { SpatialHash } from './SpatialHash';
//#endregion
/**
 * The gameplay raycaster (brief S4.3).
 *
 * Walks the same uniform hash the collision broadphase uses, with a 3D DDA
 * (Amanatides & Woo), and stops as soon as the nearest hit is provably inside the
 * current cell. `THREE.Raycaster` is not used and must not be: it walks the scene
 * graph and will not fit the frame budget. It is permitted in debug tooling only.
 *
 * Allocation free. All hits are written into a caller-owned `RayHit`.
 */

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Guard against a pathological direction producing an unbounded walk. */
const MAX_CELLS_VISITED = 4096;

let gridMin = 0;
let gridMax = 0;
//#endregion

// ====================================== CLASS Raycaster ======================================= \\
//#region Class Raycaster
export class Raycaster {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Narrowphase ray-vs-box tests since the last reset. Diagnostics. */
  tests = 0;

  private readonly scratch = makeRayHit();

  /**
   * The ray the current `cast` is walking.
   *
   * Held on the instance so the two helpers below need three arguments between them instead of
   * seven each. On the instance rather than at module level because two `Raycaster`s in one
   * process — a menu skirmish beside a match — must not be able to read each other's ray.
   */
  private rayOx = 0;
  private rayOy = 0;
  private rayOz = 0;
  private rayDx = 0;
  private rayDy = 0;
  private rayDz = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(
    private readonly colliders: ColliderSet,
    private readonly hash: SpatialHash,
  ) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Cast against static world geometry. `dx,dy,dz` must be normalised.
   * Returns true and fills `out` with the nearest hit within `maxDist`.
   */
  cast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    out: RayHit,
  ): boolean {
    const hash = this.hash;
    hash.beginQuery();

    this.rayOx = ox;
    this.rayOy = oy;
    this.rayOz = oz;
    this.rayDx = dx;
    this.rayDy = dy;
    this.rayDz = dz;

    const t0 = this.walkToGrid(maxDist);
    if (t0 < 0) return false;

    const px = ox + dx * t0;
    const py = oy + dy * t0;
    const pz = oz + dz * t0;

    let cx = hash.rawCellX(px);
    let cy = hash.rawCellY(py);
    let cz = hash.rawCellZ(pz);
    if (!hash.inGrid(cx, cy, cz)) return false;

    const cs = hash.cellSize;
    const [gx, gy, gz] = hash.origin;

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const tDeltaX = stepX === 0 ? Infinity : Math.abs(cs / dx);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(cs / dy);
    const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(cs / dz);

    let tMaxX = stepX === 0 ? Infinity : t0 + boundaryDist(px, gx + cx * cs, cs, stepX, dx);
    let tMaxY = stepY === 0 ? Infinity : t0 + boundaryDist(py, gy + cy * cs, cs, stepY, dy);
    let tMaxZ = stepZ === 0 ? Infinity : t0 + boundaryDist(pz, gz + cz * cs, cs, stepZ, dz);

    let bestT = maxDist;
    let found = false;

    for (let guard = 0; guard < MAX_CELLS_VISITED; guard++) {
      const nearer = this.nearestInCell(hash.cellIndex(cx, cy, cz), bestT, out);
      if (nearer < bestT) {
        bestT = nearer;
        found = true;
      }

      const tExit = Math.min(tMaxX, Math.min(tMaxY, tMaxZ));
      // A hit inside the current cell is final: no later cell can be nearer.
      if (found && bestT <= tExit) return true;
      if (tExit > maxDist) break;

      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else if (tMaxY <= tMaxZ) {
        cy += stepY;
        tMaxY += tDeltaY;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (!hash.inGrid(cx, cy, cz)) break;
    }

    return found;
  }

  /** True when nothing blocks the segment from A to B. */
  segmentClear(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    out: RayHit,
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) return true;
    const inv = 1 / dist;
    return !this.cast(ax, ay, az, dx * inv, dy * inv, dz * inv, dist, out);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * How far along the ray the walk should start, or -1 if it never reaches the grid.
   *
   * Zero for a ray that begins inside it, which is the ordinary case. For one that begins
   * outside, the entry distance nudged past the boundary so the first cell lookup lands inside
   * rather than on the seam.
   */
  private walkToGrid(maxDist: number): number {
    const hash = this.hash;
    if (hash.inGrid(hash.rawCellX(this.rayOx), hash.rawCellY(this.rayOy), hash.rawCellZ(this.rayOz))) {
      return 0;
    }
    const entry = this.gridEntryT(this.rayOx, this.rayOy, this.rayOz, this.rayDx, this.rayDy, this.rayDz, maxDist);
    if (entry < 0) return -1;
    const t0 = entry + 1e-4;
    return t0 > maxDist ? -1 : t0;
  }

  /**
   * Narrowphase everything in one cell, writing any improvement into `out`.
   *
   * Returns the nearest distance found, which is `bestT` unchanged when nothing in this cell
   * beats what the caller already had. The caller reads the return rather than a flag because a
   * hit is exactly a `t` that came down.
   */
  private nearestInCell(cell: number, bestT: number, out: RayHit): number {
    const hash = this.hash;
    hash.noteCell(cell);
    let best = bestT;
    const end = hash.itemsEnd(cell);
    for (let k = hash.itemsBegin(cell); k < end; k++) {
      const idx = hash.itemAt(k);
      // `claim` de-duplicates colliders that straddle several cells.
      if (idx < 0 || !hash.claim(idx)) continue;
      this.tests++;
      const hit = rayBox(
        this.colliders,
        idx,
        this.rayOx,
        this.rayOy,
        this.rayOz,
        this.rayDx,
        this.rayDy,
        this.rayDz,
        best,
        this.scratch,
      );
      if (!hit) continue;
      if (this.scratch.t >= best) continue;
      best = this.scratch.t;
      out.t = this.scratch.t;
      out.nx = this.scratch.nx;
      out.ny = this.scratch.ny;
      out.nz = this.scratch.nz;
      out.index = idx;
    }
    return best;
  }

  /**
   * Distance along the ray at which it enters the grid AABB, or -1 if it misses.
   * Written out per axis rather than via a helper closure: this runs inside the
   * gameplay raycast path and must not allocate.
   */
  private gridEntryT(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ): number {
    const hash = this.hash;
    const cs = hash.cellSize;
    const [gx, gy, gz] = hash.origin;
    const [nx, ny, nz] = hash.dimensions;

    // Unrolled per axis over module-level state: this runs inside the gameplay raycast path
    // and must not allocate. A module-level function does not, which is why the three copies
    // this replaced were not buying anything.
    gridMin = 0;
    gridMax = maxDist;
    if (!gridSlab(ox, dx, gx, gx + nx * cs)) return -1;
    if (!gridSlab(oy, dy, gy, gy + ny * cs)) return -1;
    if (!gridSlab(oz, dz, gz, gz + nz * cs)) return -1;

    return gridMin;
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * One slab of the grid AABB, narrowing `gridMin`/`gridMax`. False once the interval has closed.
 *
 * The bounds are an interval rather than a half-extent, because the grid is not centred on
 * anything, and the epsilon is 1e-9 rather than `Geometry`'s 1e-6 — a grid is tens of metres
 * across and a ray very nearly parallel to one of its faces still has to enter it. Both are
 * carried over exactly from the three copies this replaced.
 */
function gridSlab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  const inv = 1 / d;
  let t1 = (lo - o) * inv;
  let t2 = (hi - o) * inv;
  if (t1 > t2) {
    const tmp = t1;
    t1 = t2;
    t2 = tmp;
  }
  if (t1 > gridMin) gridMin = t1;
  if (t2 < gridMax) gridMax = t2;
  return gridMin <= gridMax;
}

/** Distance from `p` to the next cell boundary in the direction of travel. */
function boundaryDist(p: number, cellMin: number, cellSize: number, step: number, d: number): number {
  const target = step > 0 ? cellMin + cellSize : cellMin;
  return (target - p) / d;
}
//#endregion
