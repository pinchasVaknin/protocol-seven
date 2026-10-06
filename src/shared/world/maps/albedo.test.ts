import { describe, expect, it } from 'vitest';
import { allMaterialBaseColors, materialBaseColor } from './albedo';
import { MATERIAL_KEYS } from './types';

/**
 * Base colours, and the refusal that is the point of the file.
 *
 * `materialBaseColor` **throws** on a key with no row rather than returning `0x000000`, because
 * a default on a lookup table turns a missing row into a silently wrong picture — a material
 * added to `MATERIAL_KEYS` and forgotten here would render black and nobody would know which
 * black was wrong. The throw is asserted, not just the happy path.
 *
 * `readability` measures ground luminance off these numbers, which is how a 2% albedo was
 * found to be the real cause of a map reading as pitch black.
 */

describe('materialBaseColor', () => {
  it('has a colour for every material key', () => {
    for (const key of MATERIAL_KEYS) {
      expect(() => materialBaseColor(key)).not.toThrow();
    }
  });

  it('returns a 24-bit colour, never negative and never over white', () => {
    for (const key of MATERIAL_KEYS) {
      const colour = materialBaseColor(key);
      expect(Number.isInteger(colour)).toBe(true);
      expect(colour).toBeGreaterThanOrEqual(0);
      expect(colour).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('throws for a key with no row, rather than painting it black', () => {
    // Cast, because the whole protection is that TypeScript refuses this at the call sites.
    expect(() => materialBaseColor('nosuchmaterial' as (typeof MATERIAL_KEYS)[number])).toThrow(
      /has no base colour/,
    );
  });
});

describe('allMaterialBaseColors', () => {
  it('walks the whole table, in MATERIAL_KEYS order', () => {
    const rows = allMaterialBaseColors();

    expect(rows).toHaveLength(MATERIAL_KEYS.length);
    expect(rows.map(([key]) => key)).toEqual([...MATERIAL_KEYS]);
  });

  it('pairs each key with what materialBaseColor returns for it', () => {
    for (const [key, colour] of allMaterialBaseColors()) {
      expect(colour).toBe(materialBaseColor(key));
    }
  });
});
