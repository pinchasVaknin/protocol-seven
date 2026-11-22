/**
 * The rig's boxes as one welded mesh, and the two colours a grey-box body is painted in.
 *
 * `BotMesh` and `TargetDummy` each carried this function — the same signature, the same filter
 * on `box.zone`, the same `BoxGeometry` and `translate` per box, the same merge, the same
 * bounding sphere — differing in one token, the error string (BACKLOG #67). They also each held
 * the same two hexes for the body and the head, written twice for the same reason and named by
 * neither.
 *
 * ## Why this is a third file rather than an export from one of the two
 *
 * A firing-range dummy has no business depending on bot rendering, and bot rendering has none
 * depending on the range. Exporting either copy would have made one of those true.
 *
 * `shared/combat/HitboxRig.ts` is where the rig *table* lives and would be the obvious home,
 * and it cannot be: the geometry is `THREE.BoxGeometry` and `mergeGeometries`, and
 * `check-boundaries.mjs` forbids `shared/ -> three` outright, because the server runs `shared/`
 * headless and never renders. The table is shared and the geometry built from it is not — that
 * boundary is the reason this file is on the client side of it.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HUMANOID_RIG, type HitZone } from '../../shared/combat/HitboxRig';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * The grey-box body, and the head that is not quite skin.
 *
 * Two placeholders that have to agree, because a bot and a dummy are the same figure in two
 * places and a player reads them as the same thing. Named here so a change is one edit rather
 * than two that can be made singly (BACKLOG #67); both are pinned by number in `BotMesh`'s and
 * `TargetDummy`'s tests, so a disagreement is visible rather than silent.
 */
export const GREYBOX_BODY_COLOR = 0x59616e;
export const GREYBOX_HEAD_COLOR = 0x8a6a3c;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * One welded geometry over every rig box whose zone is in `zones`, in the rig's own order.
 *
 * The order is the table's and must stay the table's: the merged buffer's vertices come out in
 * the order the parts went in, and both callers' tests digest that buffer.
 *
 * `what` completes "Failed to merge … geometry", so each caller keeps the words it threw.
 */
export function zoneGeometry(zones: readonly HitZone[], what: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const box of HUMANOID_RIG.boxes) {
    if (!zones.includes(box.zone)) continue;
    const g = new THREE.BoxGeometry(box.sx, box.sy, box.sz);
    g.translate(box.ox, box.oy, box.oz);
    parts.push(g);
  }
  return mergeParts(parts, what);
}

/**
 * Weld the parts into one buffer and release them.
 *
 * `mergeGeometries` returns null rather than throwing when the parts disagree about their
 * attributes, and a body silently missing its torso is worse than a boot that stops, so every
 * caller checks — which is the whole reason this is one function and not four copies. Exported
 * because `BotMesh` welds two more sets of parts that are not zones at all: the arms pitched
 * onto the weapon, and the gear that was never a hitbox.
 */
export function mergeParts(
  parts: readonly THREE.BufferGeometry[],
  what: string,
): THREE.BufferGeometry {
  const merged = mergeGeometries(parts as THREE.BufferGeometry[], false);
  for (const p of parts) p.dispose();
  if (merged === null) throw new Error(`Failed to merge ${what} geometry`);
  merged.computeBoundingSphere();
  return merged;
}
//#endregion
