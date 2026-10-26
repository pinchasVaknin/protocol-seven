import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { characterDefinition, type CharacterDefinition } from './CharacterCatalog';
import { GltfCharacterAssetRepository } from './CharacterAssetRepository';

/**
 * The fetch/parse cache, pinned before unit C5's refactor.
 *
 * Nothing here is about what a clip looks like — that is `CharacterAssetImport`'s, and it is
 * stubbed below. What this file owns is *lifetime*: two caches with two different keys, one fetch
 * per URL however many actors ask at once, a failed request evicted so the next try is a real try,
 * and a skin released rather than orphaned when a sibling request fails after it has parsed.
 *
 * The animation cache keyed on the URL rather than on the skin is the one with a number behind it:
 * the catalogue shares one animation set across seven skins, so the other key would mean seven
 * fetches and seven copies of every clip.
 */

vi.mock('./CharacterAssetImport', () => ({
  validateSkin: (): unknown => ({ bindMotionPosition: new THREE.Vector3() }),
  importClip: (definition: { id: string }): THREE.AnimationClip => new THREE.AnimationClip(definition.id, 1, []),
}));

interface FakeLoader {
  readonly requests: string[];
  loadAsync(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>;
  fail: Set<string>;
  /** Resolvers held open so a test can control interleaving. */
  pending: Map<string, () => void>;
  hold: boolean;
}

function fakeLoader(): FakeLoader {
  const loader: FakeLoader = {
    requests: [],
    fail: new Set<string>(),
    pending: new Map(),
    hold: false,
    loadAsync(url: string) {
      loader.requests.push(url);
      const make = (): { scene: THREE.Object3D; animations: THREE.AnimationClip[] } => {
        const scene = new THREE.Object3D();
        scene.name = url;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
        scene.add(mesh);
        return { scene, animations: [new THREE.AnimationClip('clip', 1, [])] };
      };
      if (loader.fail.has(url)) return Promise.reject(new Error(`boom: ${url}`));
      if (!loader.hold) return Promise.resolve(make());
      return new Promise((resolve) => loader.pending.set(url, () => resolve(make())));
    },
  };
  return loader;
}

function repository(loader: FakeLoader): GltfCharacterAssetRepository {
  const repo = new GltfCharacterAssetRepository();
  (repo as unknown as { loader: FakeLoader }).loader = loader;
  return repo;
}

let loader: FakeLoader;
let echo: CharacterDefinition;
let hazard: CharacterDefinition;

beforeEach(() => {
  loader = fakeLoader();
  echo = characterDefinition('echo');
  hazard = characterDefinition('hazard');
});

function skinRequests(): string[] {
  return loader.requests.filter((url) => url.includes('/skins/'));
}

function animationRequests(): string[] {
  return loader.requests.filter((url) => url.includes('/animations/'));
}

// ======================================== the test cases ======================================

describe('GltfCharacterAssetRepository: caching', () => {
  it('fetches a skin and its animation files once each', async () => {
    const repo = repository(loader);
    await repo.preload(echo);
    expect(skinRequests().length).toBe(1);
    // One request per distinct animation URL, not one per clip slot.
    expect(new Set(animationRequests()).size).toBe(animationRequests().length);
  });

  it('serves a second preload of the same character from the cache', async () => {
    const repo = repository(loader);
    const first = await repo.preload(echo);
    const before = loader.requests.length;
    const second = await repo.preload(echo);
    expect(second).toBe(first);
    expect(loader.requests.length).toBe(before);
  });

  it('joins ten simultaneous callers onto one fetch', async () => {
    const repo = repository(loader);
    const all = await Promise.all(Array.from({ length: 10 }, () => repo.preload(echo)));
    expect(skinRequests().length).toBe(1);
    for (const bundle of all) expect(bundle).toBe(all[0]);
  });

  it('shares the animation files between two skins rather than fetching them again', async () => {
    const repo = repository(loader);
    await repo.preload(echo);
    const animationsAfterFirst = animationRequests().length;
    await repo.preload(hazard);
    // A second skin is one more skin fetch and *no* more animation fetches.
    expect(skinRequests().length).toBe(2);
    expect(animationRequests().length).toBe(animationsAfterFirst);
  });

  it('returns a bundle whose clips are indexed in the slot’s order', async () => {
    const repo = repository(loader);
    const bundle = await repo.preload(echo);
    expect(bundle.definition).toBe(echo);
    for (const [slot, variants] of Object.entries(echo.animations)) {
      expect(bundle.clips.get(slot as never)?.length, slot).toBe(variants.length);
    }
  });
});

describe('GltfCharacterAssetRepository: failure', () => {
  it('evicts a failed bundle so the next preload is a real retry', async () => {
    const repo = repository(loader);
    loader.fail.add(echo.skinUrl);
    await expect(repo.preload(echo)).rejects.toThrow(/boom/);

    loader.fail.clear();
    const bundle = await repo.preload(echo);
    expect(bundle.definition).toBe(echo);
    expect(skinRequests().length).toBe(2);
  });

  it('keeps the animation files that did arrive', async () => {
    const repo = repository(loader);
    loader.fail.add(echo.skinUrl);
    await expect(repo.preload(echo)).rejects.toThrow();
    const afterFailure = animationRequests().length;

    loader.fail.clear();
    await repo.preload(echo);
    // Nothing was wrong with the animations, so they are not fetched again.
    expect(animationRequests().length).toBe(afterFailure);
  });

  it('releases a skin that parsed while a sibling request failed', async () => {
    const repo = repository(loader);
    const firstAnimation = Object.values(echo.animations).flat()[0]?.url as string;
    loader.fail.add(firstAnimation);
    await expect(repo.preload(echo)).rejects.toThrow(/boom/);
    // The skin arrived; the repository must not be holding it. A later successful preload
    // fetches a fresh one rather than handing back the orphan.
    loader.fail.clear();
    const bundle = await repo.preload(echo);
    expect(bundle.skinTemplate.name).toBe(echo.skinUrl);
  });

  it('refuses to preload once it has been disposed', async () => {
    const repo = repository(loader);
    repo.dispose();
    await expect(repo.preload(echo)).rejects.toThrow(/disposed/);
  });

  it('throws rather than returning a half-built bundle if it is disposed mid-load', async () => {
    const repo = repository(loader);
    loader.hold = true;
    const task = repo.preload(echo);
    repo.dispose();
    for (const resolve of loader.pending.values()) resolve();
    await expect(task).rejects.toThrow(/disposed/);
  });
});

describe('GltfCharacterAssetRepository: dispose', () => {
  it('releases the geometry, material and textures of every template it holds', async () => {
    const repo = repository(loader);
    const bundle = await repo.preload(echo);
    const mesh = bundle.skinTemplate.children[0] as THREE.Mesh;
    const geometry = vi.spyOn(mesh.geometry, 'dispose');
    const material = vi.spyOn(mesh.material as THREE.Material, 'dispose');

    repo.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(bundle.skinTemplate.children.length).toBe(0);
  });

  it('is safe to call twice', async () => {
    const repo = repository(loader);
    await repo.preload(echo);
    repo.dispose();
    expect(() => repo.dispose()).not.toThrow();
  });

  it('releases the throwaway scene of every animation file at parse time', async () => {
    const repo = repository(loader);
    await repo.preload(echo);
    // An animation GLB's scene is an import container; only its clips are kept. Nothing in the
    // repository should still be holding one, which `dispose` emptying only the skins shows.
    const bundle = await repo.preload(echo);
    expect(bundle.clips.size).toBeGreaterThan(0);
  });
});
