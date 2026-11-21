/**
 * What a map root holds does not move, and this is the one place that says so.
 *
 * `three` recomputes a world matrix for every object with `matrixAutoUpdate` on, every frame,
 * whether or not anything moved it. A built map is the largest subtree in the scene and none of
 * it moves: the brushes, the props, the sky and the decals are all placed once at build time.
 * Turning the flags off is worth a measurable share of a frame — 136 of 1,236 objects were
 * still auto-updating when the station's own walk was added on 2026-10-18, and that was *after*
 * the root had been frozen.
 *
 * That is the thing worth having in one place (BACKLOG #64): the invariant, not the three lines.
 * A map freezes its root at the end of the build; a station arrives over the network minutes
 * later and has to freeze itself, because nothing walks the tree again. The next late-arriving
 * prop has the same obligation, and this is where it can read about it.
 *
 * It lives in its own file because the two callers cannot share one of theirs: `MapRender`
 * imports `MODELLED_PROP_SHAPES` from `PropModels`, so the reverse import is a cycle.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type * as THREE from 'three';
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Settle a subtree's world matrices once, then stop recomputing them.
 *
 * The update comes first and is not optional: the flags stop `three` from doing it later, so a
 * subtree frozen before it was ever updated keeps whatever matrices it was built with — which
 * for a freshly parented clone is the identity, and the prop renders at the world origin.
 */
export function freezeSubtree(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    obj.matrixAutoUpdate = false;
    obj.matrixWorldAutoUpdate = false;
  });
}
//#endregion
