/**
 * The weapon in a body's hands, seen from the outside (round 5, F4).
 *
 * One merged geometry and one material per weapon, cached by `BotRenderer` — not a viewmodel
 * parented to a body, which would be five draw calls and a fresh set of geometries per bot for
 * an object between five and fifty metres away that is never reloaded, aimed or animated.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CamoId } from '../../shared/meta/Camos';
import { modelSpecFor } from './WeaponModelSpecs';
import { boxGeometry, tubeGeometry } from './WeaponGeometry';
import { sharedSurfaces } from './WeaponSurfaces';
import {
  bodyBoxes,
  bodyTubes,
  chargingBoxes,
  magazineBoxes,
  magazineTubes,
  supportHandAnchor,
  triggerHandAnchor,
} from './WeaponMeshParts';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** A held weapon's geometry and the two points a body holds it by, in the same space. */
export interface HeldWeaponGeometry {
  readonly geometry: THREE.BufferGeometry;
  /**
   * The trigger grip, after the scale baked into the geometry. Third-person code attaches
   * this point to the character's right-hand socket instead of attaching the receiver centre,
   * so every weapon class has the correct attachment rule.
   */
  readonly gripAnchor: THREE.Vector3;
  /** The support palm, same space. The target for the animated left-arm constraint. */
  readonly supportAnchor: THREE.Vector3;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * `buildHeldWeaponGeometry` plus the anchors that go with it.
 *
 * Returned together so that whoever puts the weapon in a hand receives one object built from
 * one spec, rather than looking the geometry up by id in one place and the anchors up by id in
 * another. Anchors come from `WeaponMeshParts` — the same datum the first-person gloves sit on.
 */
/**
 * The riot shield, in metres: as wide as a torso and as tall as one plus a head behind it.
 *
 * Authored here rather than as a `WeaponModelSpec` because that vocabulary is a firearm's —
 * receiver, handguard, barrel, magazine — and there is no reading of it that produces a plate.
 * A slab is three boxes, so it does not need one.
 */
const SHIELD_W = 0.56;
const SHIELD_H = 0.92;
const SHIELD_T = 0.045;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function buildHeldWeapon(weaponId: string): HeldWeaponGeometry {
  if (weaponId === 'streak_shield') {
    return {
      geometry: buildShieldGeometry(),
      // The hand is on the grip behind the plate; the support palm is the same place, because
      // a shield is carried with one arm and the other one is holding a pistol.
      gripAnchor: new THREE.Vector3(0, -0.05, SHIELD_T * 0.5 + 0.05),
      supportAnchor: new THREE.Vector3(0, -0.05, SHIELD_T * 0.5 + 0.05),
    };
  }
  const spec = modelSpecFor(weaponId);
  const grip = triggerHandAnchor(spec);
  const support = supportHandAnchor(spec);
  return {
    geometry: buildHeldWeaponGeometry(weaponId),
    gripAnchor: new THREE.Vector3(grip.x, grip.y, grip.z).multiplyScalar(spec.scale),
    supportAnchor: new THREE.Vector3(support.x, support.y, support.z).multiplyScalar(spec.scale),
  };
}

/**
 * The one material a held weapon uses.
 *
 * A viewmodel splits into gunmetal, polymer and glove because it fills a third of the screen
 * and the eye reads the materials apart. At the distance a body is seen the split is three
 * draw calls buying a difference nobody can resolve, so the whole weapon takes the receiver's
 * finish. It is the *shared* gunmetal, already built for the viewmodel — a held weapon
 * allocates no material of its own.
 *
 * With a camo (playtest round 3, R4.4) it is the camo set's gunmetal, which *is* the pattern
 * (`buildCamoSurfaces`), from the same per-process cache the viewmodel fills. The editor's
 * stage asks for it, because a body four metres from the lens shows its finish; a match body
 * does not — the wire carries no camo, so there is none to show.
 */
export function heldWeaponMaterial(anisotropy: number, camo: CamoId | null = null): THREE.Material {
  const material = sharedSurfaces(anisotropy, camo).get('gunmetal');
  if (material === undefined) throw new Error('The shared weapon surfaces have no gunmetal.');
  return material;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * One weapon as a single merged geometry, for a body seen from the outside (round 5, F4).
 *
 * ## Why not `buildWeaponModel`
 *
 * F4 asks for the weapon in a bot's hands, and the obvious answer — build the viewmodel and
 * parent it to the body — is five draw calls and a fresh set of geometries **per bot**, on a
 * roster of ten, for an object that is between five and fifty metres away and is never
 * reloaded, never aimed down and never animated. The magazine and the charging handle are
 * separate groups in a viewmodel precisely so the reload can move them; nothing out here can
 * see a reload.
 *
 * So this is the same parts through the same specs, merged flat into one geometry with the
 * scale baked in. One draw call, and `BotRenderer` caches it per weapon id so ten bots
 * carrying four distinct weapons build four geometries rather than ten.
 *
 * ## Why it is here and not in `ai/`
 *
 * Round 4's F15 is the reason. `WeaponIcons` was a second description of what a rifle looks
 * like and it drifted; the fix was to project the killfeed's glyph from `WeaponModelSpec`, so
 * there is one source. A hand-typed rifle in `BotMesh` was the *third* description of one — it
 * has been there since M3 and it is what every bot has carried regardless of what
 * `drawBotWeapon` dealt them. This deletes it rather than adding to it.
 *
 * `lens` and `reticle` are skipped for the same reason `WeaponSilhouette` skips them: they are
 * apertures rather than material, and a filled optic window at fifty metres is a black dot on
 * the one part of the weapon that should read as glass. The first-person gloves are not skipped
 * because they are never asked for — `handBoxes` is a part group the viewmodel alone reads, and
 * a body that already has hands does not need a second pair floating beside them.
 */
function buildHeldWeaponGeometry(weaponId: string): THREE.BufferGeometry {
  const spec = modelSpecFor(weaponId);
  const parts: THREE.BufferGeometry[] = [];

  for (const part of [...bodyBoxes(spec), ...magazineBoxes(spec), ...chargingBoxes(spec)]) {
    if (part.surface === 'lens' || part.surface === 'reticle') continue;
    parts.push(boxGeometry(part));
  }

  for (const part of [...bodyTubes(spec), ...magazineTubes(spec)]) {
    if (part.surface === 'lens' || part.surface === 'reticle') continue;
    // Half the sides of the viewmodel's: a barrel that is twelve-sided at arm's length is
    // eight-sided at twenty metres and nobody can tell, and this is ten of them.
    parts.push(tubeGeometry(part, Math.max(5, Math.round((part.sides ?? 12) * 0.5))));
  }

  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (merged === null) throw new Error(`Weapon "${weaponId}" merged to no geometry.`);
  // The viewmodel scales its root; a shared geometry has no root to scale, so it is baked.
  merged.scale(spec.scale, spec.scale, spec.scale);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * A riot shield as a held object: a plate, a rim that reads at distance, and a viewport.
 *
 * It exists for the **opponent**, not for the holder. A player whose rounds stop doing anything
 * has to be able to see the reason from across a lane, and a body carrying a pistol looks
 * exactly like a body carrying a pistol. The slab is deliberately plain — one merged geometry
 * in the shared gunmetal, like every other held weapon — because what has to be legible is the
 * silhouette, and a flat rectangle held in front of a chest is a silhouette nothing else in the
 * game has.
 *
 * The viewport is a gap rather than glass: a hole in the plate costs two more boxes and no
 * material, and at twenty metres a dark band reads the same as a window.
 */
function buildShieldGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rail = 0.05;
  const gap = 0.1;
  // The plate, in three bands so the middle one can be a slot the eye reads as a viewport.
  const upper = SHIELD_H * 0.34;
  const lower = SHIELD_H - upper - gap;
  const plate = (h: number, y: number): void => {
    const g = new THREE.BoxGeometry(SHIELD_W, h, SHIELD_T);
    g.translate(0, y, 0);
    parts.push(g);
  };
  plate(upper, SHIELD_H * 0.5 - upper * 0.5);
  plate(lower, -SHIELD_H * 0.5 + lower * 0.5);
  // The bar across the viewport, and a rim down each edge: the two details that stop it
  // reading as a crate at distance.
  for (const x of [-SHIELD_W * 0.5 + rail * 0.5, SHIELD_W * 0.5 - rail * 0.5]) {
    const g = new THREE.BoxGeometry(rail, SHIELD_H, SHIELD_T * 1.6);
    g.translate(x, 0, 0);
    parts.push(g);
  }
  // The grip, behind the plate, where the hand goes.
  const grip = new THREE.BoxGeometry(0.04, 0.16, 0.05);
  grip.translate(0, -0.05, SHIELD_T * 0.5 + 0.03);
  parts.push(grip);

  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (merged === null) throw new Error('The riot shield merged to no geometry.');
  merged.computeBoundingSphere();
  return merged;
}
//#endregion
