import { beforeEach, describe, expect, it } from 'vitest';
import { installClock } from '../../shared/core/Clock';
import { installLogSink, type LogLevel } from '../../shared/core/Log';
import { defaultLoadouts } from '../../shared/meta/Loadouts';
import { NO_SKIN_INDEX } from '../../shared/meta/Skins';
import {
  decodeHeader,
  writeCheatRequest,
  writeCommands,
  writeHello,
  writePing,
  writeLoadout,
  writePong,
  writeReady,
  writeStreakRequest,
  writeVote,
  writeBye,
} from '../../shared/net/Messages';
import {
  BYE_IDLE,
  CLIENT_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  MAX_CLIENT_FRAME_BYTES,
  PROTOCOL_VERSION,
} from '../../shared/net/Protocol';
import { toNetLoadout, type NetLoadout } from '../../shared/net/Skirmish';
import type { INetLink, LinkState } from '../../shared/net/Transport';
import { ByteReader, ByteWriter } from '../../shared/net/Wire';
import type { NetPlayer } from '../NetPlayer';
import { Session, type SessionEvents, type SessionOptions } from './Session';
import { MESSAGE_BUDGETS, WARN_BUDGET } from './Validation';

/**
 * The per-kind message budgets (security audit 2026-10-04, S3), against a real `Session`.
 *
 * Every frame goes through the real encoder and the session's real decode path; only the
 * socket and the server behind the session are stand-ins. The link-level frame limit is not
 * in play here — this is what happens to frames that are *within* it.
 */

let now = 1_000;
installClock({ nowMs: () => now });

const warnings: string[] = [];
installLogSink({
  log(level: LogLevel, _tag: string, message: string): void {
    if (level === 'warn') warnings.push(message);
  },
});

class FakeLink implements INetLink {
  state: LinkState = 'open';
  lastRecvMs = 0;
  readonly remoteAddress = '203.0.113.7';
  bytesIn = 0;
  bytesOut = 0;
  framesIn = 0;
  framesOut = 0;
  readonly inbox: Uint8Array[] = [];
  readonly sent: Uint8Array[] = [];

  send(bytes: Uint8Array): void {
    this.framesOut++;
    this.sent.push(bytes.slice());
  }

  poll(handler: (bytes: Uint8Array) => void): void {
    const frames = this.inbox.splice(0);
    if (frames.length > 0) this.lastRecvMs = now;
    for (const frame of frames) handler(frame);
  }

  close(): void {
    this.state = 'closed';
  }
}

interface Calls {
  votes: Array<[number, number]>;
  loadouts: NetLoadout[];
  streaks: number[];
  cheats: string[];
  left: Array<[string, string]>;
}

function seated(options: SessionOptions = {}): { session: Session; link: FakeLink; calls: Calls } {
  const link = new FakeLink();
  const calls: Calls = { votes: [], loadouts: [], streaks: [], cheats: [], left: [] };
  const player = { entityId: 1, team: 'A', input: { accept: () => true } };
  const events: SessionEvents = {
    onJoin: () => ({ player: player as unknown as NetPlayer }),
    onLeave: (_s, reason, cause) => calls.left.push([reason, cause]),
    onLoadout: (_s, loadout) => calls.loadouts.push(loadout),
    onVote: (_s, phase, option) => calls.votes.push([phase, option]),
    onReady: () => undefined,
    onStreakRequest: (_s, kind) => calls.streaks.push(kind),
    onCheatRequest: (_s, code) => calls.cheats.push(code),
  };
  const session = new Session(link, events, () => 100, options);
  link.inbox.push(frame((w) => writeHello(w, 'ALICE', 0, null, null)));
  session.receive();
  expect(session.state).toBe('live');
  return { session, link, calls };
}

/** One encoded frame, copied: a writer's `bytes()` is a view that the next encode overwrites. */
function frame(encode: (w: ByteWriter) => Uint8Array): Uint8Array {
  return encode(new ByteWriter(MAX_CLIENT_FRAME_BYTES)).slice();
}

function classNamed(name: string): NetLoadout {
  const slot = defaultLoadouts()[0];
  if (slot === undefined) throw new Error('no default class');
  return { ...toNetLoadout(slot), name };
}

beforeEach(() => {
  now += 60_000;
  warnings.length = 0;
});

describe('a vote flood', () => {
  it('reaches the server at the budget, and the vote the player ended on is the one counted', () => {
    const { session, link, calls } = seated();
    for (let i = 0; i < 50; i++) link.inbox.push(frame((w) => writeVote(w, 1, i % 3)));
    session.receive();

    expect(calls.votes).toHaveLength(MESSAGE_BUDGETS.vote.burst);
    expect(session.messagesThrottled).toBe(50 - MESSAGE_BUDGETS.vote.burst);
    // Nothing is still connected to a refusal: over budget is not malformed.
    expect(session.state).toBe('live');

    // Half a second later one token has come back, and it is spent on the newest vote — the 50th.
    now += 500;
    session.receive();
    expect(calls.votes.at(-1)).toEqual([1, 49 % 3]);
    expect(calls.votes).toHaveLength(MESSAGE_BUDGETS.vote.burst + 1);

    // And it was held once, not queued: nothing further arrives however long the wait.
    now += 10_000;
    session.receive();
    expect(calls.votes).toHaveLength(MESSAGE_BUDGETS.vote.burst + 1);
  });
});

describe('a class flood', () => {
  it('applies the class the player ended on, at the budget', () => {
    const { session, link, calls } = seated();
    for (let i = 0; i < 20; i++) link.inbox.push(frame((w) => writeLoadout(w, classNamed(`C${i}`))));
    session.receive();
    expect(calls.loadouts).toHaveLength(MESSAGE_BUDGETS.loadout.burst);

    now += 1_000;
    session.receive();
    expect(calls.loadouts.at(-1)?.name).toBe('C19');
  });

  it('lets a newer class within budget replace one that is being held', () => {
    const { session, link, calls } = seated();
    for (let i = 0; i < 4; i++) link.inbox.push(frame((w) => writeLoadout(w, classNamed(`A${i}`))));
    session.receive(); // three applied, A3 held
    now += 1_000;
    link.inbox.push(frame((w) => writeLoadout(w, classNamed('B'))));
    session.receive(); // B takes the token directly; A3 must not follow it
    now += 10_000;
    session.receive();
    expect(calls.loadouts.map((l) => l.name)).toEqual(['A0', 'A1', 'A2', 'B']);
  });
});

describe('requests over budget', () => {
  it('drops streak requests and cheat codes rather than holding them', () => {
    const { session, link, calls } = seated();
    for (let i = 0; i < 30; i++) {
      link.inbox.push(frame((w) => writeStreakRequest(w, 0, 0, 0)));
      link.inbox.push(frame((w) => writeCheatRequest(w, 'NOPE')));
    }
    session.receive();
    now += 10_000;
    session.receive();
    expect(calls.streaks).toHaveLength(MESSAGE_BUDGETS.streak.burst);
    expect(calls.cheats).toHaveLength(MESSAGE_BUDGETS.cheat.burst);
  });
});

describe('the warning budget', () => {
  it('writes a burst of lines for a flood, then says how many it held back', () => {
    const { session, link } = seated();
    for (let i = 0; i < 200; i++) link.inbox.push(frame((w) => writeStreakRequest(w, 0, 0, 0)));
    session.receive();
    expect(warnings).toHaveLength(WARN_BUDGET.burst);

    now += 1000 / WARN_BUDGET.perSecond;
    session.warn('later');
    const suppressed = 200 - MESSAGE_BUDGETS.streak.burst - WARN_BUDGET.burst;
    expect(warnings.at(-1)).toBe(`later (+${suppressed} earlier warning(s) from this connection suppressed)`);
  });
});

describe('the idle disconnect', () => {
  const KICK_MS = 300_000;

  /** One second of a connected client: a ping, and a command with these inputs. */
  function second(link: FakeLink, cmd: { moveX?: number; yaw?: number; buttons?: number } = {}): void {
    now += 1000;
    link.inbox.push(frame((w) => writePing(w, 1, now)));
    const command = {
      seq: now,
      tickIndex: 100,
      moveX: cmd.moveX ?? 0,
      moveZ: 0,
      yaw: cmd.yaw ?? 0.5,
      pitch: 0,
      buttons: cmd.buttons ?? 0,
      sampledAtMs: now,
    };
    link.inbox.push(frame((w) => writeCommands(w, [command], 1, 0)));
  }

  function tick(session: Session): void {
    session.receive();
    session.checkTimeout();
  }

  function decoded(link: FakeLink): Array<{ kind: string; text?: string; reason?: string }> {
    return link.sent.map((bytes) => decodeHeader(new ByteReader(bytes)) as { kind: string; text?: string; reason?: string });
  }

  it('warns, then frees the seat of a player who only pings and stands still', () => {
    const { session, link, calls } = seated({ idleKickMs: KICK_MS });
    let warnedAt = -1;
    for (let s = 1; s <= KICK_MS / 1000 + 2 && session.state === 'live'; s++) {
      second(link);
      tick(session);
      if (warnedAt < 0 && decoded(link).some((m) => m.kind === 'notice')) warnedAt = s;
    }
    // The first command is the one the view is measured from, so the clock starts a second in.
    expect(warnedAt).toBe((KICK_MS - IDLE_WARNING_MS) / 1000 + 1);
    expect(session.state).toBe('closed');
    // Left, not lost: the seat is not held for a player who did not lose a connection.
    expect(calls.left).toEqual([[BYE_IDLE, 'left']]);
    expect(decoded(link).at(-1)).toEqual({ kind: 'bye', reason: BYE_IDLE });
  });

  it('keeps a player who moves, presses or turns the view — any of them resets the clock', () => {
    const { session, link } = seated({ idleKickMs: KICK_MS });
    const kinds = [{ moveX: 1 }, { buttons: 1 }, { yaw: 1.5 }];
    for (let s = 1; s <= 3 * KICK_MS / 1000; s++) {
      // One real input every four minutes, each a different kind.
      second(link, s % 240 === 0 ? kinds[(s / 240) % 3] : {});
      tick(session);
    }
    expect(session.state).toBe('live');
  });

  it('counts a vote as a person', () => {
    const { session, link } = seated({ idleKickMs: KICK_MS });
    for (let s = 1; s <= 2 * KICK_MS / 1000; s++) {
      second(link);
      if (s % 240 === 0) link.inbox.push(frame((w) => writeVote(w, 1, 0)));
      tick(session);
    }
    expect(session.state).toBe('live');
  });

  it('never disconnects when it is turned off', () => {
    const { session, link } = seated({ idleKickMs: 0 });
    for (let s = 1; s <= 2 * KICK_MS / 1000; s++) {
      second(link);
      tick(session);
    }
    expect(session.state).toBe('live');
  });
});

/**
 * The server's own round trip (2026-10-18).
 *
 * It used to be inferred from the gap between a client's pings, minus the 250 ms they are sent
 * at — which is zero on any link whose delay is steady, because a ping sent every 250 ms
 * arrives every 250 ms however long it takes to get there. The estimate sat at zero and
 * `viewLagTicks` rewound for the interpolation delay alone. A snapshot and the ack that names
 * it are a real round trip, and the session has both ends of it.
 */
describe('the round trip, from the ack of a snapshot', () => {
  /** One commands frame acking `id`, the way a client sends one. */
  function ack(session: Session, link: FakeLink, id: number): void {
    const command = {
      seq: now,
      tickIndex: 100,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      sampledAtMs: now,
    };
    link.inbox.push(frame((w) => writeCommands(w, [command], 1, id)));
    session.receive();
  }

  it('is the time between the snapshot going out and its ack coming back', () => {
    const { session, link } = seated();
    session.noteSnapshotSent(1);
    now += 120;
    ack(session, link, 1);
    expect(session.rttMs).toBe(120);
  });

  it('smooths, so one late ack does not move the rewind by its whole delay', () => {
    const { session, link } = seated();
    session.noteSnapshotSent(1);
    now += 100;
    ack(session, link, 1);

    session.noteSnapshotSent(2);
    now += 200;
    ack(session, link, 2);

    // The first sample is taken as it stands; after that it is nine parts estimate to one
    // part sample, which is what keeps a single stalled packet out of the hitboxes.
    expect(session.rttMs).toBeCloseTo(110, 6);
    expect(session.jitterMs).toBeCloseTo(10, 6);
  });

  it('takes no sample from an ack the client is repeating', () => {
    const { session, link } = seated();
    session.noteSnapshotSent(1);
    now += 100;
    ack(session, link, 1);

    // The next snapshot is still in flight, so the client acks the same id again. Timing that
    // against the same send would add a frame to the estimate every tick.
    now += 500;
    ack(session, link, 1);
    expect(session.rttMs).toBe(100);
  });

  it('takes no sample across a migration, where the ids start over', () => {
    const { session, link } = seated();
    session.noteSnapshotSent(1);

    // The player moves to another instance: a new encoder, issuing id 1 again.
    session.restartSnapshotStream();
    now += 5_000;
    ack(session, link, 1);

    expect(session.rttMs).toBe(0);
  });

  it('forgets the ids of the instance a player left, even without the reset', () => {
    const { session, link } = seated();
    session.noteSnapshotSent(400);
    // An id that is not newer than the last can only come from a different encoder.
    session.noteSnapshotSent(1);
    now += 5_000;
    ack(session, link, 400);

    expect(session.rttMs).toBe(0);
  });
});

/**
 * The dispatch, the handshake and the three ways a session ends (B3).
 *
 * The eighteen cases above are all about the budgets, the idle clock and the round trip. What
 * had none is the part every frame passes through: `handleFrame`'s state gate, the refusals it
 * writes, and `handleHello`'s own paths. Every one of them ends in a close — S4.16 makes that a
 * requirement rather than a style, *"malformed input must never crash the server"* — so each
 * case asserts the reason **and** the `LeaveCause`, because the cause is what decides whether
 * the player's seat is held for a reconnect.
 */

/** A session that has not said hello yet. `seated()` is the same thing one frame later. */
function fresh(options: SessionOptions = {}): { session: Session; link: FakeLink; calls: Calls } {
  const link = new FakeLink();
  const calls: Calls = { votes: [], loadouts: [], streaks: [], cheats: [], left: [] };
  const player = { entityId: 1, team: 'A', input: { accept: () => true } };
  const events: SessionEvents = {
    onJoin: () => ({ player: player as unknown as NetPlayer }),
    onLeave: (_s, reason, cause) => calls.left.push([reason, cause]),
    onLoadout: (_s, loadout) => calls.loadouts.push(loadout),
    onVote: (_s, phase, option) => calls.votes.push([phase, option]),
    onReady: () => undefined,
    onStreakRequest: (_s, kind) => calls.streaks.push(kind),
    onCheatRequest: (_s, code) => calls.cheats.push(code),
  };
  return { session: new Session(link, events, () => 100, options), link, calls };
}

/**
 * A `Hello` claiming another protocol version.
 *
 * `writeHello` writes `PROTOCOL_VERSION` itself, so the field is patched afterwards: found by
 * its value rather than at a fixed offset, which survives a change to the header's own shape.
 */
function helloClaiming(version: number): Uint8Array {
  const bytes = frame((w) => writeHello(w, 'ALICE', 0, null, null));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at + 1 < bytes.length; at++) {
    if (view.getUint16(at, true) === PROTOCOL_VERSION) {
      view.setUint16(at, version, true);
      return bytes;
    }
  }
  throw new Error('no version field in a hello frame');
}

/** The message kinds of everything this link was sent. */
function kindsSent(link: FakeLink): string[] {
  return link.sent.map((bytes) => decodeHeader(new ByteReader(bytes)).kind);
}

describe('a frame that arrives before the handshake', () => {
  const cases: Array<[string, (w: ByteWriter) => Uint8Array, string]> = [
    ['a class', (w) => writeLoadout(w, classNamed('EARLY')), 'loadout before hello'],
    ['a vote', (w) => writeVote(w, 1, 2), 'vote before hello'],
    ['a readiness report', (w) => writeReady(w, 7), 'ready before hello'],
    ['a streak request', (w) => writeStreakRequest(w, 3, 1, 2), 'streak before hello'],
    ['a cheat code', (w) => writeCheatRequest(w, 'IDDQD'), 'cheat before hello'],
  ];

  for (const [what, encode, reason] of cases) {
    it(`refuses ${what}, and does not hold the seat`, () => {
      const { session, link, calls } = fresh();
      link.inbox.push(frame(encode));
      session.receive();

      expect(session.state).toBe('closed');
      expect(calls.left).toEqual([[reason, 'left']]);
    });
  }

  it('refuses commands too', () => {
    const { session, link, calls } = fresh();
    link.inbox.push(frame((w) => writeCommands(w, [], 0, 0)));
    session.receive();

    expect(calls.left).toEqual([['commands before hello', 'left']]);
  });

  it('answers a ping, because that needs no seat', () => {
    const { session, link, calls } = fresh();
    link.inbox.push(frame((w) => writePing(w, 5, 1234)));
    session.receive();

    expect(session.state).toBe('handshaking');
    expect(kindsSent(link)).toEqual(['pong']);
    expect(calls.left).toEqual([]);
  });
});

describe('a frame the server cannot act on', () => {
  it('closes on bytes that are not a frame', () => {
    const { session, link, calls } = fresh();
    link.inbox.push(Uint8Array.from([1, 2, 3, 4, 5, 6]));
    session.receive();

    expect(calls.left).toEqual([['malformed frame', 'left']]);
  });

  it('closes on a server-to-client message arriving at the server', () => {
    const { session, link, calls } = seated();
    // A `Pong` is the server's to send. Either a confused client or somebody poking the port.
    link.inbox.push(frame((w) => writePong(w, 1, 2, 3, 4)));
    session.receive();

    expect(calls.left).toEqual([['unexpected message', 'left']]);
  });

  it('closes on a second hello', () => {
    const { session, link, calls } = seated();
    link.inbox.push(frame((w) => writeHello(w, 'ALICE AGAIN', 0, null, null)));
    session.receive();

    expect(calls.left).toEqual([['duplicate hello', 'left']]);
  });

  it('drops a command batch that claims more commands than it carries', () => {
    const { session, link, calls } = seated();
    const command = { seq: 1, tickIndex: 100, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, sampledAtMs: 0 };
    const whole = frame((w) => writeCommands(w, [command, command, command], 3, 0));
    const oneCommand = frame((w) => writeCommands(w, [command], 1, 0));
    // Three claimed in the header, one command's worth of bytes behind it.
    link.inbox.push(whole.slice(0, oneCommand.length));
    session.receive();

    expect(calls.left).toEqual([['truncated command batch', 'left']]);
  });
});

describe('the handshake', () => {
  it('refuses another protocol version loudly, and says both numbers', () => {
    const { session, link, calls } = fresh();
    link.inbox.push(helloClaiming(PROTOCOL_VERSION + 1));
    session.receive();

    expect(session.state).toBe('closed');
    expect(kindsSent(link)).toEqual(['reject']);
    expect(calls.left).toEqual([['version mismatch', 'left']]);
    const said = warnings.some(
      (w) => w.includes(String(PROTOCOL_VERSION + 1)) && w.includes(String(PROTOCOL_VERSION)),
    );
    expect(said).toBe(true);
  });

  it('refuses a full server with a reject rather than a silence', () => {
    const link = new FakeLink();
    const calls: Calls = { votes: [], loadouts: [], streaks: [], cheats: [], left: [] };
    const events: SessionEvents = {
      onJoin: () => null,
      onLeave: (_s, reason, cause) => calls.left.push([reason, cause]),
      onLoadout: () => undefined,
      onVote: () => undefined,
      onReady: () => undefined,
      onStreakRequest: () => undefined,
      onCheatRequest: () => undefined,
    };
    const session = new Session(link, events, () => 100);
    link.inbox.push(frame((w) => writeHello(w, 'ALICE', 0, null, null)));
    session.receive();

    expect(session.state).toBe('closed');
    expect(kindsSent(link)).toEqual(['reject']);
    expect(calls.left).toEqual([['server full', 'left']]);
  });

  it('reads a skin past the table as none, rather than refusing the client', () => {
    const { session, link } = fresh();
    link.inbox.push(frame((w) => writeHello(w, 'ALICE', 200, null, null)));
    session.receive();

    expect(session.state).toBe('live');
    expect(session.characterIndex).toBe(NO_SKIN_INDEX);
  });

  it('runs afterIdentity last, so nothing overtakes the seat assignment', () => {
    const link = new FakeLink();
    const order: string[] = [];
    const player = { entityId: 1, team: 'A', input: { accept: () => true } };
    const events: SessionEvents = {
      onJoin: (session) => {
        // Stands in for the seat assignment, which the caller sends because only it knows the
        // instance. A notice is the smallest frame that proves the ordering.
        session.notice('seat');
        order.push('onJoin');
        return {
          player: player as unknown as NetPlayer,
          afterIdentity: () => {
            session.notice('after');
            order.push('afterIdentity');
          },
        };
      },
      onLeave: () => undefined,
      onLoadout: () => undefined,
      onVote: () => undefined,
      onReady: () => undefined,
      onStreakRequest: () => undefined,
      onCheatRequest: () => undefined,
    };
    const session = new Session(link, events, () => 100);
    link.inbox.push(frame((w) => writeHello(w, 'ALICE', 0, null, null)));
    session.receive();

    expect(order).toEqual(['onJoin', 'afterIdentity']);
    expect(kindsSent(link)).toEqual(['notice', 'notice']);
  });
});

describe('the ways a session ends', () => {
  it('treats a bye as the player leaving, so no seat is held', () => {
    const { session, link, calls } = seated();
    link.inbox.push(frame((w) => writeBye(w, false, 'quitting')));
    session.receive();

    expect(calls.left).toEqual([['client left', 'left']]);
  });

  it('closes a handshake that never finishes, and holds nothing for it', () => {
    const { session, calls } = fresh();
    now += HANDSHAKE_TIMEOUT_MS + 1;
    session.checkTimeout();

    expect(calls.left).toEqual([['handshake timeout', 'left']]);
  });

  it('holds the seat of a live client that goes quiet, which may be coming back', () => {
    const { session, calls } = seated();
    now += CLIENT_TIMEOUT_MS + 1;
    session.checkTimeout();

    expect(calls.left).toEqual([['timeout', 'lost']]);
  });

  it('notices a link that died under it — the pulled cable — and holds the seat', () => {
    const { session, link, calls } = seated();
    link.state = 'closed';
    session.checkTimeout();

    expect(calls.left).toEqual([['connection lost', 'lost']]);
  });

  it('says nothing twice: a second close is ignored', () => {
    const { session, calls } = seated();
    session.close('first', 'left');
    session.close('second', 'lost');

    expect(calls.left).toEqual([['first', 'left']]);
  });
});

describe('a class no shipped client produces', () => {
  /**
   * Corrected, logged, and seated anyway (security audit S1).
   *
   * The same perk three times is the correction `LoadoutRules` is clearest about â€” *"drops the
   * second and third copy of a perk, so the effect is counted once"* â€” and it reaches the
   * session's own path: a line naming the connection, no answer to the client, no disconnect.
   * A client one build out of step gets a working game, which is the point.
   */
  it('is corrected, named in the log, and still seated', () => {
    const { session, link } = fresh();
    const base = classNamed('BENT');
    const perk = base.perks[0];
    if (perk === undefined) throw new Error('the default class has no perks');
    const bent: NetLoadout = { ...base, perks: base.perks.map(() => perk) };

    link.inbox.push(frame((w) => writeHello(w, 'ALICE', 0, bent, null)));
    session.receive();

    expect(session.state).toBe('live');
    expect(warnings.some((w) => w.includes('no shipped client produces'))).toBe(true);
  });
});
