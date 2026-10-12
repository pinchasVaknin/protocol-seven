import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { createGameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { GREYBOX_MAP } from '../world/maps/greybox';
import type { Combatant } from '../ai/Combatant';
import { FFA_CONFIG, FFA_WARMUP_CONFIG, FreeForAll } from './FreeForAll';
import type { KillEvent, ModeDeps } from './GameMode';

/**
 * Free-for-All, pinned — and with it the warmup arena, which is this mode with its limits off.
 *
 * Two things here are easy to get wrong and both have a history:
 *
 *  - **FFA crowns an individual.** `individualWinner` is what `MatchOutcome` reads to give
 *    everybody else a *place* instead of DEFEAT, and bug 4.4 was four surfaces comparing sides
 *    instead: *"in Free-for-All everybody on the winner's side reads VICTORY"*. A tie at the top
 *    crowns nobody, because two winners is not what the word means.
 *  - **Zero means absent, not immediate.** The warmup arena sets both limits to zero, and
 *    `checkWinCondition` has to read that as "there is nothing to count toward" rather than
 *    "the limit has already been reached". The rejected alternative was a very large limit — a
 *    lie that comes true after twelve hours under the soak harness, in the one world that has
 *    no path to DESTROYED.
 *
 * FFA keeps the two-team substrate, so `teamScore` still answers: it is the best individual on
 * that side, which is what the substrate can honestly say about a mode with no sides.
 */

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

function body(entityId: number, team: 'A' | 'B'): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(0, 0, 0, 0);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team,
    px: 0,
    py: 0,
    pz: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

const SEATS: ReadonlyArray<readonly [number, 'A' | 'B']> = [
  [0, 'A'],
  [100, 'A'],
  [200, 'B'],
  [201, 'B'],
];

interface Rig {
  readonly mode: FreeForAll;
  readonly score: ScoreSystem;
}

function rig(config = FFA_CONFIG, over: Partial<ModeDeps> = {}): Rig {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  const roster: Combatant[] = SEATS.map(([id, team]) => body(id, team));
  for (const c of roster) score.register(c.entityId, c.displayName, c.team);
  const deps: ModeDeps = { bus, score, roster, mapDef: GREYBOX_MAP, ...over };
  return { mode: new FreeForAll(deps, config), score };
}

/** `n` kills credited to `killerId`, through the mode. */
function kills(mode: FreeForAll, killerId: number, victimId: number, n: number): void {
  const ev: KillEvent = {
    killerId,
    victimId,
    weaponId: 'ar_carbine',
    zone: 'torso',
    killerTeam: killerId < 200 ? 'A' : 'B',
    victimTeam: victimId < 200 ? 'A' : 'B',
    headshot: false,
    suicide: false,
    friendly: false,
  };
  for (let i = 0; i < n; i++) mode.onKill(ev);
}

describe('what FFA declares it is', () => {
  it('is one round, no swap, unlimited lives, and eight bodies', () => {
    const { mode } = rig();
    expect(mode.id).toBe('FFA');
    expect(mode.roundsToWin).toBe(1);
    expect(mode.swapSidesAfterRound).toBe(null);
    expect(mode.livesPerRound).toBe(Infinity);
    expect(FFA_CONFIG.playerCount).toBe(8);
  });

  it('runs to thirty kills over ten minutes', () => {
    const { mode } = rig();
    expect(mode.scoreLimit).toBe(30);
    expect(mode.roundSeconds).toBe(600);
  });

  it('has no objectives of any kind', () => {
    const { mode } = rig();
    expect(mode.objectiveZones).toEqual([]);
    expect(mode.headerSlots).toEqual([]);
    expect(mode.dogTags).toBe(null);
    expect(mode.bombInfo).toBe(null);
  });
});

describe('crowning an individual', () => {
  it('names the clear leader, by kills', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 100, 200, 3);
    kills(mode, 200, 0, 1);
    expect(mode.individualWinner()).toBe(100);
  });

  it('crowns nobody while the top is tied', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 100, 200, 2);
    kills(mode, 200, 100, 2);
    expect(mode.individualWinner()).toBeUndefined();
  });

  it('crowns nobody before a shot is fired', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    expect(mode.individualWinner()).toBeUndefined();
  });

  it('carries the winner into the result, so a place can be derived from it', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 100, 200, 30);
    const result = mode.checkWinCondition();
    expect(result?.kind).toBe('match');
    if (result === null || result.kind !== 'match') return;
    expect(result.reason).toBe('Kill limit');
    expect(result.winnerEntityId).toBe(100);
  });
});

describe('deciding the match', () => {
  it('is undecided while nobody is near the limit', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 100, 200, 5);
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('ends on the kill that reaches the limit', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 100, 200, 29);
    expect(mode.checkWinCondition()).toBe(null);
    kills(mode, 100, 200, 1);
    expect(mode.checkWinCondition()?.winner).toBe('A');
  });

  it('ends on the clock with the leader winning on time', () => {
    const { mode } = rig(FFA_CONFIG, { roundSecondsOverride: DT });
    mode.onRoundStart(1);
    kills(mode, 200, 0, 2);
    mode.onTick(1);
    const result = mode.checkWinCondition();
    expect(result?.kind).toBe('match');
    if (result === null || result.kind !== 'match') return;
    expect(result.reason).toBe('Time limit');
    expect(result.winnerEntityId).toBe(200);
  });

  it('ends a tied clock as a draw, with nobody crowned', () => {
    const { mode } = rig(FFA_CONFIG, { roundSecondsOverride: DT });
    mode.onRoundStart(1);
    kills(mode, 100, 200, 2);
    kills(mode, 200, 100, 2);
    mode.onTick(1);
    const result = mode.checkWinCondition();
    expect(result?.winner).toBe('DRAW');
    expect(result?.reason).toBe('Time — draw');
  });

  it('reports a side as its best individual, which is all the substrate can say', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 100, 200, 4);
    kills(mode, 0, 201, 2);
    expect(mode.teamScore('A')).toBe(4);
    expect(mode.teamScore('B')).toBe(0);
  });
});

describe('the warmup arena, which is FFA with its limits off', () => {
  it('declares both limits absent, and a small room', () => {
    expect(FFA_WARMUP_CONFIG.scoreLimit).toBe(0);
    expect(FFA_WARMUP_CONFIG.timeLimitSeconds).toBe(0);
    expect(FFA_WARMUP_CONFIG.playerCount).toBe(4);
    // Everything else is FFA's.
    expect(FFA_WARMUP_CONFIG.pointsPerKill).toBe(FFA_CONFIG.pointsPerKill);
  });

  it('never ends, however many kills it sees', () => {
    const { mode } = rig(FFA_WARMUP_CONFIG);
    mode.onRoundStart(1);
    kills(mode, 100, 200, 500);
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('never ends on the clock either, with the clock at zero from the start', () => {
    const { mode } = rig(FFA_WARMUP_CONFIG);
    mode.onRoundStart(1);
    for (let tick = 1; tick <= 120; tick++) mode.onTick(tick);
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('still crowns a leader, because the ladder is live even with nothing to win', () => {
    // Zeroing the limits says there is nothing to count toward, not that nothing is counted.
    const { mode } = rig(FFA_WARMUP_CONFIG);
    mode.onRoundStart(1);
    kills(mode, 100, 200, 3);
    expect(mode.individualWinner()).toBe(100);
  });
});
