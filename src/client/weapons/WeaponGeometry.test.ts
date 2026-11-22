import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boxGeometry, tubeGeometry } from './WeaponGeometry';
import type { TubePart } from './WeaponMeshParts';

/**
 * The two part builders every weapon's geometry comes out of, and the three fields the knife
 * added to `TubePart` (BACKLOG #59).
 *
 * The point of the three cases at the bottom is **what happens when they are absent**, which is
 * every other part in the project: twelve weapons' barrels, sights, stocks and suppressors go
 * through `tubeGeometry`, and the blade's taper, flatten and direction had to cost them nothing.
 * So each is checked against the plain cylinder it was before the field existed, element for
 * element — not for a tolerance, because a buffer that moved by one bit is a buffer C8's and
 * C7's own checksums would report and this is the cheaper place to find out.
 *
 * The order the three are applied in is the blade's and is load-bearing: flatten while the
 * section is still in the XZ plane, and only then swing it flat. The last case holds that by
 * measuring the blade across and along, which is the thing a reversed order would swap.
 */

/**
 * Six places, not twelve: these buffers are `Float32Array`s, so a dimension measured out of one
 * carries about seven significant digits and 0.2 reads back as 0.20000004768371582. The three
 * byte-for-byte cases below do not go through this and compare the raw elements with `toBe`.
 */
function array(g: THREE.BufferGeometry, name: string): ArrayLike<number> {
  return g.getAttribute(name).array;
}

function same(a: THREE.BufferGeometry, b: THREE.BufferGeometry): void {
  for (const name of ['position', 'normal', 'uv']) {
    const x = array(a, name);
    const y = array(b, name);
    expect(y.length).toBe(x.length);
    for (let i = 0; i < x.length; i++) expect(y[i]).toBe(x[i]);
  }
}

const PLAIN: TubePart = { surface: 'gunmetal', x: 0.01, y: 0.02, z: -0.3, radius: 0.012, length: 0.2 };

describe('boxGeometry', () => {
  it('rotates before it translates, so a rotation is about the part’s own centre', () => {
    const turned = boxGeometry({ surface: 'gunmetal', w: 0.1, h: 0.2, d: 0.3, x: 1, y: 2, z: 3, rz: Math.PI / 2 });
    turned.computeBoundingBox();
    const box = turned.boundingBox;
    expect(box).not.toBeNull();
    if (box === null) return;
    // A 0.1 x 0.2 box turned a quarter turn about Z is 0.2 x 0.1, centred where it was put.
    expect(box.max.x - box.min.x).toBeCloseTo(0.2, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(0.1, 6);
    expect((box.max.x + box.min.x) / 2).toBeCloseTo(1, 6);
  });
});

describe('tubeGeometry', () => {
  it('lies along Z by default and stands on Y when asked', () => {
    const along = tubeGeometry(PLAIN);
    const standing = tubeGeometry({ ...PLAIN, vertical: true });
    along.computeBoundingBox();
    standing.computeBoundingBox();
    const a = along.boundingBox;
    const b = standing.boundingBox;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a === null || b === null) return;
    expect(a.max.z - a.min.z).toBeCloseTo(PLAIN.length, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(PLAIN.length, 6);
  });

  it('takes the caller’s side count over its own, which is how the held weapon halves them', () => {
    const twelve = tubeGeometry(PLAIN);
    const six = tubeGeometry(PLAIN, 6);
    expect(array(six, 'position').length).toBeLessThan(array(twelve, 'position').length);
    expect(array(tubeGeometry({ ...PLAIN, sides: 6 }), 'position')).toEqual(array(six, 'position'));
  });

  // ---- the three the knife added (BACKLOG #59) ----

  it('is byte for byte the old cylinder when tipRadius is absent', () => {
    const plain = tubeGeometry(PLAIN);
    // What the field makes explicit is what the code always did: both ends the same radius.
    const spelled = tubeGeometry({ ...PLAIN, tipRadius: PLAIN.radius });
    same(plain, spelled);
  });

  it('is byte for byte the old cylinder when flatten and towardNegativeZ are absent', () => {
    const plain = tubeGeometry(PLAIN);
    const spelled = tubeGeometry({ ...PLAIN, flatten: 1, towardNegativeZ: false });
    same(plain, spelled);
  });

  it('tapers to a point at the far end, which is down -Z for the knife', () => {
    const blade = tubeGeometry({
      surface: 'gunmetal',
      x: 0,
      y: 0,
      z: -0.2,
      radius: 0.021,
      tipRadius: 0,
      length: 0.1,
      sides: 4,
      flatten: 0.22,
      towardNegativeZ: true,
    });
    blade.computeBoundingBox();
    const box = blade.boundingBox;
    expect(box).not.toBeNull();
    if (box === null) return;
    // Flattened **across** the blade and not through it: 0.021 x 2 x 0.22 wide, 0.042 deep.
    expect(box.max.x - box.min.x).toBeCloseTo(0.021 * 2 * 0.22, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(0.021 * 2, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(0.1, 6);
    // The point is the end further down -Z, and it is a point: one x, one y, at that z.
    const pos = array(blade, 'position');
    let tipWidth = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs((pos[i + 2] ?? 0) - box.min.z) < 1e-9) tipWidth = Math.max(tipWidth, Math.abs(pos[i] ?? 0));
    }
    expect(tipWidth).toBeCloseTo(0, 6);
  });
});
