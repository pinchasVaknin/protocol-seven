/**
 * Commands from one client, ordered and made continuous (M10, S6.2).
 *
 * This is where the queueing half of the old `INetworkTransport` went, and it is the only
 * place in the codebase that needs it. S6.2 states the problem exactly: *"commands arrive
 * early, late, out of order, or not at all. Buffer them, apply in `seq` order at the right
 * tick, and on a gap **repeat the last command** rather than applying nothing."*
 *
 * ## Why repeating beats skipping
 *
 * S6.2 gives the reason in one line — *"A dropped packet should read as a hitch, not a
 * stop"* — and it is worth being concrete about what the alternative looks like. A player
 * running forward loses one frame. If the server applies a null command for that tick, the
 * player's `moveZ` goes to zero for 16 ms: friction bites, the sprint hold timer resets, and
 * because `PlayerController` computes edge transitions from `prevButtons`, the *next* real
 * command re-fires every held button as a fresh press. One lost packet cancels a sprint and
 * can retrigger a jump. Repeating the last command instead means the player keeps doing what
 * they were doing, which is overwhelmingly what they were about to do anyway.
 *
 * ## Why it is a ring by tick, not a queue
 *
 * Commands carry the tick they were sampled for. A queue would apply them in arrival order;
 * this parks each one at its own tick and reads that slot when the tick comes round. Late and
 * out-of-order arrivals sort themselves out for free, and a duplicate — which the redundancy
 * in `writeCommands` produces constantly by design — simply overwrites the slot it already
 * filled with identical bytes.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import {
  copyCommand,
  NULL_COMMAND,
  type InputCommand,
  type MutableInputCommand,
  makeCommand,
} from '../../shared/core/InputCommand';
import { ringIndex } from '../../shared/core/MathUtil';
import { MAX_TICK_SKEW } from '../../shared/net/Protocol';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface InputBufferStats {
  /** Commands accepted into the ring. */
  readonly accepted: number;
  /** Commands rejected as duplicates of a slot already filled with that seq. */
  readonly duplicate: number;
  /** Commands whose tick was outside the ring — too old to matter or too far ahead. */
  readonly outOfWindow: number;
  /** Ticks simulated by repeating the previous command because the slot was empty. */
  readonly repeated: number;
  /** Ticks simulated with the null command because nothing had ever arrived. */
  readonly starved: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Ticks of command history held: **exactly the window the validator admits**.
 *
 * Derived rather than chosen (BACKLOG #38, fixed 2026-11-22), and the derivation is the fix
 * for both halves of that entry. It used to be a flat 128 with the window taken as half a ring
 * either side, which was wrong twice over:
 *
 * - `[tick - 64, tick + 64]` is **129 ticks over 128 slots**, and `(c - 64) % 128` is
 *   `(c + 64) % 128` — so a command 64 ticks ahead silently overwrote one 64 ticks behind, and
 *   the earlier tick then starved and repeated the command before it.
 * - `validateCommand` admits a skew of up to `MAX_TICK_SKEW`, so everything from 65 to 120
 *   ticks out passed the boundary and was then counted here as `outOfWindow`. This file's own
 *   comment had claimed the window was "comfortably past `MAX_TICK_SKEW` in both directions".
 *
 * One ring long and one window long are the same length now, so the two ends cannot meet and
 * nothing the boundary let through is dropped here. `outOfWindow` therefore counts only what
 * `accept` was handed without being validated first — which is a caller's bug, not a client's,
 * and worth a non-zero count saying so. 241 ticks is 4.0 s at 60 Hz, against 2.1 s before;
 * the cost is 113 more pooled commands, allocated once.
 */
const RING = MAX_TICK_SKEW * 2 + 1;
//#endregion

// ===================================== CLASS InputBuffer ====================================== \\
//#region Class InputBuffer
export class InputBuffer {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Highest `seq` ever accepted. Echoed back to the client as the ack (S4.11). */
  lastSeq = -1;
  /** The tick `lastSeq` was applied on. */
  lastAppliedTick = -1;

  private accepted = 0;
  private duplicate = 0;
  private outOfWindow = 0;
  private repeated = 0;
  private starved = 0;

  private readonly slots: MutableInputCommand[] = [];
  /** Which tick each slot currently holds, or -1 for empty. */
  private readonly slotTick = new Int32Array(RING).fill(-1);
  /** The last command actually applied, for the gap-filling repeat. */
  private readonly last: MutableInputCommand = makeCommand();
  private hasLast = false;

  /**
   * Repeats in the recent past, as a decaying count (M10, S4.11).
   *
   * Replicated to the client so it can widen its jitter buffer. S4.11 requires the client's
   * lead to be *measured and adapted*, and this is the measurement: the server is the only
   * party that knows a command failed to arrive in time, because the client sent it and has
   * no idea it was late.
   *
   * Decayed rather than reset so a burst of starvation keeps influencing the client for a
   * second or so afterwards, which stops the lead oscillating between too tight and too wide.
   */
  private starvation = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor() {
    for (let i = 0; i < RING; i++) this.slots.push(makeCommand());
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  stats(): InputBufferStats {
    return {
      accepted: this.accepted,
      duplicate: this.duplicate,
      outOfWindow: this.outOfWindow,
      repeated: this.repeated,
      starved: this.starved,
    };
  }

  /**
   * Accept one validated command.
   *
   * `currentTick` bounds the window, at the same `MAX_TICK_SKEW` the boundary checks: further
   * behind than that is history the simulation has already passed, and further ahead is a
   * client whose clock is wrong or hostile. Both are counted rather than silently dropped,
   * because the count is the first thing to look at when a player reports rubberbanding — and
   * because this bound agreeing with the validator's means a non-zero count is now a sign that
   * something reached here unvalidated (see `RING`).
   *
   * The command must already have been through `validateCommand` — this trusts its fields.
   */
  accept(cmd: InputCommand, currentTick: number): boolean {
    const tick = cmd.tickIndex;
    if (tick < currentTick - MAX_TICK_SKEW || tick > currentTick + MAX_TICK_SKEW) {
      this.outOfWindow++;
      return false;
    }

    const index = slotIndex(tick);
    const slot = this.slots[index];
    if (slot === undefined) return false;

    // The slot already holds this exact command: the redundant copy in a later batch.
    if (this.slotTick[index] === tick && slot.seq === cmd.seq) {
      this.duplicate++;
      return false;
    }

    copyCommand(cmd, slot);
    this.slotTick[index] = tick;
    this.accepted++;
    if (cmd.seq > this.lastSeq) this.lastSeq = cmd.seq;
    return true;
  }

  /**
   * The command to simulate for `tick`.
   *
   * Never returns null. A tick always has a command — the one that arrived, the previous one
   * repeated, or the null command before anything has ever arrived — because
   * `PlayerController.step` consumes exactly one per tick and skipping would desync this
   * client's tick count from the server's.
   */
  take(tick: number): InputCommand {
    const index = slotIndex(tick);
    const slot = this.slots[index];

    if (slot !== undefined && this.slotTick[index] === tick) {
      // Consume it: the slot is freed so a stale command from 128 ticks ago cannot be
      // mistaken for a fresh one when the ring wraps back round to it.
      this.slotTick[index] = -1;
      copyCommand(slot, this.last);
      this.hasLast = true;
      this.lastAppliedTick = tick;
      return slot;
    }

    if (this.hasLast) {
      this.repeated++;
      // Capped well below the byte it is sent in, so a long stall cannot saturate the signal
      // and lose the difference between "occasionally late" and "constantly late".
      if (this.starvation < 60) this.starvation++;
      // The repeat is stamped with the tick it is being applied on. `PlayerController` reads
      // `tickIndex` into `sim.tick`, which the tac-sprint double-tap window measures against —
      // a repeat carrying a stale tick would make that window drift.
      this.last.tickIndex = tick;
      return this.last;
    }

    this.starved++;
    return NULL_COMMAND;
  }

  /**
   * Repeats since the last call, 0-60. Replicated so the client can widen its lead (S4.11).
   *
   * A **delta**, not a level, and that distinction was the difference between the adaptation
   * working and not. The first version decayed the count by one on every read; reads happen
   * once per snapshot at 20 Hz, while starvation on a healthy link runs at well under one
   * event per second. The counter was therefore back at zero before the client ever saw it,
   * the client's earned lead decayed straight back to nothing, and the adaptation measurably
   * did nothing at all.
   *
   * Reporting the delta puts the smoothing where it belongs — on the client, which is the
   * side that has to trade input latency against corrections and is the only side that knows
   * how much of each it is currently paying.
   */
  takeStarvation(): number {
    const value = this.starvation;
    this.starvation = 0;
    return value;
  }

  /** Forget everything. Used when a player respawns into a fresh controller. */
  reset(): void {
    this.slotTick.fill(-1);
    this.hasLast = false;
    this.lastSeq = -1;
    this.lastAppliedTick = -1;
    this.starvation = 0;
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** The slot a tick parks in. Wrap-safe for a negative tick, which `index` in `RigHistory` is too. */
/** This ring's slot for a tick. The wrap itself is `MathUtil.ringIndex` (BACKLOG #36). */
function slotIndex(tick: number): number {
  return ringIndex(tick, RING);
}
//#endregion
