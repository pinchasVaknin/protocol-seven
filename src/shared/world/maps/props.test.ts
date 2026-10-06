import { describe, expect, it } from 'vitest';
import { PROP_SHAPES } from './props';
import type { PropShapeId } from './types';

/**
 * The prop catalogue, checked without being edited.
 *
 * Some of these boxes are **generated**: the resupply station's four are the transformed bounds
 * of the welded `station_ammo.glb` geometry, computed by `scripts/prop-assemble.mjs` in the same
 * pass that built the model, and the file says of them *"paste them, do not edit them"*. So
 * nothing here asserts a coordinate. What it asserts are the properties that hold however the
 * generator is re-run: every shape id has a row, every row knows its own id, and every part is
 * a box a capsule can be tested against.
 *
 * That last one is the collision contract (brief S4.3): the scheme is capsule versus oriented
 * box and nothing else, so a part with a zero or negative extent is not a degenerate picture,
 * it is a collider the player walks through.
 */

const EXPECTED_IDS: readonly PropShapeId[] = [
  'crate',
  'crateTall',
  'pillar',
  'barrier',
  'lightBox',
  'container',
  'machine',
  'barrels',
  'girder',
  'ladle',
  'spool',
  'palm',
  'stall',
  'well',
  'sandbags',
  'containerBlue',
  'pallets',
  'lightMast',
  'forklift',
  'ammoCrate',
];

const SHAPES = Object.entries(PROP_SHAPES) as ReadonlyArray<
  readonly [PropShapeId, (typeof PROP_SHAPES)[PropShapeId]]
>;

describe('PROP_SHAPES', () => {
  it('has a row for every shape id the union declares, and no extras', () => {
    expect(Object.keys(PROP_SHAPES).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('gives every row the id it is keyed under', () => {
    for (const [key, shape] of SHAPES) {
      expect(shape.id).toBe(key);
    }
  });

  it('gives every shape at least one part', () => {
    for (const [key, shape] of SHAPES) {
      expect(shape.parts.length, key).toBeGreaterThan(0);
    }
  });
});

describe('every part is a box a capsule can be tested against', () => {
  it('has three positive extents', () => {
    for (const [key, shape] of SHAPES) {
      shape.parts.forEach((part, at) => {
        const where = `${key}[${at}]`;
        expect(part.size.x, where).toBeGreaterThan(0);
        expect(part.size.y, where).toBeGreaterThan(0);
        expect(part.size.z, where).toBeGreaterThan(0);
      });
    }
  });

  it('has a finite offset', () => {
    for (const [key, shape] of SHAPES) {
      shape.parts.forEach((part, at) => {
        const where = `${key}[${at}]`;
        expect(Number.isFinite(part.offset.x), where).toBe(true);
        expect(Number.isFinite(part.offset.y), where).toBe(true);
        expect(Number.isFinite(part.offset.z), where).toBe(true);
      });
    }
  });

  it('names a material and says whether it collides', () => {
    for (const [key, shape] of SHAPES) {
      shape.parts.forEach((part, at) => {
        const where = `${key}[${at}]`;
        expect(typeof part.material, where).toBe('string');
        expect(typeof part.solid, where).toBe('boolean');
      });
    }
  });

  it('sits on or above the base, since a placement is a ground position', () => {
    for (const [key, shape] of SHAPES) {
      shape.parts.forEach((part, at) => {
        // The origin is at the base, so the lowest face may touch y = 0 but not go under it
        // by more than the centimetre the generator shaves off a box.
        expect(part.offset.y - part.size.y / 2, `${key}[${at}]`).toBeGreaterThanOrEqual(-0.02);
      });
    }
  });
});

describe('the resupply station', () => {
  it('is four boxes, every one of them solid and none of them drawn', () => {
    const station = PROP_SHAPES.ammoCrate;

    expect(station.parts).toHaveLength(4);
    for (const part of station.parts) {
      expect(part.solid).toBe(true);
      expect(part.hidden).toBe(true);
    }
  });

  it('is the only shape whose parts are hidden, because it is the only one drawn from a model', () => {
    for (const [key, shape] of SHAPES) {
      if (key === 'ammoCrate') continue;
      for (const part of shape.parts) {
        expect(part.hidden, key).toBeUndefined();
      }
    }
  });
});

describe('the shapes cover derives from', () => {
  it('gives every shape with a collider at least one solid part', () => {
    const noSolid = SHAPES.filter(([, shape]) => !shape.parts.some((p) => p.solid)).map(([k]) => k);

    expect(noSolid).toEqual(['lightBox']);
  });
});
