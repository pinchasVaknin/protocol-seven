import { describe, expect, it } from 'vitest';
import { MATERIAL_KEYS, materialIndex } from './types';

/**
 * The material list, and the one property that makes it dangerous to tidy.
 *
 * `materialIndex` returns a position in this array and `ColliderSet` **stores that integer**.
 * So the list is append-only, and not as a style preference: reordering it silently remaps
 * every material in every collider already built, and nothing would throw. A sorted-looking
 * list and a correct one are different lists.
 *
 * Pinned as an exact sequence rather than as a set, which is what makes a reorder a red test
 * instead of a rendering mystery.
 */

describe('MATERIAL_KEYS', () => {
  it('is this exact sequence, because ColliderSet stores the index', () => {
    expect([...MATERIAL_KEYS]).toEqual([
      'concrete',
      'concreteDark',
      'floor',
      'metal',
      'hazard',
      'accent',
      'rubber',
      'brick',
      'rust',
      'grate',
      'sand',
      'plaster',
      'clayTile',
      'wood',
      'asphalt',
      'paintedSteel',
    ]);
  });

  it('holds sixteen keys, none of them repeated', () => {
    expect(MATERIAL_KEYS).toHaveLength(16);
    expect(new Set(MATERIAL_KEYS).size).toBe(16);
  });

  it('keeps the first ten in their pre-M8 positions, which is what append-only means', () => {
    expect(MATERIAL_KEYS.slice(0, 10)).toEqual([
      'concrete',
      'concreteDark',
      'floor',
      'metal',
      'hazard',
      'accent',
      'rubber',
      'brick',
      'rust',
      'grate',
    ]);
  });
});

describe('materialIndex', () => {
  it('is the position in MATERIAL_KEYS, for every key', () => {
    MATERIAL_KEYS.forEach((key, at) => {
      expect(materialIndex(key)).toBe(at);
    });
  });

  it('round-trips through the list', () => {
    for (const key of MATERIAL_KEYS) {
      expect(MATERIAL_KEYS[materialIndex(key)]).toBe(key);
    }
  });

  it('gives concrete index zero, which is what every fallback leans on', () => {
    expect(materialIndex('concrete')).toBe(0);
  });
});
