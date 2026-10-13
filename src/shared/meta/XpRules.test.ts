import { describe, expect, it } from 'vitest';
import {
  LONGSHOT_METRES,
  matchFloorLine,
  matchMinutes,
  WEAPON_XP_FRACTION,
  XP_SOURCES,
  xpSource,
  xpSourceAt,
  xpSourceIndex,
  type XpSourceId,
} from './XpRules';

/**
 * The one XP table both runtimes read (A18).
 *
 * `xpSourceIndex` and `xpSourceAt` are the wire's two halves — a summary line crosses as an
 * index — so they are pinned as a round trip over every row rather than on an example. The
 * table's order is therefore behaviour and not presentation, and the first block says so.
 *
 * `LONGSHOT_METRES` gets a block of its own because A18 deletes `Challenges.ts`'s local copy of
 * it in favour of this export: the value has to be the one both files were already using.
 */

describe('the table', () => {
  it('lands the floor first, which is the row that always lands', () => {
    expect(XP_SOURCES[0]?.id).toBe('matchComplete');
    expect(XP_SOURCES[1]?.id).toBe('matchTime');
  });

  it('gives every row a positive value and a label', () => {
    for (const source of XP_SOURCES) {
      expect(source.value, source.id).toBeGreaterThan(0);
      expect(source.label.length, source.id).toBeGreaterThan(0);
      expect(['flat', 'each'], source.id).toContain(source.kind);
    }
  });

  it('lists every id exactly once', () => {
    const ids = XP_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('looking a source up', () => {
  it('finds every row by id', () => {
    for (const source of XP_SOURCES) expect(xpSource(source.id)).toBe(source);
  });

  it('round-trips every row through its wire index', () => {
    for (const source of XP_SOURCES) {
      const index = xpSourceIndex(source.id);
      expect(index, source.id).toBeGreaterThanOrEqual(0);
      expect(xpSourceAt(index), source.id).toBe(source);
    }
  });

  it('indexes by position in the table, which is what the wire carries', () => {
    expect(xpSourceIndex('matchComplete')).toBe(0);
    expect(xpSourceIndex('matchTime')).toBe(1);
  });

  it('returns undefined for an index off the end rather than guessing', () => {
    expect(xpSourceAt(XP_SOURCES.length)).toBe(undefined);
    expect(xpSourceAt(999)).toBe(undefined);
    expect(xpSourceAt(-1)).toBe(undefined);
  });

  it('throws for an id that is not in the table', () => {
    expect(() => xpSource('not_a_source' as XpSourceId)).toThrow();
  });
});

describe('whole minutes of match', () => {
  it('floors rather than rounds, so a short match pays no time row at all', () => {
    expect(matchMinutes(0)).toBe(0);
    expect(matchMinutes(59)).toBe(0);
    expect(matchMinutes(60)).toBe(1);
    expect(matchMinutes(119)).toBe(1);
    expect(matchMinutes(600)).toBe(10);
  });

  it('never goes negative', () => {
    expect(matchMinutes(-1)).toBe(0);
    expect(matchMinutes(-600)).toBe(0);
  });
});

describe('the floor line', () => {
  it('is the match-complete row, counted once', () => {
    const line = matchFloorLine();
    expect(line.id).toBe('matchComplete');
    expect(line.count).toBe(1);
    expect(line.xp).toBe(xpSource('matchComplete').value);
    expect(line.label).toBe(xpSource('matchComplete').label);
  });

  it('is a fresh line each time, so a caller cannot disturb the next one', () => {
    expect(matchFloorLine()).not.toBe(matchFloorLine());
    expect(matchFloorLine()).toEqual(matchFloorLine());
  });
});

describe('the two thresholds other files read', () => {
  it('puts a longshot at 38 metres', () => {
    // `Challenges.ts` and `MatchLedger.ts` both measure against this one number.
    expect(LONGSHOT_METRES).toBe(38);
  });

  it('pays weapon XP as a fraction of the account’s', () => {
    expect(WEAPON_XP_FRACTION).toBeGreaterThan(0);
    expect(WEAPON_XP_FRACTION).toBeLessThanOrEqual(1);
  });
});
