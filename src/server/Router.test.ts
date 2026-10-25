import { describe, expect, it } from 'vitest';
import { installLogSink, type LogLevel } from '../shared/core/Log';
import type { MatchId } from '../shared/net/Skirmish';
import type { MatchInstance, UnseatCause } from './instance/MatchInstance';
import type { PlayerId, Session } from './net/Session';
import { Router } from './Router';

/**
 * The one answer to "which instance is this connection in" (B8).
 *
 * §4.18: *"A player belongs to **exactly one instance on every tick**. Never zero, never two.
 * There is no intermediate state where a player is 'between' instances."* That invariant needs
 * a single owner or it is not an invariant, and this class is it — so the tests are organised
 * around the two halves of the rule and around what the class does when it is broken anyway.
 *
 * The instances are faked structurally: the router only ever reads `id` and calls `unseat`, and
 * a real `MatchInstance` would drag a whole world in for no added assurance. What a fake does
 * buy is the ability to **assert the unseat**, including its cause, which is the part a
 * migration gets wrong silently.
 */

const logLines: Array<{ level: LogLevel; message: string }> = [];

installLogSink({
  log(level: LogLevel, _tag: string, message: string): void {
    logLines.push({ level, message });
  },
});

interface FakeInstance {
  readonly instance: MatchInstance;
  readonly unseated: Array<{ playerId: number; cause: UnseatCause }>;
}

function instance(id: number): FakeInstance {
  const unseated: Array<{ playerId: number; cause: UnseatCause }> = [];
  const fake = {
    id: id as MatchId,
    unseat(playerId: number, cause: UnseatCause): void {
      unseated.push({ playerId, cause });
    },
  };
  return { instance: fake as unknown as MatchInstance, unseated };
}

function session(playerId: number, displayName = `OP${playerId}`): Session {
  return { playerId: playerId as PlayerId, displayName } as unknown as Session;
}

describe('Router', () => {
  describe('admitting', () => {
    it('records which instance a connection is in', () => {
      const router = new Router();
      const arena = instance(0);
      const op = session(1);

      router.admit(op, arena.instance);

      expect(router.instanceOf(op.playerId)).toBe(arena.instance);
      expect(router.playerCount).toBe(1);
    });

    it('answers null for a connection it has never seen', () => {
      const router = new Router();
      expect(router.instanceOf(42 as PlayerId)).toBeNull();
      expect(router.playerCount).toBe(0);
    });

    it('treats a second admit as a move, loudly', () => {
      // The "never two" half of the invariant. A join that silently succeeded when the player
      // was already somewhere would break the invariant quietly rather than loudly.
      const router = new Router();
      const arena = instance(0);
      const live = instance(1);
      const op = session(1);
      router.admit(op, arena.instance);
      logLines.length = 0;

      router.admit(op, live.instance);

      expect(router.instanceOf(op.playerId)).toBe(live.instance);
      expect(router.playerCount).toBe(1);
      // Released from the old one as a *migration*, so nothing puts a bot in their place.
      expect(arena.unseated).toEqual([{ playerId: 1, cause: 'migrated' }]);
      expect(logLines.some((l) => l.level === 'error')).toBe(true);
    });
  });

  describe('releasing', () => {
    it('unseats from whatever instance holds the connection', () => {
      const router = new Router();
      const arena = instance(0);
      const op = session(1);
      router.admit(op, arena.instance);

      router.release(op.playerId);

      expect(router.instanceOf(op.playerId)).toBeNull();
      expect(router.playerCount).toBe(0);
      expect(arena.unseated).toEqual([{ playerId: 1, cause: 'disconnected' }]);
    });

    it('defaults to a disconnect and takes a migration when told', () => {
      const router = new Router();
      const arena = instance(0);
      const op = session(1);
      router.admit(op, arena.instance);

      router.release(op.playerId, 'migrated');

      expect(arena.unseated[0]?.cause).toBe('migrated');
    });

    it('is idempotent, because a disconnect during a migration reaches here twice', () => {
      const router = new Router();
      const arena = instance(0);
      const op = session(1);
      router.admit(op, arena.instance);

      router.release(op.playerId);
      router.release(op.playerId);

      expect(arena.unseated).toHaveLength(1);
    });
  });

  describe('noteMoved', () => {
    it('points at the new instance without unseating anything', () => {
      // `Migration` has already released the old seat and created the new one; a method that
      // unseated here would open the "never zero" window inside itself.
      const router = new Router();
      const arena = instance(0);
      const live = instance(1);
      const op = session(1);
      router.admit(op, arena.instance);

      router.noteMoved(op.playerId, live.instance);

      expect(router.instanceOf(op.playerId)).toBe(live.instance);
      expect(arena.unseated).toHaveLength(0);
    });
  });

  describe('addressing an instance', () => {
    it('allows a message for the instance the sender is in', () => {
      const router = new Router();
      const live = instance(3);
      const op = session(1);
      router.admit(op, live.instance);

      expect(router.mayAddress(op, 3 as MatchId)).toBe(true);
      expect(router.misroutedMessages).toBe(0);
    });

    it('refuses one for any other instance, and counts it (§8.15)', () => {
      // Not hypothetical: a client mid-migration has a `Prepare` for match 3 and a seat in
      // match 0, and a stale `Ready` for a destroyed match is the ordinary case.
      const router = new Router();
      const arena = instance(0);
      const op = session(1);
      router.admit(op, arena.instance);

      expect(router.mayAddress(op, 3 as MatchId)).toBe(false);
      expect(router.misroutedMessages).toBe(1);
    });

    it('refuses one from a connection that is in no instance at all', () => {
      const router = new Router();
      expect(router.mayAddress(session(9), 0 as MatchId)).toBe(false);
      expect(router.misroutedMessages).toBe(1);
    });

    it('counts every refusal, because the number is what §8.15 asks for', () => {
      const router = new Router();
      const op = session(1);
      router.mayAddress(op, 1 as MatchId);
      router.mayAddress(op, 2 as MatchId);
      expect(router.misroutedMessages).toBe(2);
    });
  });
});
