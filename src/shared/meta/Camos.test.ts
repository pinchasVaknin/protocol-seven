import { describe, expect, it } from 'vitest';
import { CAMO_IDS, CAMO_PREREQUISITES, CAMOS, camoDef, isCamoId, type CamoId } from './Camos';

/**
 * The six finishes, as data (A18).
 *
 * `CAMO_IDS` is derived from the table's own key order at load, and `CAMO_PREREQUISITES` is
 * written out by hand — so the two can drift, and the thing that would notice is OBSIDIAN
 * silently needing the wrong five. The last block is that check.
 */

describe('looking a camo up', () => {
  it('finds every shipped id', () => {
    for (const id of CAMO_IDS) expect(camoDef(id).id).toBe(id);
  });

  it('returns the table’s own object', () => {
    expect(camoDef('gold')).toBe(CAMOS.gold);
  });

  it('tells a camo id from any other string, for the save repair', () => {
    expect(isCamoId('gold')).toBe(true);
    expect(isCamoId('obsidian')).toBe(true);
    expect(isCamoId('')).toBe(false);
    expect(isCamoId('GOLD')).toBe(false);
    expect(isCamoId('chrome')).toBe(false);
  });
});

describe('the table', () => {
  it('lists the six, in declaration order', () => {
    expect(CAMO_IDS).toEqual(['digital', 'splinter', 'tiger', 'fractal', 'gold', 'obsidian']);
  });

  it('gives every camo a name and an authored requirement line', () => {
    for (const id of CAMO_IDS) {
      const def = camoDef(id);
      expect(def.name.length, id).toBeGreaterThan(0);
      expect(def.requirement.length, id).toBeGreaterThan(0);
    }
  });

  it('keys every entry by its own id', () => {
    for (const [key, def] of Object.entries(CAMOS)) expect(def.id).toBe(key);
  });
});

describe('what OBSIDIAN is built on', () => {
  it('is the other five, and never itself', () => {
    expect(CAMO_PREREQUISITES).toEqual(['digital', 'splinter', 'tiger', 'fractal', 'gold']);
    expect(CAMO_PREREQUISITES).not.toContain('obsidian');
  });

  it('is every camo but OBSIDIAN, so the two lists cannot drift apart', () => {
    const everythingElse = CAMO_IDS.filter((id) => id !== 'obsidian');
    expect([...CAMO_PREREQUISITES]).toEqual(everythingElse);
  });

  it('names only real camos', () => {
    for (const id of CAMO_PREREQUISITES) expect(isCamoId(id as CamoId)).toBe(true);
  });
});
