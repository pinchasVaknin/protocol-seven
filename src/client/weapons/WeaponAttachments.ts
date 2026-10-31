/**
 * The pack on the sockets (M19, stage 2), and what each part changes about the weapon.
 *
 * Each part is a clone of its template under the weapon's socket — the part's origin is on its
 * mating face and the socket's frame is the mount's, so the clone is added and nothing else.
 * What is left is what each part then *does*, and that is a table rather than the chain of
 * `if (partId === …)` it was: an optic moves the sight line and takes the weapon's own sights
 * off, a suppressor moves the muzzle, a foregrip replaces a moulded one, and a laser does
 * nothing but hang there.
 *
 * A part the weapon has no socket for is skipped, as `resolveWeaponDef` skips an attachment
 * the weapon has no slot for; the two lists are the same list, so this is belt and braces.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import type { AttachmentId } from '../../shared/weapons/Attachments';
import { modelSpecFor } from './WeaponModelSpecs';
import type { AttachmentPartTemplate, WeaponAssetTemplate } from './WeaponAssetService';
import {
  ATTACHMENT_PARTS,
  ATTACHMENT_PART_SOCKETS,
  MAGAZINE_EXTENDED_STRETCH,
  type AttachmentPartId,
} from './WeaponAssetCatalog';
import type { SurfaceKey } from './WeaponMeshParts';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** What mounting changed about the contract's numbers; absent means the bare weapon's. */
interface Mounted {
  muzzle?: THREE.Object3D;
  sightPoint?: THREE.Vector3;
}

/** What a part is given when it is fitted: its clone, its template, and the weapon under it. */
interface Fitting {
  readonly clone: THREE.Object3D;
  readonly part: AttachmentPartTemplate;
  readonly root: THREE.Object3D;
  readonly template: WeaponAssetTemplate;
  readonly surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>;
  readonly out: Mounted;
}

/** What one part does to the weapon once its clone is under the socket. */
type Fitter = (fitting: Fitting) => void;
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * The radius of the dot a file's own collimator gets, metres. A red dot is a dot, not a disc:
 * 2.2 mm at 19 cm from the eye read as one (playtest 6), and in the window at 28 cm this is
 * half the size it looked.
 */
const OWN_RETICLE_RADIUS = 0.0016;

/**
 * What each part of the pack changes, by part id (section 4.4).
 *
 * `satisfies Record<…>` is what keeps it honest: a part added to the pack without a fitting
 * here is a compile error rather than a model that mounts it and ignores it.
 */
const PART_FITTINGS = {
  att_optic: ({ clone, part, root, template, surfaces, out }): void => {
    // The optic's glass and reticle take the project's `lens` and `reticle` materials in place
    // of the artist's (the source carries `KHR_materials_transmission`, a render pass the
    // viewmodel does not pay for), so the dot is the same emissive dot the procedural red dot
    // draws and the glass has the same `depthWrite: false` that keeps the target visible.
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      const material = mesh.material;
      if (!(material instanceof THREE.Material)) return;
      if (material.name === 'M_glass') mesh.material = surfaces.get('lens') ?? material;
      else if (material.name === 'M_Reticle') mesh.material = surfaces.get('reticle') ?? material;
    });
    // An optic's own `socket_sight` sits above the rail socket, and the sum is the sight line
    // the ADS pose now has to cancel.
    const sight = part.sockets.socket_sight;
    if (sight !== undefined) out.sightPoint = template.sockets.socket_rail_top.clone().add(sight);
    // The weapon's own sights go under a mounted optic: its collimator (`optic_default`) and
    // its iron sights (`irons`, carved out by the build). Both stood in the middle of the
    // sight picture (playtest 4, finding 3), which is what a real shooter removes them for.
    for (const name of ['optic_default', 'irons']) hide(root, name);
  },
  att_suppressor: ({ clone, out }): void => {
    // A suppressor's own `socket_muzzle` is where the flash leaves from now, and the returned
    // node is inside the clone so the flash rides the can.
    const muzzle = clone.getObjectByName('socket_muzzle');
    if (muzzle !== undefined) out.muzzle = muzzle;
  },
  att_grip: ({ root }): void => {
    /**
     * A weapon that came with a foregrip loses its own when one is mounted (2026-09-27).
     *
     * The same rule `optic_default` has above, for the same reason and found the same way:
     * the MONOLITH's handguard has a vertical grip moulded into it, and mounting the pack's
     * put a second one through it. Carved out by the build into `grip_default`, and the
     * mounted part takes its place — `socket_rail_bottom` is that grip's own collar, so the
     * replacement stands where the original stood rather than somewhere near it.
     */
    hide(root, 'grip_default');
  },
  /** A laser is a light on a rail. Mounting it is all there is to it. */
  att_laser: (): void => {},
} satisfies Record<AttachmentPartId, Fitter>;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * What a file's own optics need before anything is mounted on them (playtest 4).
 *
 * Two jobs, both from a source that models the glass and leaves the picture to the engine:
 *
 * - `scope_glass` — a lens the build carved out of a scope whose tube, rings and glass are one
 *   material — takes the project's `lens`, so the tube stays solid and you can see down it.
 * - A weapon whose collimator draws an **empty window** — the P90's — gets the project's
 *   reticle: a small emissive disc at the file's own `socket_reticle`, which is the recipe
 *   saying *"this glass has nothing in it"*. A sight that already carries a reticle, the
 *   Tavor's, has no such node and gets nothing; adding one regardless is what put two dots on
 *   it (playtest 5). The disc goes under `optic_default`, so mounting a red dot — which hides
 *   that group — hides this with it.
 */
export function dressOwnOptic(
  root: THREE.Object3D,
  surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>,
  disposables: Array<{ dispose(): void }>,
): void {
  const glass = root.getObjectByName('scope_glass') as THREE.Mesh | undefined;
  const lens = surfaces.get('lens');
  if (glass !== undefined && lens !== undefined) glass.material = lens;

  const own = root.getObjectByName('optic_default');
  const at = root.getObjectByName('socket_reticle');
  const reticle = surfaces.get('reticle');
  if (own === undefined || at === undefined || own.children.length === 0 || reticle === undefined) return;
  const geometry = new THREE.CircleGeometry(OWN_RETICLE_RADIUS, 12);
  disposables.push(geometry);
  const dot = new THREE.Mesh(geometry, reticle);
  dot.name = 'optic_default:reticle';
  // Where the file says the window is: the recipe measures it in all three axes, halfway
  // through the head. An offset here once pushed it the other way, out of the back of the
  // housing, and from the hip it floated beside the sight (playtests 5 and 6).
  dot.position.copy(at.position);
  own.add(dot);
}

/**
 * Mount the fitted attachments, and report what they changed about the contract's numbers.
 *
 * Two rules from stage 3 live here rather than in a fitting, because both are about whether a
 * part is mounted at all: a weapon whose spec has a scope keeps it — the HYBRID OPTIC on a
 * sniper is a better scope (its effect is on the sway), not a red dot in place of one — and
 * the extended magazine is not a part but the magazine group stretched along the well
 * (`MAGAZINE_EXTENDED_STRETCH`); the reload writes the group's position and rotation and
 * leaves its scale alone, and the well hides the top.
 */
export function mountAttachments(
  root: THREE.Object3D,
  magazine: THREE.Object3D,
  template: WeaponAssetTemplate,
  options: { readonly assets?: { part(id: AttachmentPartId): AttachmentPartTemplate | null } | null; readonly attachments?: readonly AttachmentId[] },
  surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>,
): Mounted {
  const out: Mounted = {};
  const assets = options.assets ?? null;
  const attachments = options.attachments ?? [];
  if (assets === null || attachments.length === 0) return out;

  const spec = modelSpecFor(template.weaponId);
  for (const id of attachments) {
    if (id === 'mag_extended') {
      magazine.scale.y = MAGAZINE_EXTENDED_STRETCH;
      continue;
    }
    if (id === 'optic_reflex' && spec.optic === 'scope') continue;
    const partId = ATTACHMENT_PARTS[id];
    const part = assets.part(partId);
    const socket = root.getObjectByName(ATTACHMENT_PART_SOCKETS[partId]);
    if (part === null || socket === undefined) continue;
    const clone = cloneUnder(socket, part, partId);
    PART_FITTINGS[partId]({ clone, part, root, template, surfaces, out });
  }
  return out;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** The part's scene under the weapon's socket, with every mesh's matrix frozen. */
function cloneUnder(socket: THREE.Object3D, part: AttachmentPartTemplate, partId: AttachmentPartId): THREE.Object3D {
  const clone = part.scene.clone(true);
  clone.name = `attachment:${partId}`;
  clone.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.updateMatrix();
      node.matrixAutoUpdate = false;
    }
  });
  socket.add(clone);
  return clone;
}

/** Take a node out of the picture, if the file has one by that name. */
function hide(root: THREE.Object3D, name: string): void {
  const own = root.getObjectByName(name);
  if (own !== undefined) own.visible = false;
}
//#endregion
