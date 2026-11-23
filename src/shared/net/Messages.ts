/**
 * Every message on the wire, in one place at the frame level (M10, S6.1).
 *
 * ## Where a message lives
 *
 * Reader and writer for a given message sit next to each other on purpose. A binary protocol
 * fails silently and expensively when the two halves drift, and the cheapest defence is that
 * changing one and not the other is visible in a single screen of code. They sit together in
 * the file for their **message family** — the seat, the class, the match's rhythm, a mode's
 * per-tick state, the snapshot, the event channel — and this file is the frame around all of
 * them: the id table, the decode entry point, and the surface every caller imports.
 *
 * ```
 *   u32 MAGIC | u8 msgId | payload...
 * ```
 *
 * See `MessageFrame.ts` for what the magic buys and `DECODERS` for how an id becomes a decoder.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { BAD, type BadFrame } from './MessageFrame';
import { decodeEvents, type DecodedEvents } from './MessageEvents';
import { decodeLoadout, type DecodedLoadout } from './MessageLoadout';

import {
  decodePrepare,
  decodeReady,
  decodeScoreboard,
  decodeSummary,
  decodeVote,
  decodeVoteState,
  type DecodedMatchFlow,
} from './MessageMatchFlow';
import {
  decodeBomb,
  decodeCheatRequest,
  decodeCheats,
  decodeObjectives,
  decodeProjectiles,
  decodeStateHash,
  decodeStreakRequest,
  decodeStreaks,
  decodeTags,
  type DecodedModeState,
} from './MessageModeState';
import {
  decodeBye,
  decodeHello,
  decodeMigrate,
  decodeNotice,
  decodePing,
  decodePong,
  decodeReject,
  decodeWelcome,
  type DecodedSeat,
} from './MessageSeat';
import {
  decodeCommands,
  decodeSnapshot,
  type DecodedSnapshotFrame,
} from './MessageSnapshot';
import { MAGIC, MsgC, MsgS, type MsgCId, type MsgSId } from './Protocol';
import { ByteReader, ByteWriter } from './Wire';
import { readEntity, readOwnerState } from './Snapshot';

/*
 * The surface this file has always had, kept whole where every caller already imports it.
 * Each name now lives in its message family's file; nothing about what a caller writes or
 * reads changes, which is the one thing a split of this file was not allowed to do.
 */
export {
  Ev,
  beginEvents,
  finishEvents,
  readEvents,
  writeDamage,
  writeFired,
  writeFootstep,
  writeImpact,
  writeKilled,
  writePose,
  type DamageEvent,
  type EventSink,
  type FiredEvent,
  type FootstepEvent,
  type ImpactEvent,
  type KilledEvent,
  type PoseEvent,
} from './MessageEvents';
export {
  writeLoadout,
} from './MessageLoadout';
export {
  MAX_SCORE_ROWS,
  writePrepare,
  writeReady,
  writeScoreboard,
  writeSummary,
  writeVote,
  writeVoteState,
  type SummaryInfo,
  type SummaryRow,
  type SummaryXpLine,
  type VoteInfo,
} from './MessageMatchFlow';
export {
  bombStateCode,
  writeBomb,
  writeCheatRequest,
  writeCheats,
  writeObjectives,
  writeProjectiles,
  writeStateHash,
  writeStreakRequest,
  writeStreaks,
  writeTags,
} from './MessageModeState';
export {
  writeBye,
  writeHello,
  writeNotice,
  writePing,
  writePong,
  writeReject,
  writeWelcome,
  type WelcomeInfo,
} from './MessageSeat';
export {
  SFlag,
  WIRE_PHASES,
  makeSnapshotHeader,
  phaseAt,
  phaseIndex,
  readCommand,
  readSnapshotHeader,
  readSnapshotOwnerPresent,
  writeCommands,
  writeSnapshotEntities,
  writeSnapshotHeader,
  writeSnapshotOwner,
  type SnapshotHeader,
} from './MessageSnapshot';
export { readOwnerState, readEntity };
export { ByteReader, ByteWriter };
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** Everything a decoded frame can be. Discriminated on `kind`. */
export type Decoded =
  | DecodedSeat
  | DecodedLoadout
  | DecodedSnapshotFrame
  | DecodedMatchFlow
  | DecodedModeState
  | DecodedEvents
  | BadFrame;

/** One message id's decoder. Reads the body `decodeHeader` has just read the head of. */
type FrameDecoder = (r: ByteReader) => Decoded;
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Message id to decoder, which replaced a 383-line `switch` (A21).
 *
 * `satisfies Record<MsgCId | MsgSId, FrameDecoder>` is the part that earns its keep: the two id
 * spaces are disjoint — client 1-9, server 128-146 — and the compiler now refuses a protocol
 * that grows a message nothing decodes, which the switch could only have failed at runtime.
 *
 * A table rather than a switch is allowed here because this dispatch runs **once per frame**,
 * not once per entity per tick; R7 keeps tables out of the per-entity loops, and `readEvents`
 * and `writeEntity` still keep their switches for exactly that reason.
 */
const DECODERS = {
  [MsgC.Hello]: decodeHello,
  [MsgC.Commands]: decodeCommands,
  [MsgC.Ping]: decodePing,
  [MsgC.Bye]: decodeBye,
  [MsgC.Loadout]: decodeLoadout,
  [MsgC.Vote]: decodeVote,
  [MsgC.Ready]: decodeReady,
  [MsgC.Streak]: decodeStreakRequest,
  [MsgC.Cheat]: decodeCheatRequest,
  [MsgS.Welcome]: decodeWelcome,
  [MsgS.Reject]: decodeReject,
  [MsgS.Snapshot]: decodeSnapshot,
  [MsgS.Pong]: decodePong,
  [MsgS.Events]: decodeEvents,
  [MsgS.Bye]: decodeBye,
  [MsgS.Migrate]: decodeMigrate,
  [MsgS.Vote]: decodeVoteState,
  [MsgS.Prepare]: decodePrepare,
  [MsgS.Summary]: decodeSummary,
  [MsgS.Notice]: decodeNotice,
  [MsgS.Objectives]: decodeObjectives,
  [MsgS.Tags]: decodeTags,
  [MsgS.Bomb]: decodeBomb,
  [MsgS.Streaks]: decodeStreaks,
  [MsgS.Projectiles]: decodeProjectiles,
  [MsgS.StateHash]: decodeStateHash,
  [MsgS.Cheats]: decodeCheats,
  [MsgS.Scoreboard]: decodeScoreboard,
} satisfies Record<MsgCId | MsgSId, FrameDecoder>;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Read the frame header and dispatch on the message id.
 *
 * Returns `{kind:'bad'}` for anything unrecognised, truncated or not ours. **It never
 * throws** — S4.16 makes that a hard requirement, because every byte reaching this function
 * came from an untrusted socket and an exception here is a denial-of-service vector rather
 * than a bug report.
 *
 * `snapshot` and `commands` decode their header only; their bodies are streamed by the
 * caller out of the same reader, because both are variable-length and neither should
 * allocate a list to hand back.
 */
export function decodeHeader(r: ByteReader): Decoded {
  if (r.remaining < 5) return BAD;
  if (r.u32() !== MAGIC) return BAD;
  const decode: FrameDecoder | undefined = DECODERS[r.u8v() as MsgCId | MsgSId];
  return decode === undefined ? BAD : decode(r);
}
//#endregion
