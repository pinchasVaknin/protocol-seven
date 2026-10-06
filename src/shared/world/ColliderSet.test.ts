import { describe, expect, it } from 'vitest';
import { ColliderSet, writeBasis } from './ColliderSet';
import { materialIndex } from './maps/types';

/**
 * Static world geometry as oriented boxes (brief S4.3).
 *
 * This is the one representation both the collision broadphase and every gameplay raycast read,
 * so the properties pinned here are the ones everything downstream assumes without checking:
 * the basis is orthonormal, the axis-aligned flag really does mean the basis is the identity
 * (which is what licenses the fast path in `Geometry`), and the world AABB encloses the rotated
 * box rather than the unrotated one.
 *
 * The basis is `Rz * Rx * Ry`, in that order, because the mesher composes it the same way — a
 * collider and its render mesh that disagreed about rotation order would put the solid somewhere
 * the player cannot see.
 */

const UNIT = { x: 1, y: 1, z: 1 };

function setWith(...boxes: ReadonlyArray<Parameters<ColliderSet['add']>>): ColliderSet {
  const set = new ColliderSet(boxes.length + 1);
  for (const box of boxes) set.add(...box);
  return set;
}

describe('writeBasis', () => {
  it('is the identity with no rotation', () => {
    const out = new Array(9).fill(99);
    writeBasis(0, 0, 0, out);

    // Slot 7 is `-sx`, and negating a zero keeps the sign in IEEE 754. Harmless everywhere
    // downstream (-0 === 0 and every use is arithmetic) and pinned as it is, because `toEqual`
    // tells the two apart and so would a reader expecting a clean identity.
    expect(out).toEqual([1, 0, 0, 0, 1, 0, 0, -0, 1]);
  });

  it('writes at an offset without touching what is before it', () => {
    const out = new Array(12).fill(7);
    writeBasis(0, 0, 0, out, 3);

    expect(out.slice(0, 3)).toEqual([7, 7, 7]);
    expect(out.slice(3)).toEqual([1, 0, 0, 0, 1, 0, 0, -0, 1]);
  });

  it('stays orthonormal for a compound rotation', () => {
    const b = new Array(9).fill(0);
    writeBasis(0.7, -0.3, 1.1, b);

    const dot = (p: number, q: number) => b[p]! * b[q]! + b[p + 1]! * b[q + 1]! + b[p + 2]! * b[q + 2]!;

    expect(dot(0, 0)).toBeCloseTo(1, 10);
    expect(dot(3, 3)).toBeCloseTo(1, 10);
    expect(dot(6, 6)).toBeCloseTo(1, 10);
    expect(dot(0, 3)).toBeCloseTo(0, 10);
    expect(dot(0, 6)).toBeCloseTo(0, 10);
    expect(dot(3, 6)).toBeCloseTo(0, 10);
  });

  it('turns the local X axis toward -Z for a positive yaw', () => {
    const b = new Array(9).fill(0);
    writeBasis(Math.PI / 2, 0, 0, b);

    // Column 0 is the box's local X in world space.
    expect(b[0]).toBeCloseTo(0, 10);
    expect(b[1]).toBeCloseTo(0, 10);
    expect(b[2]).toBeCloseTo(-1, 10);
  });
});

describe('ColliderSet.add', () => {
  it('returns the index it wrote and advances the count', () => {
    const set = new ColliderSet(4);

    expect(set.add({ x: 0, y: 0, z: 0 }, UNIT, 0, 0, 0, 'concrete')).toBe(0);
    expect(set.add({ x: 1, y: 0, z: 0 }, UNIT, 0, 0, 0, 'metal')).toBe(1);
    expect(set.count).toBe(2);
  });

  it('stores the centre as given and the half extents as half the size', () => {
    const set = setWith([{ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 8 }, 0, 0, 0, 'concrete']);

    expect([set.centerX(0), set.centerY(0), set.centerZ(0)]).toEqual([1, 2, 3]);
    expect([set.halfX(0), set.halfY(0), set.halfZ(0)]).toEqual([2, 3, 4]);
  });

  it('flags a box as axis aligned only when all three rotations are zero', () => {
    const set = setWith(
      [{ x: 0, y: 0, z: 0 }, UNIT, 0, 0, 0, 'concrete'],
      [{ x: 0, y: 0, z: 0 }, UNIT, 0.1, 0, 0, 'concrete'],
      [{ x: 0, y: 0, z: 0 }, UNIT, 0, 0.1, 0, 'concrete'],
      [{ x: 0, y: 0, z: 0 }, UNIT, 0, 0, 0.1, 'concrete'],
    );

    expect(set.isAxisAligned(0)).toBe(true);
    expect(set.isAxisAligned(1)).toBe(false);
    expect(set.isAxisAligned(2)).toBe(false);
    expect(set.isAxisAligned(3)).toBe(false);
  });

  it('gives an axis-aligned box the identity basis, which is what the fast path assumes', () => {
    const set = setWith([{ x: 0, y: 0, z: 0 }, UNIT, 0, 0, 0, 'concrete']);

    const basis = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => set.basisAt(0, k));
    expect(basis).toEqual([1, 0, 0, 0, 1, 0, 0, -0, 1]);
  });

  it('keeps the material index the collider was authored with', () => {
    const set = setWith(
      [{ x: 0, y: 0, z: 0 }, UNIT, 0, 0, 0, 'concrete'],
      [{ x: 0, y: 0, z: 0 }, UNIT, 0, 0, 0, 'hazard'],
    );

    expect(set.materialAt(0)).toBe(materialIndex('concrete'));
    expect(set.materialAt(1)).toBe(materialIndex('hazard'));
  });

  it('throws rather than overwriting when it is full', () => {
    const set = new ColliderSet(1);
    set.add({ x: 0, y: 0, z: 0 }, UNIT, 0, 0, 0, 'concrete');

    expect(() => set.add({ x: 0, y: 0, z: 0 }, UNIT, 0, 0, 0, 'concrete')).toThrow(
      /ColliderSet full at 1/,
    );
  });
});

describe('the world AABB', () => {
  it('is the box itself when it is axis aligned', () => {
    const set = setWith([{ x: 10, y: 0, z: -5 }, { x: 2, y: 4, z: 6 }, 0, 0, 0, 'concrete']);

    expect([0, 1, 2, 3, 4, 5].map((k) => set.aabbAt(0, k))).toEqual([9, -2, -8, 11, 2, -2]);
  });

  it('grows to enclose a yawed box rather than describing the unrotated one', () => {
    // A 6 x 1 x 1 box yawed 45 degrees needs about 4.95 m on each of X and Z.
    const set = setWith([{ x: 0, y: 0, z: 0 }, { x: 6, y: 1, z: 1 }, Math.PI / 4, 0, 0, 'concrete']);

    expect(set.aabbAt(0, 3)).toBeCloseTo(2.474873, 4);
    expect(set.aabbAt(0, 5)).toBeCloseTo(2.474873, 4);
    expect(set.aabbAt(0, 4)).toBeCloseTo(0.5, 6);
  });

  it('is symmetric about the centre for any rotation', () => {
    const set = setWith([{ x: 3, y: 4, z: 5 }, { x: 2, y: 3, z: 4 }, 0.6, 0.3, -0.9, 'concrete']);

    expect(set.aabbAt(0, 0) + set.aabbAt(0, 3)).toBeCloseTo(6, 5);
    expect(set.aabbAt(0, 1) + set.aabbAt(0, 4)).toBeCloseTo(8, 5);
    expect(set.aabbAt(0, 2) + set.aabbAt(0, 5)).toBeCloseTo(10, 5);
  });

  it('never shrinks below the box, whatever the rotation', () => {
    for (const yaw of [0, 0.3, 0.7, 1.2, Math.PI / 2]) {
      const set = setWith([{ x: 0, y: 0, z: 0 }, { x: 4, y: 2, z: 2 }, yaw, 0, 0, 'concrete']);
      // The widest extent is at least the narrowest half-extent of the box.
      expect(set.aabbAt(0, 3)).toBeGreaterThanOrEqual(1);
      expect(set.aabbAt(0, 5)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('the accessors', () => {
  it('answer zero past the end rather than undefined, so no caller needs a guard', () => {
    const set = new ColliderSet(2);

    expect(set.centerX(99)).toBe(0);
    expect(set.halfY(99)).toBe(0);
    expect(set.basisAt(99, 4)).toBe(0);
    expect(set.aabbAt(99, 2)).toBe(0);
    expect(set.materialAt(99)).toBe(0);
    expect(set.isAxisAligned(99)).toBe(false);
  });
});
