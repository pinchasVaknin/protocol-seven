import { describe, expect, it } from 'vitest';
import {
  canPrestige,
  LEVEL_XP,
  levelForXp,
  levelProgress,
  MAX_LEVEL,
  PRESTIGE_MAX,
  prestigeLabel,
  TOKENS_PER_PRESTIGE,
  xpAtLevelStart,
  xpForLevel,
  XP_TO_MAX,
} from './Levels';

/**
 * The 55-level ladder (A18).
 *
 * A18 moves `buildCumulative` below the constant that calls it at load — a hoisted function
 * declaration, so the cumulative table has to come out identical. That is what the first block
 * holds: the total, the row count, and the boundaries at both ends, which `progression.txt`
 * prints and the SIM oracle keeps byte-identical.
 *
 * Every boundary is pinned from both sides. A ladder that is one XP out at a seam is the defect
 * `stepLevelBar`'s own notes were written about.
 */

describe('the shipped table', () => {
  it('has one row per step between the 55 levels', () => {
    expect(LEVEL_XP).toHaveLength(MAX_LEVEL - 1);
    expect(MAX_LEVEL).toBe(55);
  });

  it('costs the 2,029,200 the progression probe prints', () => {
    expect(XP_TO_MAX).toBe(2_029_200);
  });

  it('is the sum of its own rows', () => {
    let total = 0;
    for (const step of LEVEL_XP) total += step;
    expect(XP_TO_MAX).toBe(total);
  });

  it('never steps backwards, and steps by a constant 1,500 from level 11', () => {
    for (let i = 1; i < LEVEL_XP.length; i++) {
      expect(LEVEL_XP[i], `row ${i}`).toBeGreaterThanOrEqual(LEVEL_XP[i - 1] ?? 0);
    }
    // Rows 11 onward: the deliberate linear tail, so the last ten levels do not outlast the
    // first forty-five.
    for (let i = 11; i < LEVEL_XP.length; i++) {
      expect((LEVEL_XP[i] ?? 0) - (LEVEL_XP[i - 1] ?? 0), `row ${i}`).toBe(1500);
    }
  });

  it('asks 77,100 for the last step', () => {
    expect(LEVEL_XP[LEVEL_XP.length - 1]).toBe(77_100);
    expect(xpForLevel(MAX_LEVEL - 1)).toBe(77_100);
  });
});

describe('what a level costs and where it starts', () => {
  it('starts level 1 at zero', () => {
    expect(xpAtLevelStart(1)).toBe(0);
    expect(xpForLevel(1)).toBe(LEVEL_XP[0]);
  });

  it('starts each level where the one below it ends', () => {
    for (let level = 1; level < MAX_LEVEL; level++) {
      expect(xpAtLevelStart(level + 1), `level ${level + 1}`).toBe(
        xpAtLevelStart(level) + xpForLevel(level),
      );
    }
  });

  it('costs nothing to advance out of the cap: there is no level 56', () => {
    expect(xpForLevel(MAX_LEVEL)).toBe(0);
    expect(xpForLevel(MAX_LEVEL + 10)).toBe(0);
  });

  it('clamps a level outside the ladder rather than reading past the table', () => {
    expect(xpAtLevelStart(0)).toBe(0);
    expect(xpAtLevelStart(-5)).toBe(0);
    expect(xpAtLevelStart(MAX_LEVEL + 10)).toBe(XP_TO_MAX);
  });
});

describe('the level a total puts you at', () => {
  it('is 1 at zero, and at anything below the first boundary', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(LEVEL_XP[0]! - 1)).toBe(1);
  });

  it('is the next level exactly on the boundary, not one XP later', () => {
    for (const level of [2, 3, 11, 30, 54, MAX_LEVEL]) {
      const start = xpAtLevelStart(level);
      expect(levelForXp(start), `level ${level} on the seam`).toBe(level);
      expect(levelForXp(start - 1), `level ${level} one short`).toBe(level - 1);
    }
  });

  it('treats a negative total as zero', () => {
    expect(levelForXp(-1)).toBe(1);
    expect(levelForXp(-999_999)).toBe(1);
  });

  it('stops at the cap however much is earned past it', () => {
    expect(levelForXp(XP_TO_MAX)).toBe(MAX_LEVEL);
    expect(levelForXp(XP_TO_MAX * 10)).toBe(MAX_LEVEL);
  });
});

describe('progress through a level', () => {
  it('is nothing into level 1 on a fresh profile', () => {
    expect(levelProgress(0)).toEqual({
      level: 1,
      into: 0,
      span: LEVEL_XP[0],
      fraction: 0,
      atCap: false,
    });
  });

  it('reports the fraction through the current level', () => {
    const span = xpForLevel(1);
    const progress = levelProgress(span / 2);
    expect(progress.level).toBe(1);
    expect(progress.into).toBe(span / 2);
    expect(progress.fraction).toBeCloseTo(0.5, 10);
    expect(progress.atCap).toBe(false);
  });

  it('resets `into` at each boundary', () => {
    const progress = levelProgress(xpAtLevelStart(12));
    expect(progress.level).toBe(12);
    expect(progress.into).toBe(0);
    expect(progress.fraction).toBe(0);
  });

  it('is full and capped at the top, with nothing ahead', () => {
    const progress = levelProgress(XP_TO_MAX);
    expect(progress.level).toBe(MAX_LEVEL);
    expect(progress.span).toBe(0);
    expect(progress.fraction).toBe(1);
    expect(progress.atCap).toBe(true);
  });

  it('stays full past the cap rather than overflowing', () => {
    const progress = levelProgress(XP_TO_MAX + 500_000);
    expect(progress.fraction).toBe(1);
    expect(progress.atCap).toBe(true);
  });

  it('never reports a fraction outside 0..1', () => {
    for (const xp of [0, 1, 1000, 50_000, 900_000, XP_TO_MAX, XP_TO_MAX * 2]) {
      const { fraction } = levelProgress(xp);
      expect(fraction, `at ${xp}`).toBeGreaterThanOrEqual(0);
      expect(fraction, `at ${xp}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('prestige', () => {
  it('needs the cap, and refuses once the icons run out', () => {
    expect(canPrestige(MAX_LEVEL, 0)).toBe(true);
    expect(canPrestige(MAX_LEVEL - 1, 0)).toBe(false);
    expect(canPrestige(MAX_LEVEL, PRESTIGE_MAX)).toBe(false);
    expect(canPrestige(MAX_LEVEL, PRESTIGE_MAX - 1)).toBe(true);
  });

  it('grants one token, deliberately', () => {
    expect(TOKENS_PER_PRESTIGE).toBe(1);
  });

  it('labels every prestige in range, and clamps outside it', () => {
    expect(prestigeLabel(0)).toBe('');
    for (let p = 1; p <= PRESTIGE_MAX; p++) {
      expect(prestigeLabel(p).length, `prestige ${p}`).toBeGreaterThan(0);
    }
    expect(prestigeLabel(PRESTIGE_MAX + 5)).toBe(prestigeLabel(PRESTIGE_MAX));
    expect(prestigeLabel(-1)).toBe(prestigeLabel(0));
  });
});
