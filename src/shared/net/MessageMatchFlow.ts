/**
 * The rhythm between matches: the ballot, the hold before a match, the summary after one, and
 * the scoreboard that runs through all of it.
 *
 * These are the messages whose cadence is *seconds*, not ticks. Every one of them carries a
 * **deadline tick** rather than a duration where it has a countdown — see `SummaryInfo.endsTick`
 * — because a duration is only true at the instant it was sent.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { ReplicatedScoreRow } from '../combat/ScoreSystem';
import { BAD, head, type BadFrame } from './MessageFrame';
import { MsgC, MsgS } from './Protocol';
import type { ByteReader, ByteWriter } from './Wire';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** The vote cycle as the server sees it. The client renders this and computes nothing. */
export interface VoteInfo {
  readonly phase: number;
  readonly phaseEndsTick: number;
  readonly tally: readonly number[];
  readonly selfVote: number;
  readonly decidedMode: number;
  readonly decidedMap: number;
  readonly humans: number;
}

/** One row of the end-of-match summary (§6.9). */
export interface SummaryRow {
  readonly entityId: number;
  readonly displayName: string;
  readonly team: 'A' | 'B';
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  readonly score: number;
  readonly isBot: boolean;
}

/**
 * One row of the XP breakdown the M6 bar animates (v17, M13 Phase B).
 *
 * Awarded by the instance from the recipient's own `MatchLedger`, persisted by the client. The
 * row is named by its **index into `XP_SOURCES`** rather than by a label: both sides compile the
 * table, so the client rebuilds a full `XpLine` — id, label, kind — from one byte, and a label
 * on the wire would be a second spelling of a string the table already owns. `count` is what the
 * panel draws as `x7`; `amount` is the server's arithmetic, sent rather than re-derived.
 */
export interface SummaryXpLine {
  readonly source: number;
  readonly count: number;
  readonly amount: number;
}

export interface SummaryInfo {
  readonly matchId: number;
  readonly mapId: string;
  readonly modeId: string;
  readonly winner: string;
  /**
   * The individual who won, where the mode crowns one (v16, M13 Phase A).
   *
   * `MatchResult.winnerEntityId` on the wire: absent in team modes and on a draw, and the
   * reason a Free-for-All summary can say VICTORY to one player and a place to the rest rather
   * than VICTORY to everybody on the winner's substrate side.
   */
  readonly winnerEntityId?: number;
  readonly reason: string;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly rows: readonly SummaryRow[];
  readonly xp: readonly SummaryXpLine[];
  /**
   * The master tick the summary hold expires on, and everybody is migrated back (§6.9).
   *
   * A **deadline**, not a duration, and that is the whole of the playtest round 4 fix for B4.
   * A duration is only true at the instant it is sent: a client that entered the screen late,
   * or reconnected into it, or simply read the message a frame after the one that put the
   * screen up, would count from a number that was never about its own clock. The same shape as
   * `VoteInfo.phaseEndsTick`, derived the same way — `(endsTick - currentTick) * DT` against
   * the synced server clock — so the summary and the ballot cannot disagree about what a
   * countdown is.
   */
  readonly endsTick: number;
}

/** The ballot, the hold, the summary and the board. */
export type DecodedMatchFlow =
  | { kind: 'vote'; phase: number; option: number }
  | { kind: 'ready'; matchId: number }
  | ({ kind: 'voteState' } & VoteInfo)
  | { kind: 'prepare'; matchId: number; mapId: string; modeId: string }
  | ({ kind: 'summary' } & SummaryInfo)
  | { kind: 'scoreboard'; serial: number; rows: readonly ReplicatedScoreRow[] };
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Ballots are five modes and three maps; eight is headroom, not a limit anybody meets. */
const MAX_BALLOT_OPTIONS = 8;

const MAX_SUMMARY_ROWS = 24;

const MAX_XP_LINES = 12;

/** `SummaryInfo.winnerEntityId` absent, on the wire. */
const NO_WINNER_ENTITY = -1;

/** The most rows one board carries. Ten seats plus the bots they replaced, with headroom. */
export const MAX_SCORE_ROWS = 24;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function writeVote(w: ByteWriter, phase: number, option: number): Uint8Array {
  head(w, MsgC.Vote);
  w.u8v(phase);
  w.u8v(option);
  return w.bytes();
}

/** A client's ballot. */
export function decodeVote(r: ByteReader): DecodedMatchFlow | BadFrame {
  const phase = r.u8v();
  const option = r.u8v();
  return r.overran ? BAD : { kind: 'vote', phase, option };
}

export function writeReady(w: ByteWriter, matchId: number): Uint8Array {
  head(w, MsgC.Ready);
  w.u16(matchId);
  return w.bytes();
}

/** A client saying it is ready for the named match. */
export function decodeReady(r: ByteReader): DecodedMatchFlow | BadFrame {
  const matchId = r.u16();
  return r.overran ? BAD : { kind: 'ready', matchId };
}

export function writeVoteState(w: ByteWriter, info: VoteInfo): Uint8Array {
  head(w, MsgS.Vote);
  w.u8v(info.phase);
  w.i32(info.phaseEndsTick);
  w.u8v(Math.min(info.tally.length, MAX_BALLOT_OPTIONS));
  for (let i = 0; i < Math.min(info.tally.length, MAX_BALLOT_OPTIONS); i++) {
    w.u8v(Math.max(0, Math.min(255, info.tally[i] ?? 0)));
  }
  // Signed, because -1 is "no vote" and "not decided" and both are real states.
  w.i8(info.selfVote);
  w.i8(info.decidedMode);
  w.i8(info.decidedMap);
  w.u8v(Math.min(255, info.humans));
  return w.bytes();
}

/** The ballot as the server sees it. */
export function decodeVoteState(r: ByteReader): DecodedMatchFlow | BadFrame {
  const phase = r.u8v();
  const phaseEndsTick = r.i32();
  const count = r.u8v();
  if (r.overran || count > MAX_BALLOT_OPTIONS) return BAD;
  const tally: number[] = [];
  for (let i = 0; i < count; i++) tally.push(r.u8v());
  const selfVote = r.i8();
  const decidedMode = r.i8();
  const decidedMap = r.i8();
  const humans = r.u8v();
  if (r.overran) return BAD;
  return {
    kind: 'voteState',
    phase,
    phaseEndsTick,
    tally,
    selfVote,
    decidedMode,
    decidedMap,
    humans,
  };
}

export function writePrepare(
  w: ByteWriter,
  matchId: number,
  mapId: string,
  modeId: string,
): Uint8Array {
  head(w, MsgS.Prepare);
  w.u16(matchId);
  w.str(mapId);
  w.str(modeId);
  return w.bytes();
}

/** The match everybody is about to be moved into. */
export function decodePrepare(r: ByteReader): DecodedMatchFlow | BadFrame {
  const matchId = r.u16();
  const mapId = r.str();
  const modeId = r.str();
  return r.overran ? BAD : { kind: 'prepare', matchId, mapId, modeId };
}

export function writeSummary(w: ByteWriter, info: SummaryInfo): Uint8Array {
  head(w, MsgS.Summary);
  w.u16(info.matchId);
  w.str(info.mapId);
  w.str(info.modeId);
  w.str(info.winner);
  // -1 for "no individual won". Entity ids on the wire are 1..99, so the sign is the flag.
  w.i16(info.winnerEntityId ?? NO_WINNER_ENTITY);
  w.str(info.reason);
  w.u16(info.scoreA);
  w.u16(info.scoreB);
  w.i32(info.endsTick);
  w.u8v(Math.min(info.rows.length, MAX_SUMMARY_ROWS));
  for (let i = 0; i < Math.min(info.rows.length, MAX_SUMMARY_ROWS); i++) {
    const row = info.rows[i];
    if (row === undefined) continue;
    w.u8v(row.entityId);
    w.str(row.displayName);
    w.u8v((row.team === 'B' ? 1 : 0) | (row.isBot ? 2 : 0));
    w.u16(row.kills);
    w.u16(row.deaths);
    w.u16(row.assists);
    w.i32(row.score);
  }
  w.u8v(Math.min(info.xp.length, MAX_XP_LINES));
  for (let i = 0; i < Math.min(info.xp.length, MAX_XP_LINES); i++) {
    const line = info.xp[i];
    if (line === undefined) continue;
    w.u8v(line.source);
    w.u16(Math.min(0xffff, line.count));
    w.i32(line.amount);
  }
  return w.bytes();
}

export function decodeSummary(r: ByteReader): DecodedMatchFlow | BadFrame {
  const matchId = r.u16();
  const mapId = r.str();
  const modeId = r.str();
  const winner = r.str();
  const winnerEntity = r.i16();
  const reason = r.str();
  const scoreA = r.u16();
  const scoreB = r.u16();
  const endsTick = r.i32();
  const rows = readSummaryRows(r);
  if (rows === null) return BAD;
  const xp = readSummaryXpLines(r);
  if (xp === null || r.overran) return BAD;
  return {
    kind: 'summary',
    matchId,
    mapId,
    modeId,
    winner,
    winnerEntityId: winnerEntity === NO_WINNER_ENTITY ? undefined : winnerEntity,
    reason,
    scoreA,
    scoreB,
    endsTick,
    rows,
    xp,
  };
}

/**
 * The scoreboard, whole (M13 Phase B, bug 4.3). See `MsgS.Scoreboard`.
 *
 * `serial` is `ScoreSystem.serial` on the server at the moment of sending, so a client can
 * refuse a frame older than the one it holds. Rows past `MAX_SCORE_ROWS` are dropped rather
 * than overflowing the frame; a match seats ten and the bound is twenty-four.
 */
export function writeScoreboard(
  w: ByteWriter,
  serial: number,
  rows: readonly ReplicatedScoreRow[],
): Uint8Array {
  head(w, MsgS.Scoreboard);
  w.u32(serial >>> 0);
  const n = Math.min(rows.length, MAX_SCORE_ROWS);
  w.u8v(n);
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    w.u8v(row.entityId);
    w.str(row.displayName);
    w.u8v(row.team === 'B' ? 1 : 0);
    w.u16(clampU16(row.kills));
    w.u16(clampU16(row.deaths));
    w.u16(clampU16(row.assists));
    w.i32(row.score);
    w.u8v(Math.min(255, row.streak));
    w.u8v(Math.min(255, row.bestStreak));
    w.u16(clampU16(row.shotsFired));
    w.u16(clampU16(row.shotsHit));
    // Whole points: a shotgun deals fractional damage per pellet and the column is a total.
    w.u16(clampU16(Math.round(row.damageDealt)));
    w.u8v(Math.min(255, row.headshots));
    w.u8v(Math.min(255, row.captures));
    w.u8v(Math.min(255, row.defends));
    w.u8v(Math.min(255, row.plants));
    w.u8v(Math.min(255, row.defuses));
    w.u8v(Math.min(255, row.tags));
  }
  return w.bytes();
}

/** The whole scoreboard, with the serial that orders it. */
export function decodeScoreboard(r: ByteReader): DecodedMatchFlow | BadFrame {
  const serial = r.u32();
  const n = r.u8v();
  if (r.overran || n > MAX_SCORE_ROWS) return BAD;
  const rows: ReplicatedScoreRow[] = [];
  for (let i = 0; i < n; i++) {
    const entityId = r.u8v();
    const displayName = r.str();
    const team = r.u8v() === 1 ? 'B' : 'A';
    rows.push({
      entityId,
      displayName,
      team,
      kills: r.u16(),
      deaths: r.u16(),
      assists: r.u16(),
      score: r.i32(),
      streak: r.u8v(),
      bestStreak: r.u8v(),
      shotsFired: r.u16(),
      shotsHit: r.u16(),
      damageDealt: r.u16(),
      headshots: r.u8v(),
      captures: r.u8v(),
      defends: r.u8v(),
      plants: r.u8v(),
      defuses: r.u8v(),
      tags: r.u8v(),
    });
  }
  return r.overran ? BAD : { kind: 'scoreboard', serial, rows };
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function clampU16(v: number): number {
  return Math.max(0, Math.min(0xffff, v));
}

/** The board as it stood when the match ended, or `null` for a row count past the cap. */
function readSummaryRows(r: ByteReader): SummaryRow[] | null {
  const rowCount = r.u8v();
  if (r.overran || rowCount > MAX_SUMMARY_ROWS) return null;
  const rows: SummaryRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const entityId = r.u8v();
    const displayName = r.str();
    const bits = r.u8v();
    const kills = r.u16();
    const deaths = r.u16();
    const assists = r.u16();
    const score = r.i32();
    rows.push({
      entityId,
      displayName,
      team: (bits & 1) !== 0 ? 'B' : 'A',
      isBot: (bits & 2) !== 0,
      kills,
      deaths,
      assists,
      score,
    });
  }
  return rows;
}

/** The XP breakdown the M6 bar animates, or `null` for a count past the cap. */
function readSummaryXpLines(r: ByteReader): SummaryXpLine[] | null {
  const xpCount = r.u8v();
  if (r.overran || xpCount > MAX_XP_LINES) return null;
  const xp: SummaryXpLine[] = [];
  for (let i = 0; i < xpCount; i++) xp.push({ source: r.u8v(), count: r.u16(), amount: r.i32() });
  return xp;
}
//#endregion
