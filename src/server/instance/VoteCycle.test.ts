import { describe, expect, it, vi } from 'vitest';
import {
  MAP_BALLOT,
  MODE_BALLOT,
  VOTE_CYCLE_CONFIG,
  VotePhase,
  type VoteCycleConfig,
} from '../../shared/net/Skirmish';
import { VoteCycle, type VoteCycleDeps, type VoteResolution } from './VoteCycle';

/**
 * The 60 s cycle (B4).
 *
 * Everything the class promises is a property of *when* it changes phase and *what* it counts,
 * so the tests drive it the way the server does — one `step` per master tick — and read the
 * public surface the vote broadcast is built from (`phase`, `endsTick`, `tally`, `decided`).
 *
 * Three claims get the most attention, because they are the ones a client cannot check for
 * itself:
 *
 *  - **A phase boundary is an absolute tick, not an elapsed duration.** §4.20: *"Two clients
 *    must never see different numbers."* So a boundary is asserted as tick arithmetic,
 *    including for a cycle stepped sparsely rather than once per tick.
 *  - **One vote per player is a property of the data structure.** A client that sends a hundred
 *    votes moves one entry, because the tally is a `Map` keyed by player id.
 *  - **A tie is broken reproducibly from one seed.** §4.20 asks that *"a disputed outcome can
 *    be reconstructed rather than argued about"*, which is only true if one seed gives one
 *    answer. The pinned pair below is what reconstruction means: two ties in one cycle draw
 *    from one advancing stream, not twice from the same number.
 */

/**
 * The two options seed 77 draws for a two-way tie on the mode ballot and then on the map
 * ballot, in that order.
 *
 * Observed from the current code and pinned as a pair, because the pair is the proof. Both
 * draws are offered the same candidate set — `[0, 1]` — and they come out **different**, which
 * a reseeded stream could not do. A change to the number or order of `Rng` calls inside the
 * resolver moves these two numbers.
 */
const PINNED_SEED_77 = { mode: 1, map: 0 };

const PLAY_TICKS = Math.round(VOTE_CYCLE_CONFIG.playSeconds * 60);
const MODE_VOTE_TICKS = Math.round(VOTE_CYCLE_CONFIG.modeVoteSeconds * 60);
const MAP_VOTE_TICKS = Math.round(VOTE_CYCLE_CONFIG.mapVoteSeconds * 60);

interface Harness {
  readonly cycle: VoteCycle;
  readonly resolved: VoteResolution[];
  readonly aborted: string[];
  humans: number;
}

function harness(overrides: Partial<VoteCycleDeps> = {}): Harness {
  const resolved: VoteResolution[] = [];
  const aborted: string[] = [];
  const state = { humans: 1 };
  const deps: VoteCycleDeps = {
    humanCount: () => state.humans,
    onResolved: (r) => resolved.push(r),
    seed: 1234,
    onAborted: (reason) => aborted.push(reason),
    ...overrides,
  };
  const cycle = new VoteCycle(deps);
  return {
    cycle,
    resolved,
    aborted,
    get humans() {
      return state.humans;
    },
    set humans(v: number) {
      state.humans = v;
    },
  };
}

/** Drive a fresh cycle to the tick the mode vote opens on, and return that tick. */
function openModeVote(h: Harness, startTick = 1_000): number {
  h.cycle.step(startTick);
  const boundary = startTick + PLAY_TICKS;
  h.cycle.step(boundary);
  return boundary;
}

/** Drive a fresh cycle to the tick the map vote opens on, and return that tick. */
function openMapVote(h: Harness, startTick = 1_000): number {
  const boundary = openModeVote(h, startTick) + MODE_VOTE_TICKS;
  h.cycle.step(boundary);
  return boundary;
}

describe('VoteCycle', () => {
  describe('the idle arena', () => {
    it('starts idle, with nothing decided and no cycle counted', () => {
      const h = harness();
      expect(h.cycle.phase).toBe(VotePhase.IDLE);
      expect(h.cycle.endsTick).toBe(0);
      expect(h.cycle.cycle).toBe(0);
      expect(h.cycle.decided).toEqual({ mode: -1, map: -1 });
    });

    it('stays idle for as long as the arena is empty', () => {
      const h = harness();
      h.humans = 0;
      for (let tick = 0; tick < 10_000; tick += 100) h.cycle.step(tick);
      expect(h.cycle.phase).toBe(VotePhase.IDLE);
      expect(h.cycle.cycle).toBe(0);
    });

    it('starts a cycle on the first human to arrive', () => {
      const h = harness();
      h.cycle.step(1_000);
      expect(h.cycle.phase).toBe(VotePhase.PLAY);
      expect(h.cycle.cycle).toBe(1);
      expect(h.cycle.endsTick).toBe(1_000 + PLAY_TICKS);
    });
  });

  describe('the phase boundaries', () => {
    it('holds free play until the deadline tick, then opens the mode vote', () => {
      const h = harness();
      h.cycle.step(1_000);
      h.cycle.step(1_000 + PLAY_TICKS - 1);
      expect(h.cycle.phase).toBe(VotePhase.PLAY);

      h.cycle.step(1_000 + PLAY_TICKS);
      expect(h.cycle.phase).toBe(VotePhase.MODE_VOTE);
      expect(h.cycle.endsTick).toBe(1_000 + PLAY_TICKS + MODE_VOTE_TICKS);
    });

    it('opens the map vote when the mode ballot closes', () => {
      const h = harness();
      const opened = openMapVote(h);
      expect(h.cycle.phase).toBe(VotePhase.MAP_VOTE);
      expect(h.cycle.endsTick).toBe(opened + MAP_VOTE_TICKS);
    });

    it('reads a deadline that has already passed rather than starting a fresh window', () => {
      // A sparsely stepped cycle — the §8.5 case of a client connecting at second 47 — must not
      // restart the phase it arrives in. The next boundary is derived from the tick the phase
      // was opened on, which here is 500 ticks after the one that was due.
      const h = harness();
      h.cycle.step(1_000);
      h.cycle.step(1_000 + PLAY_TICKS + 500);
      expect(h.cycle.phase).toBe(VotePhase.MODE_VOTE);
      expect(h.cycle.endsTick).toBe(1_000 + PLAY_TICKS + 500 + MODE_VOTE_TICKS);
    });

    it('uses an injected config in place of the shipped one', () => {
      const config: VoteCycleConfig = { playSeconds: 2, modeVoteSeconds: 1, mapVoteSeconds: 1 };
      const h = harness({ config });
      h.cycle.step(0);
      expect(h.cycle.endsTick).toBe(120);
      h.cycle.step(120);
      expect(h.cycle.phase).toBe(VotePhase.MODE_VOTE);
      expect(h.cycle.endsTick).toBe(180);
    });

    it('holds in ALLOCATING with no deadline of its own', () => {
      const h = harness();
      const opened = openMapVote(h);
      h.cycle.step(opened + MAP_VOTE_TICKS);
      expect(h.cycle.phase).toBe(VotePhase.ALLOCATING);
      expect(h.resolved).toHaveLength(1);

      // Far past any plausible deadline: the allocator's latency is not this class's to guess.
      h.cycle.step(opened + 100_000);
      expect(h.cycle.phase).toBe(VotePhase.ALLOCATING);
      expect(h.resolved).toHaveLength(1);
    });
  });

  describe('an arena that empties', () => {
    const openers = [
      ['PLAY', (h: Harness) => void h.cycle.step(1_000)],
      ['MODE_VOTE', (h: Harness) => void openModeVote(h)],
      ['MAP_VOTE', (h: Harness) => void openMapVote(h)],
    ] as const;

    for (const [name, open] of openers) {
      it(`cancels the cycle in ${name} and returns to idle`, () => {
        const h = harness();
        open(h);
        h.cycle.castVote(7, h.cycle.phase, 0);
        h.humans = 0;

        h.cycle.step(2_000);
        expect(h.cycle.phase).toBe(VotePhase.IDLE);
        expect(h.cycle.endsTick).toBe(0);
        expect(h.cycle.decided).toEqual({ mode: -1, map: -1 });
        expect(h.cycle.voteOf(7)).toBe(-1);
        expect(h.resolved).toHaveLength(0);
      });
    }

    it('cancels in ALLOCATING too, so no match is built for nobody', () => {
      const h = harness();
      const opened = openMapVote(h);
      h.cycle.step(opened + MAP_VOTE_TICKS);
      expect(h.cycle.phase).toBe(VotePhase.ALLOCATING);

      h.humans = 0;
      h.cycle.step(opened + MAP_VOTE_TICKS + 1);
      expect(h.cycle.phase).toBe(VotePhase.IDLE);
    });

    it('counts the next cycle as a new one when a human comes back', () => {
      const h = harness();
      h.cycle.step(1_000);
      h.humans = 0;
      h.cycle.step(1_001);
      h.humans = 1;
      h.cycle.step(1_002);
      expect(h.cycle.phase).toBe(VotePhase.PLAY);
      expect(h.cycle.cycle).toBe(2);
    });
  });

  describe('casting a vote', () => {
    it('is refused outside a ballot phase', () => {
      const h = harness();
      expect(h.cycle.castVote(1, VotePhase.IDLE, 0)).toBe(false);
      h.cycle.step(1_000);
      expect(h.cycle.castVote(1, VotePhase.PLAY, 0)).toBe(false);
      expect(h.cycle.voteOf(1)).toBe(-1);
    });

    it('is refused when the client names a phase the server is not in', () => {
      const h = harness();
      openModeVote(h);
      expect(h.cycle.castVote(1, VotePhase.MAP_VOTE, 0)).toBe(false);
      expect(h.cycle.tally()).toEqual(new Array<number>(MODE_BALLOT.length).fill(0));
    });

    it('is accepted inside the window and shows in the tally', () => {
      const h = harness();
      openModeVote(h);
      expect(h.cycle.castVote(1, VotePhase.MODE_VOTE, 2)).toBe(true);
      expect(h.cycle.voteOf(1)).toBe(2);
      expect(h.cycle.tally()[2]).toBe(1);
    });

    it('is refused for an option off the end of the ballot', () => {
      const h = harness();
      openModeVote(h);
      expect(h.cycle.castVote(1, VotePhase.MODE_VOTE, MODE_BALLOT.length)).toBe(false);
      expect(h.cycle.castVote(1, VotePhase.MODE_VOTE, -1)).toBe(false);
      expect(h.cycle.voteOf(1)).toBe(-1);
    });

    it('is refused for an option that is not an integer', () => {
      const h = harness();
      openModeVote(h);
      expect(h.cycle.castVote(1, VotePhase.MODE_VOTE, 1.5)).toBe(false);
      expect(h.cycle.castVote(1, VotePhase.MODE_VOTE, Number.NaN)).toBe(false);
      expect(h.cycle.castVote(1, VotePhase.MODE_VOTE, Number.POSITIVE_INFINITY)).toBe(false);
      expect(h.cycle.voteOf(1)).toBe(-1);
    });

    it('validates against the map ballot once the map vote is open', () => {
      // The two ballots are different lengths, so the accepted range moves with the phase.
      const h = harness();
      openMapVote(h);
      expect(MAP_BALLOT.length).toBeLessThan(MODE_BALLOT.length);
      expect(h.cycle.castVote(1, VotePhase.MAP_VOTE, MAP_BALLOT.length - 1)).toBe(true);
      expect(h.cycle.castVote(2, VotePhase.MAP_VOTE, MAP_BALLOT.length)).toBe(false);
      expect(h.cycle.tally()).toHaveLength(MAP_BALLOT.length);
    });

    it('lets a player change their mind inside the window, without counting twice', () => {
      const h = harness();
      openModeVote(h);
      h.cycle.castVote(1, VotePhase.MODE_VOTE, 0);
      h.cycle.castVote(1, VotePhase.MODE_VOTE, 3);
      expect(h.cycle.voteOf(1)).toBe(3);
      expect(h.cycle.tally()[0]).toBe(0);
      expect(h.cycle.tally()[3]).toBe(1);
    });

    it('moves one entry however many times one client votes', () => {
      const h = harness();
      openModeVote(h);
      for (let i = 0; i < 100; i++) {
        h.cycle.castVote(9, VotePhase.MODE_VOTE, i % MODE_BALLOT.length);
      }
      const total = h.cycle.tally().reduce((sum, n) => sum + n, 0);
      expect(total).toBe(1);
    });

    it('forgets a departed player so they cannot swing the tally', () => {
      const h = harness();
      openModeVote(h);
      h.cycle.castVote(1, VotePhase.MODE_VOTE, 1);
      h.cycle.castVote(2, VotePhase.MODE_VOTE, 1);
      expect(h.cycle.tally()[1]).toBe(2);

      h.cycle.forget(1);
      expect(h.cycle.tally()[1]).toBe(1);
      expect(h.cycle.voteOf(1)).toBe(-1);
    });

    it('clears the per-player votes between phases but keeps the decided mode', () => {
      // §6.4: players choose a map knowing the mode, which is the reason for sequencing them.
      const h = harness();
      openModeVote(h);
      h.cycle.castVote(1, VotePhase.MODE_VOTE, 1);
      openMapVote(h);
      expect(h.cycle.voteOf(1)).toBe(-1);
      expect(h.cycle.decided.mode).toBe(1);
      expect(h.cycle.decided.map).toBe(-1);
    });
  });

  describe('resolving a ballot', () => {
    it('gives it to the outright winner', () => {
      const h = harness();
      openModeVote(h);
      h.cycle.castVote(1, VotePhase.MODE_VOTE, 4);
      h.cycle.castVote(2, VotePhase.MODE_VOTE, 4);
      h.cycle.castVote(3, VotePhase.MODE_VOTE, 0);
      openMapVote(h);
      expect(h.cycle.decided.mode).toBe(4);
    });

    it('hands the allocator the ids the two winning indices name', () => {
      const h = harness();
      openModeVote(h);
      h.cycle.castVote(1, VotePhase.MODE_VOTE, 1);
      const mapOpened = openMapVote(h);
      h.cycle.castVote(1, VotePhase.MAP_VOTE, 2);
      h.cycle.step(mapOpened + MAP_VOTE_TICKS);

      expect(h.resolved).toEqual([{ modeId: MODE_BALLOT[1], mapId: MAP_BALLOT[2] }]);
      expect(h.cycle.decided).toEqual({ mode: 1, map: 2 });
      expect(h.aborted).toHaveLength(0);
    });

    it('breaks a tie the same way twice from the same seed', () => {
      const run = (): number => {
        const h = harness({ seed: 4242 });
        openModeVote(h);
        h.cycle.castVote(1, VotePhase.MODE_VOTE, 0);
        h.cycle.castVote(2, VotePhase.MODE_VOTE, 3);
        openMapVote(h);
        return h.cycle.decided.mode;
      };
      const first = run();
      expect(run()).toBe(first);
      expect([0, 3]).toContain(first);
    });

    it('advances the draw stream per pick rather than reseeding it', () => {
      // Two ties in one cycle must not both draw the first number out of one seed. The mode
      // tie and the map tie are pinned as a pair, which is what "advance it by the logged draw
      // index" means in §4.20.
      const h = harness({ seed: 77 });
      openModeVote(h);
      h.cycle.castVote(1, VotePhase.MODE_VOTE, 0);
      h.cycle.castVote(2, VotePhase.MODE_VOTE, 1);
      const mapOpened = openMapVote(h);
      h.cycle.castVote(1, VotePhase.MAP_VOTE, 0);
      h.cycle.castVote(2, VotePhase.MAP_VOTE, 1);
      h.cycle.step(mapOpened + MAP_VOTE_TICKS);

      expect(h.cycle.decided).toEqual(PINNED_SEED_77);
    });

    it('draws among every option when nobody voted at all', () => {
      // "Everybody tied on zero" is what an empty ballot is, and it goes through the same draw.
      const h = harness({ seed: 99 });
      openMapVote(h);
      expect(h.cycle.decided.mode).toBeGreaterThanOrEqual(0);
      expect(h.cycle.decided.mode).toBeLessThan(MODE_BALLOT.length);
    });

    it('resolves an unvoted cycle end to end without aborting', () => {
      const h = harness({ seed: 5 });
      const mapOpened = openMapVote(h);
      h.cycle.step(mapOpened + MAP_VOTE_TICKS);
      expect(h.resolved).toHaveLength(1);
      expect(MODE_BALLOT).toContain(h.resolved[0]?.modeId);
      expect(MAP_BALLOT).toContain(h.resolved[0]?.mapId);
      expect(h.aborted).toHaveLength(0);
    });
  });

  describe('coming back from allocation', () => {
    it('starts the next cycle, counted as a new one', () => {
      const h = harness();
      const opened = openMapVote(h);
      h.cycle.step(opened + MAP_VOTE_TICKS);
      expect(h.cycle.cycle).toBe(1);

      h.cycle.resume(50_000);
      expect(h.cycle.phase).toBe(VotePhase.PLAY);
      expect(h.cycle.cycle).toBe(2);
      expect(h.cycle.endsTick).toBe(50_000 + PLAY_TICKS);
      expect(h.cycle.decided).toEqual({ mode: -1, map: -1 });
    });

    it('resolves once per cycle, and a second time after a resume', () => {
      const h = harness();
      const opened = openMapVote(h);
      h.cycle.step(opened + MAP_VOTE_TICKS);
      h.cycle.resume(50_000);

      const second = 50_000 + PLAY_TICKS;
      h.cycle.step(second);
      h.cycle.step(second + MODE_VOTE_TICKS);
      h.cycle.step(second + MODE_VOTE_TICKS + MAP_VOTE_TICKS);
      expect(h.resolved).toHaveLength(2);
    });

    it('goes idle on demand, forgetting the ballot', () => {
      const h = harness();
      openModeVote(h);
      h.cycle.castVote(1, VotePhase.MODE_VOTE, 1);
      h.cycle.toIdle();
      expect(h.cycle.phase).toBe(VotePhase.IDLE);
      expect(h.cycle.endsTick).toBe(0);
      expect(h.cycle.voteOf(1)).toBe(-1);
      expect(h.cycle.decided).toEqual({ mode: -1, map: -1 });
    });
  });

  describe('the abort path', () => {
    it('does not fire, because a resolved index is always on its ballot', () => {
      // `onAborted` fires only when a resolved index names no ballot entry. The resolver always
      // returns an index inside the array it was handed, and both ballots are validated against
      // the registry at module load, so no input reaches it. Asserted as "never fires over a
      // full cycle" rather than left uncovered, so that the day the resolver changes shape this
      // is the test that notices.
      const onAborted = vi.fn();
      const h = harness({ seed: 31, onAborted });
      const opened = openMapVote(h);
      h.cycle.step(opened + MAP_VOTE_TICKS);
      expect(onAborted).not.toHaveBeenCalled();
      expect(h.cycle.phase).toBe(VotePhase.ALLOCATING);
    });
  });
});
