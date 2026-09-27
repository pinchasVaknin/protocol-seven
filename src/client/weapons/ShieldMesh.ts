import * as THREE from 'three';
import type { ShieldAssetTemplate } from './WeaponAssetService';
import { ViewmodelHands } from './ViewmodelHands';

/**
 * The riot shield as a held first-person object (2026-09-27).
 *
 * ## Why it is not a weapon
 *
 * `buildWeaponModel` reads a muzzle, a magazine and a charging handle off every file it is
 * given, and throws when one is missing. A plate has none of them. The shield is the third
 * thing in this project to be held without being a firearm — the knife and the grenades are
 * the others — and it is built the way they are: its own loader, its own model, and a carbine
 * standing in hidden under the animator when one is needed, because `ViewmodelAnim` is built
 * around a weapon and poses one every frame.
 *
 * ## Which hand
 *
 * The **left**. This killstreak gives you a shield *and a pistol*, and the pistol is in the
 * right hand — that is the whole shape of the weapon, and `StreakWeapons.shieldPistolWeapon`
 * is the def for it. So the shield rides `socket_support`, the right arm is what the pistol's
 * own viewmodel draws, and the right arm is collapsed here so two right hands never appear in
 * one frame.
 *
 * The file's origin is the middle of the plate and the socket is behind it, where a riot
 * shield's forearm cuff is; both come from the recipe in `scripts/weapon-build.mjs`, so
 * nothing here measures the mesh.
 */
/**
 * How much of the ballistic glass you can see through.
 *
 * Not a window: a laminated pane six layers thick, scratched and spalled, which is what the
 * source's texture already paints on it. 0.34 keeps the scratches readable while a body
 * moving behind it is unmistakable — the whole reason the viewport had to stop being paint.
 */
const GLASS_OPACITY = 0.34;

/**
 * Make the `glass` group glass.
 *
 * The file's viewport is a separate node because `scripts/weapon-build.mjs` cut it out of the
 * plate (the recipe says why), but it still carries the **one material the whole shield
 * shares** — so the material is cloned here rather than edited, or the plate, the light board
 * and the handle would all turn to glass with it.
 *
 * `depthWrite` off and a later `renderOrder` because the pane sits in a hole in an object that
 * is drawn in one pass: writing depth would let the near face of the glass hide the far one,
 * and the hole would read as a mirror rather than a window.
 */
function dressGlass(plate: THREE.Object3D, disposables: Array<{ dispose(): void }>): void {
  const glass = plate.getObjectByName('glass');
  if (glass === undefined) return;
  glass.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material;
    if (Array.isArray(source) || !(source instanceof THREE.MeshStandardMaterial)) return;
    const pane = source.clone();
    pane.transparent = true;
    pane.opacity = GLASS_OPACITY;
    pane.depthWrite = false;
    pane.side = THREE.DoubleSide;
    // Laminated armour glass is polished and not a metal, whatever the plate around it is.
    pane.roughness = 0.12;
    pane.metalness = 0;
    mesh.material = pane;
    mesh.renderOrder = 1;
    disposables.push(pane);
  });
}

export interface ShieldModel {
  readonly root: THREE.Object3D;
  /** The rig, when the arms' file has arrived; null while it has not and the plate is bare. */
  readonly hands: ViewmodelHands | null;
  dispose(): void;
}

/**
 * Build the shield.
 *
 * `template` is null until the file arrives — the caller draws nothing rather than a box,
 * because the procedural slab `WeaponMesh` owns is the *world* shield and is already drawn on
 * the body; a second one in the viewmodel would be the same object twice.
 */
export function buildShieldModel(
  template: ShieldAssetTemplate | null,
  rig: THREE.Object3D | null = null,
): ShieldModel {
  const root = new THREE.Group();
  root.name = 'viewmodel:shield';

  const disposables: Array<{ dispose(): void }> = [];

  if (template !== null) {
    const plate = template.scene.clone(true);
    plate.name = 'viewmodel:shield:file';
    dressGlass(plate, disposables);
    root.add(plate);
  }
  let hands: ViewmodelHands | null = null;
  if (rig !== null) {
    // The cuff, from the file's own socket. A shield with no `socket_support` is a shield the
    // recipe built wrong, and the hand goes to the plate's origin — visibly wrong, which is
    // the point: it reads as a bug rather than as a pose that needs another nudge.
    const cuff = new THREE.Object3D();
    cuff.name = 'viewmodel:hand-target:support';
    const at = template?.sockets.socket_support;
    if (at !== undefined) cuff.position.copy(at);
    root.add(cuff);
    // `gripPose` is left at a weapon's trigger hand: it describes the right hand, which is
    // collapsed on the next line, so naming a hold for it would be a number nothing reads.
    hands = new ViewmodelHands(rig, root, { grip: cuff, support: cuff, supportPose: 'wrap', magazine: null }, 'streak_shield');
    // The right hand is the pistol's; the pistol's own viewmodel draws it.
    hands.showArm('R', false);
    root.add(hands.frame);
    disposables.push(hands);
  }

  return {
    root,
    hands,
    dispose(): void {
      // Geometry only, as the knife's does: the materials and textures belong to the template
      // and are shared by every instance built from it.
      for (const d of disposables) d.dispose();
      root.clear();
    },
  };
}
