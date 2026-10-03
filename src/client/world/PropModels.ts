import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { logger } from '../../shared/core/Log';
import { gpuWarmup } from '../engine/GpuWarmup';
import type { MapDef } from '../../shared/world/maps/types';

const log = logger('PropModels');

/**
 * Map props drawn from a model instead of from boxes (2026-09-27).
 *
 * ## Why this exists at all, and why it is only the station
 *
 * Every prop in this game is a composite of boxes, because collision is capsule versus oriented
 * box and nothing else (brief S4.3) and a prop's silhouette is never allowed to disagree with
 * what a player can walk into. That rule is not relaxed here. The resupply station's boxes are
 * still in `PROP_SHAPES` and still collide; they are marked `hidden`, so `MapRender` builds no
 * geometry for them, and this hangs the pile over the top.
 *
 * It is one prop because it is the one prop a player has to **recognise across a lane** and then
 * walk up to and kneel at. Everything else in the catalogue is cover, and cover reads better as
 * the box it collides as.
 *
 * ## Why the file is fetched rather than built into the map
 *
 * `loadMap` is synchronous and a download is not. The map is built, the match starts, and the
 * station arrives when it arrives — until then the station is an invisible box that still
 * resupplies, which is a worse picture and an identical game. A map with no station never
 * fetches it.
 */
const STATION_URL = '/models/props/station_ammo.glb';

/** The shape whose boxes this model stands over. Held to `PROP_SHAPES` by `check:props`. */
export const STATION_SHAPE = 'ammoCrate';

/**
 * Prop shapes drawn from a file. `MapRender` skips the `hidden` parts of these, and only these:
 * a shape that lost its geometry without gaining a model would be an invisible wall.
 *
 * A set rather than the renderer knowing the station's name, so switching a prop between boxes
 * and a model is one entry here and a `hidden` flag on its parts — which is how the station
 * spent a commit back on boxes while its pile was being arranged.
 */
export const MODELLED_PROP_SHAPES: ReadonlySet<string> = new Set([STATION_SHAPE]);

/**
 * The station's template, for the page rather than for one world (part 5).
 *
 * It was a field of each `PropModels`, which a world builds and disposes — so the file could only
 * be asked for once a match had started, and arrived in the middle of one. Module-level like the
 * sentry's, so the menu can fetch it (`Game.warmWeaponAssets`) and every world after finds it there.
 */
let stationTemplate: THREE.Object3D | null = null;
let stationTask: Promise<void> | null = null;

/**
 * Fetch the station, once per page. Resolves either way: a station that fails to download leaves
 * the boxes standing invisible, which resupplies exactly as it did and simply cannot be seen.
 * Cleared on a failure so a later world tries again.
 */
export function preloadStation(): Promise<void> {
  if (stationTemplate !== null) return Promise.resolve();
  if (stationTask !== null) return stationTask;
  const task = new GLTFLoader()
    .loadAsync(STATION_URL)
    .then((gltf) => {
      // Shadows set as `addStations` sets them on every copy, so the programs compiled here are
      // the ones a placed station draws with. See `GpuWarmup.adopt`.
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      stationTemplate = gltf.scene;
      void gpuWarmup.adopt(gltf.scene);
      log.info('the resupply station is ready.');
    })
    .catch((error: unknown) => {
      log.warn(`the resupply station did not load; its boxes stay invisible. ${String(error)}`);
      stationTask = null;
    });
  stationTask = task;
  return task;
}

export class PropModels {
  private disposed = false;

  /** The station's template, or null while it has not arrived. */
  stationModel(): THREE.Object3D | null {
    return this.disposed ? null : stationTemplate;
  }

  /** The page's fetch, joined. Resolves either way; see `preloadStation`. */
  preloadStation(): Promise<void> {
    return this.disposed ? Promise.resolve() : preloadStation();
  }

  /**
   * Put a station on every `ammoCrate` this map places, and answer how many.
   *
   * A clone each rather than an `InstancedMesh`: a map carries two, the model is four separate
   * pieces with their own materials, and two clones is two draw calls per material against the
   * machinery an instanced path would need to merge them first.
   */
  addStations(root: THREE.Object3D, def: MapDef): number {
    const template = this.stationModel();
    if (template === null) return 0;
    let n = 0;
    for (const p of def.props) {
      if (p.shape !== STATION_SHAPE) continue;
      const clone = template.clone(true);
      clone.name = `prop:${STATION_SHAPE}:model`;
      clone.position.set(p.position.x, p.position.y, p.position.z);
      clone.rotation.y = p.rotationY;
      clone.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      root.add(clone);
      n += 1;
    }
    return n;
  }

  /** The world is going; the page's template stays for the next one. */
  dispose(): void {
    this.disposed = true;
  }
}
