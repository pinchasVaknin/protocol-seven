import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { logger } from '../../shared/core/Log';
import {
  ATTACHMENT_PART_IDS,
  ATTACHMENT_PART_OWN_SOCKETS,
  hasWeaponAsset,
  KNIFE_ASSET_ID,
  weaponLodUrl,
  weaponAssetUrl,
  WEAPON_ASSET_VERSION,
  WEAPON_GROUP_NODES,
  WEAPON_SOCKET_NODES,
  type AttachmentPartId,
  type WeaponGroupNode,
  type WeaponSocketNode,
} from './WeaponAssetCatalog';

const log = logger('WeaponAssets');

/**
 * A parsed weapon file, validated against the contract, shared by every instance built from it.
 *
 * The scene is the template — `WeaponMesh.buildFromTemplate` clones it per viewmodel, and a
 * clone shares geometry and materials with its source, so ten previews of the same rifle hold
 * one set of GPU resources. The node maps are the contract's names resolved once, at load,
 * where a missing one is an error with the file's name in it rather than a reload that drops
 * nothing at match time.
 */
export interface WeaponAssetTemplate {
  readonly weaponId: string;
  readonly scene: THREE.Object3D;
  /** Local-space positions of the sockets, read once so an instance need not search for them. */
  readonly sockets: Readonly<Record<WeaponSocketNode, THREE.Vector3>>;
}

/**
 * A parsed pack part (stage 2): the `part` group under a root named for it, and the sockets
 * of its own — the optic's sight line, the suppressor's new muzzle — read once.
 */
export interface AttachmentPartTemplate {
  readonly partId: AttachmentPartId;
  readonly scene: THREE.Object3D;
  readonly sockets: Readonly<Partial<Record<'socket_sight' | 'socket_muzzle', THREE.Vector3>>>;
}

/** A weapon's file for the bodies (stage 3): the LOD's root and the two hand points it carries. */
export interface WeaponLodTemplate {
  readonly weaponId: string;
  readonly scene: THREE.Object3D;
  readonly gripAnchor: THREE.Vector3;
  readonly supportAnchor: THREE.Vector3;
}

export type WeaponAssetStatus = 'idle' | 'loading' | 'ready' | 'error' | 'none';

/**
 * Application-lifetime owner of the parsed weapon templates (M19, stage 1).
 *
 * The shape is `CharacterAssetService`'s, for the same reasons: one fetch and one parse per
 * file for the life of the page, a promise cache so two callers in one frame share a request, a
 * failed request evicted so a retry can try again, and a synchronous read (`template`) for the
 * callers that build models on a frame — `ClientMatch` builds both slots in its constructor and
 * `WeaponPreview` on a hover, and neither can await. A caller that finds no template yet builds
 * the procedural model and asks `preload` to tell it when the file lands.
 *
 * What it does *not* do is decide which weapons have files: that is `WeaponAssetCatalog`'s
 * list, and `weaponAssetUrl` never sees an id outside it. `Game` warms the equipped loadout's
 * weapons while the menu is up, so a match usually starts with its templates ready; when it
 * does not, the match starts on the procedural viewmodel and upgrades in place.
 *
 * **The pack rides with the first weapon** (stage 2). A weapon's `preload` also fetches the
 * four attachment parts — a megabyte, once — and `template` answers null until the pack is
 * there too, so a model built from a file always has every part it might mount. Half a state
 * (the rifle with a suppressor that has not arrived) is not one the builder has to handle.
 */
export class WeaponAssetService {
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<string, WeaponAssetTemplate>();
  private readonly parts = new Map<AttachmentPartId, AttachmentPartTemplate>();
  private packTask: Promise<void> | null = null;
  private knifeScene: THREE.Object3D | null = null;
  private knifeTask: Promise<void> | null = null;
  private readonly lods = new Map<string, WeaponLodTemplate>();
  private readonly lodTasks = new Map<string, Promise<void>>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly statuses = new Map<string, WeaponAssetStatus>();
  private disposed = false;

  /**
   * The template for a weapon, if its file and the pack have arrived; null builds the
   * procedural model.
   */
  template(weaponId: string): WeaponAssetTemplate | null {
    if (this.disposed || !this.packReady()) return null;
    return this.templates.get(weaponId) ?? null;
  }

  /** The bodies' template for a weapon, or null: no file, or not arrived, and the primitives stand in. */
  lod(weaponId: string): WeaponLodTemplate | null {
    return this.disposed ? null : (this.lods.get(weaponId) ?? null);
  }

  /**
   * Fetch a weapon's LOD. Ten bodies carrying four weapons ask for four files, each once;
   * a weapon without a file resolves at once and the bodies keep the primitives.
   */
  preloadLod(weaponId: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Weapon asset service has been disposed.'));
    if (!hasWeaponAsset(weaponId) || this.lods.has(weaponId)) return Promise.resolve();
    const existing = this.lodTasks.get(weaponId);
    if (existing !== undefined) return existing;
    const task = this.loader.loadAsync(weaponLodUrl(weaponId)).then((gltf) => {
      if (this.disposed) {
        disposeTemplate(gltf.scene);
        throw new Error('Weapon asset service was disposed while a LOD was loading.');
      }
      const root = gltf.scene.getObjectByName(weaponId);
      const grip = root?.getObjectByName('socket_grip');
      const support = root?.getObjectByName('socket_support');
      if (root === undefined || grip === undefined || support === undefined) {
        disposeTemplate(gltf.scene);
        throw new Error(`LOD file "${weaponId}" has no root with socket_grip and socket_support.`);
      }
      this.lods.set(weaponId, { weaponId, scene: root, gripAnchor: grip.position.clone(), supportAnchor: support.position.clone() });
    });
    this.lodTasks.set(weaponId, task);
    void task.then(
      () => {
        if (this.lodTasks.get(weaponId) === task) this.lodTasks.delete(weaponId);
      },
      (error: unknown) => {
        if (this.lodTasks.get(weaponId) === task) this.lodTasks.delete(weaponId);
        log.warn(`GLB LOD unavailable for "${weaponId}"; the bodies keep the primitives. ${errorMessage(error)}`);
      },
    );
    return task;
  }

  /** The knife's template (stage 3), or null while it has not arrived: `KnifeMesh` builds the boxes. */
  knife(): THREE.Object3D | null {
    return this.disposed ? null : this.knifeScene;
  }

  /** Fetch the knife's file; it rides with the weapons' warm-up and fails to the boxes alone. */
  preloadKnife(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Weapon asset service has been disposed.'));
    if (this.knifeScene !== null) return Promise.resolve();
    if (this.knifeTask !== null) return this.knifeTask;
    const task = this.loader.loadAsync(weaponAssetUrl(KNIFE_ASSET_ID)).then((gltf) => {
      if (this.disposed) {
        disposeTemplate(gltf.scene);
        throw new Error('Weapon asset service was disposed while the knife was loading.');
      }
      const root = gltf.scene.getObjectByName(KNIFE_ASSET_ID);
      if (root === undefined || root.getObjectByName('body') === undefined) {
        disposeTemplate(gltf.scene);
        throw new Error('Knife file has no root named "knife" with a "body" group.');
      }
      this.knifeScene = root;
      log.info(`GLB knife is ready (${WEAPON_ASSET_VERSION}).`);
    });
    this.knifeTask = task;
    void task.then(
      () => {
        if (this.knifeTask === task) this.knifeTask = null;
      },
      (error: unknown) => {
        if (this.knifeTask === task) this.knifeTask = null;
        log.warn(`GLB knife unavailable; the procedural blade stands in. ${errorMessage(error)}`);
      },
    );
    return task;
  }

  /** A pack part's template. Never null once `template` has answered for any weapon. */
  part(partId: AttachmentPartId): AttachmentPartTemplate | null {
    if (this.disposed) return null;
    return this.parts.get(partId) ?? null;
  }

  private packReady(): boolean {
    return ATTACHMENT_PART_IDS.every((id) => this.parts.has(id));
  }

  statusFor(weaponId: string): WeaponAssetStatus {
    if (!hasWeaponAsset(weaponId)) return 'none';
    return this.statuses.get(weaponId) ?? 'idle';
  }

  /**
   * Start or join a load. Resolves once the template is ready; rejects if the file fails, after
   * which the next call tries again. A weapon with no file resolves immediately — the caller
   * already has the procedural model and there is nothing to wait for.
   */
  preload(weaponId: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Weapon asset service has been disposed.'));
    if (!hasWeaponAsset(weaponId) || (this.templates.has(weaponId) && this.packReady())) return Promise.resolve();

    const existing = this.loading.get(weaponId);
    if (existing !== undefined) return existing;

    this.statuses.set(weaponId, 'loading');
    const weaponTask = this.templates.has(weaponId)
      ? Promise.resolve()
      : this.loader.loadAsync(weaponAssetUrl(weaponId)).then((gltf) => {
          if (this.disposed) {
            disposeTemplate(gltf.scene);
            throw new Error('Weapon asset service was disposed while a file was loading.');
          }
          let template: WeaponAssetTemplate;
          try {
            template = validateTemplate(weaponId, gltf.scene);
          } catch (error) {
            disposeTemplate(gltf.scene);
            throw error;
          }
          this.templates.set(weaponId, template);
        });
    const task = Promise.all([weaponTask, this.preloadPack()]).then(() => {
      this.statuses.set(weaponId, 'ready');
      log.info(`GLB weapon "${weaponId}" is ready (${WEAPON_ASSET_VERSION}).`);
    });
    this.loading.set(weaponId, task);
    void task.then(
      () => {
        if (this.loading.get(weaponId) === task) this.loading.delete(weaponId);
      },
      (error: unknown) => {
        if (this.loading.get(weaponId) !== task) return;
        this.loading.delete(weaponId);
        this.statuses.set(weaponId, 'error');
        log.warn(
          `GLB weapon unavailable for "${weaponId}"; the procedural viewmodel stands in until a retry succeeds. ${errorMessage(error)}`,
        );
      },
    );
    return task;
  }

  /** The four parts, fetched once and shared by every weapon; a failure is retried with the next `preload`. */
  private preloadPack(): Promise<void> {
    if (this.packReady()) return Promise.resolve();
    if (this.packTask !== null) return this.packTask;
    const task = Promise.all(
      ATTACHMENT_PART_IDS.filter((id) => !this.parts.has(id)).map((partId) =>
        this.loader.loadAsync(weaponAssetUrl(partId)).then((gltf) => {
          if (this.disposed) {
            disposeTemplate(gltf.scene);
            throw new Error('Weapon asset service was disposed while the pack was loading.');
          }
          try {
            this.parts.set(partId, validatePart(partId, gltf.scene));
          } catch (error) {
            disposeTemplate(gltf.scene);
            throw error;
          }
        }),
      ),
    ).then(() => undefined);
    this.packTask = task;
    void task.then(
      () => {
        if (this.packTask === task) this.packTask = null;
      },
      () => {
        if (this.packTask === task) this.packTask = null;
      },
    );
    return task;
  }

  /** Called when the application is torn down, after every viewmodel built from a template is gone. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const template of this.templates.values()) disposeTemplate(template.scene);
    for (const part of this.parts.values()) disposeTemplate(part.scene);
    if (this.knifeScene !== null) disposeTemplate(this.knifeScene);
    this.knifeScene = null;
    for (const lod of this.lods.values()) disposeTemplate(lod.scene);
    this.lods.clear();
    this.lodTasks.clear();
    this.templates.clear();
    this.parts.clear();
    this.loading.clear();
    this.statuses.clear();
  }
}

/** A pack part against its contract: the root named for it, a `part` group, its own sockets. */
function validatePart(partId: AttachmentPartId, scene: THREE.Object3D): AttachmentPartTemplate {
  const root = scene.getObjectByName(partId);
  if (root === undefined) throw new Error(`Attachment file "${partId}" has no root node named "${partId}".`);
  if (root.getObjectByName('part') === undefined) throw new Error(`Attachment file "${partId}" has no "part" group.`);
  const sockets: Partial<Record<'socket_sight' | 'socket_muzzle', THREE.Vector3>> = {};
  for (const name of ATTACHMENT_PART_OWN_SOCKETS[partId]) {
    const socket = root.getObjectByName(name);
    if (socket === undefined) throw new Error(`Attachment file "${partId}" has no "${name}" socket.`);
    sockets[name] = socket.position.clone();
  }
  return { partId, scene: root, sockets };
}

/**
 * The contract, checked once per file: every group and every socket by name, on the root the
 * build named for the weapon. `check:weapons` already refused a file that fails this, so a
 * failure here is a stale deploy or a hand-edited file, and the message says which name.
 */
function validateTemplate(weaponId: string, scene: THREE.Object3D): WeaponAssetTemplate {
  const root = scene.getObjectByName(weaponId);
  if (root === undefined) throw new Error(`Weapon file "${weaponId}" has no root node named "${weaponId}".`);
  for (const name of WEAPON_GROUP_NODES) {
    if (root.getObjectByName(name) === undefined) throw new Error(`Weapon file "${weaponId}" has no "${name}" group.`);
  }
  const sockets = {} as Record<WeaponSocketNode, THREE.Vector3>;
  for (const name of WEAPON_SOCKET_NODES) {
    const socket = root.getObjectByName(name);
    if (socket === undefined) throw new Error(`Weapon file "${weaponId}" has no "${name}" socket.`);
    sockets[name] = socket.position.clone();
  }
  return { weaponId, scene: root, sockets };
}

/** The group nodes of a template's clone, by the contract's names. */
export function groupNodes(root: THREE.Object3D): Record<WeaponGroupNode, THREE.Object3D> {
  const out = {} as Record<WeaponGroupNode, THREE.Object3D>;
  for (const name of WEAPON_GROUP_NODES) {
    const node = root.getObjectByName(name);
    if (node === undefined) throw new Error(`Weapon clone has no "${name}" group; the template was validated with one.`);
    out[name] = node;
  }
  return out;
}

/** Release what a template owns. Instances share it, so this runs only after they are gone. */
function disposeTemplate(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry instanceof THREE.BufferGeometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const item of material) materials.add(item);
    } else if (material instanceof THREE.Material) {
      materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.clear();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
