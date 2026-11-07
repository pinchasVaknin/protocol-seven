import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The loader and the GPU warmup are mocked, because what this file does is cache: one fetch
 * per page however many matches ask, a failure that is forgotten so a later match retries, and
 * shadow flags set on the template so the programs compiled at warmup are the ones a placed
 * turret draws with.
 *
 * `vi.resetModules` between tests, because the cache is module-level by design.
 */

const loaded: Array<{ url: string }> = [];
let nextResult: { ok: true; scene: THREE.Object3D } | { ok: false; error: string } = {
  ok: true,
  scene: new THREE.Object3D(),
};
const warmed: THREE.Object3D[] = [];

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    async loadAsync(url: string): Promise<{ scene: THREE.Object3D }> {
      loaded.push({ url });
      if (!nextResult.ok) throw new Error(nextResult.error);
      return { scene: nextResult.scene };
    }
  },
}));

vi.mock('../engine/GpuWarmup', () => ({
  gpuWarmup: {
    adopt: async (scene: THREE.Object3D): Promise<void> => {
      warmed.push(scene);
    },
  },
}));

function turretScene(): THREE.Object3D {
  const root = new THREE.Object3D();
  root.name = 'sentry_root';
  const yaw = new THREE.Object3D();
  yaw.name = 'sentry_turret_yaw';
  const pitch = new THREE.Object3D();
  pitch.name = 'sentry_turret_pitch';
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  pitch.add(barrel);
  yaw.add(pitch);
  root.add(yaw);
  return root;
}

beforeEach(() => {
  vi.resetModules();
  loaded.length = 0;
  warmed.length = 0;
  nextResult = { ok: true, scene: turretScene() };
});

describe('the node contract', () => {
  it('names the two nodes the build script promises', async () => {
    const { SENTRY_NODES } = await import('./SentryModel');
    expect(SENTRY_NODES.yaw).toBe('sentry_turret_yaw');
    expect(SENTRY_NODES.pitch).toBe('sentry_turret_pitch');
  });

  it('names the IFF material the band wears', async () => {
    const { SENTRY_IFF_MATERIAL } = await import('./SentryModel');
    expect(SENTRY_IFF_MATERIAL).toBe('iff');
  });
});

describe('before the turret arrives', () => {
  it('answers null, so the caller draws boxes', async () => {
    const { sentryModel } = await import('./SentryModel');
    expect(sentryModel()).toBeNull();
  });
});

describe('preloadSentry', () => {
  it('fetches the turret the build script writes', async () => {
    const { preloadSentry, sentryModel } = await import('./SentryModel');
    await preloadSentry();
    expect(loaded.map((l) => l.url)).toEqual(['/models/props/sentry_turret.glb']);
    expect(sentryModel()).not.toBeNull();
  });

  it('fetches once however many times it is asked', async () => {
    const { preloadSentry } = await import('./SentryModel');
    await Promise.all([preloadSentry(), preloadSentry(), preloadSentry()]);
    await preloadSentry();
    expect(loaded).toHaveLength(1);
  });

  it('joins a fetch already in flight rather than starting a second', async () => {
    const { preloadSentry } = await import('./SentryModel');
    const first = preloadSentry();
    const second = preloadSentry();
    await Promise.all([first, second]);
    expect(loaded).toHaveLength(1);
  });

  it('turns shadows on across the template before anything clones it', async () => {
    const { preloadSentry, sentryModel } = await import('./SentryModel');
    await preloadSentry();
    const template = sentryModel();
    expect(template).not.toBeNull();
    let meshes = 0;
    template?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      meshes++;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    });
    expect(meshes).toBeGreaterThan(0);
  });

  it('hands the template to the GPU warmup', async () => {
    const { preloadSentry, sentryModel } = await import('./SentryModel');
    await preloadSentry();
    expect(warmed).toHaveLength(1);
    expect(warmed[0]).toBe(sentryModel());
  });
});

describe('when the turret does not arrive', () => {
  it('resolves anyway, and leaves the model null so boxes are drawn', async () => {
    nextResult = { ok: false, error: 'offline' };
    const { preloadSentry, sentryModel } = await import('./SentryModel');
    await expect(preloadSentry()).resolves.toBeUndefined();
    expect(sentryModel()).toBeNull();
  });

  it('lets a later match try again, because the first failure may have been the network', async () => {
    nextResult = { ok: false, error: 'offline' };
    const { preloadSentry, sentryModel } = await import('./SentryModel');
    await preloadSentry();
    expect(loaded).toHaveLength(1);

    nextResult = { ok: true, scene: turretScene() };
    await preloadSentry();
    expect(loaded).toHaveLength(2);
    expect(sentryModel()).not.toBeNull();
  });

  it('warms nothing when the fetch failed', async () => {
    nextResult = { ok: false, error: 'offline' };
    const { preloadSentry } = await import('./SentryModel');
    await preloadSentry();
    expect(warmed).toHaveLength(0);
  });
});
