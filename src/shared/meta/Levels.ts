/**
 * The level curve (brief S6.1), authored as a table.
 *
 * S6.1 is explicit that this must be data and not "a formula buried in logic", and the
 * reason is pacing: the only way to answer "does level 12 arrive too late" is to look at
 * the row for level 12 and change it. `LEVEL_XP[n]` is the XP required to go from level
 * `n + 1` to level `n + 2`, so the array has 54 entries for 55 levels.
 *
 * The shape is deliberately front-loaded. The first ten levels cost 55,800 XP between
 * them — about fifteen matches of `AVERAGE_MATCH`, which is worth 3,870 XP — because every
 * weapon near the bottom of the ladder needs to arrive while the player is still deciding
 * whether to keep playing. From level 11 the steps settle into a steady climb, and the last
 * stretch to 55 is the wall prestige exists to make meaningful.
 *
 * **Every row was tripled on 2026-09-23** (playtest). The report was that a single strong
 * round carried a player to level 14 — roughly 33,000 XP on the old table, eight average
 * matches' worth of curve crossed on one summary screen — and the ladder above it with them.
 * The re-pricing is here rather than in `XpRules.ts` on purpose: the award table is the
 * brief's (100 a kill, 500 a match) and a dedicated server pays those same numbers, so
 * cutting them would have made the client and the server disagree about what a kill is worth.
 * The curve is the pacing dial; the awards are the contract. Same round now lands near 9.
 *
 * **How front-loaded, exactly, is the thing to know before re-spacing anything against it**
 * (playtest round 5, F10). The first four rows total 9,900 XP and a match pays 3,870, so the
 * first summary screen a player ever sees still crosses two or three levels at once. A level
 * is therefore not a unit of pacing down here, which is why the weapon ladder is spaced — and
 * asserted — in matches: `npm run progression` prints the match each rung arrives in, and
 * that report is the one to read after any change to this table.
 *
 * Every number here is reachable from the XP simulator (`__p7.simulateXp(n)` in the
 * F1 panel, `xpPerMatch` in `npm run progression`), which fast-forwards N matches of a
 * declared performance and reports where the curve puts you — S7's requirement, and the
 * thing that makes this table tunable without playing 55 levels.
 */

export const MAX_LEVEL = 55;

/**
 * XP from level n+1 to level n+2, in order. 54 rows.
 *
 * Rows 1-10 are hand-authored for the opening. Rows 11 onward step by a constant 1,500,
 * which is a deliberate choice rather than an accident of generation: a curve that
 * accelerates all the way to 55 makes the last ten levels take longer than the first
 * forty-five, and the simulator made that obvious the first time it was run. The whole
 * table is the 2026-09-23 re-pricing of the original, every row multiplied by three, so the
 * shape the paragraph above describes is exactly the shape it always had.
 */
export const LEVEL_XP: readonly number[] = [
  // 1 -> 11: the opening. Twelve matches to level 10, fifteen to level 11; measured by
  // `npm run progression`, not estimated.
  1500, 2100, 2700, 3600, 4500, 5700, 6900, 8100, 9600, 11100,
  // 11 -> 21
  12600, 14100, 15600, 17100, 18600, 20100, 21600, 23100, 24600, 26100,
  // 21 -> 31
  27600, 29100, 30600, 32100, 33600, 35100, 36600, 38100, 39600, 41100,
  // 31 -> 41
  42600, 44100, 45600, 47100, 48600, 50100, 51600, 53100, 54600, 56100,
  // 41 -> 51
  57600, 59100, 60600, 62100, 63600, 65100, 66600, 68100, 69600, 71100,
  // 51 -> 55
  72600, 74100, 75600, 77100,
];

/** Cumulative XP at the start of each level. `LEVEL_START[0]` is level 1, always 0. */
const LEVEL_START: readonly number[] = buildCumulative();

function buildCumulative(): number[] {
  const out: number[] = [0];
  let total = 0;
  for (const step of LEVEL_XP) {
    total += step;
    out.push(total);
  }
  return out;
}

/** Total XP needed to reach `MAX_LEVEL`. 2,029,200 on the shipped table. */
export const XP_TO_MAX = LEVEL_START[LEVEL_START.length - 1] ?? 0;

/** XP required to advance out of `level`. Zero at the cap. */
export function xpForLevel(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return LEVEL_XP[Math.max(0, level - 1)] ?? 0;
}

/** Cumulative XP at which `level` begins. */
export function xpAtLevelStart(level: number): number {
  const index = Math.min(Math.max(level, 1), MAX_LEVEL) - 1;
  return LEVEL_START[index] ?? 0;
}

/**
 * The level a lifetime XP total puts you at, 1..55.
 *
 * Linear scan over 55 entries. It is called on a level-up and by the summary screen, not
 * in the sim path, and a binary search over a fifty-five element array would be less
 * readable for no measurable gain.
 */
export function levelForXp(totalXp: number): number {
  const xp = Math.max(0, totalXp);
  for (let level = MAX_LEVEL; level >= 1; level--) {
    if (xp >= xpAtLevelStart(level)) return level;
  }
  return 1;
}

/** How far into the current level a total sits, and how far it has to go. */
export interface LevelProgress {
  readonly level: number;
  /** XP earned since this level began. */
  readonly into: number;
  /** XP this level costs in total. Zero at the cap. */
  readonly span: number;
  /** 0..1 through the level. 1 at the cap. */
  readonly fraction: number;
  readonly atCap: boolean;
}

export function levelProgress(totalXp: number): LevelProgress {
  const level = levelForXp(totalXp);
  const start = xpAtLevelStart(level);
  const span = xpForLevel(level);
  const into = Math.max(0, totalXp - start);
  const atCap = level >= MAX_LEVEL;
  return {
    level,
    into,
    span,
    fraction: atCap ? 1 : span > 0 ? Math.min(1, into / span) : 0,
    atCap,
  };
}

// -- prestige -----------------------------------------------------------------

/**
 * Prestige (S6.1): at 55 the level and the unlocks reset, the icon persists, and one
 * permanent unlock token is granted.
 *
 * A token permanently unlocks a single item *across resets* — which is what makes it a
 * choice worth thinking about rather than a currency. `PRESTIGE_MAX` is a bound rather
 * than a design statement: ten is where the icon vocabulary in `PrestigeIcons` runs out,
 * and nothing in the save schema cares.
 */
export const PRESTIGE_MAX = 10;

/** Tokens granted per prestige. One, deliberately. */
export const TOKENS_PER_PRESTIGE = 1;

/** Whether a profile at this level and prestige may prestige right now. */
export function canPrestige(level: number, prestige: number): boolean {
  return level >= MAX_LEVEL && prestige < PRESTIGE_MAX;
}

/**
 * The prestige badge, as a short label.
 *
 * Roman numerals rather than generated art: the icon has to read at 11 px in a scoreboard
 * row next to a name, and a procedural emblem at that size is a smudge.
 */
const PRESTIGE_LABELS: readonly string[] = [
  '',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
];

export function prestigeLabel(prestige: number): string {
  return PRESTIGE_LABELS[Math.max(0, Math.min(PRESTIGE_MAX, prestige))] ?? '';
}

/**
 * One frame of the summary screen's XP bar (M6, S6.1; playtest round 4 regression).
 *
 * ## Why the arithmetic is here and the animation is not
 *
 * `XpSummary` owns the DOM, the flourish and the `requestAnimationFrame` loop; this owns the
 * only question that can be *wrong*: where the bar goes next and whether it has arrived. That
 * split is the one `shared/ui/HudSurfaces.ts` and `shared/modes/SpectatorTarget.ts` already
 * make, and for the same reason — a claim about a rendered bar needs a browser, and a claim
 * about a number does not. `npm run progression` steps this to completion and reports how many
 * steps it took, which is a fact a headless process can establish.
 *
 * ## The bug it exists to make impossible
 *
 * The caller used to compute its own span as `Math.max(1, xpForLevel(level))`. `xpForLevel`
 * returns **0** at the cap, correctly — there is no level 56 to save for — and that `max(1, …)`
 * invented a one-XP level above it. The next boundary therefore landed *below* the target, so
 * every frame "crossed" it, replayed the level-up flourish for a level that never changed, and
 * set the bar back to just under the boundary it had already passed. The animation never
 * reached its end state, so the frame loop never stopped and the flourish repeated every
 * `LEVELUP_HOLD` for as long as the screen was up.
 *
 * **The guard is the general one, not the max-level one.** A step whose next boundary is not
 * *ahead* of where the bar already is has nowhere to advance to, and says so. Reaching the cap
 * is one way to be in that position — `span` is genuinely zero there. A report whose target is
 * already the current value is another, and it needs no separate early return.
 */
export interface LevelBarStep {
  /** Where the bar sits after this step. */
  readonly xp: number;
  /** A level boundary was reached: hold here and play the flourish. */
  readonly levelUp: boolean;
  /** Nothing left to advance. The caller stops; there is no further frame to ask for. */
  readonly done: boolean;
}

/**
 * Advance `shownXp` toward `targetXp` by one frame of `dt`.
 *
 * The rate is in **levels** per second rather than XP per second, which is what makes the fill
 * feel the same at level 3 and at level 40 where the same XP is a tenth of the distance.
 */
export function stepLevelBar(
  shownXp: number,
  targetXp: number,
  dt: number,
  secondsPerLevel: number,
): LevelBarStep {
  if (shownXp >= targetXp) return { xp: shownXp, levelUp: false, done: true };

  const level = levelForXp(shownXp);
  const span = xpForLevel(level);
  const nextLevelAt = xpAtLevelStart(level) + span;

  /**
   * No boundary ahead of us. **This is the whole fix.**
   *
   * At the cap `span` is zero and `nextLevelAt` is the start of the level we are already in,
   * which is at or below `shownXp`. There is no crossing to animate and no flourish to play, so
   * the bar goes straight to the target and reports that it is finished — the same answer it
   * gives for a report that had nothing to add.
   */
  if (nextLevelAt <= shownXp) return { xp: targetXp, levelUp: false, done: true };

  const rate = span / Math.max(secondsPerLevel, 1e-6);
  const advanced = Math.min(targetXp, shownXp + rate * Math.max(0, dt));
  if (advanced >= nextLevelAt && targetXp >= nextLevelAt) {
    /**
     * Nudge past the seam rather than landing on it: `levelForXp` returns the *old* level for a
     * total exactly equal to the next level's start, so a bar parked on the boundary would ask
     * the same question again next frame and cross the same line twice.
     */
    return { xp: nextLevelAt + 1e-6, levelUp: true, done: false };
  }
  return { xp: advanced, levelUp: false, done: advanced >= targetXp };
}
