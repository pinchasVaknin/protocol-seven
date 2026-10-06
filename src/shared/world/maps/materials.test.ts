import { describe, expect, it } from 'vitest';
import {
  DECAL_HOLE_FRACTION,
  DECAL_RIM_FRACTION,
  DECAL_RIM_MAX_M,
  DECAL_RIM_MIN_M,
  surfaceAtIndex,
  surfaceOf,
} from './materials';
import { MATERIAL_KEYS, materialIndex } from './types';

/**
 * The surface table, and the bridge between a material key and the integer a collider stores.
 *
 * Two things are worth a test here. Every key must have a row — a missing one would read as
 * `undefined` under `noUncheckedIndexedAccess` and reach the renderer as a hole. And
 * `surfaceAtIndex` must agree with `surfaceOf` for every key, because they are two routes to
 * the same answer: one from the authored name, one from what `ColliderSet.materialAt` kept.
 */

describe('surfaceOf', () => {
  it('has a row for every material key', () => {
    for (const key of MATERIAL_KEYS) {
      expect(surfaceOf(key)).toBeDefined();
    }
  });

  it('returns the same object each time, so nothing allocates per lookup', () => {
    expect(surfaceOf('concrete')).toBe(surfaceOf('concrete'));
  });

  it('gives different materials different surfaces', () => {
    expect(surfaceOf('concrete')).not.toBe(surfaceOf('metal'));
  });
});

describe('surfaceAtIndex', () => {
  it('agrees with surfaceOf for every key, which is the whole point of the index', () => {
    for (const key of MATERIAL_KEYS) {
      expect(surfaceAtIndex(materialIndex(key))).toBe(surfaceOf(key));
    }
  });

  it('falls back to concrete out of range rather than returning nothing', () => {
    expect(surfaceAtIndex(-1)).toBe(surfaceOf('concrete'));
    expect(surfaceAtIndex(MATERIAL_KEYS.length)).toBe(surfaceOf('concrete'));
    expect(surfaceAtIndex(9999)).toBe(surfaceOf('concrete'));
  });

  it('never returns undefined, so no call site needs a guard', () => {
    for (let i = -3; i < MATERIAL_KEYS.length + 3; i++) {
      expect(surfaceAtIndex(i)).toBeDefined();
    }
  });
});

describe('the decal fractions', () => {
  it('put the rim outside the hole and inside the footprint', () => {
    expect(DECAL_HOLE_FRACTION).toBe(0.44);
    expect(DECAL_RIM_FRACTION).toBe(0.96);
    expect(DECAL_HOLE_FRACTION).toBeLessThan(DECAL_RIM_FRACTION);
    expect(DECAL_RIM_FRACTION).toBeLessThan(1);
  });

  it('bound the rim in metres, low below high', () => {
    expect(DECAL_RIM_MIN_M).toBe(0.05);
    expect(DECAL_RIM_MAX_M).toBe(0.12);
    expect(DECAL_RIM_MIN_M).toBeLessThan(DECAL_RIM_MAX_M);
  });
});
