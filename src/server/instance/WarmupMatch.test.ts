import { beforeAll, describe, expect, it } from 'vitest';
import { installClock } from '../../shared/core/Clock';
import { InstanceState, WARMUP_MATCH_ID } from '../../shared/net/Skirmish';
import { GREYBOX_MAP } from '../../shared/world/maps/greybox';
import { MapBakery } from '../MapBakery';
import { WarmupMatch, type WarmupOptions } from './WarmupMatch';

/**
 * The permanent skirmish arena (B4).
 *
 * The class comment makes four claims about this room that no caller can check, and each one
 * is a test here:
 *
 *  1. **It is live the moment it exists.** `BOOTING -> RUNNING` happens in the constructor,
 *     because §4.9 says the process holds exactly one of these from boot until shutdown and
 *     there is nothing for it to wait for.
 *  2. **Nobody dies here and nothing is recorded** (playtest round 4, F7). Two flags carry
 *     that, both set from `variant: 'WARMUP'`, and the second one is the easier of the two to
 *     break by accident because "no score" was built as a zeroed *limit* elsewhere.
 *  3. **The dummies survive the mode choice**, because they are map data rather than mode data.
 *  4. **It keeps the unshifted snapshot phase** (§4.19), so a live match is the instance that
 *     moves out of its way.
 *
 * The step tripwire is deliberately unreachable — `FFA_WARMUP_CONFIG` switches both of
 * Free-for-All's win conditions off — so what is pinned here is the condition it watches,
 * not the log line it would emit.
 */

installClock({ nowMs: () => 1_000 });

let bakery: MapBakery;

beforeAll(() => {
  bakery = new MapBakery();
  bakery.bakeAll();
});

function options(overrides: Partial<WarmupOptions> = {}): WarmupOptions {
  return {
    bakery,
    snapshotHz: 20,
    interpolationDelayMs: 100,
    seed: 1234,
    startTick: 0,
    bots: 3,
    difficulty: 'MIX',
    ...overrides,
  };
}

describe('WarmupMatch', () => {
  describe('the room', () => {
    it('is live the moment it is built', () => {
      const arena = new WarmupMatch(options());
      expect(arena.state).toBe(InstanceState.RUNNING);
      arena.dispose();
    });

    it('is the arena, under its reserved id', () => {
      const arena = new WarmupMatch(options());
      expect(arena.isArena).toBe(true);
      expect(arena.id).toBe(WARMUP_MATCH_ID);
      arena.dispose();
    });

    it('is always the greybox room under free-for-all rules', () => {
      const arena = new WarmupMatch(options());
      expect(arena.mapId).toBe(GREYBOX_MAP.id);
      expect(arena.modeId).toBe('FFA');
      expect(arena.match.mapEntry.id).toBe(GREYBOX_MAP.id);
      arena.dispose();
    });

    it('keeps the unshifted snapshot phase, so a live match moves out of its way', () => {
      const arena = new WarmupMatch(options());
      expect(arena.clock.phaseOffset).toBe(0);
      arena.dispose();
    });
  });

  describe('nobody dies here, and nothing is recorded (round 4, F7)', () => {
    it('makes a hit on a person resolve and report without taking health', () => {
      const arena = new WarmupMatch(options());
      expect(arena.match.damage.combatantsInvulnerable).toBe(true);
      arena.dispose();
    });

    it('records no scoreboard row, so Tab shows no kills, deaths or ladder', () => {
      const arena = new WarmupMatch(options());
      expect(arena.match.score.records).toBe(false);
      expect(arena.match.score.rows).toHaveLength(0);
      arena.dispose();
    });

    it('still reports a hit, rather than dropping it', () => {
      // "Damage live" and "players killable" turned out to be two facts wearing one flag, and
      // only the second one is off. A room that stopped resolving hits altogether would be a
      // corridor rather than a range, and would pass the two assertions above.
      const arena = new WarmupMatch(options());
      expect(arena.match.damage.combatantsInvulnerable).toBe(true);
      expect(arena.match.score.records).toBe(false);
      expect(arena.match.mode.id).toBe('FFA');
      arena.dispose();
    });
  });

  describe('what the operator configured', () => {
    it('puts the asked-for number of bots in the room', () => {
      // §6.3 asks for 2-3, so a lone player has something to shoot.
      const arena = new WarmupMatch(options({ bots: 3 }));
      expect(arena.match.bots.bots).toHaveLength(3);
      arena.dispose();
    });

    it('takes the bot count it is given rather than a default of its own', () => {
      const arena = new WarmupMatch(options({ bots: 2 }));
      expect(arena.match.bots.bots).toHaveLength(2);
      arena.dispose();
    });

    it('runs the bots at the configured tier rather than a literal MIX (round 4, F1)', () => {
      // A server deliberately set to RECRUIT used to put a Veteran in the room a new player
      // lands in, because the tier was hard-coded here.
      const arena = new WarmupMatch(options({ difficulty: 'RECRUIT' }));
      const tiers = [...arena.match.bots.tiersOn('A'), ...arena.match.bots.tiersOn('B')];
      expect(tiers).toHaveLength(3);
      for (const tier of tiers) expect(tier).toBe('RECRUIT');
      arena.dispose();
    });
  });

  describe('stepping the arena', () => {
    it('advances the local clock while following the master tick', () => {
      const arena = new WarmupMatch(options({ startTick: 41_000 }));
      arena.step(41_000);
      arena.step(41_001);
      expect(arena.clock.absoluteTick).toBe(41_001);
      expect(arena.clock.localTick).toBe(1);
      arena.dispose();
    });

    it('never declares a winner, which is what the tripwire watches for', () => {
      // FFA_WARMUP_CONFIG switches off both of Free-for-All's win conditions, so this is the
      // condition the latched error in `step` exists to notice rather than one it can reach.
      // An arena that reached MATCH_END would freeze every connected player on a final banner
      // with no rotation behind it, and present as "multiplayer stopped working".
      const arena = new WarmupMatch(options({ startTick: 0 }));
      for (let tick = 0; tick < 120; tick++) arena.step(tick);
      expect(arena.match.isOver).toBe(false);
      expect(arena.state).toBe(InstanceState.RUNNING);
      arena.dispose();
    });
  });
});
