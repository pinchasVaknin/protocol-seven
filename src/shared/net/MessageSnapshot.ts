/**
 * The snapshot frame and the command batch: the two messages that carry the simulation itself.
 *
 * The header only. The bodies — the owner block and the entity deltas one way, the commands
 * the other — are streamed by the caller out of the same reader, because both are
 * variable-length and neither should allocate a list to hand back. `Snapshot.ts` owns the
 * records inside them; this file owns the framing around them.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { InputCommand, MutableInputCommand } from '../core/InputCommand';
import type { PlayerSimState } from '../player/PlayerState';
import { BAD, head, type BadFrame } from './MessageFrame';
import {
  dequantAngle,
  dequantMove,
  dequantPitch,
  MAX_COMMANDS_PER_BATCH,
  MsgC,
  MsgS,
  quantAngle,
  quantMove,
  quantPitch,
} from './Protocol';
import { writeEntity, writeOwnerState, type EntitySnapshot } from './Snapshot';
import type { ByteReader, ByteWriter } from './Wire';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface SnapshotHeader {
  snapshotId: number;
  baselineId: number;
  serverTick: number;
  /** The last command seq the server has processed for this client. The ack (S4.11). */
  ackSeq: number;
  /** The tick that command was applied on. */
  ackTick: number;
  /** Score, so the HUD has it without a second channel. */
  scoreA: number;
  scoreB: number;
  /** Seconds left in the match, or -1 outside a running clock. */
  timeLeft: number;
  /** `SFlag` bits. Match phase, which S4.15 lists as server-authoritative round state. */
  flags: number;
  /** Index into `MATCH_PHASES`. The HUD's banner reads the phase, not just the frozen bit. */
  phase: number;
  /** Seconds left of the warm-up or round-end hold. Drives the 3-2-1 countdown. */
  phaseSeconds: number;
  /** Round number, for the modes that have them. */
  round: number;
  /**
   * How often this client's commands have recently arrived too late to use, 0-60.
   *
   * The feedback signal for S4.11's *"measure and adapt this offset per client"*. Only the
   * server can measure it — the client has no way to know its command was late, because from
   * its side it was sent on time.
   */
  starvation: number;
}

/** The snapshot and the command batch: a head each, then a body the caller streams. */
export type DecodedSnapshotFrame =
  | { kind: 'commands'; count: number; snapshotAck: number }
  | { kind: 'snapshot' };
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Snapshot header flags.
 *
 * `InputFrozen` exists because of a divergence that was invisible until it was measured. The
 * server zeroes a player's movement axes during WARMUP and ROUND_END, and applies no command
 * at all while they are dead. A client that did not know either of those things kept
 * predicting ordinary movement, and every tick of the three-second countdown and every tick
 * of every death produced a correction. Measured before this flag existed: ~68 mispredictions
 * per twenty-second run at **zero** added latency, p50 7.7 cm.
 *
 * S4.15 already puts "round state" in the server-authoritative column. This is that rule
 * being honoured rather than a new mechanism.
 */
export const SFlag = {
  /** Countdown or post-round: movement and actions are ignored, look is not. */
  InputFrozen: 1 << 0,
  /** The match has ended. */
  MatchOver: 1 << 1,
} as const;

/**
 * Wire order for `MatchPhase`. Index, not string — one byte instead of a length-prefixed word.
 *
 * Mirrors `MATCH_PHASES` in `shared/modes/MatchFlow.ts`; the two are asserted to agree by
 * `phaseIndex` returning 0 for anything unrecognised, which is WARMUP and is the safe answer.
 */
export const WIRE_PHASES = ['WARMUP', 'LIVE', 'ROUND_END', 'MATCH_END'] as const;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * A batch of commands, newest last.
 *
 * S6.2 requires the *whole* struct, and it is worth being blunt about why the redundancy is
 * here rather than a retransmit scheme: commands are tiny and a lost one is unrecoverable by
 * the time anybody notices. Sending the last few every tick means a single dropped frame
 * costs nothing at all, and at ~13 bytes a command that is cheaper than any acknowledgement
 * protocol would be.
 */
export function writeCommands(
  w: ByteWriter,
  cmds: readonly InputCommand[],
  count: number,
  lastSnapshotAck: number,
): Uint8Array {
  head(w, MsgC.Commands);
  const n = Math.min(count, MAX_COMMANDS_PER_BATCH);
  w.u16(lastSnapshotAck);
  w.u8v(n);
  for (let i = 0; i < n; i++) {
    const c = cmds[i];
    if (c === undefined) continue;
    w.u32(c.seq);
    w.i32(c.tickIndex);
    // Move axes are already normalised to -1..1 by the sampler; a byte each is 1/127
    // resolution, well under what a keyboard or a stick produces after normalisation.
    w.i8(quantMove(c.moveX));
    w.i8(quantMove(c.moveZ));
    w.u16(quantAngle(c.yaw));
    w.i16(quantPitch(c.pitch));
    w.u32(c.buttons);
  }
  return w.bytes();
}

/** The command batch header. The commands themselves stream out of the reader. */
export function decodeCommands(r: ByteReader): DecodedSnapshotFrame | BadFrame {
  const snapshotAck = r.u16();
  const count = r.u8v();
  if (r.overran || count > MAX_COMMANDS_PER_BATCH) return BAD;
  return { kind: 'commands', count, snapshotAck };
}

/** Read one command out of a `commands` body into a caller-owned record. */
export function readCommand(r: ByteReader, out: MutableInputCommand): void {
  out.seq = r.u32();
  out.tickIndex = r.i32();
  out.moveX = dequantMove(r.i8());
  out.moveZ = dequantMove(r.i8());
  out.yaw = dequantAngle(r.u16());
  out.pitch = dequantPitch(r.i16());
  out.buttons = r.u32();
  // Never transmitted: it is the *sampling runtime's* clock, so a client's value is
  // meaningless here and trusting one would be trusting a number an attacker chose.
  out.sampledAtMs = 0;
}

export function writeSnapshotHeader(w: ByteWriter, h: SnapshotHeader): void {
  head(w, MsgS.Snapshot);
  w.u16(h.snapshotId);
  w.u16(h.baselineId);
  w.i32(h.serverTick);
  /**
   * **Signed**, so the "nothing acked yet" sentinel survives the wire.
   *
   * This was a bug worth remembering. `ackSeq` starts at -1 on a freshly seated player, and
   * as a `u32` that arrives as 4,294,967,295. The client set `lastAckedSeq` to four billion
   * on the first snapshot and then silently discarded every real ack for the rest of the
   * match as "older than one already applied" — so reconciliation ran exactly once, at join,
   * and never again. Nothing looked wrong: the player moved, the game played, and prediction
   * was quietly doing nothing at all.
   *
   * It only appeared with two clients, because with one the join happened to complete before
   * the first snapshot went out and the sentinel was never sent.
   */
  w.i32(h.ackSeq);
  w.i32(h.ackTick);
  w.u16(h.scoreA);
  w.u16(h.scoreB);
  w.i16(Math.round(h.timeLeft));
  w.u8v(h.flags);
  w.u8v(h.starvation);
  w.u8v(h.phase);
  // Tenths, so a 3-2-1 countdown ticks smoothly rather than in whole seconds.
  w.u16(Math.max(0, Math.round(h.phaseSeconds * 10)));
  w.u8v(Math.min(255, Math.max(0, h.round)));
}

/** The snapshot header, which the caller reads next out of the same reader. */
export function decodeSnapshot(): DecodedSnapshotFrame {
  return { kind: 'snapshot' };
}

export function readSnapshotHeader(r: ByteReader, out: SnapshotHeader): void {
  out.snapshotId = r.u16();
  out.baselineId = r.u16();
  out.serverTick = r.i32();
  out.ackSeq = r.i32();
  out.ackTick = r.i32();
  out.scoreA = r.u16();
  out.scoreB = r.u16();
  out.timeLeft = r.i16();
  out.flags = r.u8v();
  out.starvation = r.u8v();
  out.phase = r.u8v();
  out.phaseSeconds = r.u16() / 10;
  out.round = r.u8v();
}

export function makeSnapshotHeader(): SnapshotHeader {
  return {
    snapshotId: 0,
    baselineId: 0,
    serverTick: 0,
    ackSeq: 0,
    ackTick: 0,
    scoreA: 0,
    scoreB: 0,
    timeLeft: -1,
    flags: 0,
    starvation: 0,
    phase: 0,
    phaseSeconds: 0,
    round: 1,
  };
}

/**
 * The owner block, flagged so a spectating or unspawned client can omit it entirely.
 *
 * The cheat mask is written **after** the optional state and unconditionally (playtest round 4,
 * F14). Unconditionally because the block is absent for a client with no body, and a player who
 * switches free-cam on while dead would otherwise not be told until they spawned; after, because
 * appending is the change that leaves every existing field where it was.
 *
 * One byte per snapshot per client, and it buys the property that matters: the entitlement is
 * replicated as **state**, so no single dropped frame can leave the two sides disagreeing about
 * whether a wall stops this player.
 */
export function writeSnapshotOwner(
  w: ByteWriter,
  owner: PlayerSimState | null,
  cheatMask: number,
): void {
  if (owner === null) {
    w.u8v(0);
  } else {
    w.u8v(1);
    writeOwnerState(w, owner);
  }
  w.u8v(cheatMask & 0xff);
}

/** True when an owner block follows. */
export function readSnapshotOwnerPresent(r: ByteReader): boolean {
  return r.u8v() === 1;
}


export function writeSnapshotEntities(
  w: ByteWriter,
  entities: readonly EntitySnapshot[],
  count: number,
  baseline: (id: number) => EntitySnapshot | null,
  removed: readonly number[],
  removedCount: number,
): void {
  w.u8v(Math.min(removedCount, 255));
  for (let i = 0; i < removedCount && i < 255; i++) w.u8v(removed[i] ?? 0);
  w.u8v(Math.min(count, 255));
  for (let i = 0; i < count && i < 255; i++) {
    const e = entities[i];
    if (e === undefined) continue;
    writeEntity(w, e, baseline(e.entityId));
  }
}

export function phaseIndex(phase: string): number {
  const at = WIRE_PHASES.indexOf(phase as (typeof WIRE_PHASES)[number]);
  return at < 0 ? 0 : at;
}

export function phaseAt(index: number): (typeof WIRE_PHASES)[number] {
  return WIRE_PHASES[index] ?? 'WARMUP';
}
//#endregion
