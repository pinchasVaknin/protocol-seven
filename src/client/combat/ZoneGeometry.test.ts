import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { HUMANOID_RIG, type HitZone } from '../../shared/combat/HitboxRig';
import {
  GREYBOX_BODY_COLOR,
  GREYBOX_HEAD_COLOR,
  mergeParts,
  zoneGeometry,
} from './ZoneGeometry';

/**
 * The welded rig geometry, against the two copies it replaced (BACKLOG #67).
 *
 * `BotMesh` and `TargetDummy` each built this and each has its own tests, but between them they
 * pinned the vertex *count* and the two material colours — not the buffer. The entry's own
 * verification is C11's BROWSER checksum A, which digests the attribute buffers, the index and
 * the bounding sphere; that is a browser procedure and not something a suite can run.
 *
 * So the buffer is pinned here instead, and pinned the only way that proves anything: against
 * the old code, written out below. `rebuiltTheOldWay` is `TargetDummy`'s copy as it stood —
 * the same loop over `HUMANOID_RIG.boxes` in the table's order, the same `BoxGeometry` and
 * `translate` per box, the same `mergeGeometries(parts, false)`. A rewrite that reordered the
 * parts, or filtered the zones differently, would come out with the same vertex count and a
 * different buffer, which is exactly what the two files' own tests could not see.
 */

// ---------------------------------------------------------------------------- the old code

/** `TargetDummy.buildZoneGeometry`, as it was before #67. */
function rebuiltTheOldWay(zones: readonly HitZone[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const box of HUMANOID_RIG.boxes) {
    if (!zones.includes(box.zone)) continue;
    const g = new THREE.BoxGeometry(box.sx, box.sy, box.sz);
    g.translate(box.ox, box.oy, box.oz);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error('Failed to merge dummy geometry');
  merged.computeBoundingSphere();
  return merged;
}

function arrayOf(g: THREE.BufferGeometry, name: string): ArrayLike<number> {
  return g.getAttribute(name).array;
}

// ---------------------------------------------------------------------------- the buffers

describe('zoneGeometry', () => {
  const sets: readonly (readonly HitZone[])[] = [
    ['head'],
    ['torso', 'arm', 'leg'],
    ['torso'],
    ['arm'],
    ['leg'],
    ['head', 'torso', 'arm', 'leg'],
  ];

  for (const zones of sets) {
    it(`builds [${zones.join(', ')}] exactly as the two copies did`, () => {
      const now = zoneGeometry(zones, 'dummy');
      const before = rebuiltTheOldWay(zones);

      for (const name of ['position', 'normal', 'uv']) {
        const a = arrayOf(before, name);
        const b = arrayOf(now, name);
        expect(b.length).toBe(a.length);
        for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]);
      }
      expect(now.getIndex()?.array ?? null).toEqual(before.getIndex()?.array ?? null);
      // The sphere both files' checksum digests, to the last bit of its radius.
      expect(now.boundingSphere?.radius).toBe(before.boundingSphere?.radius);
      expect(now.boundingSphere?.center.toArray()).toEqual(before.boundingSphere?.center.toArray());
    });
  }

  it('takes the zones in the rig table’s order, not the argument’s', () => {
    // Which is why the order of `zones` cannot matter: the loop walks the table, not the list.
    const a = zoneGeometry(['leg', 'torso', 'arm'], 'dummy');
    const b = zoneGeometry(['torso', 'arm', 'leg'], 'dummy');
    expect(arrayOf(a, 'position')).toEqual(arrayOf(b, 'position'));
  });

  it('names the caller in the error, so each one keeps the words it threw', () => {
    // `mergeGeometries` returns null when the parts disagree about their attributes — not for an
    // empty set, which comes back as an empty geometry. So the way to reach the throw is to hand
    // it a box and something with only a position, which is the shape the guard exists for.
    const bare = (): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      return g;
    };
    expect(() => mergeParts([new THREE.BoxGeometry(1, 1, 1), bare()], 'dummy')).toThrow(
      'Failed to merge dummy geometry',
    );
    expect(() => mergeParts([new THREE.BoxGeometry(1, 1, 1), bare()], 'bot body')).toThrow(
      'Failed to merge bot body geometry',
    );
  });

  it('disposes the parts it welded', () => {
    // The parts are internal, so this is asked through a set handed to `mergeParts` directly.
    const parts = [new THREE.BoxGeometry(1, 1, 1), new THREE.BoxGeometry(1, 1, 1)];
    let disposed = 0;
    for (const p of parts) p.addEventListener('dispose', () => disposed++);
    mergeParts(parts, 'dummy');
    expect(disposed).toBe(2);
  });
});

// ---------------------------------------------------------------------------- the colours

describe('the grey-box colours', () => {
  it('are the two hexes both files held', () => {
    // Pinned by number here as well as in `BotMesh.test.ts` and `TargetDummy.test.ts`, which is
    // the point of naming them: three assertions now disagree if one of them is edited alone.
    expect(GREYBOX_BODY_COLOR).toBe(0x59616e);
    expect(GREYBOX_HEAD_COLOR).toBe(0x8a6a3c);
  });
});
