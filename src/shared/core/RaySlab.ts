/**
 * The ray-slab test, once, for the two subsystems that cast rays at boxes.
 *
 * `world/Geometry.rayBox` tests a ray against the static world's colliders and
 * `combat/HitboxRig.raySlab` tests one against a body's hitboxes. They were the same test:
 * the same `EPS`, the same arithmetic character for character, and the same pattern of
 * module-level state chosen in both places because the test must not allocate
 * (BACKLOG #12, closed 2026-11-22).
 *
 * A4's commit `389db4e` records that this test was written out **seven** times across the
 * collision core and that A4 reduced it to two. The rig's copy was in another unit, outside
 * A4's fence, so it stayed; A9 found it as the third and could not reach it either. This is
 * the file that ends that.
 *
 * ## Why an out parameter and not module state
 *
 * The state could have been shared: the two tests can never be nested — `narrowSlab` was
 * reached only from the rig's own box loop and the world's only from `rayBox`, called from
 * `Raycaster.cast` and `NavBake`, and neither subsystem's ray test runs inside the other's. But
 * sharing the slots would mean `combat/` reading `world/`'s module scratch or the reverse,
 * which is the coupling A9 declined to create in the first place.
 *
 * So each caller keeps a record of its own and hands it in. That allocates nothing — the two
 * records are module-level constants in their own files — and it is the shape this codebase
 * already uses for every allocation-free out-parameter it has: `Movement`'s `stepRise`,
 * `NavBake`'s `columnRay`, `WeaponSystem`'s `flameJet`, `SimMath`'s `LookDir`. The price is
 * that the hottest path in the project reads a property where it read a module variable, which
 * the SIM pair measures the correctness of and which V8 treats the same for a monomorphic
 * object.
 *
 * ## The one difference the two copies had, and which one this is
 *
 * The world's copy tested a parallel ray's in-range case as `o >= -h && o <= h` and the rig's
 * as `!(o < -h || o > h)`. The two agree on every number **except NaN**: the first rejects a
 * NaN coordinate and the second accepts it and goes on to report a hit. A9 kept the second
 * deliberately, because it was the form the three inline copies it replaced had.
 *
 * **It is the first form here, and NaN was measured rather than argued about.** A guard that
 * threw on a NaN `o`, `d` or `h` was put inside both copies and the project was run: 7,190
 * tests over 316 files, the 3,600-tick determinism scenario, the content, progression,
 * readability, intro and event-decode probes, and five seeded bot matches. It never tripped,
 * so NaN is unreachable in everything this project exercises and the two forms are equivalent
 * on every input the game can produce. Given that, the rejecting form is the one to keep: a
 * NaN ray that reports a hit would be a hit at a NaN distance, which is worse than no hit.
 */

// =========================================== TYPES ============================================ \\
//#region Types
/** One ray's progress through a box's three slabs. See `narrowSlab`. */
export interface SlabHit {
  /** Nearest distance along the ray still inside every slab tested so far. */
  min: number;
  /** Furthest. The ray has missed once `min` passes `max`. */
  max: number;
  /** Which axis the near intersection came from: 0 for X, 1 for Y, 2 for Z. */
  axis: number;
  /** Which face of it: -1 for the low side, +1 for the high, 0 while the origin is inside. */
  sign: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Below this a ray is treated as parallel to the slab rather than divided by.
 *
 * `1e-6`, which is the value both copies had. It is declared here rather than imported from
 * either of them, because an epsilon that lives in one subsystem and is read by another is the
 * drift this file exists to stop.
 */
const EPS = 1e-6;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** A record to narrow into, for a caller with no reason to keep one of its own. */
export function makeSlabHit(): SlabHit {
  return { min: 0, max: 0, axis: 0, sign: 0 };
}

/**
 * Open a test: nothing nearer than the origin, nothing further than `maxT`.
 *
 * `min` starts at 0 rather than at `-Infinity`, which is what makes a ray that began inside the
 * box land at zero rather than behind itself — the property `ai/PlayerCombatant` relies on.
 */
export function beginSlab(out: SlabHit, maxT: number): void {
  out.min = 0;
  out.max = maxT;
  out.axis = 0;
  out.sign = 0;
}

/**
 * Narrow `out` by one axis, and remember which face the near intersection came from.
 *
 * `o` and `d` are the ray's origin and direction along that axis in the box's own frame, `h` is
 * the box's half extent along it. False once the interval has closed and the ray has missed, so
 * a caller tests three axes and stops at the first false.
 *
 * A hit needs to know which way its normal points and an exit distance does not, which is why
 * the face is tracked here and `Geometry.exitSlab` — the same test without it — stays separate.
 */
export function narrowSlab(out: SlabHit, o: number, d: number, h: number, axis: number): boolean {
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
  if (t1 > out.min) {
    out.min = t1;
    out.axis = axis;
    out.sign = s;
  }
  if (t2 < out.max) out.max = t2;
  return out.min <= out.max;
}
//#endregion
