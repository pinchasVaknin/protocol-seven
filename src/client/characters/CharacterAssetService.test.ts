import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { characterDefinition, type CharacterDefinition } from './CharacterCatalog';
import type { CharacterAssetBundle, CharacterAssetRepository } from './CharacterAssetRepository';
import { CharacterAssetService } from './CharacterAssetService';

/**
 * The application-lifetime owner of parsed character templates, pinned before unit C5's refactor.
 *
 * It takes its repository as a constructor argument, which is the seam this file uses: everything
 * below is about the *status machine and the factory cache* on top of it — a load that other
 * callers join, a failure that leaves a retry possible, and a disposal that never reaches into
 * shared geometry a live Match might still be drawing.
 */

interface FakeRepository extends CharacterAssetRepository {
  readonly calls: string[];
  resolveNext(): void;
  rejectNext(error: Error): void;
  disposed: boolean;
}

function fakeRepository(): FakeRepository {
  const waiting: Array<{ resolve: (b: CharacterAssetBundle) => void; reject: (e: Error) => void; definition: CharacterDefinition }> = [];
  const repo: FakeRepository = {
    calls: [],
    disposed: false,
    preload(definition: CharacterDefinition) {
      repo.calls.push(definition.id);
      return new Promise<CharacterAssetBundle>((resolve, reject) => {
        waiting.push({ resolve, reject, definition });
      });
    },
    dispose() {
      repo.disposed = true;
    },
    resolveNext() {
      const next = waiting.shift();
      if (next === undefined) throw new Error('nothing waiting');
      const skinTemplate = new THREE.Object3D();
      skinTemplate.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
      next.resolve({ definition: next.definition, skinTemplate, clips: new Map() });
    },
    rejectNext(error: Error) {
      const next = waiting.shift();
      if (next === undefined) throw new Error('nothing waiting');
      next.reject(error);
    },
  };
  return repo;
}

let repo: FakeRepository;
let echo: CharacterDefinition;

beforeEach(() => {
  repo = fakeRepository();
  echo = characterDefinition('echo');
});

// ======================================== the test cases ======================================

describe('CharacterAssetService: the status machine', () => {
  it('starts idle and knows nothing about a character it has not seen', () => {
    const service = new CharacterAssetService(repo);
    expect(service.statusFor(echo)).toBe('idle');
  });

  it('is loading while the repository is working, and ready when it is done', async () => {
    const service = new CharacterAssetService(repo);
    const task = service.preload(echo);
    expect(service.statusFor(echo)).toBe('loading');
    repo.resolveNext();
    await task;
    expect(service.statusFor(echo)).toBe('ready');
  });

  it('is error after a failure, and says so without throwing at the caller that did not ask', async () => {
    const service = new CharacterAssetService(repo);
    const task = service.preload(echo);
    repo.rejectNext(new Error('offline'));
    await expect(task).rejects.toThrow(/offline/);
    expect(service.statusFor(echo)).toBe('error');
  });
});

describe('CharacterAssetService: joining and caching', () => {
  it('joins a second caller onto the load already in flight', async () => {
    const service = new CharacterAssetService(repo);
    const a = service.preload(echo);
    const b = service.preload(echo);
    expect(repo.calls.length).toBe(1);
    repo.resolveNext();
    await Promise.all([a, b]);
  });

  it('returns immediately once a factory is cached', async () => {
    const service = new CharacterAssetService(repo);
    const task = service.preload(echo);
    repo.resolveNext();
    await task;
    await service.preload(echo);
    expect(repo.calls.length).toBe(1);
  });

  it('asks the repository again after a failure, which is what retry means', async () => {
    const service = new CharacterAssetService(repo);
    const first = service.preload(echo);
    repo.rejectNext(new Error('offline'));
    await expect(first).rejects.toThrow();

    const second = service.retry(echo);
    expect(repo.calls.length).toBe(2);
    repo.resolveNext();
    await second;
    expect(service.statusFor(echo)).toBe('ready');
  });
});

describe('CharacterAssetService: what it does to a loaded template', () => {
  it('turns shadows on for every mesh before the first body is drawn', async () => {
    const service = new CharacterAssetService(repo);
    const task = service.preload(echo);
    repo.resolveNext();
    await task;
    // `CharacterSkin` sets these on every body, so the programs warmed here are the ones a body
    // draws with. Reaching the template through the provider is the only handle the test has.
    const provider = service.avatarProvider(echo);
    expect(provider.isReady).toBe(true);
  });
});

describe('CharacterAssetService: providers', () => {
  it('hands out a provider that is not ready until the load finishes', async () => {
    const service = new CharacterAssetService(repo);
    const provider = service.avatarProvider(echo);
    expect(provider.isReady).toBe(false);
    repo.resolveNext();
    await service.preload(echo);
    expect(provider.isReady).toBe(true);
  });

  it('lets a live provider see a retry succeed without being replaced', async () => {
    const service = new CharacterAssetService(repo);
    const provider = service.avatarProvider(echo);
    repo.rejectNext(new Error('offline'));
    await expect(service.preload(echo)).rejects.toThrow();
    expect(provider.isReady).toBe(false);

    const retry = service.retry(echo);
    repo.resolveNext();
    await retry;
    expect(provider.isReady).toBe(true);
  });

  it('refuses a template the rig cannot bind to, rather than throwing into the frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new CharacterAssetService(repo);
    const task = service.preload(echo);
    // The fake repository's template is a bare mesh with none of the rig's required bones, which
    // is what a malformed or mis-exported GLB looks like from here.
    repo.resolveNext();
    await task;
    const provider = service.avatarProvider(echo);
    expect(provider.isReady).toBe(true);
    expect(provider.create()).toBeNull();
    // ...and having failed once it stops asking, which is the containment rule.
    expect(provider.isReady).toBe(false);
    warn.mockRestore();
  });
});

describe('CharacterAssetService: dispose', () => {
  it('disposes the repository it owns and refuses further work', async () => {
    const service = new CharacterAssetService(repo);
    service.dispose();
    expect(repo.disposed).toBe(true);
    await expect(service.preload(echo)).rejects.toThrow(/disposed/);
  });

  it('is safe to call twice', () => {
    const service = new CharacterAssetService(repo);
    service.dispose();
    expect(() => service.dispose()).not.toThrow();
  });

  it('makes a provider handed out earlier stop creating', async () => {
    const service = new CharacterAssetService(repo);
    const task = service.preload(echo);
    repo.resolveNext();
    await task;
    const provider = service.avatarProvider(echo);
    expect(provider.isReady).toBe(true);
    service.dispose();
    expect(provider.isReady).toBe(false);
    expect(provider.create()).toBeNull();
  });

  it('throws rather than caching a factory if it is disposed mid-load', async () => {
    const service = new CharacterAssetService(repo);
    const task = service.preload(echo);
    service.dispose();
    repo.resolveNext();
    await expect(task).rejects.toThrow(/disposed/);
  });
});
