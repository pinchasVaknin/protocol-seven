import { describe, expect, it } from 'vitest';
import { levelForXp, MAX_LEVEL, XP_TO_MAX } from './Levels';
import { XP_SOURCES, xpSource } from './XpRules';
import {
  AVERAGE_MATCH,
  simulateXp,
  simulationToLines,
  xpPerMatch,
  type SimulatedMatch,
} from './XpSimulator';

/**
 * What one match is worth, and the ladder that follows from it (A18).
 *
 * `matchLineXp` is a fourteen-case switch over `XpSourceId` with a `default: return 0`, and A18
 * turns it into a table checked for exhaustiveness. Every line is therefore pinned here *one at
 * a time*, by moving one count and reading the difference through `xpPerMatch` — the function
 * itself is private, and a line that silently returned zero would be invisible in a test that
 * only checked the total.
 *
 * Three lines are not simply "count times value" and are the ones a table conversion could get
 * wrong without any total moving much: `matchTime` is ten minutes of the projection's own
 * authored length, `weaponLevel` is a flat 0.3 of one level, and `win`/`mvp` are expected values
 * rather than coin flips.
 *
 * `progression.txt` prints 3,870 for `AVERAGE_MATCH` and the SIM oracle holds it byte-identical,
 * so that number is pinned here too: the two must not be able to disagree.
 */

/** `AVERAGE_MATCH` with one field changed, which is how each line is isolated. */
function match(over: Partial<SimulatedMatch> = {}): SimulatedMatch {
  return { ...AVERAGE_MATCH, ...over };
}

/** What moving one count by `delta` adds to a match's XP. */
function lineValue(over: Partial<SimulatedMatch>): number {
  return xpPerMatch(match(over)) - xpPerMatch(AVERAGE_MATCH);
}

describe('the shipped average match', () => {
  it('is worth the 3,870 the progression oracle prints', () => {
    expect(xpPerMatch(AVERAGE_MATCH)).toBe(3870);
  });

  it('is the profile the acceptance runs were measured against', () => {
    expect(AVERAGE_MATCH).toEqual({
      kills: 18,
      headshots: 5,
      assists: 6,
      objectives: 0,
      longshots: 2,
      bestStreak: 4,
      winRate: 0.5,
      mvpRate: 0.2,
      challengeXp: 350,
    });
  });

  it('is rounded, so the expected values never leak a fraction', () => {
    expect(Number.isInteger(xpPerMatch(AVERAGE_MATCH))).toBe(true);
    expect(Number.isInteger(xpPerMatch(match({ winRate: 0.37, mvpRate: 0.11 })))).toBe(true);
  });
});

describe('each line of a match, one at a time', () => {
  it('pays the flat match-complete award whatever happened', () => {
    // Nothing done at all: the floor plus the time played, and nothing else.
    const nothing = match({
      kills: 0,
      headshots: 0,
      assists: 0,
      objectives: 0,
      longshots: 0,
      bestStreak: 0,
      winRate: 0,
      mvpRate: 0,
      challengeXp: 0,
    });
    const floor = xpSource('matchComplete').value;
    const time = 10 * xpSource('matchTime').value;
    const weaponLevels = xpSource('weaponLevel').value * 0.3;
    expect(xpPerMatch(nothing)).toBe(Math.round(floor + time + weaponLevels));
  });

  it('counts ten minutes of time played, the length this projection is authored against', () => {
    // 600 seconds floored to minutes, times 25 — the same ten minutes `hours` converts with.
    expect(10 * xpSource('matchTime').value).toBe(250);
  });

  it('pays per kill, headshot, assist, objective and longshot', () => {
    expect(lineValue({ kills: AVERAGE_MATCH.kills + 1 })).toBe(xpSource('kill').value);
    expect(lineValue({ headshots: AVERAGE_MATCH.headshots + 1 })).toBe(xpSource('headshot').value);
    expect(lineValue({ assists: AVERAGE_MATCH.assists + 1 })).toBe(xpSource('assist').value);
    expect(lineValue({ objectives: AVERAGE_MATCH.objectives + 1 })).toBe(
      xpSource('objective').value,
    );
    expect(lineValue({ longshots: AVERAGE_MATCH.longshots + 1 })).toBe(xpSource('longshot').value);
  });

  it('pays per point of the best streak', () => {
    expect(lineValue({ bestStreak: AVERAGE_MATCH.bestStreak + 1 })).toBe(xpSource('streak').value);
  });

  it('takes the challenge XP as the number it is handed, not as a count times a value', () => {
    // `challenge` has a value of 1 in the table and the field is already XP.
    expect(lineValue({ challengeXp: AVERAGE_MATCH.challengeXp + 100 })).toBe(100);
  });

  it('treats the win and the MVP as expected values rather than coin flips', () => {
    expect(lineValue({ winRate: 1 })).toBe(xpSource('win').value * 0.5);
    expect(lineValue({ mvpRate: 1 })).toBe(xpSource('mvp').value * 0.8);
    expect(lineValue({ winRate: 0 })).toBe(-xpSource('win').value * 0.5);
  });

  it('averages the weapon levels to a flat fraction rather than modelling them', () => {
    // Weapon levels arrive in bursts early and stop; 0.3 of one level per match, flagged in
    // the panel so nobody reads it as exact. No `SimulatedMatch` field moves it.
    const breakdown = simulateXp(1).breakdown;
    const row = breakdown.find((r) => r.label === 'Weapon levels');
    expect(row?.xp).toBe(Math.round(xpSource('weaponLevel').value * 0.3));
  });

  it('gives every shipped source a line, and none of them a silent zero', () => {
    // The guard on the table conversion: a source with no case fell through to `default` and
    // paid nothing. With `objectives` moved off zero, every one of the twelve pays something.
    const busy = match({ objectives: 3 });
    const breakdown = simulateXp(1, 0, busy).breakdown;
    expect(breakdown).toHaveLength(XP_SOURCES.length);
    for (const row of breakdown) expect(row.xp, row.label).toBeGreaterThan(0);
  });

  it('labels each line the way the table does, in table order', () => {
    const breakdown = simulateXp(1, 0, match({ objectives: 3 })).breakdown;
    expect(breakdown.map((r) => r.label)).toEqual(XP_SOURCES.map((s) => s.label));
  });

  it('drops a line worth nothing from the breakdown', () => {
    // The shipped average plays no objectives, so that row is not drawn.
    const breakdown = simulateXp(1).breakdown;
    expect(breakdown.map((r) => r.label)).not.toContain('Objectives');
    expect(breakdown).toHaveLength(XP_SOURCES.length - 1);
  });
});

describe('projecting matches forward', () => {
  it('reports what it was asked for, and banks one match’s XP per match', () => {
    const sim = simulateXp(3);
    expect(sim.matchesPlayed).toBe(3);
    expect(sim.perMatch).toBe(xpPerMatch(AVERAGE_MATCH));
    expect(sim.finalXp).toBe(sim.perMatch * 3);
    expect(sim.finalLevel).toBe(levelForXp(sim.finalXp));
  });

  it('starts from the XP it is given', () => {
    const sim = simulateXp(2, 10_000);
    expect(sim.finalXp).toBe(10_000 + sim.perMatch * 2);
  });

  it('refuses a negative start and a negative count', () => {
    expect(simulateXp(0).matchesPlayed).toBe(0);
    expect(simulateXp(-5).matchesPlayed).toBe(0);
    expect(simulateXp(1, -100).finalXp).toBe(xpPerMatch(AVERAGE_MATCH));
  });

  it('records every level it crosses, once, in order', () => {
    const sim = simulateXp(40);
    const levels = sim.milestones.map((m) => m.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(levels.length);
    expect(levels[0]).toBe(2);
  });

  it('converts matches to hours at the same ten minutes the XP is authored against', () => {
    const sim = simulateXp(12);
    for (const step of sim.milestones) {
      expect(step.hours).toBeCloseTo((step.matches * 10) / 60, 10);
    }
  });

  it('says when the cap was reached, and -1 while it has not been', () => {
    expect(simulateXp(5).matchesToMax).toBe(-1);

    const toCap = simulateXp(1000);
    expect(toCap.finalLevel).toBe(MAX_LEVEL);
    expect(toCap.matchesToMax).toBeGreaterThan(0);
    // The match it was reached on is the one whose cumulative XP first cleared the cap.
    expect(toCap.matchesToMax * toCap.perMatch).toBeGreaterThanOrEqual(XP_TO_MAX);
    expect((toCap.matchesToMax - 1) * toCap.perMatch).toBeLessThan(XP_TO_MAX);
  });

  it('reports zero matches to the cap for a profile that starts there', () => {
    expect(simulateXp(1, XP_TO_MAX).matchesToMax).toBe(0);
  });
});

describe('the printed projection', () => {
  it('leads with the per-match figure and the level reached', () => {
    const lines = simulationToLines(simulateXp(3));
    expect(lines[0]).toContain('XP per match');
    expect(lines[0]).toContain('3 matches simulated');
    expect(lines[1]).toContain('Reached level');
  });

  it('says how many more matches the cap needs when it was not reached', () => {
    const lines = simulationToLines(simulateXp(2));
    expect(lines[2]).toContain(`Level ${MAX_LEVEL} needs`);
    expect(lines[2]).toContain('more matches');
  });

  it('says which match reached the cap when it was', () => {
    const lines = simulationToLines(simulateXp(1000));
    expect(lines[2]).toContain(`Level ${MAX_LEVEL} at match`);
  });

  it('prints one line per level crossed', () => {
    const sim = simulateXp(20);
    const lines = simulationToLines(sim);
    expect(lines).toHaveLength(3 + sim.milestones.length);
  });
});
