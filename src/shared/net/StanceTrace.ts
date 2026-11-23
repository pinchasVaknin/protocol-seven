/**
 * Whether a stance change ever reaches the client on the wire (BACKLOG #87).
 *
 * ## The one question left
 *
 * Two instruments have now measured the two ends and they disagree. On the server, a probe over
 * the stepped roster reports **nothing**: no live bot is `AIRBORNE` for even a second, across a
 * deployed session and eight headless matches. On the client, `?airpose` catches bodies holding
 * `stance: AIRBORNE` for 1,200 ms and more, with `frozen: false` — so the interpolator is being
 * fed, it is simply being fed the wrong stance.
 *
 * Both measurements are sound and they cannot both describe the same fact, so the change is
 * being lost between them. The replication path was then read end to end and every link came
 * back consistent: the encoder's baseline is the frame the client acked and `store` copies it,
 * the dormant record freezes coherently, `interp.reset` leaves `latest` alone so the client's
 * baseline survives a wake. Nothing there is visibly wrong, which is exactly when guessing
 * stops being worth anything.
 *
 * So this asks the question directly, at the only place that can answer it: **does a delta
 * carrying the `Stance` bit ever arrive for a body that is stuck, and what did it carry?**
 *
 * - The bit never arrives → the server decided the stance matched its baseline and did not send
 *   it. The fault is in what the server believes the client knows, and the hunt moves to the
 *   acked-baseline bookkeeping around dormancy.
 * - The bit arrives carrying `AIRBORNE` → the server really is sending that stance, and the
 *   server-side probe is looking at the wrong roster or the wrong instance.
 * - The bit arrives carrying `STAND` and the body stays in the air pose → replication is sound
 *   and the fault is downstream, in the interpolator's sampling or the animator.
 *
 * Three outcomes, each naming a different file. That is what an instrument is for.
 *
 * ## Why it lives in `shared/net`
 *
 * It records inside `NetClient.readEntityDeltas`, which is `shared/`, and `check-boundaries`
 * will not let `shared/` reach into `client/`. The client turns it on through the same
 * `?airpose` flag that drives the pose watch, and reads it back through `__p7.stanceTrace()`.
 *
 * Off by default, and while off it costs one property read per entity per snapshot.
 */

// =========================================== TYPES ============================================ \\
//#region Types
/** One decoded delta for one entity, as the wire delivered it. */
export interface StanceDelta {
  readonly entityId: number;
  /** Whether the delta carried the `Stance` bit at all. The question this file exists to ask. */
  readonly sent: boolean;
  /** The stance the client held before this delta was applied. */
  readonly before: string;
  /** And after. Equal to `before` whenever `sent` is false — that is the contract, not a bug. */
  readonly after: string;
  /** Whether the record was marked dormant before this delta, and after it. */
  readonly wasDormant: boolean;
  readonly nowDormant: boolean;
  /** Server time of the snapshot this delta rode in, ms. */
  readonly serverMs: number;
}

export interface StanceTraceReport {
  readonly on: boolean;
  /** Deltas held, oldest first. Only those that changed something or crossed dormancy. */
  readonly deltas: readonly StanceDelta[];
  /** Per entity: how many snapshots carried a `Stance` bit since the trace was turned on. */
  readonly sentCounts: Readonly<Record<number, number>>;
  /** Per entity: how many did not. A body stuck with a large count here is the first answer. */
  readonly absentCounts: Readonly<Record<number, number>>;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Deltas kept. Enough to cover an episode and its edges; not a leak over a long session. */
const MAX_DELTAS = 512;

/**
 * The switch, read once per entity per snapshot at the call site.
 *
 * An object rather than an exported `let` for the same reason `AirPoseWatch` uses one: the
 * caller can read the field without a function call on a path that runs per entity per frame.
 */
export const STANCE_TRACE = { on: false };

const deltas: StanceDelta[] = [];
const sentCounts = new Map<number, number>();
const absentCounts = new Map<number, number>();
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** Turn the trace on or off. Turning it off clears what it held. */
export function setStanceTrace(on: boolean): void {
  STANCE_TRACE.on = on;
  if (!on) resetStanceTrace();
}

/**
 * One decoded entity delta. Called from `NetClient.readEntityDeltas` only when `STANCE_TRACE.on`.
 *
 * Every delta is counted, but only the interesting ones are kept: a body walking around with no
 * stance change is the overwhelming majority and says nothing. What is kept is any delta that
 * carried the bit, and any that crossed the dormant edge in either direction — which between
 * them are the only places the stance can change or be lost.
 */
export function noteStanceDelta(delta: StanceDelta): void {
  const counts = delta.sent ? sentCounts : absentCounts;
  counts.set(delta.entityId, (counts.get(delta.entityId) ?? 0) + 1);
  if (!delta.sent && delta.wasDormant === delta.nowDormant) return;
  deltas.push(delta);
  if (deltas.length > MAX_DELTAS) deltas.shift();
}

/** What the trace has seen. Read from `__p7.stanceTrace()`. */
export function stanceTraceReport(): StanceTraceReport {
  return {
    on: STANCE_TRACE.on,
    deltas: [...deltas],
    sentCounts: Object.fromEntries(sentCounts),
    absentCounts: Object.fromEntries(absentCounts),
  };
}

/** Forget everything recorded. The trace stays on. */
export function resetStanceTrace(): void {
  deltas.length = 0;
  sentCounts.clear();
  absentCounts.clear();
}
//#endregion
