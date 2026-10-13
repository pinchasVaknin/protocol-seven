/**
 * The XP / unlock simulator (brief S7).
 *
 * S7 asks for "a debug panel that fast-forwards N matches of average performance and
 * reports the level curve, so the human can sanity-check pacing without playing 55
 * levels". This is the arithmetic half; `MetaPanel` draws it.
 *
 * It is deliberately *not* a Monte Carlo. A simulated match here is a fixed set of counts
 * multiplied through the same `XP_SOURCES` table `MatchProgression` uses, so the answer to
 * "how many matches to level 30" is exact for the performance you describe rather than an
 * average of a distribution nobody can inspect. Variance would hide the thing the panel
 * exists to show, which is whether the *curve* is right.
 *
 * The profile is never touched. This is a projection, not a grant — `MetaPanel` has a
 * separate, explicit button for granting XP.
 *
 * ## Why it is in `shared/` (playtest round 5, F10)
 *
 * It was in `client/debug/`, next to the panel that draws it, and it has never touched the
 * DOM: every line of it is arithmetic over `XP_SOURCES`, `LEVEL_XP` and the unlock tables.
 * F10 asked for the weapon ladder to be re-spaced, and the only honest unit for that is the
 * **match** rather than the level — which made "what is a match worth" a question a headless
 * probe had to be able to ask. A second copy of `xpPerMatch` in `server/` would have been the
 * two-sources mistake this file's own reason for existing warns about, so the projection moved
 * to where both the panel and `npm run progression` can read the one of it. Same argument as
 * `stepLevelBar`'s, one file away: the half that can be wrong invisibly belongs where it can
 * be measured.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { levelForXp, MAX_LEVEL, XP_TO_MAX } from './Levels';
import { unlocksAtLevel } from './Unlocks';
import { matchMinutes, XP_SOURCES, xpSource, type XpSourceId } from './XpRules';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** One match of "average performance", as counts per XP source. */
export interface SimulatedMatch {
  kills: number;
  headshots: number;
  assists: number;
  objectives: number;
  longshots: number;
  bestStreak: number;
  /** Fraction of matches won, 0..1. Applied as an expected value, not a coin flip. */
  winRate: number;
  /** Fraction of matches the player tops the board. */
  mvpRate: number;
  /** XP from challenges per match. Front-loaded in reality; flat here, and said so. */
  challengeXp: number;
}

interface SimulatedLevel {
  readonly level: number;
  /** Matches played by the time this level was reached. */
  readonly matches: number;
  /** Hours, at ten minutes a match. */
  readonly hours: number;
  readonly unlocks: readonly string[];
}

export interface XpSimulation {
  /** XP one average match is worth. */
  readonly perMatch: number;
  readonly matchesPlayed: number;
  readonly finalLevel: number;
  readonly finalXp: number;
  /** Matches needed to reach the cap at this rate, or -1 if not reached within `matches`. */
  readonly matchesToMax: number;
  readonly milestones: readonly SimulatedLevel[];
  /** The per-source breakdown of one average match, for the panel's first block. */
  readonly breakdown: ReadonlyArray<Readonly<{ label: string; xp: number }>>;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * How long the average match this projection models runs, minutes.
 *
 * It was a bare `10` inside the milestone loop's hours conversion. `matchTime` needs the same
 * number (round 5, B6), and a projection whose XP-per-match and hours-per-match disagreed about
 * the length of a match would be two models wearing one graph.
 */
const MINUTES_PER_MATCH = 10;

/**
 * The default profile of an average player, measured against the M4/M5 acceptance runs.
 *
 * A ten-minute TDM to 75 kills with ten combatants gives a competent player roughly 18
 * kills; the rest follow from the M5 bot-aim measurements (about a third of kills are
 * headshots at these multipliers) and from the assist ledger's 8-second window.
 */
export const AVERAGE_MATCH: SimulatedMatch = {
  kills: 18,
  headshots: 5,
  assists: 6,
  objectives: 0,
  longshots: 2,
  bestStreak: 4,
  winRate: 0.5,
  mvpRate: 0.2,
  challengeXp: 350,
};

/**
 * What one line of the match is worth, per XP source (A18).
 *
 * A table rather than a `switch`, and typed `satisfies Record<XpSourceId, …>` so it is checked
 * for exhaustiveness: the switch it replaced ended in `default: return 0`, which meant a source
 * added to `XP_SOURCES` and forgotten here paid **nothing, silently**, in a projection whose
 * whole job is to answer "is this pacing right". Adding one now fails to compile.
 *
 * Three of the fourteen are not simply a count times a value, and each says why on its own line.
 */
const MATCH_LINES = {
  matchComplete: () => xpSource('matchComplete').value,
  // The ten minutes this whole projection is authored against — see `SimulatedLevel.hours`,
  // which converts matches to hours at the same rate.
  matchTime: () => matchMinutes(MINUTES_PER_MATCH * 60) * xpSource('matchTime').value,
  kill: (match) => match.kills * xpSource('kill').value,
  headshot: (match) => match.headshots * xpSource('headshot').value,
  assist: (match) => match.assists * xpSource('assist').value,
  objective: (match) => match.objectives * xpSource('objective').value,
  longshot: (match) => match.longshots * xpSource('longshot').value,
  // Already XP rather than a count, so the table's own value is not a multiplier here.
  challenge: (match) => match.challengeXp,
  // Weapon levels arrive in bursts early and stop; averaged to a small constant here rather
  // than modelled, and flagged in the panel so nobody reads it as exact.
  weaponLevel: () => xpSource('weaponLevel').value * 0.3,
  // Expected values, not coin flips: variance would hide the curve the panel exists to show.
  win: (match) => xpSource('win').value * match.winRate,
  mvp: (match) => xpSource('mvp').value * match.mvpRate,
  streak: (match) => match.bestStreak * xpSource('streak').value,
  /**
   * Nothing, and the zero is the point.
   *
   * `'match'` is the id a **dedicated server** stamps on its own already-labelled breakdown
   * lines (§6.9); it is deliberately not a row in `XP_SOURCES`, so neither `xpPerMatch` nor the
   * breakdown — both of which walk that table — ever reaches this entry. It is here because the
   * union is closed and the table is checked against it, which is what turned the `default:
   * return 0` this replaced into a line that says so. A projection cannot model a figure only a
   * server can compute.
   */
  match: () => 0,
} satisfies Record<XpSourceId, (match: SimulatedMatch) => number>;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** XP one match of the given performance is worth. */
export function xpPerMatch(match: SimulatedMatch): number {
  let total = 0;
  for (const source of XP_SOURCES) {
    total += MATCH_LINES[source.id](match);
  }
  return Math.round(total);
}

/**
 * Project `matches` matches forward from `startXp`.
 *
 * Reports every level crossed, what it unlocked, and how long it took at ten minutes a
 * match — which is the number that actually answers "is this pacing right".
 */
export function simulateXp(
  matches: number,
  startXp = 0,
  match: SimulatedMatch = AVERAGE_MATCH,
): XpSimulation {
  const perMatch = xpPerMatch(match);
  const milestones: SimulatedLevel[] = [];

  let xp = Math.max(0, startXp);
  let level = levelForXp(xp);
  let matchesToMax = level >= MAX_LEVEL ? 0 : -1;
  const count = Math.max(0, Math.round(matches));

  for (let i = 1; i <= count; i++) {
    xp += perMatch;
    const next = levelForXp(xp);
    while (level < next) {
      level++;
      milestones.push({
        level,
        matches: i,
        hours: (i * MINUTES_PER_MATCH) / 60,
        unlocks: unlocksAtLevel(level),
      });
      if (level >= MAX_LEVEL && matchesToMax < 0) matchesToMax = i;
    }
  }

  const breakdown = XP_SOURCES.map((source) => ({
    label: source.label,
    xp: Math.round(MATCH_LINES[source.id](match)),
  })).filter((row) => row.xp > 0);

  return {
    perMatch,
    matchesPlayed: count,
    finalLevel: level,
    finalXp: xp,
    matchesToMax,
    milestones,
    breakdown,
  };
}

/** One line per level, as text. What the panel prints and the console API returns. */
export function simulationToLines(sim: XpSimulation): string[] {
  const out: string[] = [
    `${sim.perMatch.toLocaleString()} XP per match · ${sim.matchesPlayed} matches simulated`,
    `Reached level ${sim.finalLevel} with ${Math.round(sim.finalXp).toLocaleString()} XP`,
    sim.matchesToMax >= 0
      ? `Level ${MAX_LEVEL} at match ${sim.matchesToMax} (${((sim.matchesToMax * 10) / 60).toFixed(1)} h)`
      : `Level ${MAX_LEVEL} needs ${Math.ceil((XP_TO_MAX - sim.finalXp) / sim.perMatch)} more matches`,
  ];
  for (const step of sim.milestones) {
    const unlocks = step.unlocks.length === 0 ? '' : ` — ${step.unlocks.join(', ')}`;
    out.push(`  L${String(step.level).padStart(2, ' ')} @ match ${String(step.matches).padStart(3, ' ')} (${step.hours.toFixed(1)} h)${unlocks}`);
  }
  return out;
}
//#endregion
