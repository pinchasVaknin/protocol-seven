import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CheatState } from '../shared/cheats/Cheats';
import { installClock } from '../shared/core/Clock';
import { NO_SKIN_INDEX } from '../shared/meta/Skins';
import { type MatchId } from '../shared/net/Skirmish';
import { LiveMatch } from './instance/LiveMatch';
import { WarmupMatch } from './instance/WarmupMatch';
import { MapBakery } from './MapBakery';
import { Migration, seatInfo } from './Migration';
import type { Session } from './net/Session';
import { Router } from './Router';

/**
 * Moving a player between instances (B8).
 *
 * §4.18 calls this *"the piece most likely to be got wrong"* and gives five rules; the file's
 * own comment lists them and `move` implements each in one line. The tests are organised the
 * same way, because every one of the five is invisible when it is wrong:
 *
 *  1. **Exactly one instance on every tick** — the release and the seat happen inside one
 *     synchronous call, so the assertion is that the router's answer has changed by the time
 *     `move` returns and that the player exists in exactly one world throughout.
 *  2. **A named tick** — the seat assignment carries `effectiveTick`.
 *  3. **The client is told** — a `Migrate` frame, which the fake session records.
 *  4. **The loadout is read at migration time**, not inside `seat`.
 *  5. **Failure leaves the player where they are, with a message** — never a disconnect.
 *
 * Two real instances, because the seat has to be real on both sides for the invariant to mean
 * anything; only the `Session` is faked, as `LiveMatch.test.ts` and `MatchInstance.test.ts`
 * both fake it, and for the same reason: a real one owns a socket.
 */

let now = 10_000;

installClock({ nowMs: () => now });

let bakery: MapBakery;
let nextPlayerId = 1;
const live: Array<{ dispose(): void }> = [];

beforeAll(() => {
  bakery = new MapBakery();
  bakery.bakeAll();
});

beforeEach(() => {
  now = 10_000;
  nextPlayerId = 1;
});

interface FakeSession {
  readonly session: Session;
  readonly seats: Array<{ matchId: number; entityId: number; migrated: boolean; tick: number }>;
  readonly notices: string[];
  closed: string | null;
}

function session(): FakeSession {
  const playerId = nextPlayerId++;
  const seats: FakeSession['seats'] = [];
  const notices: string[] = [];
  const state = { closed: null as string | null };
  const fake = {
    playerId,
    displayName: `OP${playerId}`,
    cheats: new CheatState(),
    characterIndex: NO_SKIN_INDEX,
    reconnectToken: null,
    closed: false,
    rttMs: 50,
    ackedSnapshot: 0,
    loadout: null,
    player: null,
    restartSnapshotStream(): void {},
    noteSnapshotSent(): void {},
    send(): void {},
    sendScoreboard(): void {},
    sendObjectives(): void {},
    sendTags(): void {},
    sendBomb(): void {},
    sendStreaks(): void {},
    sendProjectiles(): void {},
    sendStateHash(): void {},
    sendSeat(info: { matchId: number; entityId: number; migrated: boolean; effectiveTick: number }): void {
      seats.push({
        matchId: info.matchId,
        entityId: info.entityId,
        migrated: info.migrated,
        tick: info.effectiveTick,
      });
    },
    notice(text: string): void {
      notices.push(text);
    },
    close(reason: string): void {
      state.closed = reason;
    },
  };
  return {
    session: fake as unknown as Session,
    seats,
    notices,
    get closed(): string | null {
      return state.closed;
    },
    set closed(value: string | null) {
      state.closed = value;
    },
  };
}

function arena(): WarmupMatch {
  const made = new WarmupMatch({
    bakery,
    snapshotHz: 20,
    interpolationDelayMs: 100,
    seed: 1234,
    startTick: 0,
    bots: 1,
    difficulty: 'MIX',
  });
  live.push(made);
  return made;
}

function match(id = 1): LiveMatch {
  const made = new LiveMatch({
    id: id as MatchId,
    bakery,
    mapId: 'mp_foundry',
    modeId: 'TDM',
    snapshotHz: 20,
    interpolationDelayMs: 100,
    seed: 1234,
    startTick: 0,
    botTier: 'MIX',
    readyTimeoutMs: 5_000,
    summaryHoldSeconds: 12,
    roundSecondsOverride: 0,
  });
  live.push(made);
  return made;
}

/** A router with this connection already seated in `from`. */
function seated(from: WarmupMatch | LiveMatch): { router: Router; migration: Migration; op: FakeSession } {
  const router = new Router();
  const migration = new Migration(router);
  const op = session();
  const player = from.seat(op.session, null);
  expect(player).not.toBeNull();
  router.admit(op.session, from);
  return { router, migration, op };
}

describe('Migration', () => {
  describe('a move that works', () => {
    it('releases the old seat and creates the new one in one call', () => {
      const from = arena();
      const to = match();
      const { router, migration, op } = seated(from);

      expect(migration.move(op.session, to, 3_600, 20)).toBe(true);

      // Exactly one instance, and it is the new one, by the time the call returns.
      expect(router.instanceOf(op.session.playerId)).toBe(to);
      expect(from.playerCount).toBe(0);
      expect(to.playerCount).toBe(1);
    });

    it('tells the client, with the tick the move takes effect on', () => {
      const from = arena();
      const to = match(4);
      const { migration, op } = seated(from);
      op.seats.length = 0;

      migration.move(op.session, to, 3_600, 20);

      expect(op.seats).toHaveLength(1);
      expect(op.seats[0]?.matchId).toBe(4);
      expect(op.seats[0]?.tick).toBe(3_600);
      expect(op.seats[0]?.migrated).toBe(true);
    });

    it('does not put a bot in the mover place, because they are not leaving', () => {
      // `'migrated'`, explicitly: treating a migration as a departure would add a bot on every
      // cycle and turn §8.13's flat hundred cycles into a staircase.
      const from = match(1);
      const to = arena();
      const { migration, op } = seated(from);
      const botsBefore = from.botCount;

      migration.move(op.session, to, 3_600, 20);

      expect(from.botCount).toBe(botsBefore);
    });

    it('records the move, with its duration and both instance ids', () => {
      const from = arena();
      const to = match(2);
      const { migration, op } = seated(from);

      migration.move(op.session, to, 3_600, 20);

      const last = migration.log[migration.log.length - 1];
      expect(last?.ok).toBe(true);
      expect(last?.fromMatch).toBe(0);
      expect(last?.toMatch).toBe(2);
      expect(last?.tick).toBe(3_600);
      expect(last?.reason).toBe('ok');
    });
  });

  describe('a move that cannot happen', () => {
    it('refuses to move a connection that is not seated anywhere', () => {
      const router = new Router();
      const migration = new Migration(router);
      const op = session();

      expect(migration.move(op.session, match(), 10, 20)).toBe(false);
      expect(migration.log[0]?.reason).toBe('not seated anywhere');
      expect(migration.log[0]?.fromMatch).toBe(-1);
    });

    it('is a quiet success when the player is already in the destination', () => {
      // The flow asks for this when a player joined during a migration and was already put in
      // the destination: not a failure, and not worth a record.
      const from = arena();
      const { migration, op } = seated(from);

      expect(migration.move(op.session, from, 10, 20)).toBe(true);
      expect(migration.log).toHaveLength(0);
    });

    it('never disconnects a player whose move failed', () => {
      const from = arena();
      const { migration, op } = seated(from);
      // A destination that refuses every seat.
      const full = { id: 9 as MatchId, seat: () => null } as unknown as LiveMatch;

      expect(migration.move(op.session, full, 10, 20)).toBe(false);

      expect(op.closed).toBeNull();
      expect(op.notices).toContain('Could not join the match — staying in the arena.');
    });

    it('puts a refused mover back where they came from, as a fresh seat', () => {
      // The old entity is gone, so the restore is a respawn in the arena — a visible respawn
      // beats a player who exists in no world and whose commands are routed to null.
      const from = arena();
      const { router, migration, op } = seated(from);
      const full = { id: 9 as MatchId, seat: () => null } as unknown as LiveMatch;

      migration.move(op.session, full, 10, 20);

      expect(router.instanceOf(op.session.playerId)).toBe(from);
      expect(from.playerCount).toBe(1);
      expect(migration.log[0]?.reason).toBe('destination full');
    });
  });

  describe('the record log', () => {
    it('keeps the newest records and drops the oldest past its cap', () => {
      // A 12-hour soak runs roughly 720 cycles and migrates every player twice per cycle. An
      // unbounded array is a slow leak in the tool that exists to prove there are none.
      const from = arena();
      const router = new Router();
      const migration = new Migration(router);
      const op = session();

      // 600 failed moves is the cheapest way to fill the log past 512 — and they fail at the
      // first line, so no world is touched.
      for (let i = 0; i < 600; i++) migration.move(op.session, from, i, 20);

      expect(migration.log.length).toBeLessThanOrEqual(512);
      expect(migration.log.length).toBeGreaterThan(0);
    });
  });

  describe('seatInfo', () => {
    it('describes the destination, not the origin', () => {
      const to = match(5);
      const info = seatInfo(to, 7, 'B', 3_600, 20, true);

      expect(info.matchId).toBe(5);
      expect(info.entityId).toBe(7);
      expect(info.team).toBe('B');
      expect(info.mapId).toBe(to.match.mapEntry.id);
      expect(info.modeId).toBe(to.match.modeEntry.id);
      expect(info.snapshotHz).toBe(20);
      // The named tick, twice: the client needs both the stamp and the moment it applies.
      expect(info.serverTick).toBe(3_600);
      expect(info.effectiveTick).toBe(3_600);
      expect(info.migrated).toBe(true);
    });
  });
});
