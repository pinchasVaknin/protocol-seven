import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installClock } from '../../shared/core/Clock';
import { CheatState } from '../../shared/cheats/Cheats';
import { DT } from '../../shared/core/Loop';
import { NO_SKIN_INDEX } from '../../shared/meta/Skins';
import { InstanceState, type MatchId } from '../../shared/net/Skirmish';
import { MapBakery } from '../MapBakery';
import type { Session } from '../net/Session';
import { LiveMatch, type LiveMatchOptions } from './LiveMatch';

/**
 * A voted match (B4).
 *
 * The class is a state machine with five places the flow can fail differently, and the tests
 * are organised the same way: the readiness window, going live, the ending, the summary, and
 * the seat. Four claims get the most attention, because each one is a fix whose absence
 * presented as something else entirely:
 *
 *  - **`step` moves to `ENDED` only after `super.step` has had its chance to send.** The base
 *    class decides whether to force a snapshot by reading `state === RUNNING && match.isOver`,
 *    so a transition one line earlier would silence the `MATCH_END` header on two ticks in
 *    three — which presented as four separate bugs at M11.
 *  - **The summary hold is measured against the master tick**, not this instance's clock. An
 *    `ENDED` instance is never advanced again, so a hold measured against its own frozen clock
 *    can never expire, and every player sits on the summary forever.
 *  - **`everSeated` separates *emptied* from *not yet filled*.** Both are "no humans in it",
 *    and only the first means teardown.
 *  - **A seat takes a bot off the team the human actually landed on**, which is why the swap
 *    runs after `super.seat` rather than guessing the side in advance.
 *
 * The clock here is a fake one the tests move by hand, because the readiness timeout is the one
 * thing in the file measured in milliseconds rather than ticks.
 */

/** The harness clock, so the readiness timeout can be stepped over without waiting for it. */
let now = 10_000;

installClock({ nowMs: () => now });

const READY_TIMEOUT_MS = 5_000;
const SUMMARY_HOLD_SECONDS = 12;
const START_TICK = 41_000;

let bakery: MapBakery;
let nextPlayerId = 1;

beforeAll(() => {
  bakery = new MapBakery();
  bakery.bakeAll();
});

beforeEach(() => {
  now = 10_000;
  nextPlayerId = 1;
});

function options(overrides: Partial<LiveMatchOptions> = {}): LiveMatchOptions {
  return {
    id: 1 as MatchId,
    bakery,
    mapId: 'mp_foundry',
    modeId: 'TDM',
    snapshotHz: 20,
    interpolationDelayMs: 100,
    seed: 1234,
    startTick: START_TICK,
    botTier: 'MIX',
    readyTimeoutMs: READY_TIMEOUT_MS,
    summaryHoldSeconds: SUMMARY_HOLD_SECONDS,
    roundSecondsOverride: 0,
    ...overrides,
  };
}

/** What a faked session recorded being sent to it. */
interface SendLog {
  boards: number;
  snapshots: number;
}

/**
 * A `Session` as the instance sees it, faked structurally rather than built.
 *
 * A real one owns a socket. These are the members `MatchInstance` touches on the seating and
 * the sending paths, and nothing else — if the list ever falls short, the step throws on the
 * missing member rather than quietly skipping a client, which is what makes this fake safe to
 * assert sends against.
 */
function session(
  overrides: { playerId?: number; displayName?: string; token?: Uint8Array | null; log?: SendLog } = {},
): Session {
  const playerId = overrides.playerId ?? nextPlayerId++;
  const log = overrides.log;
  const fake = {
    playerId,
    displayName: overrides.displayName ?? `OP${playerId}`,
    cheats: new CheatState(),
    characterIndex: NO_SKIN_INDEX,
    reconnectToken: overrides.token ?? null,
    closed: false,
    rttMs: 50,
    ackedSnapshot: 0,
    restartSnapshotStream(): void {},
    noteSnapshotSent(): void {},
    send(): void {
      if (log !== undefined) log.snapshots++;
    },
    sendScoreboard(): void {
      if (log !== undefined) log.boards++;
    },
    sendObjectives(): void {},
    sendTags(): void {},
    sendBomb(): void {},
    sendStreaks(): void {},
    sendProjectiles(): void {},
    sendStateHash(): void {},
  };
  return fake as unknown as Session;
}

/** A match in `RUNNING`, which is where seating and the ending both live. */
function running(overrides: Partial<LiveMatchOptions> = {}): LiveMatch {
  const match = new LiveMatch(options(overrides));
  match.begin(START_TICK);
  return match;
}

describe('LiveMatch', () => {
  describe('construction', () => {
    it('is built and waiting on client background builds', () => {
      const match = new LiveMatch(options());
      expect(match.state).toBe(InstanceState.READY_WAIT);
      expect(match.awaitingReadiness).toBe(true);
      match.dispose();
    });

    it('is not the arena, however much it looks like one', () => {
      const match = new LiveMatch(options());
      expect(match.isArena).toBe(false);
      match.dispose();
    });

    it('carries the voted map and mode', () => {
      const match = new LiveMatch(options({ mapId: 'mp_dunes', modeId: 'DOM' }));
      expect(match.mapId).toBe('mp_dunes');
      expect(match.modeId).toBe('DOM');
      expect(match.match.mapEntry.id).toBe('mp_dunes');
      match.dispose();
    });

    it('takes the snapshot phase one send interval clear of the arena', () => {
      const match = new LiveMatch(options());
      expect(match.clock.phaseOffset).toBe(1);
      match.dispose();
    });

    it('spawns the mode authored roster before anybody has migrated in', () => {
      // §6.7: 10 for TDM. It has no way of knowing how many will make it through the readiness
      // handshake, which is why every seat granted afterwards has to take a bot with it.
      const match = new LiveMatch(options());
      expect(match.match.bots.bots).toHaveLength(10);
      expect(match.playerCount).toBe(0);
      match.dispose();
    });

    it('has not been seated, so it is not abandoned', () => {
      // "No humans in it" is also true of an instance in the seconds between allocation and
      // migration. Only `everSeated` separates emptied from not yet filled.
      const match = new LiveMatch(options());
      expect(match.abandoned).toBe(false);
      match.dispose();
    });
  });

  describe('the readiness window', () => {
    it('settles at once when everybody expected has reported', () => {
      const match = new LiveMatch(options());
      match.noteReady(1);
      match.noteReady(2);
      expect(match.readinessSettled([1, 2])).toEqual({ settled: true, timedOut: [] });
      expect(match.timeoutCount).toBe(0);
      match.dispose();
    });

    it('settles for an empty expected set', () => {
      const match = new LiveMatch(options());
      expect(match.readinessSettled([])).toEqual({ settled: true, timedOut: [] });
      match.dispose();
    });

    it('waits while a client is missing and the timeout has not expired', () => {
      const match = new LiveMatch(options());
      match.noteReady(1);
      now += READY_TIMEOUT_MS - 1;
      expect(match.readinessSettled([1, 2])).toEqual({ settled: false, timedOut: [] });
      expect(match.timeoutCount).toBe(0);
      match.dispose();
    });

    it('starts without a slow client once the timeout expires', () => {
      // §4.18: a client that has not reported ready is migrated anyway and shows its own
      // loading screen. The alternative is a start gated on the slowest machine in the match.
      const match = new LiveMatch(options());
      match.noteReady(1);
      now += READY_TIMEOUT_MS;
      expect(match.readinessSettled([1, 2, 3])).toEqual({ settled: true, timedOut: [2, 3] });
      expect(match.timeoutCount).toBe(2);
      match.dispose();
    });

    it('counts a report that arrives after the timeout fired', () => {
      // The readiness set is consulted after the timeout, so a late client stops being counted
      // as timed out rather than being remembered as one for the migration log.
      const match = new LiveMatch(options());
      now += READY_TIMEOUT_MS;
      match.readinessSettled([1, 2]);
      expect(match.timeoutCount).toBe(2);

      match.noteReady(1);
      expect(match.timeoutCount).toBe(1);
      match.dispose();
    });

    it('is idempotent, because a retransmitted Prepare is reported twice', () => {
      const match = new LiveMatch(options());
      match.noteReady(1);
      match.noteReady(1);
      match.noteReady(1);
      expect(match.readinessSettled([1])).toEqual({ settled: true, timedOut: [] });
      match.dispose();
    });
  });

  describe('going live', () => {
    it('moves to RUNNING and starts the mode clocks there', () => {
      const match = new LiveMatch(options());
      match.begin(START_TICK + 50);
      expect(match.state).toBe(InstanceState.RUNNING);
      expect(match.runningSinceTick).toBe(START_TICK + 50);
      expect(match.awaitingReadiness).toBe(false);
      match.dispose();
    });

    it('is refused from any state but READY_WAIT, so it cannot be called twice', () => {
      const match = new LiveMatch(options());
      match.begin(START_TICK + 50);
      match.begin(START_TICK + 90);
      expect(match.runningSinceTick).toBe(START_TICK + 50);
      match.dispose();
    });

    it('can be marked failed after its step threw', () => {
      const match = running();
      match.fail('step threw');
      expect(match.state).toBe(InstanceState.FAILED);
      match.dispose();
    });
  });

  describe('the ending', () => {
    /** Step until the win condition fires, and return the tick it fired on. */
    function stepToEnd(match: LiveMatch): number {
      for (let i = 0; i < 1_200; i++) {
        const tick = START_TICK + i;
        match.step(tick);
        if (match.state === InstanceState.ENDED) return tick;
      }
      throw new Error('the match did not end inside the step budget');
    }

    it('moves to ENDED on the tick the win condition fires', () => {
      const match = running({ roundSecondsOverride: 1 });
      const endedAt = stepToEnd(match);
      expect(match.state).toBe(InstanceState.ENDED);
      expect(match.match.isOver).toBe(true);
      // One second of round at 60 Hz, reached from the tick the match went live.
      expect(endedAt).toBeGreaterThanOrEqual(START_TICK + 60);
      match.dispose();
    });

    it('stays RUNNING for as long as the win condition has not fired', () => {
      const match = running({ roundSecondsOverride: 0 });
      for (let i = 0; i < 120; i++) match.step(START_TICK + i);
      expect(match.state).toBe(InstanceState.RUNNING);
      expect(match.match.isOver).toBe(false);
      match.dispose();
    });

    it('holds the summary for the configured seconds, counted in master ticks', () => {
      const match = running({ roundSecondsOverride: 1 });
      const endedAt = stepToEnd(match);
      expect(match.summaryEndsTick).toBe(endedAt + Math.round(SUMMARY_HOLD_SECONDS / DT));
      match.dispose();
    });

    it('expires the hold against the master tick, not its own frozen clock', () => {
      // An ENDED instance is never advanced again, so a hold measured against
      // `clock.absoluteTick` would compare a frozen number against a deadline it can never
      // reach: the summary is sent and nobody ever goes back to the arena. Found by the flow
      // harness, where the match ended at 32 s and nothing happened for the next 70 s.
      const match = running({ roundSecondsOverride: 1 });
      const endedAt = stepToEnd(match);
      const frozen = match.clock.absoluteTick;

      expect(match.summaryElapsed(endedAt)).toBe(false);
      expect(match.summaryElapsed(match.summaryEndsTick - 1)).toBe(false);
      expect(match.summaryElapsed(match.summaryEndsTick)).toBe(true);
      // The instance's own clock has not moved past the deadline and never will.
      expect(frozen).toBeLessThan(match.summaryEndsTick);
      expect(match.clock.absoluteTick).toBe(frozen);
      match.dispose();
    });

    it('sends the last board on the ending tick, even off the snapshot phase', () => {
      /**
       * The reason `step` moves to `ENDED` *after* `super.step` has run.
       *
       * The base class decides whether to force a send by reading
       * `state === RUNNING && match.isOver`. A live match sends on one tick in three, so on two
       * endings in three that forced pass is the only one there will ever be: the instance is
       * `ENDED` from the next tick and is never stepped again. Transitioning one line earlier
       * makes `ending` false, and the snapshot carrying `phase = MATCH_END` is never sent.
       * The client's `MatchFlow.applyReplicated` then never sees the transition that fires
       * `EV.MatchEnded`, and everything hanging off it — the summary screen, the announcer,
       * the world teardown — never happens. Measured at M11: 9 endings in 15 never replicated
       * it, against the 2-in-3 the theory predicts.
       *
       * The *snapshot* is what is asserted rather than the board. The forced board additionally
       * needs `changed`, and a timed ending usually has no kill in its final tick, which is
       * the hole BACKLOG #42 is about.
       *
       * So the test deliberately finds an ending that lands **off** the snapshot phase, where
       * `shouldSnapshot()` is false and a send can only be explained by `ending`.
       */
      const interval = 3;
      let found = false;
      for (let shift = 0; shift < interval && !found; shift++) {
        const log: SendLog = { boards: 0, snapshots: 0 };
        const match = new LiveMatch(options({ roundSecondsOverride: 1 }));
        match.begin(START_TICK + shift);
        match.seat(session({ log }), null);

        let endedAt = -1;
        let sentBefore = -1;
        for (let i = shift; i < 1_200 && endedAt < 0; i++) {
          const tick = START_TICK + i;
          sentBefore = log.snapshots;
          match.step(tick);
          if (match.state === InstanceState.ENDED) endedAt = tick;
        }
        expect(endedAt).toBeGreaterThan(0);

        // Only the endings that are not already snapshot ticks prove anything here.
        if ((endedAt + match.clock.phaseOffset) % interval === 0) {
          match.dispose();
          continue;
        }
        found = true;
        expect(log.snapshots).toBeGreaterThan(sentBefore);
        match.dispose();
      }
      expect(found).toBe(true);
    });

    it('reports no elapsed hold before the match has ended', () => {
      const match = running();
      expect(match.summaryElapsed(START_TICK + 1_000_000)).toBe(false);
      match.dispose();
    });

    it('tracks whether the summary has been delivered', () => {
      const match = running();
      expect(match.summaryAlreadySent).toBe(false);
      match.markSummarySent();
      expect(match.summaryAlreadySent).toBe(true);
      match.dispose();
    });
  });

  describe('the summary', () => {
    it('is built once and handed out as the same object', () => {
      // The rows live in `ScoreSystem`, which `dispose` releases, so a summary built after
      // teardown would report a match of zeroes. Built before, and memoised.
      const match = running();
      const first = match.buildSummary();
      expect(match.buildSummary()).toBe(first);
      match.dispose();
    });

    it('names the match, its map and its mode', () => {
      const match = running({ mapId: 'mp_depot', modeId: 'KC' });
      const summary = match.buildSummary();
      expect(summary.matchId).toBe(1);
      expect(summary.mapId).toBe('mp_depot');
      expect(summary.modeId).toBe('KC');
      match.dispose();
    });

    it('carries one row per body on the board, every one a bot', () => {
      // A bot is anything the roster holds that no session is seated on, derived rather than
      // stored, so a human who disconnects mid-match stays the human they were.
      const match = running();
      const summary = match.buildSummary();
      expect(summary.rows).toHaveLength(10);
      for (const row of summary.rows) {
        expect(row.isBot).toBe(true);
        expect(row.team === 'A' || row.team === 'B').toBe(true);
      }
      match.dispose();
    });

    it('sorts the rows the way the scoreboard does', () => {
      const match = running({ roundSecondsOverride: 1 });
      for (let i = 0; i < 300; i++) match.step(START_TICK + i);
      const rows = match.buildSummary().rows;
      for (let i = 1; i < rows.length; i++) {
        const previous = rows[i - 1];
        const current = rows[i];
        if (previous === undefined || current === undefined) continue;
        expect(previous.score).toBeGreaterThanOrEqual(current.score);
      }
      match.dispose();
    });

    it('carries no XP in the common half, because a recipient lines are theirs alone', () => {
      const match = running();
      expect(match.buildSummary().xp).toEqual([]);
      match.dispose();
    });

    it('carries the deadline the summary screen counts down to', () => {
      const match = running();
      expect(match.buildSummary().endsTick).toBe(match.summaryEndsTick);
      match.dispose();
    });

    it('falls back to a draw when the mode has declared no outcome', () => {
      const match = running();
      const summary = match.buildSummary();
      expect(summary.winner).toBe('DRAW');
      expect(summary.reason).toBe('Match ended');
      expect(summary.scoreA).toBe(0);
      expect(summary.scoreB).toBe(0);
      match.dispose();
    });

    it('reports a seated human as a human rather than a bot', () => {
      const match = running();
      const op = session();
      const player = match.seat(op, null);
      expect(player).not.toBeNull();

      const row = match.buildSummary().rows.find((r) => r.entityId === player?.entityId);
      expect(row?.isBot).toBe(false);
      expect(row?.displayName).toBe('OP1');
      match.dispose();
    });

    it('gives a seat its own XP lines beside the common half', () => {
      const match = running();
      const op = session();
      const player = match.seat(op, null);
      const seat = match.seatOf(op.playerId);
      expect(seat).not.toBeNull();
      if (seat === null || player === null) return;

      const common = match.buildSummary();
      const mine = match.buildSummaryFor(seat);
      expect(mine.rows).toEqual(common.rows);
      expect(mine.matchId).toBe(common.matchId);
      expect(mine.endsTick).toBe(common.endsTick);
      // The ledger exists from the moment the seat was granted, so the lines are a list rather
      // than an absence — and they are this seat's, not everybody's.
      expect(Array.isArray(mine.xp)).toBe(true);
      for (const line of mine.xp) {
        expect(Number.isInteger(line.amount)).toBe(true);
        expect(line.count).toBeGreaterThan(0);
      }
      match.dispose();
    });
  });

  describe('seating a human', () => {
    it('latches everSeated, so the match can be told emptied from not yet filled', () => {
      const match = running();
      const op = session();
      match.seat(op, null);
      expect(match.playerCount).toBe(1);
      expect(match.abandoned).toBe(false);

      match.unseat(op.playerId, 'disconnected');
      expect(match.playerCount).toBe(0);
      expect(match.abandoned).toBe(true);
      match.dispose();
    });

    it('takes a bot off the team the human actually landed on', () => {
      // §6.7: a human joining replaces a bot rather than adding a player, so team sizes stay
      // fixed. Three humans joining a ten-bot TDM must not make it a thirteen-body match.
      const match = running();
      const before = {
        A: match.match.bots.tiersOn('A').length,
        B: match.match.bots.tiersOn('B').length,
      };

      const op = session();
      const player = match.seat(op, null);
      expect(player).not.toBeNull();
      if (player === null) return;

      const after = {
        A: match.match.bots.tiersOn('A').length,
        B: match.match.bots.tiersOn('B').length,
      };
      expect(match.match.bots.bots).toHaveLength(9);
      expect(after[player.team]).toBe(before[player.team] - 1);
      expect(after[player.team === 'A' ? 'B' : 'A']).toBe(before[player.team === 'A' ? 'B' : 'A']);
      match.dispose();
    });

    it('keeps the body count fixed across three joins', () => {
      const match = running();
      for (let i = 0; i < 3; i++) match.seat(session(), null);
      expect(match.playerCount).toBe(3);
      expect(match.match.bots.bots).toHaveLength(7);
      match.dispose();
    });

    it('creates one XP ledger per entity, once', () => {
      // Checked through the summary, which is the only place a ledger is observable: a seat
      // with no ledger would be sent an empty XP list rather than its own lines.
      const match = running();
      const op = session();
      match.seat(op, null);
      const seat = match.seatOf(op.playerId);
      if (seat === null) return;

      const first = match.buildSummaryFor(seat).xp;
      const second = match.buildSummaryFor(seat).xp;
      expect(second).toEqual(first);
      match.dispose();
    });
  });

  describe('a seat that is lost', () => {
    it('leaves a bot behind on a disconnect, so the side is not a body down', () => {
      // It matters most in S&D, where the last human on a side dropping out would end the round
      // for everybody, scored as an elimination nobody achieved.
      const match = running();
      const op = session();
      match.seat(op, null);
      expect(match.match.bots.bots).toHaveLength(9);

      match.unseat(op.playerId, 'disconnected');
      expect(match.match.bots.bots).toHaveLength(10);
      match.dispose();
    });

    it('leaves no bot behind on a migration, because the player is still playing', () => {
      // A migration is not a departure — the player is being seated one instance over in the
      // same synchronous call — and treating it as one would add a bot on every cycle.
      const match = running();
      const op = session();
      match.seat(op, null);
      expect(match.match.bots.bots).toHaveLength(9);

      match.unseat(op.playerId, 'migrated');
      expect(match.match.bots.bots).toHaveLength(9);
      expect(match.playerCount).toBe(0);
      match.dispose();
    });

    it('leaves no bot behind when the match is not running', () => {
      const match = new LiveMatch(options());
      const op = session();
      match.seat(op, null);
      const before = match.match.bots.bots.length;
      match.unseat(op.playerId, 'disconnected');
      expect(match.match.bots.bots).toHaveLength(before);
      match.dispose();
    });

    it('releases the seat even when no bot was available to take it', () => {
      const match = running();
      const op = session();
      match.seat(op, null);
      match.unseat(op.playerId, 'disconnected');
      expect(match.seatOf(op.playerId)).toBeNull();
      match.dispose();
    });

    it('does nothing for a player who is not seated here', () => {
      const match = running();
      const before = match.match.bots.bots.length;
      match.unseat(999, 'disconnected');
      expect(match.match.bots.bots).toHaveLength(before);
      expect(match.abandoned).toBe(false);
      match.dispose();
    });
  });

  describe('a player who comes back past the grace', () => {
    it('adopts the row their old token opens', () => {
      // Past the grace they are a new entity, possibly on the other side, and the token they
      // present — expired to the registry, but still the one this instance recorded when the
      // seat was lost — names the row with their kills on it.
      const match = running();
      const token = new Uint8Array([1, 2, 3, 4]);
      const first = session({ playerId: 1, displayName: 'OP1', token });
      const left = match.seat(first, null);
      expect(left).not.toBeNull();
      if (left === null) return;

      match.unseat(first.playerId, 'disconnected');

      const back = session({ playerId: 2, displayName: 'OP1', token });
      const returned = match.seat(back, null, null, token);
      expect(returned).not.toBeNull();
      if (returned === null) return;

      const rows = match.buildSummary().rows;
      expect(rows.filter((r) => r.displayName === 'OP1')).toHaveLength(1);
      expect(rows.find((r) => r.entityId === left.entityId)).toBeUndefined();
      expect(rows.find((r) => r.entityId === returned.entityId)?.isBot).toBe(false);
      match.dispose();
    });

    it('records the row owner only for a lost connection', () => {
      // A Bye is the player saying they are done and a migration is the match ending, so
      // neither leaves a row waiting to be claimed.
      const match = running();
      const token = new Uint8Array([9, 9]);
      const first = session({ playerId: 1, token });
      const left = match.seat(first, null);
      if (left === null) return;
      match.unseat(first.playerId, 'migrated');

      const back = session({ playerId: 2, token });
      const returned = match.seat(back, null, null, token);
      if (returned === null) return;
      // Nothing was recorded, so there is no row to adopt and the old one still stands.
      const rows = match.buildSummary().rows;
      expect(rows.find((r) => r.entityId === left.entityId)).toBeDefined();
      match.dispose();
    });

    it('ignores an empty or absent token', () => {
      const match = running();
      const op = session();
      expect(match.seat(op, null, null, null)).not.toBeNull();
      const other = session();
      expect(match.seat(other, null, null, new Uint8Array(0))).not.toBeNull();
      match.dispose();
    });

    it('moves nothing when the token names the entity the seat already has', () => {
      // Inside the grace `reclaim` already put them back on this entity; there is nothing to
      // move, and the adoption must not run against itself.
      const match = running();
      const token = new Uint8Array([7]);
      const op = session({ playerId: 1, token });
      const player = match.seat(op, null);
      if (player === null) return;
      match.unseat(op.playerId, 'disconnected');

      const again = session({ playerId: 1, token });
      const back = match.seat(again, null, { entityId: player.entityId, team: player.team }, token);
      expect(back).not.toBeNull();
      expect(back?.entityId).toBe(player.entityId);
      match.dispose();
    });
  });

  describe('teardown', () => {
    it('releases the readiness sets, the summary and the ledgers', () => {
      const match = running();
      const op = session();
      match.seat(op, null);
      match.noteReady(1);
      match.buildSummary();

      match.dispose();
      expect(match.timeoutCount).toBe(0);
      expect(match.readinessSettled([1])).toEqual({ settled: false, timedOut: [] });
    });
  });
});
