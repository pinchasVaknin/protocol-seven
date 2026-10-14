/**
 * The outgoing command stream (A22, lifted out of `NetClient`).
 *
 * One invariant, in one place: **the client predicts with exactly the bytes the wire will
 * carry**, and every frame carries the last few commands so that a single lost one costs
 * nothing at all. Those two facts are one mechanism — the rounding happens on the way into
 * the redundancy ring, so what was predicted with and what was sent are the same record —
 * and they used to be four fields and four methods spread through a 1,200-line class.
 *
 * What it does not decide: *when* a command must be suppressed. That is the seat's state —
 * the match's phase and whether this player is alive — and it stays with the client that
 * holds it, as `NetClient.inputSuppressed`.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { Btn, copyCommand, type InputCommand, type MutableInputCommand } from '../core/InputCommand';
import { COMMAND_REDUNDANCY, quantiseCommandInPlace } from './Protocol';
import { writeCommands } from './Messages';
import type { ByteWriter } from './Wire';
//#endregion

// =================================== CLASS CommandPipeline ==================================== \\
//#region Class CommandPipeline
export class CommandPipeline {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly writer: ByteWriter;

  /**
   * The newest commands, oldest first, resent every tick for redundancy against loss.
   *
   * S6.2 requires commands to survive a dropped packet, and at thirteen bytes each the
   * cheapest way to do that is to keep sending the last sixteen. A single lost frame then
   * costs nothing at all, and no acknowledgement protocol is needed for the one message type
   * where a retransmit would arrive too late to be worth anything.
   */
  private readonly pending: MutableInputCommand[] = [];

  /** Neutralised command scratch. See `neutralise`. */
  private readonly neutral: MutableInputCommand = blank();
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  /** Takes the client's own writer: one encode buffer per connection, as `ByteWriter` intends. */
  constructor(writer: ByteWriter) {
    this.writer = writer;
    for (let i = 0; i < COMMAND_REDUNDANCY; i++) this.pending.push(blank());
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Apply the server's own input rules to a sampled command, before predicting with it.
   *
   * `suppress` is the caller's answer to *"does the server consume this command at all"* —
   * `NetClient.inputSuppressed` states the two cases and why each one was a real divergence.
   * `ServerMatch.stepPlayer` strips the movement axes and every action bit and keeps the view
   * angles, so looking around still works; this does the same thing to the same fields.
   *
   * The view angles survive in both cases, which is what makes a countdown feel like a
   * starting gun and a death screen feel like a camera rather than a freeze frame.
   *
   * Every command passes through here, suppressed or not, because this is also where the
   * command is rounded to wire precision.
   *
   * This is the netcode-side statement of a rule the single-player build already had
   * (`Input.sampleSpectating`). Neither side owns it alone: it lives here so both halves of
   * a networked match read it from one place.
   *
   * **Except that it restated the rule and lost its exception** (playtest round 4, B6).
   * `Input.sampleSpectating` keeps `Btn.Scoreboard` through a death on purpose — the M4 note
   * that the death screen is exactly when you want to look at the board — and this zeroed the
   * whole bitfield, so on a networked client the one fact the scoreboard is derived from was
   * forced to nothing the moment the server said you were dead. The standing
   * authority-migration failure in miniature: the rule moved here, the exception did not.
   *
   * Keeping it costs no divergence and cannot. `Btn.Scoreboard` is presentation: nothing in
   * `PlayerController.step` or `Weapons.step` reads it, `NetPlayer.step` does not consume a
   * dead player's command at all, and the frozen path's `lastButtons` is only ever asked
   * whether the trigger was down. The bit rides the same bitfield as everything else because
   * S4.2 allows exactly one input path, not because the simulation wants it.
   */
  neutralise(cmd: InputCommand, suppress: boolean): InputCommand {
    const out = this.neutral;
    out.seq = cmd.seq;
    out.tickIndex = cmd.tickIndex;
    out.moveX = suppress ? 0 : cmd.moveX;
    out.moveZ = suppress ? 0 : cmd.moveZ;
    out.yaw = cmd.yaw;
    out.pitch = cmd.pitch;
    out.buttons = suppress ? cmd.buttons & Btn.Scoreboard : cmd.buttons;
    out.sampledAtMs = cmd.sampledAtMs;

    // Predict with exactly what the wire will carry. See `quantiseCommandInPlace` — without
    // this the client and the server simulate subtly different commands and the divergence
    // accumulates in one direction whenever the player is turning.
    quantiseCommandInPlace(out);
    return out;
  }

  /** Keep the newest commands for the redundant batch. */
  queue(cmd: InputCommand): void {
    // Shift left and append. The array is `MAX_COMMANDS_PER_BATCH` long and this runs at most
    // five times a frame, so the copy is cheaper than the bookkeeping a ring would need.
    for (let i = 0; i < this.pending.length - 1; i++) {
      const dst = this.pending[i];
      const src = this.pending[i + 1];
      if (dst !== undefined && src !== undefined) copyCommand(src, dst);
    }
    const last = this.pending[this.pending.length - 1];
    if (last !== undefined) copyCommand(cmd, last);
  }

  /** The batch as a frame, acking `ackSnapshot`. Valid until the next write on the writer. */
  frame(ackSnapshot: number): Uint8Array {
    return writeCommands(this.writer, this.pending, this.pending.length, ackSnapshot);
  }

  /**
   * Forget every queued command.
   *
   * Called on a seat assignment: the commands in the ring were stamped with ticks from the
   * instance this client has just left, and resending them would ask the new one to simulate
   * input for a world that is gone.
   */
  clear(): void {
    for (const cmd of this.pending) blankInto(cmd);
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function blank(): MutableInputCommand {
  return { seq: 0, tickIndex: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, sampledAtMs: 0 };
}

/** Wipe a command in place. The redundancy buffer is preallocated and never reallocated. */
function blankInto(cmd: MutableInputCommand): void {
  cmd.seq = 0;
  cmd.tickIndex = 0;
  cmd.moveX = 0;
  cmd.moveZ = 0;
  cmd.yaw = 0;
  cmd.pitch = 0;
  cmd.buttons = 0;
  cmd.sampledAtMs = 0;
}
//#endregion
