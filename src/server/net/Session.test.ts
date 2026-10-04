import { beforeEach, describe, expect, it } from 'vitest';
import { installClock } from '../../shared/core/Clock';
import { installLogSink, type LogLevel } from '../../shared/core/Log';
import { defaultLoadouts } from '../../shared/meta/Loadouts';
import {
  decodeHeader,
  writeCheatRequest,
  writeCommands,
  writeHello,
  writePing,
  writeLoadout,
  writeStreakRequest,
  writeVote,
} from '../../shared/net/Messages';
import { BYE_IDLE, IDLE_WARNING_MS, MAX_CLIENT_FRAME_BYTES } from '../../shared/net/Protocol';
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
