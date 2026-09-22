import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../shared/core/Rng';
import { camoTexture } from '../meta/CamoTextures';
import type { CamoId } from '../../shared/meta/Camos';
import {
  bodyBoxes,
  bodyTubes,
  barrelY,
  chargingBoxes,
  handBoxes,
  handBoxesAt,
  magazineBoxes,
  magazineTubes,
  muzzleZ,
  supportHandAnchor,
  triggerHandAnchor,
  type BoxPart,
  type SurfaceKey,
  type TubePart,
} from './WeaponMeshParts';
import { modelSpecFor } from './WeaponModelSpecs';
import { groupNodes, type WeaponAssetService, type WeaponAssetTemplate } from './WeaponAssetService';
import { ATTACHMENT_PARTS, ATTACHMENT_PART_SOCKETS, MAGAZINE_EXTENDED_STRETCH } from './WeaponAssetCatalog';
import type { AttachmentId } from '../../shared/weapons/Attachments';

/**
 * Viewmodels, built from primitives in code (brief S2: zero external assets).
 *
 * M2 hand-placed the AR's boxes. M5 needs twelve, and twelve hand-placed weapons is twelve
 * lists of coordinates that drift apart the first time the sight height changes — so the
 * geometry is now a *function* of a `WeaponModelSpec` and the specs are the content. The
 * carbine's spec reproduces M2's proportions; everything else varies from it.
 *
 * Geometry is merged per material, so a whole weapon is five draw calls: three for the
 * static body and two for the parts that move on their own — the magazine and the charging
 * handle (or the pump), which the reload sequence animates independently.
 *
 * Local space matches the viewmodel camera: +X right, +Y up, **-Z forward**, origin at the
 * centre of the receiver. The sights are authored so a line through them sits at
 * `spec.sightHeight` above the origin; that is the number `ViewmodelConfig.adsY` cancels
 * for the sights to land on the screen centre when aimed.
 *
 * Textures are built once per *process* and shared by every model — twelve weapons each
 * generating three 128px canvases would be thirty-six canvases for three distinct images.
 *
 * **M19 adds a second source behind the same contract.** A weapon with a built GLB
 * (`WeaponAssetCatalog`) whose template has arrived (`WeaponAssetService`) is cloned from the
 * file instead — `buildFromTemplate` below — and everything downstream reads the same
 * `WeaponModel`: `ViewmodelAnim` drops the same `magazine`, `Fx` parents the flash to the same
 * `muzzle`, the ADS pose cancels the same `sightHeight`. The file's groups and sockets carry
 * the contract's names, so the two builders differ in where the triangles come from and in
 * nothing else. When the template is not there — no file, not loaded yet, failed — the
 * primitives are built exactly as before; `source` says which happened, so a caller can ask
 * for the upgrade when the file lands.
 */

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
   * The support hand and its forearm, as one node, or null when the model has no hands
   * (the loadout preview, the bodies' LOD) or is the primitives'.
   *
   * Its own group rather than part of the body because it is the hand that **changes the
   * magazine** (M19, playtest 5): the trigger hand stays on the grip and this one travels to
   * the well, carries the empty magazine away and brings the fresh one up. A reload the player
   * cannot see is a reload that might as well be a fade to black, and the well was the one
   * thing the raised pose made visible — so something had to arrive at it.
   */
  readonly supportHand: THREE.Object3D | null;
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
}

const VIEWMODEL: WeaponModelOptions = { hands: true };

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
  const spec = modelSpecFor(weaponId);
  const surfaces = sharedSurfaces(anisotropy, camo);

  const template = options.assets?.template(weaponId) ?? null;
  if (template !== null) return buildFromTemplate(template, anisotropy, camo, surfaces, options);

  const root = new THREE.Group();
  root.name = `viewmodel:${weaponId}`;
  root.scale.setScalar(spec.scale);

  const disposables: Array<{ dispose(): void }> = [];

  // The hands are their own part group (see `handBoxes`), so a model without them is built
  // from fewer groups rather than from a filtered one.
  const boxes = options.hands ? [...bodyBoxes(spec), ...handBoxes(spec)] : bodyBoxes(spec);
  addMerged(root, boxes, bodyTubes(spec), surfaces, disposables, 'body');

  const magazine = new THREE.Group();
  magazine.name = 'viewmodel:magazine';
  addMerged(magazine, magazineBoxes(spec), magazineTubes(spec), surfaces, disposables, 'mag');
  root.add(magazine);

  const chargingHandle = new THREE.Group();
  chargingHandle.name = 'viewmodel:charging';
  addMerged(chargingHandle, chargingBoxes(spec), [], surfaces, disposables, 'charge');
  root.add(chargingHandle);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'viewmodel:muzzle';
  muzzle.position.set(0, barrelY(spec), muzzleZ(spec));
  root.add(muzzle);

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
    // The primitives keep their hands in the body: their reload is the old dip, and nothing
    // down there is worth watching (only the two LMGs are built this way now).
    supportHand: null,
    dispose(): void {
      // Only the geometry is per model. The three materials and their textures are shared
      // for the life of the process in `cachedSurfaces` and `baseTextures` here and the camo cache in
      // `meta/CamoTextures`. Nothing releases them today; a page teardown, if one is ever built,
      // disposes those three caches, not the meshes.
      for (const d of disposables) d.dispose();
      root.clear();
    },
  };
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
function buildFromTemplate(
  template: WeaponAssetTemplate,
  anisotropy: number,
  camo: CamoId | null,
  surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>,
  options: WeaponModelOptions,
): WeaponModel {
  const spec = modelSpecFor(template.weaponId);
  const root = template.scene.clone(true);
  root.name = `viewmodel:${template.weaponId}`;
  const groups = groupNodes(root);
  const disposables: Array<{ dispose(): void }> = [];
  if (camo !== null) paintCamo(root, camo, anisotropy);

  // The filtering the procedural textures get, on the file's — once per texture, and the
  // textures are shared, so a second instance finds it set.
  root.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (!(m instanceof THREE.Material)) continue;
      for (const value of Object.values(m as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture && value.anisotropy !== anisotropy) {
          value.anisotropy = anisotropy;
          value.needsUpdate = true;
        }
      }
    }
  });

  dressOwnOptic(root, surfaces, disposables);

  let supportHand: THREE.Object3D | null = null;
  if (options.hands) {
    const boxes = handBoxesAt(spec, template.sockets.socket_grip, template.sockets.socket_support);
    // `handBoxes` lists the trigger pair first and the support pair second (its own comment
    // says so); the split is by that order, as `handBoxesAt` already relies on it.
    addMerged(groups.body, boxes.slice(0, 2), [], surfaces, disposables, 'hands');
    const support = boxes.slice(2);
    if (support.length > 0) {
      const group = new THREE.Group();
      group.name = 'viewmodel:hand:support';
      addMerged(group, support, [], surfaces, disposables, 'hand-support');
      root.add(group);
      supportHand = group;
    }
  }

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
    // A scope is held at eye relief; irons and a red dot at a shouldered rifle's sight
    // distance. `mountAttachments` leaves a scoped weapon its scope, so the two cannot disagree.
    adsSightDistance: spec.optic === 'scope' ? SCOPE_EYE_RELIEF : SIGHT_DISTANCE,
    adsPitch: front === undefined ? 0 : ironsPitch(sightPoint, front.position),
    adsOffsetZ: spec.adsOffsetZ,
    weaponId: template.weaponId,
    source: 'glb',
    magazineExit: magazineExitOf(root),
    supportHand,
    dispose(): void {
      for (const d of disposables) d.dispose();
      root.clear();
    },
  };
}

/**
 * Paint a file's weapon in a camo: every opaque material under `root` becomes its
 * `camoMaterial` variant. Transparent materials — the glass of a file's own optic — are
 * left, for the reason `addOpticSurfaces` gives: a painted lens is not a lens.
 */
export function paintCamo(root: THREE.Object3D, camo: CamoId, anisotropy: number): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (material === undefined) return;
    const paint = (m: THREE.Material): THREE.Material =>
      m instanceof THREE.MeshStandardMaterial && !m.transparent ? camoMaterial(m, camo, anisotropy) : m;
    mesh.material = Array.isArray(material) ? material.map(paint) : paint(material);
  });
}

/**
 * How many times the 256 px pattern tiles across a file's UV square. The procedural boxes
 * carry the pattern at two tiles per face, a few centimetres each; a file's atlas covers the
 * whole weapon in one square, and six tiles across it lands the pattern at about the size
 * the boxes wear it.
 */
const CAMO_OVERLAY_REPEAT = 6;

/**
 * The camo variants of the files' materials (decision 4), one per material and camo, kept
 * for the process like `cachedSurfaces` — a match and every loadout change ask for the same
 * few, and a variant is a compiled program. A disposed template's variants stay in the map;
 * the service is disposed once, at the end.
 */
const camoVariants = new Map<THREE.MeshStandardMaterial, Map<CamoId, THREE.MeshStandardMaterial>>();

/**
 * A file material in a camo: the same material — its normal map, its roughness, its baked
 * wear — with the pattern multiplied into the albedo after `map_fragment`, so the shading
 * the artist painted shows through the paint. The pattern is scaled by the file's own
 * brightness (`lum`: a black albedo keeps the paint dark, a worn edge lifts it), and GOLD
 * and OBSIDIAN take the metalness the procedural set gives them, through the file's
 * metalness map where it has one. The sampler reads the mesh's `uv` through a varying of
 * its own, so a material with no map of its own — a plain-colour part — paints the same.
 */
export function camoMaterial(material: THREE.MeshStandardMaterial, camo: CamoId, anisotropy: number): THREE.MeshStandardMaterial {
  let byCamo = camoVariants.get(material);
  if (byCamo === undefined) {
    byCamo = new Map();
    camoVariants.set(material, byCamo);
  }
  const existing = byCamo.get(camo);
  if (existing !== undefined) return existing;
  const variant = material.clone();
  variant.name = `${material.name}|${camo}`;
  const metallic = camo === 'gold' || camo === 'obsidian';
  if (metallic) {
    variant.metalness = Math.max(variant.metalness, 0.55);
    variant.roughness = Math.min(variant.roughness, 0.3);
  }
  const texture = camoTexture(camo, anisotropy);
  variant.onBeforeCompile = (shader) => {
    shader.uniforms.camoMap = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCamoUv;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvCamoUv = uv * ${CAMO_OVERLAY_REPEAT.toFixed(1)};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D camoMap;\nvarying vec2 vCamoUv;')
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          '{',
          '  vec3 camo = texture2D(camoMap, vCamoUv).rgb;',
          '  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));',
          '  diffuseColor.rgb = camo * clamp(0.6 + 1.4 * lum, 0.0, 1.5);',
          '}',
        ].join('\n'),
      );
  };
  variant.customProgramCacheKey = () => `camo:${camo}`;
  byCamo.set(camo, variant);
  return variant;
}

/** Where a file's rear sight or red dot is held at ADS, metres from the eye. */
const SIGHT_DISTANCE = 0.2;
/** Where a file's scope ocular is held: eye relief, so the tube fills the view. */
const SCOPE_EYE_RELIEF = 0.1;

const MAGAZINE_EXIT_DOWN = new THREE.Vector3(0, -1, 0);

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

/**
 * The radius of the dot a file's own collimator gets, metres. A red dot is a dot, not a disc:
 * 2.2 mm at 19 cm from the eye read as one (playtest 6), and in the window at 28 cm this is
 * half the size it looked.
 */
const OWN_RETICLE_RADIUS = 0.0016;

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
function dressOwnOptic(
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

/** What mounting changed about the contract's numbers; absent means the bare weapon's. */
interface Mounted {
  muzzle?: THREE.Object3D;
  sightPoint?: THREE.Vector3;
}

/**
 * The pack on the sockets (M19, stage 2).
 *
 * Each part is a clone of its template under the weapon's socket — the part's origin is on its
 * mating face and the socket's frame is the mount's, so the clone is added and nothing else.
 * Then the two numbers: an optic's own `socket_sight` sits above the rail socket, and the sum
 * is the sight line the ADS pose now has to cancel; a suppressor's own `socket_muzzle` is where
 * the flash leaves from now, and the returned node is inside the clone so the flash rides the
 * can. The extended magazine is the magazine group stretched along the well
 * (`MAGAZINE_EXTENDED_STRETCH`); the reload writes the group's position and rotation and leaves
 * its scale alone, and the well hides the top.
 *
 * The optic's glass and reticle take the project's `lens` and `reticle` materials in place of
 * the artist's (the source carries `KHR_materials_transmission`, a render pass the viewmodel
 * does not pay for), so the dot is the same emissive dot the procedural red dot draws and the
 * glass has the same `depthWrite: false` that keeps the target visible through it.
 *
 * A part the weapon has no socket for is skipped, as `resolveWeaponDef` skips an attachment
 * the weapon has no slot for; the two lists are the same list, so this is belt and braces.
 *
 * Two rules from stage 3: a weapon whose spec has a scope keeps it — the HYBRID OPTIC on a
 * sniper is a better scope (its effect is on the sway), not a red dot in place of one — and
 * a weapon with a sight of its own in `optic_default` (the P90's and the Tavor's collimators)
 * hides it when the red dot goes on, so two sights do not stand on one rail.
 */
function mountAttachments(
  root: THREE.Object3D,
  magazine: THREE.Object3D,
  template: WeaponAssetTemplate,
  options: WeaponModelOptions,
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
    const clone = part.scene.clone(true);
    clone.name = `attachment:${partId}`;
    socket.add(clone);

    if (partId === 'att_optic') {
      clone.traverse((node) => {
        const mesh = node as THREE.Mesh;
        const material = mesh.material;
        if (!(material instanceof THREE.Material)) return;
        if (material.name === 'M_glass') mesh.material = surfaces.get('lens') ?? material;
        else if (material.name === 'M_Reticle') mesh.material = surfaces.get('reticle') ?? material;
      });
      const sight = part.sockets.socket_sight;
      if (sight !== undefined) out.sightPoint = template.sockets.socket_rail_top.clone().add(sight);
      // The weapon's own sights go under a mounted optic: its collimator (`optic_default`) and
      // its iron sights (`irons`, carved out by the build). Both stood in the middle of the
      // sight picture (playtest 4, finding 3), which is what a real shooter removes them for.
      for (const name of ['optic_default', 'irons']) {
        const own = root.getObjectByName(name);
        if (own !== undefined) own.visible = false;
      }
    } else if (partId === 'att_suppressor') {
      const muzzle = clone.getObjectByName('socket_muzzle');
      if (muzzle !== undefined) out.muzzle = muzzle;
    }
  }
  return out;
}

// -- assembly ---------------------------------------------------------------

function addMerged(
  parent: THREE.Object3D,
  boxes: readonly BoxPart[],
  tubes: readonly TubePart[],
  surfaces: Map<SurfaceKey, THREE.MeshStandardMaterial>,
  disposables: Array<{ dispose(): void }>,
  label: string,
): void {
  const bySurface = new Map<SurfaceKey, THREE.BufferGeometry[]>();

  const push = (key: SurfaceKey, geometry: THREE.BufferGeometry): void => {
    const list = bySurface.get(key);
    if (list === undefined) bySurface.set(key, [geometry]);
    else list.push(geometry);
  };

  for (const part of boxes) {
    const g = new THREE.BoxGeometry(part.w, part.h, part.d);
    if (part.rx !== undefined) g.rotateX(part.rx);
    if (part.ry !== undefined) g.rotateY(part.ry);
    if (part.rz !== undefined) g.rotateZ(part.rz);
    g.translate(part.x, part.y, part.z);
    push(part.surface, g);
  }

  for (const part of tubes) {
    const g = new THREE.CylinderGeometry(part.radius, part.radius, part.length, part.sides ?? 12, 1);
    // CylinderGeometry runs along +Y; barrels run along Z.
    if (part.vertical !== true) g.rotateX(Math.PI / 2);
    g.translate(part.x, part.y, part.z);
    push(part.surface, g);
  }

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

// -- surfaces ---------------------------------------------------------------

/**
 * The materials, built once per process and per camo.
 *
 * M2 built them per model, which was correct when there was one model. Twelve weapons and a
 * per-match rebuild would be thirty-six 128px canvases generated for three distinct images,
 * and every one of them a GPU upload on the frame the match starts.
 *
 * M6 keys the cache by camo instead of holding a single set. A camo replaces the two
 * *structural* surfaces — the receiver and the furniture — and deliberately leaves the
 * glove alone: painting the player's hands in tiger stripe is not what a weapon camo is,
 * and the hands are the one part of the viewmodel that should stay constant so the eye can
 * read the gun against them.
 */
const cachedSurfaces = new Map<string, Map<SurfaceKey, THREE.MeshStandardMaterial>>();

/**
 * The uncamouflaged surface set, for a viewmodel that is not a weapon (round 2).
 *
 * The knife shares these rather than building its own gunmetal and polymer. It is the same
 * decision the camo cache is: three canvases exist per process, and a second set painted for
 * one small model would be three more uploads for three images that already exist — and, more
 * to the point, a blade lit differently from the rifle it replaces would read as a different
 * game. A camo is deliberately not offered: camo is a property of a *weapon*, and the knife
 * is not one.
 */
export function sharedWeaponSurfaces(
  anisotropy: number,
): ReadonlyMap<SurfaceKey, THREE.MeshStandardMaterial> {
  return sharedSurfaces(anisotropy, null);
}

function sharedSurfaces(
  anisotropy: number,
  camo: CamoId | null,
): Map<SurfaceKey, THREE.MeshStandardMaterial> {
  const key = camo ?? '';
  const existing = cachedSurfaces.get(key);
  if (existing !== undefined) return existing;
  const out = camo === null ? buildDefaultSurfaces(anisotropy) : buildCamoSurfaces(anisotropy, camo);
  cachedSurfaces.set(key, out);
  return out;
}

/**
 * A camo set: the same BRDF as the default, with the pattern in place of the base map.
 *
 * Roughness is lifted slightly on the painted surfaces because paint over machining is
 * duller than the metal underneath, and GOLD goes the other way — it is the one camo that
 * is a *material* rather than a coating, so it takes the metalness the others do not.
 */
function buildCamoSurfaces(
  anisotropy: number,
  camo: CamoId,
): Map<SurfaceKey, THREE.MeshStandardMaterial> {
  const out = new Map<SurfaceKey, THREE.MeshStandardMaterial>();
  const texture = camoTexture(camo, anisotropy);
  const metallic = camo === 'gold' || camo === 'obsidian';
  out.set(
    'gunmetal',
    new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: metallic ? 0.3 : 0.55,
      metalness: metallic ? 0.55 : 0.18,
    }),
  );
  out.set(
    'polymer',
    new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: metallic ? 0.38 : 0.8,
      metalness: metallic ? 0.45 : 0.04,
    }),
  );
  out.set(
    'glove',
    new THREE.MeshStandardMaterial({
      map: baseTexture('glove', anisotropy),
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  addOpticSurfaces(out);
  return out;
}

function buildDefaultSurfaces(anisotropy: number): Map<SurfaceKey, THREE.MeshStandardMaterial> {
  const out = new Map<SurfaceKey, THREE.MeshStandardMaterial>();

  // A viewmodel is the one place in this project worth a real BRDF: it is a handful of
  // triangles filling a small part of the screen, and the difference between "metal" and
  // "plastic" is exactly what roughness is for.
  //
  // Metalness is deliberately kept low. A physically honest 0.85 metal has almost no
  // diffuse response and gets nearly all its colour from reflections — with no
  // environment map in the scene there is nothing to reflect, and the gun renders black.
  // Base colour lives in the textures; the material tints are left neutral.
  out.set(
    'gunmetal',
    new THREE.MeshStandardMaterial({
      map: baseTexture('gunmetal', anisotropy),
      color: 0xffffff,
      roughness: 0.44,
      metalness: 0.3,
    }),
  );
  out.set(
    'polymer',
    new THREE.MeshStandardMaterial({
      map: baseTexture('polymer', anisotropy),
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.02,
    }),
  );
  out.set(
    'glove',
    new THREE.MeshStandardMaterial({
      map: baseTexture('glove', anisotropy),
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  addOpticSurfaces(out);
  return out;
}

/**
 * The red dot's glass and its dot (M7).
 *
 * Shared by the default and camo sets and deliberately *not* camouflaged: a painted lens is
 * not a lens, and the dot is the one thing on the weapon that has to stay legible against
 * every background the map can put behind it.
 *
 * `depthWrite: false` on the glass is the load-bearing flag. With it on, the window writes
 * depth and everything seen through it — the enemy you are aiming at — is rejected by the
 * depth test, which is the opaque-optic bug wearing a transparent material.
 */
function addOpticSurfaces(out: Map<SurfaceKey, THREE.MeshStandardMaterial>): void {
  out.set(
    'lens',
    new THREE.MeshStandardMaterial({
      color: 0x18242e,
      roughness: 0.07,
      metalness: 0,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
  );
  out.set(
    'reticle',
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xff2a1e,
      emissiveIntensity: 3.5,
      roughness: 1,
      metalness: 0,
      // The dot is a light source, not a lit surface: tone mapping would drag it toward the
      // scene's exposure and a red dot that dims in a bright lane is not a red dot.
      toneMapped: false,
    }),
  );
}

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
    const g = new THREE.BoxGeometry(part.w, part.h, part.d);
    if (part.rx !== undefined) g.rotateX(part.rx);
    if (part.ry !== undefined) g.rotateY(part.ry);
    if (part.rz !== undefined) g.rotateZ(part.rz);
    g.translate(part.x, part.y, part.z);
    parts.push(g);
  }

  for (const part of [...bodyTubes(spec), ...magazineTubes(spec)]) {
    if (part.surface === 'lens' || part.surface === 'reticle') continue;
    // Half the sides of the viewmodel's: a barrel that is twelve-sided at arm's length is
    // eight-sided at twenty metres and nobody can tell, and this is ten of them.
    const sides = Math.max(5, Math.round((part.sides ?? 12) * 0.5));
    const g = new THREE.CylinderGeometry(part.radius, part.radius, part.length, sides, 1);
    if (part.vertical !== true) g.rotateX(Math.PI / 2);
    g.translate(part.x, part.y, part.z);
    parts.push(g);
  }

  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (merged === null) throw new Error(`Weapon "${weaponId}" merged to no geometry.`);
  // The viewmodel scales its root; a shared geometry has no root to scale, so it is baked.
  merged.scale(spec.scale, spec.scale, spec.scale);
  merged.computeBoundingSphere();
  return merged;
}

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

/**
 * `buildHeldWeaponGeometry` plus the anchors that go with it.
 *
 * Returned together so that whoever puts the weapon in a hand receives one object built from
 * one spec, rather than looking the geometry up by id in one place and the anchors up by id in
 * another. Anchors come from `WeaponMeshParts` — the same datum the first-person gloves sit on.
 */
export function buildHeldWeapon(weaponId: string): HeldWeaponGeometry {
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

/**
 * The three hand-drawn base textures, built once for the process.
 *
 * Cached separately from the materials because a camo set reuses the glove: without this,
 * six camos would generate six identical 128 px hand textures.
 */
const baseTextures = new Map<SurfaceKey, THREE.Texture>();

function baseTexture(key: SurfaceKey, anisotropy: number): THREE.Texture {
  const existing = baseTextures.get(key);
  if (existing !== undefined) return existing;
  const made =
    key === 'gunmetal'
      ? gunmetalTexture(anisotropy)
      : key === 'polymer'
        ? polymerTexture(anisotropy)
        : gloveTexture(anisotropy);
  baseTextures.set(key, made);
  return made;
}

const TEX = 128;

function makeCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = TEX;
  canvas.height = TEX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas context unavailable; cannot build weapon textures.');
  return ctx;
}

function finish(ctx: CanvasRenderingContext2D, anisotropy: number, repeat: number): THREE.Texture {
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.repeat.set(repeat, repeat);
  texture.needsUpdate = true;
  return texture;
}

function gunmetalTexture(anisotropy: number): THREE.Texture {
  const ctx = makeCanvas();
  const rng = new Rng(0x6a17_c0de);
  ctx.fillStyle = '#565c66';
  ctx.fillRect(0, 0, TEX, TEX);
  // Machining marks running along the barrel axis.
  for (let i = 0; i < 340; i++) {
    const y = rng.float() * TEX;
    const a = rng.range(0.03, 0.11);
    ctx.fillStyle = rng.chance(0.5) ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(rng.float() * TEX, y, rng.range(12, 70), 1);
  }
  // Edge wear: a few brighter scuffs where a real rifle rubs.
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(220,225,235,${rng.range(0.05, 0.16)})`;
    ctx.fillRect(rng.float() * TEX, rng.float() * TEX, rng.range(3, 14), rng.range(1, 3));
  }
  return finish(ctx, anisotropy, 1);
}

function polymerTexture(anisotropy: number): THREE.Texture {
  const ctx = makeCanvas();
  const rng = new Rng(0x9f2b_5511);
  ctx.fillStyle = '#3a3e45';
  ctx.fillRect(0, 0, TEX, TEX);
  // Moulded stipple.
  for (let i = 0; i < 2600; i++) {
    const a = rng.range(0.03, 0.14);
    ctx.fillStyle = rng.chance(0.55) ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(rng.float() * TEX, rng.float() * TEX, rng.range(0.8, 2.2), rng.range(0.8, 2.2));
  }
  // Panel lines so the handguard does not read as one flat slab.
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 8; i++) {
    const x = (i / 8) * TEX;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TEX);
    ctx.stroke();
  }
  return finish(ctx, anisotropy, 2);
}

function gloveTexture(anisotropy: number): THREE.Texture {
  const ctx = makeCanvas();
  const rng = new Rng(0x11a7_3ef0);
  ctx.fillStyle = '#5d574a';
  ctx.fillRect(0, 0, TEX, TEX);
  // Woven fabric: two crossing sets of threads.
  for (let i = 0; i < TEX; i += 3) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.06, 0.16)})`;
    ctx.fillRect(0, i, TEX, 1);
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.02, 0.07)})`;
    ctx.fillRect(i, 0, 1, TEX);
  }
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.04, 0.12)})`;
    ctx.fillRect(rng.float() * TEX, rng.float() * TEX, rng.range(1, 3), rng.range(1, 3));
  }
  return finish(ctx, anisotropy, 3);
}
