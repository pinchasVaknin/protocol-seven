import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { logger } from '../../shared/core/Log';

const log = logger('SentryModel');

/** Built by `scripts/sentry-build.mjs`; the names below are that script's contract. */
const SENTRY_URL = '/models/props/sentry_turret.glb';

/**
 * The two nodes the sim drives and the material the viewer's side paints.
 *
 * Looked up by name rather than by index because `gltf-transform` is free to reorder anything
 * it likes on its way through the build, and a turret whose barrel is really its tripod is a
 * bug that only shows up after the next texture pass.
 */
export const SENTRY_NODES = {
  yaw: 'sentry_turret_yaw',
  pitch: 'sentry_turret_pitch',
} as const;

/** The material of the IFF band. `SentryMesh` replaces it; nothing else wears it. */
export const SENTRY_IFF_MATERIAL = 'iff';

let template: THREE.Object3D | null = null;
let task: Promise<void> | null = null;

/**
 * The turret's model, or null while it has not arrived.
 *
 * A module-level cache, like `palette`, and for the same reason: `SentryMesh` is built deep
 * inside `StreakRenderer` by way of `ClientMatch`, and threading a loader down three
 * constructors to hold one file would be ceremony around a constant URL. One copy is fetched
 * per page, not per match — a turret does not change between rounds.
 */
export function sentryModel(): THREE.Object3D | null {
  return template;
}

/**
 * Fetch the turret, once. Resolves either way.
 *
 * A failure is logged and then forgotten on purpose: `SentryMesh` draws the old box turret
 * when this returns nothing, so a download that does not arrive costs the picture and not the
 * game. That matters more here than it does for the resupply station — a station you cannot
 * see still resupplies, but a sentry you cannot see is one you cannot shoot back at.
 *
 * Called when a match starts rather than at boot. A sentry costs a killstreak, so the file has
 * the opening minutes of the match to arrive and in practice is there long before the first
 * one is earned; starting the fetch any earlier would only compete with the map.
 */
export function preloadSentry(): Promise<void> {
  if (template !== null) return Promise.resolve();
  if (task !== null) return task;
  const started = new GLTFLoader()
    .loadAsync(SENTRY_URL)
    .then((gltf) => {
      template = gltf.scene;
      log.info('the sentry turret is ready.');
    })
    .catch((error: unknown) => {
      log.warn(`the sentry turret did not load; sentries stay boxes. ${String(error)}`);
      // Cleared so a later match tries again: the first failure may have been the network.
      task = null;
    });
  task = started;
  return started;
}
