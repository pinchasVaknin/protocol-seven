/**
 * Bit-deterministic trigonometry for the simulation (M9, S6.6 and S4.14).
 *
 * ## Why this exists
 *
 * The M9 cross-runtime check found the simulation diverging between Node and Chrome at tick
 * 149 of a 3600-tick run, on `vz`, by one unit in the last place. Probing the maths surface
 * with 20,000 arguments each found the cause precisely:
 *
 * | engine pair | `hypot` | `sqrt` | `pow` | `exp` | `log` | `atan2` | **`sin`** | **`cos`** |
 * |---|---|---|---|---|---|---|---|---|
 * | Node 24 (V8 13.6) vs Chrome 148 (V8 14.x), M9 | same | same | same | same | same | same | **differs** | **differs** |
 * | Node 24.18.0 vs Chrome 156.0.8078.100, 2026-11-22 | same | same | same | **differs** | **differs** | **differs** | **differs** | **differs** |
 *
 * They are not required to agree: ECMA-262 says these are *implementation-approximated*, and
 * V8 changes its kernels between versions.
 *
 * ## The second row is the one to read, and it was measured, not assumed (BACKLOG #22)
 *
 * The first row is M9's and it is **version-scoped** — the entry's original complaint was that
 * the header never said so. Re-measured on 2026-11-22 against the Chrome the game is actually
 * played in, **five of the eight natives differ, not two**. `simSin` and `simCos` agree across
 * both runtimes, which is the replacement strategy working exactly as designed.
 *
 * The measurement is `mathDigest()`'s own 20,000-argument sweep, run on both sides and diffed:
 * `node dist-server/hashRun.js` for Node, and `__p7.determinism.math()` in the browser — the
 * latter added on the same day, because `hashRun` reported the per-function digests and the
 * console handle did not, so the two halves of a check built to be compared could only be
 * compared on the fingerprint.
 *
 * ## What that does *not* mean
 *
 * **The simulation still agrees bit for bit.** The 3,600-tick fingerprint is `3c4687ef` in both
 * runtimes, measured the same day. A sweep differing and the simulation agreeing are not in
 * conflict: the sweep asks 20,000 arbitrary arguments and the simulation only ever asks the
 * few thousand its own state produces, which here land where the two engines round alike.
 *
 * So the table's columns are a property of **the sweep**, not a guarantee about the game. What
 * makes `sin`/`cos` different in kind is that M9 caught them diverging *in the simulation*, at
 * tick 149 on `vz` — a measured desync, not a measured sweep.
 *
 * ## What it does mean, and the part worth watching
 *
 * `Math.atan2` now demonstrably differs between the two runtimes, and the simulation uses it:
 * seven sites in `ai/BotBrain` and `ai/CombatBehaviour`, which are bot aim and bot movement.
 * **The determinism scenario does not cover them** — `runDeterminismScenario` drives a
 * `PlayerController`, a `WeaponSystem` and a `DamageSystem`, and builds no bots at all — so the
 * matching fingerprint says nothing about that code.
 *
 * It is not a desync, and that is a conclusion rather than a hope: a bot's brain runs in
 * exactly one runtime per match. Solo play runs it in the browser, a networked match runs it on
 * the server, and a networked client's roster is empty by construction. Nothing computes the
 * same bot's aim twice and compares.
 *
 * What it does cost is **reproducibility across runtimes**: the seeded `match-<MODE>.jsonl`
 * oracles describe the bots Node plays, and the same seed in a browser may deal a different
 * fight after enough ticks. Those oracles are compared Node-against-Node, so they are sound as
 * used — this is a caveat about reading them, not a defect in them. The day something *does*
 * compute a bot's aim on both sides, `atan2` needs the `simSin` treatment first.
 *
 * `Math.exp` reaches the simulation too, through `MathUtil.damp`, which `PlayerController.step`
 * calls every tick for the eye height — and that **is** on the fingerprint's path, and the
 * fingerprint matches. For the arguments a damped eye height produces, the two engines agree.
 *
 * ## One more thing this table implies
 *
 * **A SIM snapshot/compare pair is only meaningful on one machine and one Node build.** The
 * state hashes are built from these functions, so a "before" taken on one engine and an "after"
 * on another compares two things at once. `npm run readability` is immune: its figures go
 * through `toFixed(3)`/`toFixed(4)`, which rounds any last-bit difference away.
 *
 * `check-boundaries` bans `sin`, `cos` and `tan` in `shared/` and not `atan2`, `exp` or `log`.
 * That is deliberate as of this measurement: the three that are banned are banned because they
 * were caught desyncing a real simulation, and a ban on the other three would fire on ten
 * honest sites to guard against something no code path can currently reach.
 *
 * This is not a curiosity. S4.11 makes client prediction mandatory and reconciliation
 * replays unacked commands through the same `PlayerController.step` the server ran — and
 * yaw-to-direction is `sin`/`cos` on every single tick. A client on a different Chrome build
 * from the server's Node would drift from the server continuously, in a way that looks
 * exactly like packet loss and is not. Pinning versions is not available: players run
 * whatever browser they have.
 *
 * ## The implementation
 *
 * Cody-Waite argument reduction onto [-π/4, π/4], then the fdlibm minimax kernels. **Every
 * operation is `+`, `-`, `*` or `Math.round` on doubles**, all of which IEEE 754 specifies
 * exactly and every conformant engine must round identically. There is no library call left
 * to disagree about.
 *
 * Accuracy is within one ULP of the platform's own `Math.sin`/`Math.cos` over the range a
 * game uses, which is verified rather than asserted — see `verifyAgainstNative` below and
 * the M9 verification table in PLAN.md. A one-ULP change to a yaw cannot be felt; a
 * divergent one can be, eventually, as rubberbanding.
 *
 * ## Scope
 *
 * `shared/` uses these instead of `Math.sin`/`Math.cos`, and the boundary check enforces it.
 * `client/` may keep using the natives freely: a camera angle, a muzzle flash or a bob curve
 * is not simulation state and nobody replays it.
 */

// =========================================== TYPES ============================================ \\
//#region Types
/** A direction, written in place. See `lookDirection`. */
export interface LookDir {
  dx: number;
  dy: number;
  dz: number;
}

export interface AccuracyReport {
  /** Samples compared. */
  readonly samples: number;
  /** Largest difference from the platform's own function, in units in the last place. */
  readonly maxUlpSin: number;
  readonly maxUlpCos: number;
  /** Largest absolute difference. */
  readonly maxAbsSin: number;
  readonly maxAbsCos: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const PI = Math.PI;
const TWO_OVER_PI = 2 / PI;

/**
 * π/2, split so that `n * PIO2_HI` is exact for the `n` a game produces.
 *
 * `PIO2_HI` has its low 33 bits cleared, so multiplying it by a modest integer loses nothing;
 * `PIO2_LO` carries the rest. Subtracting the two parts separately is what keeps the reduced
 * argument accurate near a multiple of π/2, where cancellation would otherwise destroy it.
 */
const PIO2_HI = 1.5707963267341256; // 0x3FF921FB54400000
const PIO2_LO = 6.077100506506192e-11; // π/2 - PIO2_HI

// fdlibm __kernel_sin coefficients. Minimax for sin(x)/x - 1 on [-π/4, π/4].
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

// fdlibm __kernel_cos coefficients.
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

const reduced = { r: 0 };
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Deterministic sine. Same bits in every conformant engine.
 *
 * Non-finite input returns `NaN`, matching `Math.sin`, rather than looping in the reduction.
 */
export function simSin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const q = reduce(x);
  const r = reduced.r;
  switch (q) {
    case 0:
      return kernelSin(r);
    case 1:
      return kernelCos(r);
    case 2:
      return -kernelSin(r);
    default:
      return -kernelCos(r);
  }
}

/** Deterministic cosine. Same bits in every conformant engine. */
export function simCos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const q = reduce(x);
  const r = reduced.r;
  switch (q) {
    case 0:
      return kernelCos(r);
    case 1:
      return -kernelSin(r);
    case 2:
      return -kernelCos(r);
    default:
      return kernelSin(r);
  }
}

/** Deterministic tangent. Only a handful of call sites; derived rather than given a kernel. */
export function simTan(x: number): number {
  const c = simCos(x);
  return c === 0 ? NaN : simSin(x) / c;
}

/**
 * Compare against the host's `Math.sin`/`Math.cos` over the range a match uses.
 *
 * Not a test framework — a function the harness calls and reports, so the claim "within one
 * ULP" in PLAN.md is a measurement rather than a hope. Run in both runtimes: each compares
 * against *its own* natives, and both should agree with them to the same tolerance while
 * agreeing with each other exactly.
 */
export function verifyAgainstNative(samples = 200000, span = 64): AccuracyReport {
  let maxUlpSin = 0;
  let maxUlpCos = 0;
  let maxAbsSin = 0;
  let maxAbsCos = 0;

  // Deterministic sweep rather than random, so two runtimes compare identical arguments.
  for (let i = 0; i < samples; i++) {
    const x = ((i / (samples - 1)) * 2 - 1) * span;

    const ns = Math.sin(x);
    const ms = simSin(x);
    const as = Math.abs(ns - ms);
    if (as > maxAbsSin) maxAbsSin = as;
    const us = as / Math.max(ulp(ns), Number.MIN_VALUE);
    if (us > maxUlpSin) maxUlpSin = us;

    const nc = Math.cos(x);
    const mc = simCos(x);
    const ac = Math.abs(nc - mc);
    if (ac > maxAbsCos) maxAbsCos = ac;
    const uc = ac / Math.max(ulp(nc), Number.MIN_VALUE);
    if (uc > maxUlpCos) maxUlpCos = uc;
  }

  return {
    samples,
    maxUlpSin: Math.round(maxUlpSin * 1000) / 1000,
    maxUlpCos: Math.round(maxUlpCos * 1000) / 1000,
    maxAbsSin,
    maxAbsCos,
  };
}
/** A direction to write into, for a caller that has no object of its own to lend. */
export function makeLookDir(): LookDir {
  return { dx: 0, dy: 0, dz: 0 };
}

/**
 * The unit direction a body is looking in, for `yaw` and `pitch` in radians, into `out`.
 *
 * `yaw` 0 looks along -Z and a positive `pitch` looks up; the result is a unit vector because
 * the three components are a sine and two cosines of perpendicular angles.
 *
 * **These four lines are carried over character for character, and must stay that way**
 * (BACKLOG #27, R5). Three places computed them — a sentry's shot, a chopper gunner's, and the
 * flamethrower's jet — and `simSin`/`simCos` with `cp` factored out exactly like this is what
 * makes a round land in the same place on two engines. A helper is fine; re-deriving the maths
 * inside one is not, so nothing here was tidied on the way in.
 *
 * **Why this is not every caller of the expression.** `PlayerController.moveBasis` and
 * `ThrowController` compute a *basis* — a forward and a right — and the right vector reuses
 * the `simSin(yaw)` and `simCos(yaw)` the forward needs. Folding only the forward out of those
 * two would make them call the trigonometry twice on the hottest path in the game, which R7
 * forbids for a saving of four lines. They are a different shape and they stay where they are.
 */
export function lookDirection(yaw: number, pitch: number, out: LookDir): void {
  const cp = simCos(pitch);
  out.dx = -simSin(yaw) * cp;
  out.dy = simSin(pitch);
  out.dz = -simCos(yaw) * cp;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** sin on [-π/4, π/4]. */
function kernelSin(x: number): number {
  const z = x * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + x * z * (S1 + z * r);
}

/** cos on [-π/4, π/4]. */
function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  // Written as fdlibm writes it: the 0.5*z term is split out so the cancellation near
  // |x| ~ π/4 happens between two exactly representable pieces.
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

/**
 * Reduce `x` to `r` in [-π/4, π/4] and return the quadrant `n & 3`.
 *
 * The reduced value is written to `reduced` rather than returned as a pair, because S4.7
 * bans allocation in the per-tick path and this is squarely in it.
 */
function reduce(x: number): number {
  const n = Math.round(x * TWO_OVER_PI);
  reduced.r = x - n * PIO2_HI - n * PIO2_LO;
  return n & 3;
}

/** The gap between `v` and the next representable double. */
function ulp(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return Number.MIN_VALUE;
  const exp = Math.floor(Math.log2(a));
  return Math.pow(2, exp - 52);
}
//#endregion
