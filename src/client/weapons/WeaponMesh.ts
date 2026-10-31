/**
 * A weapon assembled: specs and tables in, a `WeaponModel` out.
 *
 * Two ways in, and the contract is the same either way. A **file** is a built GLB, cloned,
 * dressed and fitted; the **primitives** are the twelve weapons' proportions merged from boxes
 * and tubes. What a caller gets back is a root, three groups the animation moves, and the
 * handful of numbers the ADS pose reads — and nothing in `ViewmodelAnim` knows which path
 * produced them.
 *
 * ## What is where
 *
 * This file is the assembly and the surface. The rest lives beside it:
 *
 * | file | what it owns |
 * |---|---|
 * | `WeaponMeshParts.ts` | where every primitive goes, as a function of a spec |
 * | `WeaponGeometry.ts` | a part into a geometry, and the merge by surface |
 * | `WeaponSurfaces.ts` | the three materials, their textures and the optic's two |
 * | `WeaponCamo.ts` | a camo over a file's own materials |
 * | `WeaponAttachments.ts` | the pack on the sockets, and what each part changes |
 * | `HeldWeaponMesh.ts` | the same weapon for a body seen from the outside |
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import type { CamoId } from '../../shared/meta/Camos';
import type { AttachmentId } from '../../shared/weapons/Attachments';
import { modelSpecFor } from './WeaponModelSpecs';
import { groupNodes, type WeaponAssetService, type WeaponAssetTemplate } from './WeaponAssetService';
import { ViewmodelHands, type HandTargets, type SupportPose } from './ViewmodelHands';
import { addMerged } from './WeaponGeometry';
import { sharedSurfaces } from './WeaponSurfaces';
import { paintCamo } from './WeaponCamo';
import { dressOwnOptic, mountAttachments } from './WeaponAttachments';
import {
  barrelY,
  bodyBoxes,
  bodyTubes,
  chargingBoxes,
  handBoxes,
  handBoxesAt,
  magazineBoxes,
  magazineTubes,
  muzzleZ,
  supportHandAnchor,
  triggerHandAnchor,
  type SurfaceKey,
} from './WeaponMeshParts';

/*
 * The surface this file has always had, kept whole where every caller already imports it.
 * `BotRenderer`, `CharacterStage` and `WeaponPreview` take the held weapon and its material;
 * `KnifeMesh` takes the shared surfaces; `ClientMatch`, the hand tuner and the preview take
 * the builder and the model. Each name now lives with the stage that owns it, and nothing
 * about what a caller writes changes.
 */
export { sharedWeaponSurfaces } from './WeaponSurfaces';
export { camoMaterial, paintCamo } from './WeaponCamo';
export { buildHeldWeapon, heldWeaponMaterial, type HeldWeaponGeometry } from './HeldWeaponMesh';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface WeaponModel {
  /** `Object3D` rather than `Group` since M19: a GLB node is the former, and nothing here reads the flag. */
  readonly root: THREE.Object3D;
  /** Slides out of the well and drops away during a reload. */
  readonly magazine: THREE.Object3D;
  /** Pulled and released on the empty reload. On a shotgun this is the pump. */
  readonly chargingHandle: THREE.Object3D;
  /** Muzzle flash is parented here so it tracks every animation the gun does. */
  readonly muzzle: THREE.Object3D;
  /**
   * Height of the sight line above the origin **in the parent's space**, metres —
   * `spec.sightHeight` with `spec.scale` already applied.
   *
   * The scale matters and was missed the first time: the root is scaled, so a weapon at
   * 1.08 has a sight line 8% higher than its spec says, and the ADS compensation in
   * `ViewmodelAnim` was cancelling the unscaled number. Measured error was up to 8.3 mm —
   * about 2.5 degrees at the ADS distance, which is a visibly misaligned sight picture on
   * the six weapons whose scale is not 1.
   */
  readonly sightHeight: number;
  /**
   * The sight line as a point in weapon space (M19, playtest 3): `sightHeight` is its Y, and
   * its X and Z are what the ADS pose brings onto the camera axis at the eye's distance. On
   * the primitives it is (0, sightHeight, 0), the pose the config was tuned against; on a file
   * it is `socket_sight`, or the mounted optic's own sight above the rail socket — a P90's
   * collimator twelve centimetres ahead of the receiver's centre, an AK's rear leaf on it,
   * and `ViewmodelAnim` holds every one at the same distance from the eye.
   */
  readonly sightPoint: THREE.Vector3;
  /**
   * How far in front of the eye `sightPoint` is held at full ADS, metres (M19, playtest 3).
   *
   * A shouldered rifle puts its rear sight or its red dot about 20 cm from the eye, and a
   * scope its ocular about 10 — that is eye relief, and it is why a scope fills the view and
   * a red dot does not. Holding every weapon at one distance is what put the AK's receiver
   * across the screen and the P90's collimator at arm's length; holding the *sight* at the
   * right distance puts the rest of each weapon where the eye expects it.
   *
   * Zero on the primitives, whose pose is `ViewmodelConfig.adsZ` plus the spec's own
   * `adsOffsetZ` and is not derived from a sight point at all.
   */
  readonly adsSightDistance: number;
  /**
   * Degrees the weapon turns about its own X at full ADS, the muzzle up (M19, playtest 6).
   *
   * Zero wherever the sight line is parallel to the bore, which is everywhere but a file whose
   * irons are a line that is not: the VULCAN's quad rail stands over its front post, and the
   * only line that sees the post falls toward it from over the rail. The file says so with a
   * `socket_sight_front` at the post's tip, this is the slope from `sightPoint` to it, and the
   * ADS pose turns the weapon by it so that line is the camera's axis. A mounted optic's line is
   * parallel to the bore again, so it is zero under one.
   */
  readonly adsPitch: number;
  /** Per-weapon correction to the shared ADS pose. See `WeaponModelSpec.adsOffsetZ`. */
  readonly adsOffsetZ: number;
  readonly weaponId: string;
  /** Where the triangles came from (M19): the file, or the primitives standing in for it. */
  readonly source: 'glb' | 'procedural';
  /**
   * The direction the magazine leaves along on a reload, a unit vector in weapon space (M19,
   * stage 3). Straight down for every weapon but the P90, whose magazine lies along the top
   * and comes off upward and back; a file says so with a `socket_mag_exit` node.
   */
  readonly magazineExit: THREE.Vector3;
  /**
   * The support glove's boxes and forearm, as one node, or null when the model has no hands
   * (the loadout preview, the bodies' LOD), is the primitives', or wears the arms' rig — whose
   * support hand goes to the magazine through `hands.magazineHold` instead.
   *
   * Its own group rather than part of the body because it is the hand that **changes the
   * magazine** (M19, playtest 5): the trigger hand stays on the grip and this one travels to
   * the well, carries the empty magazine away and brings the fresh one up. A reload the player
   * cannot see is a reload that might as well be a fade to black, and the well was the one
   * thing the raised pose made visible — so something had to arrive at it.
   */
  readonly supportHand: THREE.Object3D | null;
  /**
   * The first-person arms (M19, stage 4), or null when the model wears the grey boxes — no
   * hands asked for, or the arms' file has not arrived. `ViewmodelAnim` calls its `update`
   * once the root has its pose for the frame; the rig puts the gloves on the model's two hand
   * targets, one of which is under `supportHand`.
   */
  readonly hands: ViewmodelHands | null;
  dispose(): void;
}

/** What a `WeaponModel` is for, which decides which part groups it is built from. */
export interface WeaponModelOptions {
  /**
   * The first-person gloves. On for the viewmodel, where a weapon with no hands reads as a
   * floating prop; off for a picture of the weapon alone, such as the loadout preview.
   */
  readonly hands: boolean;
  /**
   * Where a built GLB comes from (M19). Absent or null, every weapon is the primitives; given,
   * a weapon whose template has arrived is cloned from the file. Never awaited here: the
   * builder is synchronous, and a template that is still loading is a procedural model now
   * and a `preload` promise for the caller to act on.
   */
  readonly assets?: WeaponAssetService | null;
  /**
   * The attachments to show on the gun (M19, stage 2). Read only by a model built from a file:
   * the pack mounts on sockets, and the primitives have none. Absent means bare.
   */
  readonly attachments?: readonly AttachmentId[];
  /**
   * Build the geometry of a **different** weapon, and keep this one's identity (2026-09-27).
   *
   * One caller: the riot shield's sidearm. The streak hands you a pistol, and the human asked
   * for the pistol the game already has rather than the slab `WeaponModelSpecs` describes — but
   * it is not *that* pistol, it is a one-handed pistol held beside a plate, and its hand pose
   * and its place on screen are its own. So the mesh comes from `pistol_talon` and everything
   * tuned — `HAND_POSES`, `HAND_WRAPS`, `VIEWMODEL_OFFSETS` — stays keyed to the weapon asking.
   *
   * Absent, which is every other call, the two are the same id and nothing changes.
   */
  readonly assetId?: string;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const VIEWMODEL: WeaponModelOptions = { hands: true };

/**
 * The four groups a primitive weapon is built from, merged and parented.
 *
 * The hands are their own part group (see `handBoxes`), so a model without them is built from
 * fewer groups rather than from a filtered one. The arms' rig replaces the boxes once its file
 * has arrived (stage 4), on the same two anchors the boxes stand on.
 */
function mergePrimitiveGroups(
  spec: ReturnType<typeof modelSpecFor>,
  surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>,
  options: WeaponModelOptions,
  into: { readonly disposables: Array<{ dispose(): void }>; readonly weaponId: string },
): {
  root: THREE.Group;
  magazine: THREE.Group;
  chargingHandle: THREE.Group;
  muzzle: THREE.Object3D;
  hands: ViewmodelHands | null;
} {
  const { disposables, weaponId } = into;
  const root = new THREE.Group();
  root.name = `viewmodel:${weaponId}`;
  root.scale.setScalar(spec.scale);

  const rig = options.hands ? (options.assets?.hands() ?? null) : null;
  const boxes = options.hands && rig === null ? [...bodyBoxes(spec), ...handBoxes(spec)] : bodyBoxes(spec);
  addMerged(root, boxes, bodyTubes(spec), surfaces, disposables, 'body');

  const magazine = new THREE.Group();
  magazine.name = 'viewmodel:magazine';
  addMerged(magazine, magazineBoxes(spec), magazineTubes(spec), surfaces, disposables, 'mag');
  // The magazine's middle, from its own boxes, measured before it has a parent: the reload
  // hand's place, as a file's `socket_mag_grip` is.
  magazine.updateMatrixWorld(true);
  const magazineMiddle = new THREE.Box3().setFromObject(magazine).getCenter(new THREE.Vector3());
  root.add(magazine);

  let hands: ViewmodelHands | null = null;
  if (rig !== null) {
    const grip = handTarget(root, 'grip', triggerHandAnchor(spec));
    const support = handTarget(root, 'support', supportHandAnchor(spec));
    const onMagazine = handTarget(magazine, 'magazine', magazineMiddle);
    hands = attachHands(rig, root, { grip, support, supportPose: supportPoseFor(spec), magazine: onMagazine }, weaponId, disposables);
  }

  const chargingHandle = new THREE.Group();
  chargingHandle.name = 'viewmodel:charging';
  addMerged(chargingHandle, chargingBoxes(spec), [], surfaces, disposables, 'charge');
  root.add(chargingHandle);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'viewmodel:muzzle';
  muzzle.position.set(0, barrelY(spec), muzzleZ(spec));
  root.add(muzzle);

  return { root, magazine, chargingHandle, muzzle, hands };
}

/**
 * A `WeaponModel` from a built GLB (M19, stage 1).
 *
 * The clone shares geometry and materials with the template, so what is per instance is the
 * node tree and the gloves; `dispose` releases the gloves' merged geometry and clears the
 * tree, and never touches the template's resources — `WeaponAssetService` owns those for the
 * life of the application, as the character templates are owned.
 *
 * The file is already in viewmodel space (metres, -Z forward, the origin at the receiver:
 * `weapon-build.mjs`'s fix), so the root's scale is 1 and the socket positions are the
 * numbers the contract asks for. `sightHeight` is `socket_sight`'s Y — measured from the
 * mesh, not typed into a spec — and `adsOffsetZ` still comes from the spec, because it is a
 * correction to the shared pose and not a property of the geometry. The gloves are the same
 * grey boxes every procedural weapon wears, carried to the file's `socket_grip` and
 * `socket_support` (`handBoxesAt`): a body's hands are a later stage, and a rifle with no
 * hands reads as a floating prop today.
 *
 * The camo is an overlay (decision 4, stage 3): every opaque material under the root is
 * swapped for its `camoMaterial` variant before the hands and the attachments arrive, so the
 * gloves stay grey and the pack parts stay the finish they came in — a camo is a property of
 * the weapon, and a suppressor is not painted with it.
 *
 * **The attachments are mounted here** (stage 2), because they change two numbers the
 * contract hands out: an optic moves the sight line the ADS pose cancels, and a suppressor
 * moves the muzzle the flash is parented to. Both are settled before the model is returned,
 * so nothing downstream learns that a gun can change shape — `ViewmodelAnim` reads
 * `sightHeight`, `Fx` parents to `muzzle`, and the values are simply different.
 */
const configuredMaterials = new WeakSet<THREE.Material>();

/** Where a file's rear sight or red dot is held at ADS, metres from the eye. */
const SIGHT_DISTANCE = 0.2;
/** Where a file's scope ocular is held: eye relief, so the tube fills the view. */
const SCOPE_EYE_RELIEF = 0.1;
/**
 * Where a pistol's rear sight is held at ADS: out at arm's length, as a pistol is aimed (stage
 * 4). At a rifle's 20 cm the box gloves fitted under it; the arms do not — two forearms from
 * hands 20 cm from the eye come back under the lens and filled the lower half of the picture.
 */
const PISTOL_SIGHT_DISTANCE = 0.42;

const MAGAZINE_EXIT_DOWN = new THREE.Vector3(0, -1, 0);
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Build one weapon.
 *
 * `anisotropy` reaches the shared textures on first use only; later calls reuse them, which
 * is why it is not part of the cache key. Every model in a match is built with the same
 * value in practice.
 */

export function buildWeaponModel(
  weaponId: string,
  anisotropy: number,
  camo: CamoId | null = null,
  options: WeaponModelOptions = VIEWMODEL,
): WeaponModel {
  // The geometry's id and the identity's id, which are the same for every weapon but one.
  const assetId = options.assetId ?? weaponId;
  const spec = modelSpecFor(assetId);
  const surfaces = sharedSurfaces(anisotropy, camo);

  const template = options.assets?.template(assetId) ?? null;
  if (template !== null) return buildFromTemplate(template, anisotropy, camo, surfaces, options, weaponId);
  return buildFromPrimitives(spec, surfaces, options, weaponId);
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * The twelve weapons' own proportions, merged from boxes and tubes.
 *
 * Only the two LMGs are built this way now; every other weapon has a file. It is still the
 * fallback for one that has not arrived, and it is what the loadout editor draws while a
 * template is in flight.
 */
function buildFromPrimitives(
  spec: ReturnType<typeof modelSpecFor>,
  surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>,
  options: WeaponModelOptions,
  weaponId: string,
): WeaponModel {
  const disposables: Array<{ dispose(): void }> = [];
  const { root, magazine, chargingHandle, muzzle, hands } = mergePrimitiveGroups(spec, surfaces, options, {
    disposables,
    weaponId,
  });

  return {
    root,
    magazine,
    chargingHandle,
    muzzle,
    sightHeight: spec.sightHeight * spec.scale,
    sightPoint: new THREE.Vector3(0, spec.sightHeight * spec.scale, 0),
    adsSightDistance: 0,
    adsPitch: 0,
    adsOffsetZ: spec.adsOffsetZ,
    weaponId,
    source: 'procedural',
    magazineExit: MAGAZINE_EXIT_DOWN.clone(),
    // The primitives' reload is the old dip, and nothing down there is worth watching (only the
    // two LMGs are built this way now): the support hand stays where it holds the weapon.
    supportHand: null,
    hands,
    dispose(): void {
      // Only the geometry is per model. The three materials and their textures are shared
      // for the life of the process in `WeaponSurfaces` and the camo cache in
      // `meta/CamoTextures`. Nothing releases them today; a page teardown, if one is ever
      // built, disposes those caches, not the meshes.
      for (const d of disposables) d.dispose();
      root.clear();
    },
  };
}

/**
 * A `WeaponModel` from a built GLB (M19, stage 1).
 *
 * The file is the weapon; this clones it, dresses what the recipe left for the engine, puts
 * the hands on it and fits the pack. `identity` is whose tuning the model answers to — the
 * template's own id for every weapon but the shield's sidearm.
 */
function buildFromTemplate(
  template: WeaponAssetTemplate,
  anisotropy: number,
  camo: CamoId | null,
  surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>,
  options: WeaponModelOptions,
  identity: string = template.weaponId,
): WeaponModel {
  const spec = modelSpecFor(template.weaponId);
  const root = template.scene.clone(true);
  root.name = `viewmodel:${identity}`;
  const groups = groupNodes(root);
  const disposables: Array<{ dispose(): void }> = [];
  if (camo !== null) paintCamo(root, camo, anisotropy);
  configureMaterials(root, anisotropy);
  dressOwnOptic(root, surfaces, disposables);

  const { hands, supportHand } = attachTemplateHands(root, groups, template, {
    spec,
    surfaces,
    options,
    disposables,
    identity,
  });

  const bareMuzzle = root.getObjectByName('socket_muzzle');
  if (bareMuzzle === undefined) throw new Error(`Weapon clone "${template.weaponId}" has no socket_muzzle.`);
  const mounted = mountAttachments(root, groups.magazine, template, options, surfaces);
  const sightPoint = mounted.sightPoint ?? template.sockets.socket_sight.clone();
  const front = mounted.sightPoint === undefined ? root.getObjectByName('socket_sight_front') : undefined;

  return {
    root,
    magazine: groups.magazine,
    chargingHandle: groups.charge,
    muzzle: mounted.muzzle ?? bareMuzzle,
    sightHeight: sightPoint.y,
    sightPoint,
    adsSightDistance: adsDistanceFor(spec),
    adsPitch: front === undefined ? 0 : ironsPitch(sightPoint, front.position),
    adsOffsetZ: spec.adsOffsetZ,
    weaponId: identity,
    source: 'glb',
    magazineExit: magazineExitOf(root),
    supportHand,
    hands,
    dispose(): void {
      for (const d of disposables) d.dispose();
      root.clear();
    },
  };
}

/**
 * The arms on a file-backed weapon: the rig if its file has arrived, the box gloves if not.
 *
 * The rig takes the two sockets, and the magazine's grip on the magazine itself, so the reload
 * hand goes where the magazine goes (`ViewmodelHands.magazineHold`).
 */
function attachTemplateHands(
  root: THREE.Object3D,
  groups: ReturnType<typeof groupNodes>,
  template: WeaponAssetTemplate,
  context: {
    readonly spec: ReturnType<typeof modelSpecFor>;
    readonly surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>;
    readonly options: WeaponModelOptions;
    readonly disposables: Array<{ dispose(): void }>;
    readonly identity: string;
  },
): { hands: ViewmodelHands | null; supportHand: THREE.Object3D | null } {
  const { spec, surfaces, options, disposables, identity } = context;
  const rig = options.hands ? (options.assets?.hands() ?? null) : null;
  if (rig !== null) {
    const grip = handTarget(root, 'grip', template.sockets.socket_grip);
    const support = handTarget(root, 'support', template.sockets.socket_support);
    const onMagazine = handTarget(groups.magazine, 'magazine', template.sockets.socket_mag_grip);
    const hands = attachHands(rig, root, { grip, support, supportPose: supportPoseFor(spec), magazine: onMagazine }, identity, disposables);
    return { hands, supportHand: null };
  }
  if (!options.hands) return { hands: null, supportHand: null };
  return { hands: null, supportHand: attachBoxHands(root, groups.body, template, spec, surfaces, disposables) };
}

/**
 * The filtering the procedural textures get, on the file's.
 *
 * Once per texture, and the textures are shared, so a second instance finds it set. Every
 * mesh's matrix is frozen at the same time: nothing under a weapon moves on its own.
 */
function configureMaterials(root: THREE.Object3D, anisotropy: number): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.updateMatrix();
      node.matrixAutoUpdate = false;
    }
    const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : [material]) filterTextures(m, anisotropy);
  });
}

/** Every texture on one material, filtered once. A second instance finds it already set. */
function filterTextures(material: THREE.Material | undefined, anisotropy: number): void {
  if (!(material instanceof THREE.Material) || configuredMaterials.has(material)) return;
  configuredMaterials.add(material);
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value instanceof THREE.Texture && value.anisotropy !== anisotropy) {
      value.anisotropy = anisotropy;
      value.needsUpdate = true;
    }
  }
}

/**
 * The box gloves on a file's own sockets, for a weapon built before the arms' rig arrived.
 *
 * `handBoxes` lists the trigger pair first and the support pair second (its own comment says
 * so); the split is by that order, as `handBoxesAt` already relies on it. The support pair is
 * its own group because the reload moves it.
 */
function attachBoxHands(
  root: THREE.Object3D,
  body: THREE.Object3D,
  template: WeaponAssetTemplate,
  spec: ReturnType<typeof modelSpecFor>,
  surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>,
  disposables: Array<{ dispose(): void }>,
): THREE.Object3D | null {
  const boxes = handBoxesAt(spec, template.sockets.socket_grip, template.sockets.socket_support);
  addMerged(body, boxes.slice(0, 2), [], surfaces, disposables, 'hands');
  const support = boxes.slice(2);
  if (support.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'viewmodel:hand:support';
  addMerged(group, support, [], surfaces, disposables, 'hand-support');
  root.add(group);
  return group;
}

/**
 * How far in front of the eye the sight point is held at full ADS.
 *
 * A scope is held at eye relief; irons and a red dot at a shouldered rifle's sight distance,
 * and a pistol at arm's length. `mountAttachments` leaves a scoped weapon its scope, so the
 * two cannot disagree.
 */
function adsDistanceFor(spec: ReturnType<typeof modelSpecFor>): number {
  if (spec.optic === 'scope') return SCOPE_EYE_RELIEF;
  return spec.handguardLength > 0 ? SIGHT_DISTANCE : PISTOL_SIGHT_DISTANCE;
}

/** An empty node a hand is put on, `at` in its parent's space. */
function handTarget(parent: THREE.Object3D, which: 'grip' | 'support' | 'magazine', at: { x: number; y: number; z: number }): THREE.Object3D {
  const node = new THREE.Object3D();
  node.name = `viewmodel:hand-target:${which}`;
  node.position.set(at.x, at.y, at.z);
  parent.add(node);
  return node;
}

/**
 * A weapon with no handguard is held in two hands on the grip (`handBoxes` says why), so its
 * support hand wraps the trigger hand rather than cupping furniture that is not there.
 */
function supportPoseFor(spec: { readonly handguardLength: number }): SupportPose {
  return spec.handguardLength > 0 ? 'handguard' : 'wrap';
}

/** The arms' rig on a model: its frame under the root, released with the model. */
function attachHands(
  template: THREE.Object3D,
  root: THREE.Object3D,
  targets: HandTargets,
  weaponId: string,
  disposables: Array<{ dispose(): void }>,
): ViewmodelHands {
  const hands = new ViewmodelHands(template, root, targets, weaponId);
  root.add(hands.frame);
  disposables.push(hands);
  return hands;
}

/** The file's `socket_mag_exit`, a unit direction carried as a point; down when it has none. */
function magazineExitOf(root: THREE.Object3D): THREE.Vector3 {
  const socket = root.getObjectByName('socket_mag_exit');
  if (socket === undefined) return MAGAZINE_EXIT_DOWN.clone();
  const exit = socket.position.clone();
  return exit.lengthSq() > 0 ? exit.normalize() : MAGAZINE_EXIT_DOWN.clone();
}

/**
 * The slope of an irons line from the rear point to the front post, degrees, positive when the
 * post is lower — the turn about X, the muzzle up, that makes the line level. See `adsPitch`.
 */
function ironsPitch(rear: THREE.Vector3, front: THREE.Vector3): number {
  const run = rear.z - front.z;
  if (run <= 0) return 0;
  return Math.atan2(rear.y - front.y, run) * THREE.MathUtils.RAD2DEG;
}
//#endregion
