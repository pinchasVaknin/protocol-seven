import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { findMap } from '../../shared/modes/ModeRegistry';
import { loadMapCollision } from '../../shared/world/MapLoader';
import type { MaterialKey } from '../../shared/world/maps/types';
import { buildBoxGeometry, type AoSettings, type BoxSpec } from './MapMesher';

/**
 * Characterization tests for the brush mesher (C10).
 *
 * Written against the unmodified file and green on it before a line of production code moved.
 *
 * The AO bake is floating-point arithmetic against a real `CollisionWorld`, and the whole point
 * of pinning it is that every one of those floats stays where it is — so the colour buffers are
 * compared as whole arrays rather than by a tolerance, and the inline snapshots hold the bytes
 * of the shipped maps' own geometry.
 */

const IDENTITY: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function box(overrides: Partial<BoxSpec> = {}): BoxSpec {
  return {
    cx: 0,
    cy: 0,
    cz: 0,
    hx: 0.5,
    hy: 0.5,
    hz: 0.5,
    basis: [...IDENTITY],
    material: 'concrete' as MaterialKey,
    uvScale: 2,
    ...overrides,
  };
}

function only(built: Map<MaterialKey, THREE.BufferGeometry>): THREE.BufferGeometry {
  expect(built.size).toBe(1);
  const geometry = [...built.values()][0];
  if (geometry === undefined) throw new Error('no geometry');
  return geometry;
}

function floats(geometry: THREE.BufferGeometry, name: string): number[] {
  return [...(geometry.getAttribute(name).array as Float32Array)].map((v) => Math.round(v * 1e6) / 1e6);
}

/** FNV-1a over the raw float32 bytes: a whole attribute as one comparable value. */
function hashAttribute(geometry: THREE.BufferGeometry, name: string): string {
  const array = geometry.getAttribute(name).array as Float32Array;
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let h = 0x811c9dc5;
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('buildBoxGeometry grouping', () => {
  it('produces nothing for no boxes', () => {
    expect(buildBoxGeometry([], null, 1.6).size).toBe(0);
  });

  it('merges every box of one material into one geometry', () => {
    const one = only(buildBoxGeometry([box()], null, 1.6));
    const two = only(buildBoxGeometry([box(), box({ cx: 4 })], null, 1.6));
    expect(two.getAttribute('position').count).toBe(one.getAttribute('position').count * 2);
    expect(two.getIndex()?.count).toBe((one.getIndex()?.count ?? 0) * 2);
  });

  it('keeps one geometry per material, in the order the materials were first seen', () => {
    const built = buildBoxGeometry(
      [
        box({ material: 'metal' as MaterialKey }),
        box({ material: 'concrete' as MaterialKey }),
        box({ material: 'metal' as MaterialKey, cx: 3 }),
      ],
      null,
      1.6,
    );
    expect([...built.keys()]).toEqual(['metal', 'concrete']);
  });

  it('indexes the merged geometry and gives it a bounding sphere', () => {
    const geometry = only(buildBoxGeometry([box({ cx: 5, cy: 1, cz: -2 })], null, 1.6));
    expect(geometry.getIndex()).not.toBe(null);
    expect(geometry.boundingSphere).not.toBe(null);
    expect(geometry.boundingSphere?.center.toArray().map((v) => Math.round(v * 1e5) / 1e5)).toEqual([5, 1, -2]);
    for (const name of ['position', 'normal', 'uv', 'color']) {
      expect(geometry.getAttribute(name)).toBeDefined();
    }
    expect(geometry.getAttribute('position').itemSize).toBe(3);
    expect(geometry.getAttribute('uv').itemSize).toBe(2);
  });

  it('emits six faces of two triangles each for the smallest box', () => {
    const geometry = only(buildBoxGeometry([box({ hx: 0.1, hy: 0.1, hz: 0.1 })], null, 1.6));
    // One division a side: 2 x 2 samples per face, 6 faces.
    expect(geometry.getAttribute('position').count).toBe(6 * 4);
    expect(geometry.getIndex()?.count).toBe(6 * 2 * 3);
  });
});

describe('buildBoxGeometry tessellation', () => {
  it('subdivides a face toward the target spacing', () => {
    const coarse = only(buildBoxGeometry([box({ hx: 4, hy: 4, hz: 4 })], null, 4));
    const fine = only(buildBoxGeometry([box({ hx: 4, hy: 4, hz: 4 })], null, 0.5));
    expect(fine.getAttribute('position').count).toBeGreaterThan(coarse.getAttribute('position').count);
  });

  it('caps the divisions at 24 a side however large the face is', () => {
    const huge = only(buildBoxGeometry([box({ hx: 200, hy: 200, hz: 200 })], null, 0.1));
    // 25 uniform samples plus the four inset rows, on every one of the six faces.
    expect(huge.getAttribute('position').count).toBe(6 * 29 * 29);
  });

  it('adds the two inset rows a side only on a face wider than 0.45 m', () => {
    const narrow = only(buildBoxGeometry([box({ hx: 0.2, hy: 0.2, hz: 0.2 })], null, 1.6));
    const wide = only(buildBoxGeometry([box({ hx: 0.3, hy: 0.3, hz: 0.3 })], null, 1.6));
    expect(narrow.getAttribute('position').count).toBe(6 * 2 * 2);
    // 0.6 m across clears the 0.45 threshold; the 0.09 inset fits inside 0.7 of the half-extent
    // and the 0.3 one does not, so one extra row lands at each edge.
    expect(wide.getAttribute('position').count).toBe(6 * 4 * 4);
  });

  it('drops samples that landed on top of each other', () => {
    // An inset that coincides with the uniform grid must not produce a duplicated row.
    const geometry = only(buildBoxGeometry([box({ hx: 0.5, hy: 0.5, hz: 0.5 })], null, 0.82));
    const positions = geometry.getAttribute('position');
    const seen = new Set<string>();
    for (let i = 0; i < positions.count; i++) {
      seen.add(`${positions.getX(i)},${positions.getY(i)},${positions.getZ(i)}`);
    }
    // Faces share corner positions, so the set is smaller than the count; what matters is that
    // no face repeats a sample row, which shows up as an index count that is still 6 * 2 * (n-1)^2.
    expect(seen.size).toBeGreaterThan(0);
    const perFace = positions.count / 6;
    const side = Math.sqrt(perFace);
    expect(Number.isInteger(side)).toBe(true);
    expect(geometry.getIndex()?.count).toBe(6 * (side - 1) * (side - 1) * 6);
  });

  it('pins the sample positions of a one-metre cube', () => {
    expect(floats(only(buildBoxGeometry([box()], null, 1.6)), 'position')).toMatchInlineSnapshot(`
      [
        0.5,
        -0.5,
        -0.5,
        0.5,
        -0.41,
        -0.5,
        0.5,
        -0.2,
        -0.5,
        0.5,
        0.2,
        -0.5,
        0.5,
        0.41,
        -0.5,
        0.5,
        0.5,
        -0.5,
        0.5,
        -0.5,
        -0.41,
        0.5,
        -0.41,
        -0.41,
        0.5,
        -0.2,
        -0.41,
        0.5,
        0.2,
        -0.41,
        0.5,
        0.41,
        -0.41,
        0.5,
        0.5,
        -0.41,
        0.5,
        -0.5,
        -0.2,
        0.5,
        -0.41,
        -0.2,
        0.5,
        -0.2,
        -0.2,
        0.5,
        0.2,
        -0.2,
        0.5,
        0.41,
        -0.2,
        0.5,
        0.5,
        -0.2,
        0.5,
        -0.5,
        0.2,
        0.5,
        -0.41,
        0.2,
        0.5,
        -0.2,
        0.2,
        0.5,
        0.2,
        0.2,
        0.5,
        0.41,
        0.2,
        0.5,
        0.5,
        0.2,
        0.5,
        -0.5,
        0.41,
        0.5,
        -0.41,
        0.41,
        0.5,
        -0.2,
        0.41,
        0.5,
        0.2,
        0.41,
        0.5,
        0.41,
        0.41,
        0.5,
        0.5,
        0.41,
        0.5,
        -0.5,
        0.5,
        0.5,
        -0.41,
        0.5,
        0.5,
        -0.2,
        0.5,
        0.5,
        0.2,
        0.5,
        0.5,
        0.41,
        0.5,
        0.5,
        0.5,
        0.5,
        -0.5,
        -0.5,
        -0.5,
        -0.5,
        -0.5,
        -0.41,
        -0.5,
        -0.5,
        -0.2,
        -0.5,
        -0.5,
        0.2,
        -0.5,
        -0.5,
        0.41,
        -0.5,
        -0.5,
        0.5,
        -0.5,
        -0.41,
        -0.5,
        -0.5,
        -0.41,
        -0.41,
        -0.5,
        -0.41,
        -0.2,
        -0.5,
        -0.41,
        0.2,
        -0.5,
        -0.41,
        0.41,
        -0.5,
        -0.41,
        0.5,
        -0.5,
        -0.2,
        -0.5,
        -0.5,
        -0.2,
        -0.41,
        -0.5,
        -0.2,
        -0.2,
        -0.5,
        -0.2,
        0.2,
        -0.5,
        -0.2,
        0.41,
        -0.5,
        -0.2,
        0.5,
        -0.5,
        0.2,
        -0.5,
        -0.5,
        0.2,
        -0.41,
        -0.5,
        0.2,
        -0.2,
        -0.5,
        0.2,
        0.2,
        -0.5,
        0.2,
        0.41,
        -0.5,
        0.2,
        0.5,
        -0.5,
        0.41,
        -0.5,
        -0.5,
        0.41,
        -0.41,
        -0.5,
        0.41,
        -0.2,
        -0.5,
        0.41,
        0.2,
        -0.5,
        0.41,
        0.41,
        -0.5,
        0.41,
        0.5,
        -0.5,
        0.5,
        -0.5,
        -0.5,
        0.5,
        -0.41,
        -0.5,
        0.5,
        -0.2,
        -0.5,
        0.5,
        0.2,
        -0.5,
        0.5,
        0.41,
        -0.5,
        0.5,
        0.5,
        -0.5,
        0.5,
        -0.5,
        -0.5,
        0.5,
        -0.41,
        -0.5,
        0.5,
        -0.2,
        -0.5,
        0.5,
        0.2,
        -0.5,
        0.5,
        0.41,
        -0.5,
        0.5,
        0.5,
        -0.41,
        0.5,
        -0.5,
        -0.41,
        0.5,
        -0.41,
        -0.41,
        0.5,
        -0.2,
        -0.41,
        0.5,
        0.2,
        -0.41,
        0.5,
        0.41,
        -0.41,
        0.5,
        0.5,
        -0.2,
        0.5,
        -0.5,
        -0.2,
        0.5,
        -0.41,
        -0.2,
        0.5,
        -0.2,
        -0.2,
        0.5,
        0.2,
        -0.2,
        0.5,
        0.41,
        -0.2,
        0.5,
        0.5,
        0.2,
        0.5,
        -0.5,
        0.2,
        0.5,
        -0.41,
        0.2,
        0.5,
        -0.2,
        0.2,
        0.5,
        0.2,
        0.2,
        0.5,
        0.41,
        0.2,
        0.5,
        0.5,
        0.41,
        0.5,
        -0.5,
        0.41,
        0.5,
        -0.41,
        0.41,
        0.5,
        -0.2,
        0.41,
        0.5,
        0.2,
        0.41,
        0.5,
        0.41,
        0.41,
        0.5,
        0.5,
        0.5,
        0.5,
        -0.5,
        0.5,
        0.5,
        -0.41,
        0.5,
        0.5,
        -0.2,
        0.5,
        0.5,
        0.2,
        0.5,
        0.5,
        0.41,
        0.5,
        0.5,
        0.5,
        -0.5,
        -0.5,
        -0.5,
        -0.41,
        -0.5,
        -0.5,
        -0.2,
        -0.5,
        -0.5,
        0.2,
        -0.5,
        -0.5,
        0.41,
        -0.5,
        -0.5,
        0.5,
        -0.5,
        -0.5,
        -0.5,
        -0.5,
        -0.41,
        -0.41,
        -0.5,
        -0.41,
        -0.2,
        -0.5,
        -0.41,
        0.2,
        -0.5,
        -0.41,
        0.41,
        -0.5,
        -0.41,
        0.5,
        -0.5,
        -0.41,
        -0.5,
        -0.5,
        -0.2,
        -0.41,
        -0.5,
        -0.2,
        -0.2,
        -0.5,
        -0.2,
        0.2,
        -0.5,
        -0.2,
        0.41,
        -0.5,
        -0.2,
        0.5,
        -0.5,
        -0.2,
        -0.5,
        -0.5,
        0.2,
        -0.41,
        -0.5,
        0.2,
        -0.2,
        -0.5,
        0.2,
        0.2,
        -0.5,
        0.2,
        0.41,
        -0.5,
        0.2,
        0.5,
        -0.5,
        0.2,
        -0.5,
        -0.5,
        0.41,
        -0.41,
        -0.5,
        0.41,
        -0.2,
        -0.5,
        0.41,
        0.2,
        -0.5,
        0.41,
        0.41,
        -0.5,
        0.41,
        0.5,
        -0.5,
        0.41,
        -0.5,
        -0.5,
        0.5,
        -0.41,
        -0.5,
        0.5,
        -0.2,
        -0.5,
        0.5,
        0.2,
        -0.5,
        0.5,
        0.41,
        -0.5,
        0.5,
        0.5,
        -0.5,
        0.5,
        -0.5,
        -0.5,
        0.5,
        -0.41,
        -0.5,
        0.5,
        -0.2,
        -0.5,
        0.5,
        0.2,
        -0.5,
        0.5,
        0.41,
        -0.5,
        0.5,
        0.5,
        -0.5,
        0.5,
        -0.5,
        -0.41,
        0.5,
        -0.41,
        -0.41,
        0.5,
        -0.2,
        -0.41,
        0.5,
        0.2,
        -0.41,
        0.5,
        0.41,
        -0.41,
        0.5,
        0.5,
        -0.41,
        0.5,
        -0.5,
        -0.2,
        0.5,
        -0.41,
        -0.2,
        0.5,
        -0.2,
        -0.2,
        0.5,
        0.2,
        -0.2,
        0.5,
        0.41,
        -0.2,
        0.5,
        0.5,
        -0.2,
        0.5,
        -0.5,
        0.2,
        0.5,
        -0.41,
        0.2,
        0.5,
        -0.2,
        0.2,
        0.5,
        0.2,
        0.2,
        0.5,
        0.41,
        0.2,
        0.5,
        0.5,
        0.2,
        0.5,
        -0.5,
        0.41,
        0.5,
        -0.41,
        0.41,
        0.5,
        -0.2,
        0.41,
        0.5,
        0.2,
        0.41,
        0.5,
        0.41,
        0.41,
        0.5,
        0.5,
        0.41,
        0.5,
        -0.5,
        0.5,
        0.5,
        -0.41,
        0.5,
        0.5,
        -0.2,
        0.5,
        0.5,
        0.2,
        0.5,
        0.5,
        0.41,
        0.5,
        0.5,
        0.5,
        0.5,
        0.5,
        -0.5,
        -0.5,
        -0.5,
        -0.5,
        -0.41,
        -0.5,
        -0.5,
        -0.2,
        -0.5,
        -0.5,
        0.2,
        -0.5,
        -0.5,
        0.41,
        -0.5,
        -0.5,
        0.5,
        -0.5,
        -0.41,
        -0.5,
        -0.5,
        -0.41,
        -0.41,
        -0.5,
        -0.41,
        -0.2,
        -0.5,
        -0.41,
        0.2,
        -0.5,
        -0.41,
        0.41,
        -0.5,
        -0.41,
        0.5,
        -0.5,
        -0.2,
        -0.5,
        -0.5,
        -0.2,
        -0.41,
        -0.5,
        -0.2,
        -0.2,
        -0.5,
        -0.2,
        0.2,
        -0.5,
        -0.2,
        0.41,
        -0.5,
        -0.2,
        0.5,
        -0.5,
        0.2,
        -0.5,
        -0.5,
        0.2,
        -0.41,
        -0.5,
        0.2,
        -0.2,
        -0.5,
        0.2,
        0.2,
        -0.5,
        0.2,
        0.41,
        -0.5,
        0.2,
        0.5,
        -0.5,
        0.41,
        -0.5,
        -0.5,
        0.41,
        -0.41,
        -0.5,
        0.41,
        -0.2,
        -0.5,
        0.41,
        0.2,
        -0.5,
        0.41,
        0.41,
        -0.5,
        0.41,
        0.5,
        -0.5,
        0.5,
        -0.5,
        -0.5,
        0.5,
        -0.41,
        -0.5,
        0.5,
        -0.2,
        -0.5,
        0.5,
        0.2,
        -0.5,
        0.5,
        0.41,
        -0.5,
        0.5,
        0.5,
        -0.5,
      ]
    `);
  });
});

describe('buildBoxGeometry world-projected UVs', () => {
  it('is continuous across two brushes that share a face', () => {
    const left = box({ cx: -1, hx: 1, hy: 1, hz: 1, uvScale: 2 });
    const right = box({ cx: 1, hx: 1, hy: 1, hz: 1, uvScale: 2 });
    const merged = only(buildBoxGeometry([left, right], null, 1.6));
    const uv = merged.getAttribute('uv');
    const position = merged.getAttribute('position');
    // Every vertex's UV is its own world position on the face axes over the scale, so two
    // vertices at the same world point carry the same UV whichever brush emitted them.
    const byPoint = new Map<string, string>();
    let shared = 0;
    for (let i = 0; i < position.count; i++) {
      const key = `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;
      const value = `${uv.getX(i).toFixed(4)},${uv.getY(i).toFixed(4)}`;
      const previous = byPoint.get(key);
      if (previous !== undefined && previous === value) shared++;
      byPoint.set(key, value);
    }
    expect(shared).toBeGreaterThan(0);
  });

  it('divides the projection by the brush\'s own uv scale', () => {
    const at2 = only(buildBoxGeometry([box({ cx: 4, uvScale: 2 })], null, 1.6)).getAttribute('uv');
    const at4 = only(buildBoxGeometry([box({ cx: 4, uvScale: 4 })], null, 1.6)).getAttribute('uv');
    for (let i = 0; i < at2.count; i++) {
      expect(at4.getX(i) * 2).toBeCloseTo(at2.getX(i), 5);
      expect(at4.getY(i) * 2).toBeCloseTo(at2.getY(i), 5);
    }
  });

  it('follows the brush basis rather than the world axes', () => {
    const c = Math.cos(Math.PI / 4);
    const turned = box({ basis: [c, 0, -c, 0, 1, 0, c, 0, c], hx: 1, hy: 1, hz: 1 });
    const normals = only(buildBoxGeometry([turned], null, 1.6)).getAttribute('normal');
    const seen = new Set<string>();
    for (let i = 0; i < normals.count; i++) {
      seen.add(`${normals.getX(i).toFixed(3)},${normals.getY(i).toFixed(3)},${normals.getZ(i).toFixed(3)}`);
    }
    expect([...seen].sort()).toMatchInlineSnapshot(`
      [
        "-0.707,0.000,-0.707",
        "-0.707,0.000,0.707",
        "0.000,-1.000,0.000",
        "0.000,1.000,0.000",
        "0.707,0.000,-0.707",
        "0.707,0.000,0.707",
      ]
    `);
  });
});

describe('buildBoxGeometry shading without a collision world', () => {
  it('darkens the bottom of a prop and leaves its top alone', () => {
    const geometry = only(buildBoxGeometry([box({ cy: 1, hy: 1 })], null, 0.6));
    const color = geometry.getAttribute('color');
    const position = geometry.getAttribute('position');
    let lowest = Infinity;
    let highest = -Infinity;
    let lowShade = 0;
    let highShade = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y < lowest) { lowest = y; lowShade = color.getX(i); }
      if (y > highest) { highest = y; highShade = color.getX(i); }
    }
    expect(lowShade).toBeCloseTo(0.55, 6);
    expect(highShade).toBeCloseTo(1, 6);
    expect(lowShade).toBeLessThan(highShade);
  });

  it('writes the same shade into all three channels', () => {
    const color = only(buildBoxGeometry([box({ cy: 1, hy: 1 })], null, 0.6)).getAttribute('color');
    for (let i = 0; i < color.count; i++) {
      expect(color.getY(i)).toBe(color.getX(i));
      expect(color.getZ(i)).toBe(color.getX(i));
    }
  });

  it('saturates to white over the top five-eighths of the box', () => {
    const geometry = only(buildBoxGeometry([box({ cy: 4, hy: 4 })], null, 1.6));
    const color = geometry.getAttribute('color');
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const t = (position.getY(i) - 0) / 8;
      if (t * 1.6 >= 1) expect(color.getX(i)).toBeCloseTo(1, 6);
    }
  });

  it('leaves a flat box at full brightness rather than dividing by zero', () => {
    const color = only(buildBoxGeometry([box({ hy: 0 })], null, 1.6)).getAttribute('color');
    for (let i = 0; i < color.count; i++) expect(Number.isFinite(color.getX(i))).toBe(true);
  });
});

describe('buildBoxGeometry ambient occlusion', () => {
  const world = loadMapCollision(findMap('mp_foundry').def).collision;
  const pillar = box({ cx: 0, cy: 1, cz: 0, hx: 1.5, hy: 1, hz: 1.5 });

  it('bakes a shade per vertex into the colour buffer', () => {
    const color = only(buildBoxGeometry([pillar], world, 1.6)).getAttribute('color');
    const shades = new Set<number>();
    for (let i = 0; i < color.count; i++) shades.add(Math.round(color.getX(i) * 1e6));
    expect(shades.size).toBeGreaterThan(1);
  });

  it('never goes below the floor or above full brightness', () => {
    const ao: AoSettings = { distance: 2.2, samples: 6, floor: 0.32, bias: 0.02 };
    const color = only(buildBoxGeometry([pillar], world, 1.6, ao)).getAttribute('color');
    for (let i = 0; i < color.count; i++) {
      expect(color.getX(i)).toBeGreaterThanOrEqual(ao.floor - 1e-6);
      expect(color.getX(i)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('honours the floor it is given', () => {
    const dark = only(buildBoxGeometry([pillar], world, 1.6, { distance: 4, samples: 16, floor: 0, bias: 0.02 }));
    const light = only(buildBoxGeometry([pillar], world, 1.6, { distance: 4, samples: 16, floor: 0.8, bias: 0.02 }));
    const darkColor = dark.getAttribute('color');
    const lightColor = light.getAttribute('color');
    for (let i = 0; i < darkColor.count; i++) {
      expect(lightColor.getX(i)).toBeGreaterThanOrEqual(darkColor.getX(i) - 1e-6);
      expect(lightColor.getX(i)).toBeGreaterThanOrEqual(0.8 - 1e-6);
    }
  });

  it('caps the sample count at the bundle it generated', () => {
    const asked = only(buildBoxGeometry([pillar], world, 1.6, { distance: 2.2, samples: 999, floor: 0.32, bias: 0.02 }));
    const capped = only(buildBoxGeometry([pillar], world, 1.6, { distance: 2.2, samples: 16, floor: 0.32, bias: 0.02 }));
    expect(floats(asked, 'color')).toEqual(floats(capped, 'color'));
  });

  it('takes at least one sample however few it is asked for', () => {
    const none = only(buildBoxGeometry([pillar], world, 1.6, { distance: 2.2, samples: 0, floor: 0.32, bias: 0.02 }));
    const one = only(buildBoxGeometry([pillar], world, 1.6, { distance: 2.2, samples: 1, floor: 0.32, bias: 0.02 }));
    expect(floats(none, 'color')).toEqual(floats(one, 'color'));
  });

  it('bakes the same ray bundle on every load', () => {
    const a = only(buildBoxGeometry([pillar], world, 1.6));
    const b = only(buildBoxGeometry([pillar], world, 1.6));
    expect(hashAttribute(a, 'color')).toBe(hashAttribute(b, 'color'));
  });

  it('pins the bake against each shipped map, bit for bit', () => {
    const rows = ['mp_foundry', 'mp_dunes', 'mp_depot', 'mp_testbed'].map((id) => {
      const collision = loadMapCollision(findMap(id).def).collision;
      const geometry = only(buildBoxGeometry([pillar], collision, 1.6));
      return `${id} ${hashAttribute(geometry, 'color')} ${hashAttribute(geometry, 'position')} ${hashAttribute(geometry, 'normal')} ${hashAttribute(geometry, 'uv')}`;
    });
    expect(rows).toMatchInlineSnapshot(`
      [
        "mp_foundry dad1f81f ac6e361d 4ba15975 c8e35f45",
        "mp_dunes 5a59314a ac6e361d 4ba15975 c8e35f45",
        "mp_depot 97582fde ac6e361d 4ba15975 c8e35f45",
        "mp_testbed 79990ca0 ac6e361d 4ba15975 c8e35f45",
      ]
    `);
  });

  it('pins the bake at a second settings bundle', () => {
    const geometry = only(buildBoxGeometry([pillar], world, 1.6, { distance: 4, samples: 16, floor: 0.1, bias: 0.05 }));
    expect(hashAttribute(geometry, 'color')).toMatchInlineSnapshot(`"c9e328ec"`);
  });
});
