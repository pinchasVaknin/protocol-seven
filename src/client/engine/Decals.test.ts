import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Rng } from '../../shared/core/Rng';
import { ATTACHMENT_IDS, attachmentDef } from '../../shared/weapons/Attachments';
import { ALL_WEAPONS } from '../../shared/weapons/WeaponDefs';
import { DecalField } from './Decals';

/**
 * The bullet-hole field, pinned before unit C4's refactor.
 *
 * `DecalField` is a ring of instance slots with no lifetime: hole 377 reuses the slot of hole 1.
 * That is the whole design, and it is the part worth holding — a capacity that stopped being
 * derived, or a cursor that stopped wrapping, would both show up as "the range runs out of
 * holes" long after the change that caused it.
 *
 * The only DOM it touches is one canvas for its texture, so a small fake is enough; the
 * `InstancedMesh` underneath is the real class and the matrices read back are the real ones.
 */

// ========================================== the fake ==========================================

class FakeGradient {
  addColorStop(): void {}
}

function fakeCanvas(): Record<string, unknown> {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => new FakeGradient(),
      fillStyle: '',
      beginPath: (): void => {},
      arc: (): void => {},
      fill: (): void => {},
      fillRect: (): void => {},
    }),
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).document = { createElement: () => fakeCanvas() };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
});

function field(): { decals: DecalField; disposables: Array<{ dispose(): void }> } {
  const disposables: Array<{ dispose(): void }> = [];
  return { decals: new DecalField(4, disposables), disposables };
}

function seeded(): Rng {
  return new Rng(0x1234_5678);
}

/** Where slot `i`'s instance sits, read back off the real InstancedMesh. */
function positionAt(decals: DecalField, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  decals.mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

function scaleAt(decals: DecalField, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  decals.mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixScale(matrix);
}

// ======================================== the test cases ======================================

describe('DecalField: the derived capacity', () => {
  it('is two of the largest magazine the arsenal can assemble', () => {
    let mult = 1;
    for (const id of ATTACHMENT_IDS) {
      const effect = attachmentDef(id)?.effects.magSizeMult;
      if (effect !== undefined && effect > mult) mult = effect;
    }
    let biggest = 1;
    for (const def of ALL_WEAPONS) {
      const size = Math.round(def.magSize * mult);
      if (size > biggest) biggest = size;
    }
    expect(field().decals.capacity).toBe(2 * biggest);
  });

  it('is 376 at the shipped tables, which is what the comment promises', () => {
    expect(field().decals.capacity).toBe(376);
  });

  it('gives the mesh exactly that many instances', () => {
    const { decals } = field();
    expect(decals.mesh.count).toBe(decals.capacity);
  });
});

describe('DecalField: the mesh it builds', () => {
  it('is one instanced mesh, never culled, with its own matrix held still', () => {
    const { decals } = field();
    expect(decals.mesh.name).toBe('fx:decals');
    expect(decals.mesh.frustumCulled).toBe(false);
    expect(decals.mesh.matrixAutoUpdate).toBe(false);
  });

  it('hands its texture, material and geometry to the caller to dispose', () => {
    const { disposables } = field();
    expect(disposables.length).toBe(3);
    for (const d of disposables) expect(typeof d.dispose).toBe('function');
  });

  it('starts with every slot scaled to nothing, so an unused ring draws no quads', () => {
    const { decals } = field();
    expect(decals.live).toBe(0);
    for (const i of [0, 1, 100, 375]) {
      const s = scaleAt(decals, i);
      expect([s.x, s.y, s.z]).toEqual([0, 0, 0]);
    }
  });

  it('lifts the material off the surface so the quad cannot z-fight the wall', () => {
    const { disposables } = field();
    const material = disposables.find((d) => d instanceof THREE.MeshBasicMaterial) as THREE.MeshBasicMaterial;
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBe(-4);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
  });
});

describe('DecalField: placing a hole', () => {
  it('counts up to the capacity and then stops counting', () => {
    const { decals } = field();
    const rng = seeded();
    for (let i = 0; i < 10; i++) decals.place(i, 0, 0, 0, 0, 1, 0.05, 1, rng);
    expect(decals.live).toBe(10);
    for (let i = 0; i < decals.capacity; i++) decals.place(i, 0, 0, 0, 0, 1, 0.05, 1, rng);
    expect(decals.live).toBe(decals.capacity);
  });

  it('recycles the oldest slot once the ring is full', () => {
    const { decals } = field();
    const rng = seeded();
    // Fill the ring, then place one more: it must land back in slot 0.
    for (let i = 0; i < decals.capacity; i++) decals.place(0, 0, 0, 0, 0, 1, 0.05, 1, rng);
    const slot0 = positionAt(decals, 0);
    decals.place(42, 7, -3, 0, 0, 1, 0.05, 1, rng);
    const after = positionAt(decals, 0);
    expect(after.x).toBe(42);
    expect(after.y).toBe(7);
    expect(slot0.x).not.toBe(42);
  });

  it('walks the cursor one slot at a time', () => {
    const { decals } = field();
    const rng = seeded();
    decals.place(1, 0, 0, 0, 0, 1, 0.05, 1, rng);
    decals.place(2, 0, 0, 0, 0, 1, 0.05, 1, rng);
    decals.place(3, 0, 0, 0, 0, 1, 0.05, 1, rng);
    expect(positionAt(decals, 0).x).toBe(1);
    expect(positionAt(decals, 1).x).toBe(2);
    expect(positionAt(decals, 2).x).toBe(3);
  });

  it('lifts the hole off the surface along the normal', () => {
    const { decals } = field();
    decals.place(0, 0, 0, 0, 0, 1, 0.05, 1, seeded());
    expect(positionAt(decals, 0).z).toBeCloseTo(0.006, 8);
    const other = field();
    other.decals.place(0, 0, 0, 0, 1, 0, 0.05, 1, seeded());
    expect(positionAt(other.decals, 0).y).toBeCloseTo(0.006, 8);
  });

  it('sizes the quad from the radius, jittered on the seeded stream', () => {
    const { decals } = field();
    const rng = seeded();
    decals.place(0, 0, 0, 0, 0, 1, 0.05, 1, rng);
    const s = scaleAt(decals, 0);
    // radius * 2, times a jitter in [0.85, 1.2).
    expect(s.x).toBeGreaterThanOrEqual(0.05 * 2 * 0.85);
    expect(s.x).toBeLessThan(0.05 * 2 * 1.2);
    expect(s.y).toBeCloseTo(s.x, 12);
    expect(s.z).toBe(1);
  });

  it('is deterministic for a given seed', () => {
    const a = field();
    const b = field();
    a.decals.place(0, 0, 0, 0, 0, 1, 0.05, 1, seeded());
    b.decals.place(0, 0, 0, 0, 0, 1, 0.05, 1, seeded());
    expect(scaleAt(a.decals, 0).x).toBe(scaleAt(b.decals, 0).x);
  });

  it('spins each hole about its own normal, so repeats do not stamp a pattern', () => {
    const { decals } = field();
    const rng = seeded();
    const quat = new THREE.Quaternion();
    const matrix = new THREE.Matrix4();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      decals.place(0, 0, 0, 0, 0, 1, 0.05, 1, rng);
      decals.mesh.getMatrixAt(i, matrix);
      matrix.decompose(new THREE.Vector3(), quat, new THREE.Vector3());
      seen.add(quat.z.toFixed(6));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('darkens the instance with the strength it was given', () => {
    const soft = field();
    const hard = field();
    soft.decals.place(0, 0, 0, 0, 0, 1, 0.05, 0, seeded());
    hard.decals.place(0, 0, 0, 0, 0, 1, 0.05, 1, seeded());
    const a = new THREE.Color();
    const b = new THREE.Color();
    soft.decals.mesh.getColorAt(0, a);
    hard.decals.mesh.getColorAt(0, b);
    expect(b.r).toBeLessThan(a.r);
    expect(a.r).toBeCloseTo(1, 6);
  });

  it('clamps a strength outside 0..1', () => {
    const over = field();
    const at = field();
    over.decals.place(0, 0, 0, 0, 0, 1, 0.05, 5, seeded());
    at.decals.place(0, 0, 0, 0, 0, 1, 0.05, 1, seeded());
    const a = new THREE.Color();
    const b = new THREE.Color();
    over.decals.mesh.getColorAt(0, a);
    at.decals.mesh.getColorAt(0, b);
    expect(a.r).toBe(b.r);
  });
});

describe('DecalField: clearing', () => {
  it('hides every slot and starts the ring again', () => {
    const { decals } = field();
    const rng = seeded();
    for (let i = 0; i < 20; i++) decals.place(i, 0, 0, 0, 0, 1, 0.05, 1, rng);
    expect(decals.live).toBe(20);

    decals.clear();
    expect(decals.live).toBe(0);
    for (const i of [0, 5, 19]) {
      const s = scaleAt(decals, i);
      expect([s.x, s.y, s.z]).toEqual([0, 0, 0]);
    }

    // The cursor is back at the start, so the next hole takes slot 0.
    decals.place(99, 0, 0, 0, 0, 1, 0.05, 1, rng);
    expect(positionAt(decals, 0).x).toBe(99);
    expect(decals.live).toBe(1);
  });
});
