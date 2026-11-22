/**
 * A part list into geometry: one box or tube at a time, and the merge that makes them a mesh.
 *
 * Split out of `WeaponMesh.ts` because both builders do it and neither should own it. The
 * viewmodel merges by surface, so a weapon is three draw calls with three materials; the
 * held weapon merges the lot into one, at half the sides, because at twenty metres nobody can
 * count them. Before this file those two loops were the same eight lines written twice.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoxPart, SurfaceKey, TubePart } from './WeaponMeshParts';
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** One box, rotated and placed. The caller owns it and disposes it. */
export function boxGeometry(part: BoxPart): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(part.w, part.h, part.d);
  if (part.rx !== undefined) g.rotateX(part.rx);
  if (part.ry !== undefined) g.rotateY(part.ry);
  if (part.rz !== undefined) g.rotateZ(part.rz);
  g.translate(part.x, part.y, part.z);
  return g;
}

/**
 * One tube, placed. `sides` overrides the part's own, which is how the held weapon halves
 * them: a barrel that is twelve-sided at arm's length is eight-sided at twenty metres and
 * nobody can tell, and this is ten of them.
 */
export function tubeGeometry(part: TubePart, sides = part.sides ?? 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(
    part.tipRadius ?? part.radius,
    part.radius,
    part.length,
    sides,
    1,
  );
  // The three optional steps are the knife blade's (BACKLOG #59) and are absent on every other
  // part in the project, so each `if` is skipped for all of them and the geometry they produce
  // is the same geometry it always was. The order is the blade's own and is load-bearing:
  // flatten while the section is still in XZ, and only then swing it flat.
  if (part.flatten !== undefined) g.scale(part.flatten, 1, 1);
  // CylinderGeometry runs along +Y; barrels run along Z.
  if (part.vertical !== true) g.rotateX(part.towardNegativeZ === true ? -Math.PI / 2 : Math.PI / 2);
  g.translate(part.x, part.y, part.z);
  return g;
}

/**
 * Merge the parts by surface and add one mesh per surface under `parent`.
 *
 * The merged geometries go into `disposables`, because they are the only thing in a weapon
 * that is per model; the materials and their textures are shared for the life of the process.
 */
export function addMerged(
  parent: THREE.Object3D,
  boxes: readonly BoxPart[],
  tubes: readonly TubePart[],
  surfaces: ReadonlyMap<SurfaceKey, THREE.Material>,
  disposables: Array<{ dispose(): void }>,
  label: string,
): void {
  const bySurface = new Map<SurfaceKey, THREE.BufferGeometry[]>();
  const push = (key: SurfaceKey, geometry: THREE.BufferGeometry): void => {
    const list = bySurface.get(key);
    if (list === undefined) bySurface.set(key, [geometry]);
    else list.push(geometry);
  };

  for (const part of boxes) push(part.surface, boxGeometry(part));
  for (const part of tubes) push(part.surface, tubeGeometry(part));

  for (const [key, list] of bySurface) {
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (merged === null) continue;
    merged.computeBoundingSphere();
    const material = surfaces.get(key);
    if (material === undefined) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `viewmodel:${label}:${key}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
    disposables.push(merged);
  }
}
//#endregion
