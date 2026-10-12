import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { createGameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { GREYBOX_MAP } from '../world/maps/greybox';
import type { Combatant } from '../ai/Combatant';
import { COL_ACC, COL_BEST, COL_DEATHS, COL_KD, COL_KILLS, COL_SCORE, type KillEvent, type ModeDeps } from './GameMode';
import { Tdm } from './Tdm';

/**
 * Team Deathmatch, pinned — and with it the contract every mode answers.
 *
 * TDM is the mode the base class was written against, so what it declares is the baseline the
 * other four are variations on: one round, no side swap, unlimited lives, and a match decided
 * by a score limit or a clock. Both halves of that are worth pinning, because `MatchFlow` reads
 * them to decide whether to run rounds at all and a mode that answered "two rounds" by accident
 * would change the flow of every match on the map.
 *
 * The clock is the detail that repays attention. There are **two** match clocks — `MatchFlow`'s
 * `ticksRemaining` and the mode's own `ticksLeft`, both seeded from the same authored number —
 * and it is the mode's that decides a match on time. `roundSecondsOverride` exists so a harness
 * cannot shorten one without the other.
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

interface Rig {
  readonly mode: Tdm;
  readonly score: ScoreSystem;
}

function rig(over: Partial<ModeDeps> = {}): Rig {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  const roster: Combatant[] = [body(0, 'A'), body(100, 'B')];
  for (const c of roster) score.register(c.entityId, c.displayName, c.team);
  const deps: ModeDeps = { bus, score, roster, mapDef: GREYBOX_MAP, ...over };
  return { mode: new Tdm(deps), score };
}

/** `n` kills credited to `team`, through the mode rather than around it. */
function kills(mode: Tdm, team: 'A' | 'B', n: number): void {
  const ev: KillEvent = {
    killerId: team === 'A' ? 0 : 100,
    victimId: team === 'A' ? 100 : 0,
    weaponId: 'ar_carbine',
    zone: 'torso',
    killerTeam: team,
    victimTeam: team === 'A' ? 'B' : 'A',
    headshot: false,
    suicide: false,
    friendly: false,
  };
  for (let i = 0; i < n; i++) mode.onKill(ev);
}

describe('what TDM declares it is', () => {
  it('is one continuous round with no swap and no life limit', () => {
    const { mode } = rig();
    expect(mode.id).toBe('TDM');
    expect(mode.roundsToWin).toBe(1);
    expect(mode.swapSidesAfterRound).toBe(null);
    expect(mode.livesPerRound).toBe(Infinity);
  });

  it('names itself and briefs the player in words', () => {
    const { mode } = rig();
    expect(mode.name.length).toBeGreaterThan(0);
    expect(mode.brief.length).toBeGreaterThan(0);
  });

  it('runs to the authored score limit over the authored minutes', () => {
    const { mode } = rig();
    expect(mode.scoreLimit).toBe(75);
    expect(mode.roundSeconds).toBe(600);
  });

  it('crowns a side, never an individual', () => {
    const { mode } = rig();
    expect(mode.individualWinner()).toBeUndefined();
  });

  it('has no objectives, no header slots, no tags and no bomb', () => {
    const { mode } = rig();
    expect(mode.objectiveZones).toEqual([]);
    expect(mode.headerSlots).toEqual([]);
    expect(mode.dogTags).toBe(null);
    expect(mode.bombInfo).toBe(null);
  });

  it('shows the six shared columns', () => {
    const { mode } = rig();
    expect(mode.getScoreboardColumns()).toEqual([COL_SCORE, COL_KILLS, COL_DEATHS, COL_KD, COL_ACC, COL_BEST]);
  });
});

describe('the mode clock', () => {
  it('is seeded on the round start, not in the constructor', () => {
    const { mode } = rig();
    // Nothing has started, so the clock has not been wound: the win condition sees a zero
    // clock and would end the match on time. `MatchFlow` always starts a round first.
    mode.onRoundStart(1);
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('counts down one tick at a time and never below zero', () => {
    const { mode } = rig({ roundSecondsOverride: 2 * DT });
    mode.onRoundStart(1);
    mode.onTick(1);
    expect(mode.checkWinCondition()).toBe(null);
    mode.onTick(2);
    const result = mode.checkWinCondition();
    expect(result?.winner).toBe('DRAW');
    // And it stays ended rather than wrapping.
    mode.onTick(3);
    expect(mode.checkWinCondition()?.winner).toBe('DRAW');
  });

  it('is shortened by the harness override, which both clocks read', () => {
    const { mode } = rig({ roundSecondsOverride: 30 });
    expect(mode.roundSeconds).toBe(600);
    mode.onRoundStart(1);
    for (let tick = 1; tick <= Math.round(30 / DT); tick++) mode.onTick(tick);
    expect(mode.checkWinCondition()).not.toBe(null);
  });
});

describe('deciding the match', () => {
  it('is undecided while nobody is at the limit and the clock runs', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 'A', 10);
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('crowns the side that reaches the score limit, on the kill that reaches it', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 'A', 74);
    expect(mode.checkWinCondition()).toBe(null);
    kills(mode, 'A', 1);
    const result = mode.checkWinCondition();
    expect(result?.kind).toBe('match');
    expect(result?.winner).toBe('A');
    expect(result?.reason).toBe('Score limit');
  });

  it('gives the lead to the other side when they get there first', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 'B', 75);
    expect(mode.checkWinCondition()?.winner).toBe('B');
  });

  it('reads its score straight off the score system, per side', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    kills(mode, 'A', 3);
    expect(mode.teamScore('A')).toBeGreaterThan(0);
    expect(mode.teamScore('B')).toBe(0);
  });

  it('ends a tie on the clock as a draw', () => {
    const { mode } = rig({ roundSecondsOverride: DT });
    mode.onRoundStart(1);
    kills(mode, 'A', 5);
    kills(mode, 'B', 5);
    mode.onTick(1);
    const result = mode.checkWinCondition();
    expect(result?.winner).toBe('DRAW');
    expect(result?.reason).toBe('Time — draw');
  });

  it('ends on the clock with the leader winning on time', () => {
    const { mode } = rig({ roundSecondsOverride: DT });
    mode.onRoundStart(1);
    kills(mode, 'A', 5);
    mode.onTick(1);
    const result = mode.checkWinCondition();
    expect(result?.winner).toBe('A');
    expect(result?.reason).toBe('Time limit');
  });
});

describe('the parts of the contract TDM leaves empty', () => {
  it('does nothing on a spawn, and nothing on a round end', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    expect(() => mode.onSpawn(body(1, 'A'))).not.toThrow();
    expect(() =>
      mode.onRoundEnd({ kind: 'round', round: 1, winner: 'A', reason: 'Score limit' }),
    ).not.toThrow();
  });

  it('starts the round over when asked again', () => {
    const { mode } = rig({ roundSecondsOverride: DT });
    mode.onRoundStart(1);
    mode.onTick(1);
    expect(mode.checkWinCondition()).not.toBe(null);
    mode.onRoundStart(2);
    expect(mode.checkWinCondition()).toBe(null);
  });
});
