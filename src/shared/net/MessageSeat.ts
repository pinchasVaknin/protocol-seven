/**
 * The messages that open, hold and close a connection: the handshake, the seat, the clock
 * exchange, and the two ways a server says something went wrong.
 *
 * `Welcome` and `Migrate` share a body deliberately (see `writeWelcome`), and the reconnect
 * token rides it without being part of `WelcomeInfo`. Every writer here has its decoder beside
 * it, which is the whole point of splitting this file by message family: the half that reads
 * and the half that writes a given frame change together or not at all.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { BAD, head, type BadFrame } from './MessageFrame';
import { readLoadoutBody, writeLoadoutBody } from './MessageLoadout';
import { MsgC, MsgS, PROTOCOL_VERSION, RECONNECT_TOKEN_BYTES } from './Protocol';
import type { NetLoadout } from './Skirmish';
import type { ByteReader, ByteWriter } from './Wire';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * What the server told this client about the match it just joined.
 *
 * **The client builds its world from this and never from its own menu selection** (M10,
 * playtest round 2). Before that rule existed the browser loaded whichever map was last
 * picked in the front end while the server ran whatever `MAP` said, and the two disagreeing
 * produced exactly the symptoms you would predict and none of the ones you would look for:
 * spawning outside the geometry, walking through walls that are not there, and a rubber-band
 * every time the authoritative position was applied against a collision world that did not
 * match. It reads as a netcode fault and is a *loading* fault.
 */
export interface WelcomeInfo {
  readonly entityId: number;
  readonly team: 'A' | 'B';
  readonly mapId: string;
  readonly modeId: string;
  readonly serverTick: number;
  readonly serverMs: number;
  readonly snapshotHz: number;
  /**
   * Which instance this seat is in (M11). `WARMUP_MATCH_ID` is the arena.
   *
   * Carried on `Welcome` as well as `Migrate` so there is exactly one field the client reads
   * to answer *"whose world is this snapshot describing"*, on both the join path and the
   * migration path. A client that inferred it from the map id would be right until somebody
   * voted for a live match on the greybox room.
   */
  readonly matchId: number;
  /**
   * The tick this seat becomes live, from the server's clock (§4.18).
   *
   * On a join this is simply the current tick. On a migration it is the **named tick** the
   * contract turns on: the router sends this player's messages to the old instance up to it
   * and the new one from it, and the client applies nothing from the new instance before it.
   */
  readonly effectiveTick: number;
  /** True when this is a migration rather than a fresh join. Drives the client's flush. */
  readonly migrated: boolean;
}

/** What the handshake, the seat and the keepalive decode to. */
export type DecodedSeat =
  | {
      kind: 'hello';
      version: number;
      name: string;
      /** A position in `SKIN_IDS`, or `NO_SKIN_INDEX`; the server clamps a stranger to the latter (M16, B6). */
      skinIndex: number;
      loadout: NetLoadout | null;
      /** What this connection claims about a seat it held before (round 4, F8). */
      reconnectToken: Uint8Array | null;
    }
  | ({ kind: 'welcome'; version: number; reconnectToken: Uint8Array | null } & WelcomeInfo)
  | ({ kind: 'migrate'; version: number; reconnectToken: Uint8Array | null } & WelcomeInfo)
  | { kind: 'ping'; id: number; clientMs: number }
  | { kind: 'pong'; id: number; clientMs: number; serverMs: number; serverTick: number }
  | { kind: 'bye'; reason: string }
  | { kind: 'reject'; code: number }
  | { kind: 'notice'; text: string };
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * The first frame on a connection — and it carries the player's class (M11, Tier 1 #20) and,
 * since v18, the body they wear (M16, B6).
 *
 * ## The skin, one byte after the name
 *
 * `skinIndex` is a position in `SKIN_IDS` or `NO_SKIN_INDEX`, and it is sent by every
 * connection with no presence byte (M16 decision 3): 255 *is* the absence, and a presence
 * byte would be a second way to say it. It sits after the name and ahead of the class because
 * it is a fact every connection has, which is what the token's rule below is about. It is a
 * *setting*, not part of the class — a respawn changes classes, not bodies — so the `Loadout`
 * message does not carry it, and a pick made mid-connection is the next connection's.
 *
 * ## Why the loadout is here and not in a message that follows
 *
 * The seat is created **inside the handshake**: `onJoin` calls `addPlayer`, which builds the
 * `NetPlayer` whose constructor sets `controller.speedScale` from the resolved perks. A class
 * that arrives in a later frame therefore arrives after the entity it was meant to configure,
 * and for every tick in between the client predicts with Lightweight's +7% while the server
 * simulates without it.
 *
 * That window is not theoretical and it is not small. Measured with the class sent one frame
 * later: **178 mispredictions in 1277 comparisons** across a warmup period, against 0 once it
 * moved into the handshake. It is Tier 1 #20 in miniature — the same arithmetic, the same
 * cause, just bounded by how long the player stays in the arena rather than forever.
 *
 * A trailing optional field, so a client that has no class yet (the first ever run, before the
 * M6 save exists) simply omits it and gets the server defaults.
 *
 * ## And the reconnect token, behind it (playtest round 4, F8)
 *
 * *"I was here a moment ago and this is my seat."* Optional in exactly the same way and for the
 * same reason: a first connection has nothing to present, and presenting a token nobody
 * recognises is an ordinary join rather than an error. Sent last so the class — which every
 * connection has an opinion about — is not behind a field most of them omit.
 *
 * The server never trusts it beyond looking it up: see `ReconnectRegistry.claim` for what it
 * refuses, and `RECONNECT_TOKEN_BYTES` for why guessing one is the attack it is designed
 * against.
 */
export function writeHello(
  w: ByteWriter,
  name: string,
  skinIndex: number,
  loadout?: NetLoadout | null,
  reconnectToken?: Uint8Array | null,
): Uint8Array {
  head(w, MsgC.Hello);
  w.u16(PROTOCOL_VERSION);
  w.str(name);
  w.u8v(skinIndex);
  w.u8v(loadout == null ? 0 : 1);
  if (loadout != null) writeLoadoutBody(w, loadout);
  const token = reconnectToken != null && reconnectToken.length === RECONNECT_TOKEN_BYTES
    ? reconnectToken
    : null;
  w.u8v(token === null ? 0 : 1);
  if (token !== null) w.raw(token);
  return w.bytes();
}

/** The first frame on a connection: version, name, body, class and a seat claim. */
export function decodeHello(r: ByteReader): DecodedSeat | BadFrame {
  const version = r.u16();
  const name = r.str();
  // One byte, always present; a frame from a build that did not send it is a v17 frame,
  // and the version check refuses it before this value is read as anything.
  const skinIndex = r.u8v();
  // The version is checked by the caller before any of this is trusted, but the trailing
  // loadout must still decode without throwing on a frame from a build that did not send
  // one — hence the explicit presence byte rather than "read if bytes remain".
  const hasLoadout = r.u8v() === 1;
  const loadout = hasLoadout ? readLoadoutBody(r) : null;
  // Same explicit presence byte as the loadout above, and never "read if bytes remain":
  // a length inferred from what is left in the frame is a length an attacker chooses.
  const hasToken = r.u8v() === 1;
  const reconnectToken = hasToken ? r.raw(RECONNECT_TOKEN_BYTES) : null;
  return r.overran
    ? BAD
    : { kind: 'hello', version, name, skinIndex, loadout, reconnectToken };
}

/**
 * `Welcome` and `Migrate` share a body, deliberately.
 *
 * They say the same thing — *"this is your seat, in this instance, on this map, from this
 * tick"* — and differ only in whether the client had one before. One encoder means the
 * migration path cannot grow a field the join path lacks, which is the failure mode that
 * produces a client correctly seated in a live match and still rendering warmup's world.
 */
export function writeWelcome(
  w: ByteWriter,
  info: WelcomeInfo,
  reconnectToken: Uint8Array | null,
): Uint8Array {
  head(w, info.migrated ? MsgS.Migrate : MsgS.Welcome);
  writeSeatBody(w, info, reconnectToken);
  return w.bytes();
}

/** A fresh seat. */
export function decodeWelcome(r: ByteReader): DecodedSeat | BadFrame {
  const seat = readSeatBody(r, false);
  return seat === null ? BAD : { kind: 'welcome', ...seat };
}

/** The same seat body, moved to another instance. */
export function decodeMigrate(r: ByteReader): DecodedSeat | BadFrame {
  const seat = readSeatBody(r, true);
  return seat === null ? BAD : { kind: 'migrate', ...seat };
}

export function writePing(w: ByteWriter, id: number, clientMs: number): Uint8Array {
  head(w, MsgC.Ping);
  w.u32(id);
  w.f64(clientMs);
  return w.bytes();
}

/** A client's clock sample. */
export function decodePing(r: ByteReader): DecodedSeat | BadFrame {
  const pid = r.u32();
  const clientMs = r.f64();
  return r.overran ? BAD : { kind: 'ping', id: pid, clientMs };
}

export function writePong(
  w: ByteWriter,
  id: number,
  clientMs: number,
  serverMs: number,
  serverTick: number,
): Uint8Array {
  head(w, MsgS.Pong);
  w.u32(id);
  // Echoed untouched so the client can match a reply to its own send without keeping a table.
  w.f64(clientMs);
  w.f64(serverMs);
  w.i32(serverTick);
  return w.bytes();
}

/** The reply, with the client’s own millisecond echoed back. */
export function decodePong(r: ByteReader): DecodedSeat | BadFrame {
  const pid = r.u32();
  const clientMs = r.f64();
  const serverMs = r.f64();
  const serverTick = r.i32();
  return r.overran ? BAD : { kind: 'pong', id: pid, clientMs, serverMs, serverTick };
}

export function writeBye(w: ByteWriter, fromServer: boolean, reason: string): Uint8Array {
  head(w, fromServer ? MsgS.Bye : MsgC.Bye);
  w.str(reason);
  return w.bytes();
}

/** Either side hanging up, with its reason. */
export function decodeBye(r: ByteReader): DecodedSeat | BadFrame {
  const reason = r.str();
  return r.overran ? BAD : { kind: 'bye', reason };
}

export function writeReject(w: ByteWriter, code: number): Uint8Array {
  head(w, MsgS.Reject);
  w.u8v(code);
  return w.bytes();
}

/** A refused handshake, as a code. */
export function decodeReject(r: ByteReader): DecodedSeat | BadFrame {
  const code = r.u8v();
  return r.overran ? BAD : { kind: 'reject', code };
}

export function writeNotice(w: ByteWriter, text: string): Uint8Array {
  head(w, MsgS.Notice);
  w.str(text);
  return w.bytes();
}

/** A line of text for the player. */
export function decodeNotice(r: ByteReader): DecodedSeat | BadFrame {
  const text = r.str();
  return r.overran ? BAD : { kind: 'notice', text };
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * The token rides the seat body, and is **not** part of `WelcomeInfo` (round 4, F8).
 *
 * `WelcomeInfo` is *"this is your seat"* — the thing a world is built from, reconstructed by
 * `NetClient.matchInfo` and handed around the client. A credential is not part of that answer,
 * and folding it in would mean every builder of a `WelcomeInfo` — there are three — deciding
 * what to put in a field only one of them knows anything about. So it is a separate argument
 * with exactly one caller, `Session.sendSeat`, which stamps its own connection's token.
 */
function writeSeatBody(w: ByteWriter, info: WelcomeInfo, reconnectToken: Uint8Array | null): void {
  w.u16(PROTOCOL_VERSION);
  w.u8v(info.entityId);
  w.u8v(info.team === 'B' ? 1 : 0);
  w.str(info.mapId);
  w.str(info.modeId);
  w.i32(info.serverTick);
  w.f64(info.serverMs);
  w.u8v(info.snapshotHz);
  w.u16(info.matchId);
  w.i32(info.effectiveTick);
  const token =
    reconnectToken != null && reconnectToken.length === RECONNECT_TOKEN_BYTES ? reconnectToken : null;
  w.u8v(token === null ? 0 : 1);
  if (token !== null) w.raw(token);
}

function readSeatBody(
  r: ByteReader,
  migrated: boolean,
): (WelcomeInfo & { version: number; reconnectToken: Uint8Array | null }) | null {
  const version = r.u16();
  const entityId = r.u8v();
  const team = r.u8v() === 1 ? 'B' : 'A';
  const mapId = r.str();
  const modeId = r.str();
  const serverTick = r.i32();
  const serverMs = r.f64();
  const snapshotHz = r.u8v();
  const matchId = r.u16();
  const effectiveTick = r.i32();
  const hasToken = r.u8v() === 1;
  const reconnectToken = hasToken ? r.raw(RECONNECT_TOKEN_BYTES) : null;
  if (r.overran) return null;
  return {
    version,
    reconnectToken,
    entityId,
    team,
    mapId,
    modeId,
    serverTick,
    serverMs,
    snapshotHz,
    matchId,
    effectiveTick,
    migrated,
  };
}
//#endregion
