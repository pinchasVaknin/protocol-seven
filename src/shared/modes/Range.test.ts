import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { createGameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { GREYBOX_MAP } from '../world/maps/greybox';
import type { Combatant } from '../ai/Combatant';
import type { KillEvent, ModeDeps } from './GameMode';
import { Range } from './Range';

/**
 * The shooting range, pinned.
 *
 * The range is the mode that proves the base class is not secretly about fighting. It has no
 * score limit, no sides and nothing shooting back — so what it exercises is the *other* way a
 * mode can end (a session that simply runs out) and the fact that `teamScore` has to answer
 * something sensible for a mode where a side is meaningless.
 *
 * Its scoreboard is the one place a mode builds its own columns rather than taking the six
 * shared ones: a range is about the weapon, so shots, hits and accuracy are the three numbers
 * a player is there to read. Accuracy is given to one decimal here against the shared column's
 * zero, which is the difference between a range read-out and a scoreboard.
 */

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

function body(entityId: number): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(0, 0, 0, 0);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team: 'A',
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

function rig(over: Partial<ModeDeps> = {}): { mode: Range; score: ScoreSystem } {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  const roster: Combatant[] = [body(0)];
  score.register(0, 'PLAYER', 'A');
  const deps: ModeDeps = { bus, score, roster, mapDef: GREYBOX_MAP, ...over };
  return { mode: new Range(deps), score };
}

function target(mode: Range, n: number): void {
  const ev: KillEvent = {
    killerId: 0,
    victimId: 1,
    weaponId: 'ar_carbine',
    zone: 'torso',
    killerTeam: 'A',
    // A dummy is on nobody's side, which is what makes it a target rather than an enemy.
    victimTeam: null,
    headshot: false,
    suicide: false,
    friendly: false,
  };
  for (let i = 0; i < n; i++) mode.onKill(ev);
}

describe('what the range declares it is', () => {
  it('is one open-ended session with nothing to win', () => {
    const { mode } = rig();
    expect(mode.id).toBe('RANGE');
    expect(mode.name).toBe('SHOOTING RANGE');
    expect(mode.roundsToWin).toBe(1);
    expect(mode.swapSidesAfterRound).toBe(null);
    expect(mode.livesPerRound).toBe(Infinity);
    // No limit: the bar at the top of the HUD has nothing to count toward.
    expect(mode.scoreLimit).toBe(0);
  });

  it('runs for fifteen minutes', () => {
    const { mode } = rig();
    expect(mode.roundSeconds).toBe(900);
  });

  it('tells the player there is nobody shooting back', () => {
    const { mode } = rig();
    expect(mode.brief).toContain('NOBODY SHOOTING BACK');
  });

  it('has no objectives, no tags, no bomb and no individual winner', () => {
    const { mode } = rig();
    expect(mode.objectiveZones).toEqual([]);
    expect(mode.headerSlots).toEqual([]);
    expect(mode.dogTags).toBe(null);
    expect(mode.bombInfo).toBe(null);
    expect(mode.individualWinner()).toBeUndefined();
  });

  it('scores every side as zero, because a side means nothing here', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    target(mode, 5);
    expect(mode.teamScore('A')).toBe(0);
    expect(mode.teamScore('B')).toBe(0);
  });
});

describe('hitting a target', () => {
  it('credits the authored points for it', () => {
    const { mode, score } = rig();
    mode.onRoundStart(1);
    target(mode, 3);
    const row = score.row(0);
    expect(row?.kills).toBe(3);
    expect(row?.score).toBe(30);
  });
});

describe('ending the session', () => {
  it('runs while the clock does', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    expect(mode.checkWinCondition()).toBe(null);
    mode.onTick(1);
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('ends as a draw when the clock runs out — a session, not a fight', () => {
    const { mode } = rig();
    mode.onRoundStart(1);
    const ticks = Math.round(900 / DT);
    for (let tick = 1; tick < ticks; tick++) mode.onTick(tick);
    expect(mode.checkWinCondition()).toBe(null);
    mode.onTick(ticks);
    const result = mode.checkWinCondition();
    expect(result?.kind).toBe('match');
    if (result === null || result.kind !== 'match') return;
    expect(result.winner).toBe('DRAW');
    expect(result.reason).toBe('Session ended');
    expect([result.scoreA, result.scoreB]).toEqual([0, 0]);
  });

  it('ignores the harness clock override, unlike every other mode', () => {
    // Pins current behaviour; suspected bug: Range.onRoundStart bypasses roundTicks.
    //
    // `onRoundStart` computes `Math.round(config.timeLimitSeconds / DT)` directly where the
    // other five modes call the inherited `roundTicks(...)`, which is the one place
    // `roundSecondsOverride` is read. `ModeDeps.roundSecondsOverride` documents the opposite
    // — "both are overridden from this one value, so they cannot be shortened apart" — so a
    // harness asking for a thirty-second range gets the authored fifteen minutes.
    const { mode } = rig({ roundSecondsOverride: 2 * DT });
    mode.onRoundStart(1);
    mode.onTick(1);
    mode.onTick(2);
    mode.onTick(3);
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('ends immediately if nobody ever started the round', () => {
    // The clock is wound by `onRoundStart`, so an unstarted range is already over. `MatchFlow`
    // always starts a round first; this pins what the code does rather than what it should.
    const { mode } = rig();
    expect(mode.checkWinCondition()?.reason).toBe('Session ended');
  });
});

describe('the range scoreboard', () => {
  it('is about the weapon: score, hits, shots and accuracy', () => {
    const { mode } = rig();
    expect(mode.getScoreboardColumns().map((c) => c.key)).toEqual([
      'score',
      'hits',
      'shots',
      'acc',
      'dmg',
    ]);
  });

  it('gives accuracy a decimal place, which a scoreboard does not', () => {
    const { mode, score } = rig();
    const row = score.register(1, 'SHOOTER', 'A');
    expect(row).toBeDefined();
    if (row === undefined) return;
    row.shotsFired = 7;
    row.shotsHit = 3;
    const acc = mode.getScoreboardColumns().find((c) => c.key === 'acc');
    expect(acc?.value(row)).toBe('42.9%');
  });

  it('shows an em dash rather than a division by zero before the first shot', () => {
    const { mode, score } = rig();
    const row = score.row(0);
    expect(row).toBeDefined();
    if (row === undefined) return;
    const acc = mode.getScoreboardColumns().find((c) => c.key === 'acc');
    expect(acc?.value(row)).toBe('—');
  });

  it('builds its own columns rather than sharing the mutable ones', () => {
    const { mode } = rig();
    expect(mode.getScoreboardColumns()).not.toBe(mode.getScoreboardColumns());
  });
});
