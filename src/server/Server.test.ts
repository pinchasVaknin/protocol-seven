import { afterEach, describe, expect, it } from 'vitest';
import { CheatOutcome } from '../shared/cheats/Cheats';
import { installClock } from '../shared/core/Clock';
import { EventBus } from '../shared/core/EventBus';
import {
  decodeHeader,
  writeCheatRequest,
  writeHello,
  writeLoadout,
  writeReady,
  writeStreakRequest,
  writeVote,
  type Decoded,
} from '../shared/net/Messages';
import { InstanceState, VotePhase, WARMUP_MATCH_ID } from '../shared/net/Skirmish';
import type { INetLink, LinkState } from '../shared/net/Transport';
import { ByteReader, ByteWriter } from '../shared/net/Wire';
import { loadConfig, type ServerConfig } from './Config';
import { Server } from './Server';

/**
 * The process (B7): what it wires, who it seats, and the order it ticks in.
 *
 * `Server.ts` had no test of its own before this file, and the reason is structural: its public
 * surface is `start()` — which opens a listening socket and a wall-clock loop — eight accessors
 * and the leak harness's one operation. There is no public way to deliver a frame or to run a
 * single tick.
 *
 * So the suite drives the two seams a socket and a timer would drive, named once in `Seams`
 * below and reached through one cast: `accept(link)` and `tick(tickIndex)`. Nothing is made
 * public for the tests and no helper is exported (R2); everything *asserted* goes through the
 * public surface — `instances`, `liveMatch`, `vote`, `reconnectStats`, `boot`, `faulty` — or
 * through the frames a `FakeLink` received, decoded with the client's own `decodeHeader`.
 *
 * The constructor opens nothing: `new Server(cfg)` bakes the maps and builds the arena, and
 * `listen()` lives in `start()`, which these tests never call.
 *
 * The vote cycle is configured down to its one-second minimum per phase, so a whole cycle —
 * free play, mode ballot, map ballot, allocation, readiness, migration, match, summary, the
 * trip home — is about 1,400 ticks of a two-bot arena rather than the four minutes a real
 * server spends. Allocation is a promise, so the ticker lets its continuation land before the
 * next tick.
 *
 * **The clock is frozen and the ticks do the moving.** Every boundary these tests care about is
 * a tick — the ballot's phases, the readiness window, the match flow, the summary hold — while
 * the two things measured in milliseconds are the idle reaper and the metrics line, and a test
 * that advanced the clock far enough to end a match also advanced it far enough to be kicked
 * for silence. So `now` stays where it is, and a test that wants the clock to move says so.
 *
 * **The ballot is voted, not drawn.** With nobody voting, the resolution is a seeded random
 * pick, and the mode it lands on decides how long a match takes — Search & Destroy is three
 * rounds of it. The cycle tests cast a real vote for the first mode and the first map, which
 * is both deterministic and the path a player actually takes.
 */

let now = 100_000;

installClock({ nowMs: () => now });

/** The two private seams a socket and a timer would drive. See the file comment. */
interface Seams {
  accept(link: INetLink): void;
  tick(tickIndex: number): void;
}

function seams(server: Server): Seams {
  return server as unknown as Seams;
}

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

const writer = new ByteWriter(4096);

function frame(write: (w: ByteWriter) => Uint8Array): Uint8Array {
  writer.reset();
  return write(writer).slice();
}

/** Every decoded frame this link has been sent, in order. */
function received(link: FakeLink): Decoded[] {
  return link.sent.map((bytes) => decodeHeader(new ByteReader(bytes)));
}

function kinds(link: FakeLink): string[] {
  return received(link).map((d) => d.kind);
}

const live: Server[] = [];

afterEach(async () => {
  for (const server of live) await server.stop();
  live.length = 0;
  now = 100_000;
});

function config(overrides: Record<string, string> = {}): ServerConfig {
  return loadConfig({
    PORT: '0',
    WARMUP_BOTS: '2',
    PLAY_SECONDS: '1',
    MODE_VOTE_SECONDS: '1',
    MAP_VOTE_SECONDS: '1',
    MATCH_ROUND_SECONDS: '1',
    SUMMARY_HOLD_SECONDS: '1',
    READY_TIMEOUT_MS: '500',
    METRICS_SECONDS: '0',
    ...overrides,
  });
}

function server(overrides: Record<string, string> = {}): Server {
  const made = new Server(config(overrides));
  live.push(made);
  return made;
}

/** Let promise continuations — the allocator's, above all — land before the next tick. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** One connection, handshaked into wherever the server decides to seat it. */
function connect(s: Server, name: string, token: Uint8Array | null = null): FakeLink {
  const link = new FakeLink();
  seams(s).accept(link);
  link.inbox.push(frame((w) => writeHello(w, name, 0, null, token)));
  return link;
}

/** This connection's stable id, which is a module counter and not 1 after the first test. */
function playerIdOf(s: Server, name: string): number {
  for (const instance of s.instances) {
    for (const seat of instance.sessions) {
      if (seat.session.displayName === name) return seat.session.playerId;
    }
  }
  throw new Error(`no seat for ${name}`);
}

/**
 * The master tick, as one cursor per test.
 *
 * Every loop continues from where the last one stopped, because a tick number that goes
 * backwards is not a thing the loop can produce: `InstanceClock`, `MatchFlow` and the readiness
 * window are all indexed by it, and rewinding it would be testing a server that cannot exist.
 */
class Ticker {
  tick = 0;

  constructor(private readonly server: Server) {}

  /** Step `count` ticks, settling promises between them. */
  async run(count: number): Promise<void> {
    for (let i = 0; i < count; i++) await this.one();
  }

  /** Step until `done` answers true, or fail. Answers the tick it became true on. */
  async until(budget: number, done: () => boolean): Promise<number> {
    for (let i = 0; i < budget; i++) {
      const at = this.tick;
      await this.one();
      if (done()) return at;
    }
    throw new Error('the condition did not come true inside the tick budget');
  }

  private async one(): Promise<void> {
    seams(this.server).tick(this.tick++);
    await settle();
  }
}

/** Cast one vote, as a packet. */
function castVote(link: FakeLink, phase: number, option: number): void {
  link.inbox.push(frame((w) => writeVote(w, phase, option)));
}

/**
 * Vote the first mode and the first map, and run until the allocator has answered.
 *
 * Answers the match id, which every later frame from this client has to name.
 */
async function reachAllocation(s: Server, ticker: Ticker, link: FakeLink): Promise<number> {
  await ticker.until(400, () => s.vote.phase === VotePhase.MODE_VOTE);
  castVote(link, VotePhase.MODE_VOTE, 0);
  await ticker.until(400, () => s.vote.phase === VotePhase.MAP_VOTE);
  castVote(link, VotePhase.MAP_VOTE, 0);
  await ticker.until(400, () => s.liveMatch !== null);
  return s.liveMatch?.id ?? -1;
}

/** Report ready for every client, and run until the match is live. */
async function reachRunning(
  s: Server,
  ticker: Ticker,
  links: FakeLink[],
  matchId: number,
): Promise<void> {
  for (const link of links) link.inbox.push(frame((w) => writeReady(w, matchId)));
  await ticker.until(400, () => s.liveMatch?.state === InstanceState.RUNNING);
}

describe('Server', () => {
  describe('boot', () => {
    it('bakes every map before anything else, and reports it', () => {
      const s = server();
      const report = s.boot;
      expect(report).not.toBeNull();
      expect(report?.maps.length).toBeGreaterThanOrEqual(4);
      expect(report?.totalBytes).toBeGreaterThan(0);
    });

    it('builds the arena and nothing else', () => {
      const s = server();
      expect(s.instances).toHaveLength(1);
      expect(s.instances[0]?.isArena).toBe(true);
      expect(s.instances[0]?.id).toBe(WARMUP_MATCH_ID);
      expect(s.liveMatch).toBeNull();
    });

    it('runs the arena from construction, because the room is always live', () => {
      const s = server();
      expect(s.instances[0]?.state).toBe(InstanceState.RUNNING);
    });

    it('starts the cycle in free play with nothing decided', () => {
      const s = server();
      expect(s.vote.phase).toBe(VotePhase.IDLE);
      expect(s.reconnectStats.held).toBe(0);
      expect(s.misroutedMessages).toBe(0);
    });

    it('wires the faulty allocator only when it is asked for', () => {
      expect(server().faulty).toBeNull();
      expect(server({ FAULT_INJECTION: '1' }).faulty).not.toBeNull();
    });
  });

  describe('accepting a connection', () => {
    it('seats a fresh connection in the arena', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');

      await ticker.run(1);

      expect(s.instances[0]?.playerCount).toBe(1);
      expect(kinds(link)).toContain('welcome');
    });

    it('tells it the vote state once it is seated', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');

      await ticker.run(1);

      // The seat assignment is the identity frame; the vote state is sent after it, never
      // before (Tier 2 §D).
      const order = kinds(link);
      expect(order.indexOf('welcome')).toBeLessThan(order.indexOf('voteState'));
    });

    it('gives the second player of the same name a suffix', async () => {
      // Two people who picked the same callsign could not tell which row was theirs, and a
      // third could impersonate either (security audit S9).
      const s = server();
      const ticker = new Ticker(s);
      connect(s, 'ALPHA');
      connect(s, 'ALPHA');

      await ticker.run(1);

      const names = [...(s.instances[0]?.sessions ?? [])].map((seat) => seat.session.displayName);
      expect(names).toContain('ALPHA');
      expect(names).toContain('ALPHA (2)');
    });

    it('compares names without case, because alice beside ALICE is the same impersonation', async () => {
      const s = server();
      const ticker = new Ticker(s);
      connect(s, 'alice');
      connect(s, 'ALICE');

      await ticker.run(1);

      const names = [...(s.instances[0]?.sessions ?? [])].map((seat) => seat.session.displayName);
      expect(new Set(names).size).toBe(2);
      expect(names.some((n) => n.endsWith('(2)'))).toBe(true);
    });

    it('mints a reconnect token for every connection, before anything is seated', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');

      await ticker.run(1);

      const welcome = received(link).find((d) => d.kind === 'welcome');
      expect(welcome).toBeDefined();
      if (welcome !== undefined && welcome.kind === 'welcome') {
        expect(welcome.reconnectToken).not.toBeNull();
      }
    });
  });

  describe('the tick', () => {
    it('steps the arena and measures what the instances cost', async () => {
      const s = server();
      const ticker = new Ticker(s);
      connect(s, 'ALPHA');

      await ticker.run(3);

      expect(s.instances[0]?.clock.localTick).toBeGreaterThanOrEqual(2);
      expect(s.totalStepMs).toBeGreaterThanOrEqual(0);
    });

    it('survives a session that throws while receiving, and keeps the others', async () => {
      // S4.16: malformed input must never crash the server. The handlers were the unguarded
      // layer, and a throw there used to take the drain, the step and the flow with it.
      const s = server();
      const ticker = new Ticker(s);
      const bad = connect(s, 'BAD');
      const good = connect(s, 'GOOD');
      await ticker.run(1);

      // A frame whose magic is right and whose body is nonsense, repeated: whatever the
      // handlers make of it, the tick must come back.
      bad.inbox.push(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
      expect(() => seams(s).tick(1)).not.toThrow();
      await settle();

      expect(s.instances[0]?.playerCount).toBeGreaterThanOrEqual(1);
      expect(kinds(good)).toContain('welcome');
    });

    it('reaps a closed connection', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);
      expect(s.instances[0]?.playerCount).toBe(1);

      link.state = 'closed';
      await ticker.run(2);

      expect(s.instances[0]?.playerCount).toBe(0);
    });
  });

  describe('the ballot', () => {
    it('broadcasts the vote state to the arena at a rate, not every tick', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);
      const before = kinds(link).filter((k) => k === 'voteState').length;

      // 15 ticks is one broadcast interval at 4 Hz.
      await ticker.run(14);

      const after = kinds(link).filter((k) => k === 'voteState').length;
      expect(after - before).toBeLessThanOrEqual(2);
    });

    it('sends a changed vote out on the tick it changed (security audit S3)', async () => {
      // This used to broadcast per vote to every seat in the arena: one client repeating a
      // legal vote made the server send that many frames to everybody — an amplifier with a
      // fan-out of the room.
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.until(400, () => s.vote.phase === VotePhase.MODE_VOTE);

      const playerId = playerIdOf(s, 'ALPHA');
      const before = kinds(link).filter((k) => k === 'voteState').length;
      link.inbox.push(frame((w) => writeVote(w, VotePhase.MODE_VOTE, 1)));
      await ticker.run(1);

      expect(s.vote.voteOf(playerId)).toBe(1);
      expect(kinds(link).filter((k) => k === 'voteState').length).toBeGreaterThan(before);
    });

    it('rejects a vote cast outside its window and says so in the log', async () => {
      // §8.6 requires a vote outside its window to be demonstrably rejected. The tally not
      // moving is the client's feedback; a reply would be a frame a hostile client could make
      // the server send at will.
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);

      const playerId = playerIdOf(s, 'ALPHA');
      link.inbox.push(frame((w) => writeVote(w, VotePhase.MAP_VOTE, 2)));
      await ticker.run(1);

      expect(s.vote.voteOf(playerId)).toBe(-1);
    });
  });

  describe('a cycle, end to end', () => {
    it('allocates a match when the map vote resolves, and prepares every client', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');

      await reachAllocation(s, ticker, link);

      expect(s.liveMatch).not.toBeNull();
      expect(s.instances).toHaveLength(2);
      expect(s.liveMatch?.state).toBe(InstanceState.READY_WAIT);
      // §6.5: the background build starts at allocation, not at the migration.
      expect(kinds(link)).toContain('prepare');
    });

    it('migrates the arena into the match once readiness settles', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      const matchId = await reachAllocation(s, ticker, link);

      await reachRunning(s, ticker, [link], matchId);

      expect(s.liveMatch?.playerCount).toBe(1);
      expect(s.instances[0]?.playerCount).toBe(0);
      expect(kinds(link)).toContain('migrate');
    });

    it('sends the summary once, prepares the arena with it, then takes everybody home', async () => {
      // F13: every client got a background build for the trip *into* a match and none for the
      // trip back, because `Prepare` was only ever sent when a match was allocated.
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      const matchId = await reachAllocation(s, ticker, link);
      await reachRunning(s, ticker, [link], matchId);

      await ticker.until(2_000, () => kinds(link).includes('summary'));
      const summaries = kinds(link).filter((k) => k === 'summary').length;
      const prepares = kinds(link).filter((k) => k === 'prepare').length;

      await ticker.until(600, () => s.liveMatch === null);

      expect(summaries).toBe(1);
      // One for the match, one for the arena behind the summary screen.
      expect(prepares).toBeGreaterThanOrEqual(2);
      expect(s.instances).toHaveLength(1);
      expect(s.instances[0]?.playerCount).toBe(1);
    });

    it('opens the next ballot once everybody is home', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      const matchId = await reachAllocation(s, ticker, link);
      await reachRunning(s, ticker, [link], matchId);
      await ticker.until(2_000, () => s.liveMatch === null);

      // The cycle resumes into free play rather than sitting in ALLOCATING for ever.
      expect([VotePhase.PLAY, VotePhase.MODE_VOTE, VotePhase.MAP_VOTE]).toContain(s.vote.phase);
    });
  });

  describe('a cycle that cannot start', () => {
    it('leaves everybody in the arena with a message when allocation fails', async () => {
      // §4.17: never by dropping them, stranding them, or leaking a half-built instance.
      const s = server({ FAULT_INJECTION: '1' });
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);
      // One injected failure, which is `AllocationError('failure')` from the wrapper.
      if (s.faulty !== null) s.faulty.faults.failuresRemaining = 1;

      await ticker.until(600, () => kinds(link).includes('notice'));

      expect(s.liveMatch).toBeNull();
      expect(s.instances).toHaveLength(1);
      expect(s.instances[0]?.playerCount).toBe(1);
    });

    it('cancels a match nobody is left to play', async () => {
      // §4.20, one stage later than the cycle's own cancel: the instance was built, so unlike
      // the allocation-failure path there is something to release.
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.until(600, () => s.liveMatch !== null);

      link.state = 'closed';
      await ticker.until(600, () => s.liveMatch === null);

      expect(s.instances).toHaveLength(1);
    });
  });

  describe('in-match requests', () => {
    it('refuses a cheat code when the server has cheats disabled', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);

      link.inbox.push(frame((w) => writeCheatRequest(w, 'IDDQD')));
      await ticker.run(1);

      const cheats = received(link).filter((d) => d.kind === 'cheats');
      expect(cheats.length).toBeGreaterThan(0);
    });

    it('answers an unknown code before it consults the flag', async () => {
      // A typo is not an attempt at anything, and telling somebody "cheats are disabled" about
      // a string that is not a code would send them looking for an operator they do not need.
      const s = server({ CHEATS_ENABLED: '1' });
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);

      link.inbox.push(frame((w) => writeCheatRequest(w, 'NOTACODE')));
      await ticker.run(1);

      const answer = received(link).find((d) => d.kind === 'cheats');
      expect(answer).toBeDefined();
      if (answer !== undefined && answer.kind === 'cheats') {
        expect(answer.outcome).toBe(CheatOutcome.RefusedUnknown);
      }
    });

    it('drops a streak request for a kind that does not exist', async () => {
      // §4.16 puts the response to malformed input at the boundary: count it, drop it, never
      // throw.
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);

      link.inbox.push(frame((w) => writeStreakRequest(w, 200, 0, 0)));
      expect(() => seams(s).tick(1)).not.toThrow();
    });

    it('counts a Ready for a match that is not the live one as misrouted', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);
      const before = s.misroutedMessages;

      link.inbox.push(frame((w) => writeReady(w, 4242)));
      await ticker.run(1);

      expect(s.misroutedMessages).toBe(before + 1);
    });

    it('keeps a client that sent an unusable class, and warns rather than dropping it', async () => {
      // A class the server cannot read is a client one build ahead or behind, and the M10
      // defaults are a working game.
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);

      link.inbox.push(
        frame((w) =>
          writeLoadout(w, {
            name: 'BROKEN',
            primary: { weaponId: 'not_a_weapon', attachments: [], camo: null },
            secondary: { weaponId: 'not_a_weapon', attachments: [], camo: null },
            lethal: 'frag',
            tactical: 'flashbang',
            fieldUpgrade: 'ammo_box',
            perks: [null, null, null],
            streaks: [null, null, null],
          }),
        ),
      );
      await ticker.run(1);

      expect(link.state).toBe('open');
      expect(s.instances[0]?.playerCount).toBe(1);
    });
  });

  describe('holding a seat for a return', () => {
    it('holds a lost connection seat in a running match', async () => {
      // Two connections, because the seat is held against the *match*: if the last human
      // leaves, `maybeAbandonLive` destroys it and `destroyLive` forgets the reservation with
      // it — a reservation naming a match that no longer exists could never be redeemed.
      const s = server();
      const ticker = new Ticker(s);
      const alpha = connect(s, 'ALPHA');
      const bravo = connect(s, 'BRAVO');
      const matchId = await reachAllocation(s, ticker, alpha);
      await reachRunning(s, ticker, [alpha, bravo], matchId);
      expect(s.liveMatch?.playerCount).toBe(2);

      // A dropped socket, not a Bye: the player did not say they were done.
      alpha.state = 'closed';
      await ticker.run(2);

      expect(s.reconnectStats.held).toBe(1);
      expect(s.liveMatch?.playerCount).toBe(1);
    });

    it('holds nothing for an arena seat, which is worth nothing to hold', async () => {
      // It records no score, carries no objective state and is handed out instantly to
      // anybody who asks, so a reservation for one would protect nothing.
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);

      link.state = 'closed';
      await ticker.run(2);

      expect(s.reconnectStats.held).toBe(0);
    });

    it('gives a returning player the seat, the id and the side they left with', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const alpha = connect(s, 'ALPHA');
      const bravo = connect(s, 'BRAVO');
      const matchId = await reachAllocation(s, ticker, alpha);
      await reachRunning(s, ticker, [alpha, bravo], matchId);
      const seat = [...(s.liveMatch?.sessions ?? [])].find((x) => x.session.displayName === 'ALPHA');
      const entityId = seat?.player.entityId ?? -1;
      const team = seat?.player.team;
      const token = seat?.session.reconnectToken ?? null;
      expect(token).not.toBeNull();

      alpha.state = 'closed';
      await ticker.run(2);
      expect(s.reconnectStats.held).toBe(1);

      const back = connect(s, 'ALPHA', token);
      await ticker.run(1);

      const returned = [...(s.liveMatch?.sessions ?? [])].find(
        (x) => x.player.entityId === entityId,
      );
      expect(returned).toBeDefined();
      expect(returned?.player.team).toBe(team);
      expect(s.reconnectStats.claimed).toBe(1);
      expect(kinds(back)).toContain('welcome');
    });

    it('sends an unknown token straight through to an ordinary join, in silence', async () => {
      // A token from a match that ended cleanly, or from an arena seat that never reserved
      // anything: nothing was lost, so there is nothing to say.
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA', new Uint8Array(16).fill(7));
      await ticker.run(1);

      expect(s.instances[0]?.playerCount).toBe(1);
      expect(s.reconnectStats.unknown).toBe(1);
      expect(kinds(link)).not.toContain('notice');
    });
  });

  describe('what the panel reads', () => {
    it('lists the arena first and the live match second', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await reachAllocation(s, ticker, link);

      expect(s.instances).toHaveLength(2);
      expect(s.instances[0]?.isArena).toBe(true);
      expect(s.instances[1]?.id).toBe(s.liveMatch?.id);
    });

    it('answers for the loop before it has ever run', () => {
      // Nothing has been measured yet, so the percentiles are zero rather than undefined —
      // the §7 panel reads this on its first frame.
      const s = server();
      const j = s.jitter;
      expect(j.p50).toBe(0);
      expect(j.p99).toBe(0);
      expect(j.late).toBe(0);
      expect(j.dropped).toBe(0);
    });

    it('tells every connected player at once, wherever they are seated', async () => {
      // Distinct from `instance.broadcast`, which reaches one world. §4.17 requires all of
      // them to be told when a transition is aborted.
      const s = server({ FAULT_INJECTION: '1' });
      const ticker = new Ticker(s);
      const alpha = connect(s, 'ALPHA');
      const bravo = connect(s, 'BRAVO');
      await ticker.run(1);
      if (s.faulty !== null) s.faulty.faults.failuresRemaining = 1;

      await ticker.until(600, () => kinds(alpha).includes('notice'));

      expect(kinds(bravo)).toContain('notice');
    });
  });

  describe('teardown', () => {
    it('allocates and destroys a match without leaking a subscription', async () => {
      // §8.13's one operation, and the number it counts.
      const s = server();
      const before = EventBus.liveSubscriptions;

      await s.allocateAndDestroyForLeakTest();

      expect(s.liveMatch).toBeNull();
      expect(EventBus.liveSubscriptions).toBe(before);
    });

    it('rotates the map and the mode across leak-test cycles', async () => {
      // A leak that only appears on one map is not missed by a hundred repetitions of the
      // cheapest one.
      const s = server();
      await s.allocateAndDestroyForLeakTest();
      await s.allocateAndDestroyForLeakTest();
      expect(s.liveMatch).toBeNull();
    });

    it('closes every connection and disposes the arena', async () => {
      const s = server();
      const ticker = new Ticker(s);
      const link = connect(s, 'ALPHA');
      await ticker.run(1);

      await s.stop();
      live.length = 0;

      expect(link.state).toBe('closed');
    });
  });
});
