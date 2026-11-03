import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ParticulateDef } from '../../shared/world/maps/types';
import { Particulate } from './Particulate';

/**
 * Characterization tests for the airborne particulate (C10).
 *
 * Written against the unmodified file and green on it before a line of production code moved.
 * The cloud is a seeded `Rng` and two wrap functions, so everything it does is a pure function
 * of the def and of the camera positions it is handed — which is what lets a node test pin it
 * exactly rather than approximately.
 */

const DUST: ParticulateDef = {
  count: 12,
  radius: 10,
  color: 0xc9ae83,
  size: 0.08,
  opacity: 0.5,
  drift: { x: 0.4, y: -0.1, z: 0.2 },
};

/** The position attribute's own array, which is the buffer the class writes into in place. */
function positionsOf(cloud: Particulate): Float32Array {
  const attribute = cloud.points.geometry.getAttribute('position');
  return attribute.array as Float32Array;
}

function roundedPositions(cloud: Particulate): number[] {
  return [...positionsOf(cloud)].map((v) => Math.round(v * 1e6) / 1e6);
}

describe('Particulate construction', () => {
  it('seeds the same cloud for the same def, every time', () => {
    const a = roundedPositions(new Particulate(DUST));
    const b = roundedPositions(new Particulate(DUST));
    expect(a).toEqual(b);
  });

  it('places the motes from a seed derived from the count', () => {
    expect(roundedPositions(new Particulate(DUST))).toMatchInlineSnapshot(`
      [
        -8.787828,
        0.997105,
        -2.009785,
        -4.096735,
        0.669785,
        4.51934,
        9.609072,
        2.849279,
        1.939155,
        -3.604672,
        1.907758,
        -9.208788,
        -2.553726,
        1.724541,
        2.665728,
        3.694798,
        5.27402,
        -2.011195,
        4.601651,
        4.500135,
        1.981477,
        -0.935765,
        0.217338,
        0.072732,
        -2.119488,
        3.230394,
        -2.165683,
        -6.986816,
        2.607983,
        9.583369,
        -2.855283,
        5.310848,
        -8.101473,
        -4.301165,
        1.20415,
        8.568849,
      ]
    `);
  });

  it('biases the motes low: no mote starts above 0.55 of the radius', () => {
    const cloud = new Particulate({ ...DUST, count: 400 });
    const pos = positionsOf(cloud);
    for (let i = 0; i < pos.length / 3; i++) {
      const y = pos[i * 3 + 1] ?? 0;
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(DUST.radius * 0.55);
    }
  });

  it('keeps x and z inside the box half-extent', () => {
    const cloud = new Particulate({ ...DUST, count: 400 });
    const pos = positionsOf(cloud);
    for (let i = 0; i < pos.length / 3; i++) {
      expect(Math.abs(pos[i * 3] ?? 0)).toBeLessThanOrEqual(DUST.radius);
      expect(Math.abs(pos[i * 3 + 2] ?? 0)).toBeLessThanOrEqual(DUST.radius);
    }
  });

  it('builds one Points with a fixed bounding sphere and no frustum culling', () => {
    const cloud = new Particulate(DUST);
    expect(cloud.points.name).toBe('particulate');
    expect(cloud.points.frustumCulled).toBe(false);
    expect(cloud.points.renderOrder).toBe(2);
    expect(cloud.points.geometry.boundingSphere?.radius).toBe(DUST.radius * 2);
    expect(cloud.points.geometry.getAttribute('position').count).toBe(DUST.count);
  });

  it('carries the def onto the material, unlit and untone-mapped', () => {
    const material = new Particulate(DUST).points.material as THREE.PointsMaterial;
    expect(material.color.getHex()).toBe(DUST.color);
    expect(material.size).toBe(DUST.size);
    expect(material.opacity).toBe(DUST.opacity);
    expect(material.sizeAttenuation).toBe(true);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
  });

  it('always makes at least one mote, however small the count is', () => {
    expect(new Particulate({ ...DUST, count: 0 }).points.geometry.getAttribute('position').count).toBe(1);
    expect(new Particulate({ ...DUST, count: -5 }).points.geometry.getAttribute('position').count).toBe(1);
    expect(new Particulate({ ...DUST, count: 7.9 }).points.geometry.getAttribute('position').count).toBe(7);
  });
});

describe('Particulate.update', () => {
  it('recentres only once the camera has moved past the recentre distance', () => {
    const cloud = new Particulate(DUST);
    cloud.update(3.9, 0, 0, 1 / 60);
    expect(cloud.points.position.toArray()).toEqual([0, 0, 0]);

    cloud.update(4.1, 0, 0, 1 / 60);
    expect(cloud.points.position.x).toBeCloseTo(4.1, 10);
    expect(cloud.points.position.y).toBeCloseTo(-DUST.radius * 0.2, 10);
    expect(cloud.points.position.z).toBeCloseTo(0, 10);
  });

  it('recentres on a move in y or z alone, not only in x', () => {
    const vertical = new Particulate(DUST);
    vertical.update(0, 5, 0, 1 / 60);
    expect(vertical.points.position.y).toBeCloseTo(5 - DUST.radius * 0.2, 10);

    const lateral = new Particulate(DUST);
    lateral.update(0, 0, -6, 1 / 60);
    expect(lateral.points.position.z).toBeCloseTo(-6, 10);
  });

  it('wraps a mote that leaves one face back in through the opposite one', () => {
    const cloud = new Particulate({ ...DUST, count: 1, drift: { x: 4, y: 0, z: 0 } });
    const pos = positionsOf(cloud);
    const before = pos[0] ?? 0;
    // Enough seconds of 4 m/s drift to cross the 20 m box several times over.
    for (let i = 0; i < 40; i++) cloud.update(0, 0, 0, 0.5);
    const after = pos[0] ?? 0;
    expect(after).toBeLessThan(DUST.radius);
    expect(after).toBeGreaterThanOrEqual(-DUST.radius);
    expect(after).not.toBe(before);
  });

  it('wraps by exactly one span per frame, so a single step wider than the box lands outside', () => {
    // The real drifts are centimetres a frame, so this is the shape of the wrap rather than a
    // case the game reaches: `wrap` subtracts the span once and does not loop.
    const cloud = new Particulate({ ...DUST, count: 1, drift: { x: 40, y: 0, z: 0 } });
    const pos = positionsOf(cloud);
    const before = pos[0] ?? 0;
    cloud.update(0, 0, 0, 1);
    const sway = Math.sin(1 * (cloud as unknown as { wobble: Float32Array }).wobble[0]!
      + (cloud as unknown as { wobble: Float32Array }).wobble[1]!) * 0.35;
    expect(pos[0]).toBeCloseTo(before + 40 + sway - DUST.radius * 2, 5);
  });

  it('wraps the vertical axis over the cloud height rather than the full box', () => {
    const cloud = new Particulate({ ...DUST, count: 1, drift: { x: 0, y: -2, z: 0 } });
    const pos = positionsOf(cloud);
    for (let i = 0; i < 40; i++) cloud.update(0, 0, 0, 0.5);
    const y = pos[1] ?? 0;
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(DUST.radius * 0.55);
  });

  it('keeps every mote inside the box over a long drift', () => {
    const cloud = new Particulate({ ...DUST, count: 200 });
    for (let i = 0; i < 1200; i++) cloud.update(i * 0.05, 1.7, i * 0.03, 1 / 60);
    const pos = positionsOf(cloud);
    for (let i = 0; i < pos.length / 3; i++) {
      expect(Math.abs(pos[i * 3] ?? 0)).toBeLessThanOrEqual(DUST.radius);
      expect(pos[i * 3 + 1] ?? 0).toBeGreaterThanOrEqual(0);
      expect(pos[i * 3 + 1] ?? 0).toBeLessThan(DUST.radius * 0.55);
      expect(Math.abs(pos[i * 3 + 2] ?? 0)).toBeLessThanOrEqual(DUST.radius);
    }
  });

  it('is a pure function of the camera track and the deltas', () => {
    const walk = (cloud: Particulate): void => {
      for (let i = 0; i < 300; i++) cloud.update(i * 0.11, 1.7, i * 0.07, 1 / 60);
    };
    const a = new Particulate(DUST);
    const b = new Particulate(DUST);
    walk(a);
    walk(b);
    expect(roundedPositions(a)).toEqual(roundedPositions(b));
  });

  it('pins 300 drifted frames exactly', () => {
    const cloud = new Particulate(DUST);
    for (let i = 0; i < 300; i++) cloud.update(i * 0.11, 1.7, i * 0.07, 1 / 60);
    expect(roundedPositions(cloud)).toMatchInlineSnapshot(`
      [
        -5.571692,
        0.28648,
        -1.796003,
        -2.17621,
        0.359866,
        5.356785,
        -7.493217,
        2.127206,
        2.133715,
        -1.659855,
        1.474388,
        -8.519622,
        -0.455511,
        1.214102,
        4.030621,
        5.562473,
        5.088391,
        -0.495814,
        6.6109,
        3.738194,
        2.785657,
        0.794838,
        5.323943,
        0.88342,
        0.018055,
        2.703898,
        -1.36424,
        -5.032746,
        1.795954,
        -9.424081,
        -0.567911,
        4.778356,
        -7.326946,
        -2.481042,
        0.331694,
        9.521045,
      ]
    `);
  });

  it('moves nothing on a zero delta, however many frames pass', () => {
    const cloud = new Particulate(DUST);
    const before = roundedPositions(cloud);
    for (let i = 0; i < 50; i++) cloud.update(0, 0, 0, 0);
    expect(roundedPositions(cloud)).toEqual(before);
  });

  it('flags the buffer for upload on every frame', () => {
    const cloud = new Particulate(DUST);
    // `needsUpdate` is write-only on a BufferAttribute; what it does is bump `version`.
    const attribute = cloud.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const before = attribute.version;
    cloud.update(0, 0, 0, 1 / 60);
    cloud.update(0, 0, 0, 1 / 60);
    expect(attribute.version).toBe(before + 2);
  });

  it('drifts each mote by its own phase rather than as one block', () => {
    const cloud = new Particulate({ ...DUST, count: 8, drift: { x: 0, y: 0, z: 0 } });
    const pos = positionsOf(cloud);
    const before = [...pos];
    for (let i = 0; i < 60; i++) cloud.update(0, 0, 0, 1 / 60);
    const deltas = new Set<number>();
    for (let i = 0; i < pos.length / 3; i++) {
      deltas.add(Math.round(((pos[i * 3] ?? 0) - (before[i * 3] ?? 0)) * 1e5));
    }
    expect(deltas.size).toBeGreaterThan(1);
  });
});

describe('Particulate.dispose', () => {
  it('releases the geometry and the material', () => {
    const cloud = new Particulate(DUST);
    let geometryDisposed = 0;
    let materialDisposed = 0;
    cloud.points.geometry.addEventListener('dispose', () => { geometryDisposed++; });
    (cloud.points.material as THREE.Material).addEventListener('dispose', () => { materialDisposed++; });
    cloud.dispose();
    expect(geometryDisposed).toBe(1);
    expect(materialDisposed).toBe(1);
  });
});
