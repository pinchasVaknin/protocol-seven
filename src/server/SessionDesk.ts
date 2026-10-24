/**
 * The connected sockets of one process, as a list (B7).
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { uniqueDisplayName } from '../shared/net/DisplayText';
import { MAX_NAME_LENGTH } from '../shared/net/UrlFlags';
import type { Session } from './net/Session';
import type { WsLink } from './net/WsServer';
//#endregion

// ===================================== CLASS SessionDesk ====================================== \\
//#region Class SessionDesk
/**
 * Every live connection, and the five passes a tick makes over them.
 *
 * The `Server` owns the *policy* — who gets seated where, what a fault costs, when a vote is
 * broadcast — and this owns the *list*: adding a connection, naming it uniquely, draining it,
 * flushing it, timing it out and dropping it once it is inert. They were one class, and the
 * five loops over `sessions[]` were interleaved with the scheduler they ran beside.
 *
 * Nothing here decides anything about a world. It does not know what an instance is.
 */
export class SessionDesk {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly sessions: Session[] = [];
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get count(): number {
    return this.sessions.length;
  }

  /** Every connection, in the order they arrived. Iterated per tick, so never copied. */
  all(): readonly Session[] {
    return this.sessions;
  }

  add(session: Session): void {
    this.sessions.push(session);
  }

  /**
   * A callsign no other connected player is using (security audit 2026-10-04, S9).
   *
   * Names are chosen by the client and nothing made them unique, so a player could join as the
   * name already on the board and be indistinguishable from its owner in the killfeed, the
   * scoreboard and the vote — and two people who simply picked the same callsign could not tell
   * which row was theirs. The second one in becomes `NAME (2)`, the next `NAME (3)`, cut to fit
   * `MAX_NAME_LENGTH`. Compared without case, because `alice` beside `ALICE` is the same
   * impersonation. Server-wide rather than per instance: the name travels with the connection
   * through every migration, so it has to be unique everywhere the connection can go.
   */
  uniqueNameFor(session: Session): string {
    const taken: string[] = [];
    for (const other of this.sessions) {
      if (other === session || other.closed || other.displayName === '') continue;
      taken.push(other.displayName);
    }
    return uniqueDisplayName(session.displayName, taken, MAX_NAME_LENGTH);
  }

  /**
   * Drain every socket into the input buffers, one at a time (M11 playtest).
   *
   * S4.16 requires that *"malformed input must never crash the server"*, and the decode paths
   * honour that — `ByteReader` does not throw and `decodeHeader` returns `bad` rather than
   * raising. What was unguarded is the layer above: the *handlers*. `onLoadout` runs
   * `resolveLoadout` over a class a client chose, and a throw there escaped the tick entirely,
   * taking the rest of the drain, the whole simulation step and the flow with it.
   *
   * Per session rather than around the loop, so one client's bad frame costs that client its
   * frame and nobody else theirs. What to do about it is the caller's: `onFault` is handed the
   * session and the error, and the server's answer is to log it and close the link.
   */
  receiveAll(onFault: (session: Session, err: unknown) => void): void {
    for (const session of this.sessions) {
      try {
        session.receive();
      } catch (err) {
        onFault(session, err);
      }
    }
  }

  /** Release whatever the per-link condition simulator has been holding. */
  flushOutbound(): void {
    for (const session of this.sessions) {
      const link = session.link;
      if (isWsLink(link)) link.pumpOutbound();
    }
  }

  /** Time out the silent ones. Each may close itself, which `reap` then clears. */
  checkTimeouts(): void {
    for (const session of this.sessions) session.checkTimeout();
  }

  /**
   * Drop the connections that have closed.
   *
   * `close` already ran `onLeave`, which released the seat. This only drops the now-inert
   * session object so the per-tick loops stay short — and hands it to the caller, because what
   * else a closed connection has to be taken out of (the router, the ballot) is the server's.
   */
  reap(onReaped: (session: Session) => void): void {
    for (let i = this.sessions.length - 1; i >= 0; i--) {
      const session = this.sessions[i];
      if (session === undefined) continue;
      if (!session.closed) continue;
      onReaped(session);
      this.sessions.splice(i, 1);
    }
  }

  /**
   * A line for **every connected player**, wherever they are seated.
   *
   * Distinct from `instance.broadcast`, which reaches one world. An aborted transition is
   * exactly the case where "one world" is the wrong set: the players are in the arena, the
   * instance that failed may not exist, and §4.17 requires all of them to be told.
   */
  noticeAll(text: string): void {
    for (const session of this.sessions) {
      if (!session.closed && session.state === 'live') session.notice(text);
    }
  }

  /** Shut every connection, with one reason, and forget them. Part of `Server.stop`. */
  closeAll(reason: string): void {
    for (const session of this.sessions) session.close(reason);
    this.sessions.length = 0;
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** `pumpOutbound` is a `WsLink` concern, not part of the `INetLink` contract. */
function isWsLink(link: unknown): link is WsLink {
  return typeof (link as { pumpOutbound?: unknown }).pumpOutbound === 'function';
}
//#endregion
