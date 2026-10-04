import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile, COMPILE_GIVE_UP_MS, type Compiler } from './GpuWarmup';

/**
 * The wait for the GPU to link a compiled program, against a renderer that only keeps the books:
 * each material's `currentProgram`, which three.js deletes when the material is disposed.
 */

function fakeRenderer(materials: THREE.Material[]): { renderer: Compiler; programs: Map<THREE.Material, { ready: boolean }> } {
  const programs = new Map<THREE.Material, { ready: boolean }>();
  for (const m of materials) programs.set(m, { ready: false });
  const renderer = {
    compile: () => new Set(materials),
    properties: {
      get: (m: THREE.Material) => {
        const p = programs.get(m);
        return p === undefined ? {} : { currentProgram: { isReady: () => p.ready } };
      },
    },
    extensions: { has: () => true },
  } as unknown as Compiler;
  return { renderer, programs };
}

const root = new THREE.Object3D();
const camera = new THREE.Camera();
const scene = new THREE.Scene();

describe('compile', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits until every program is linked', async () => {
    vi.useFakeTimers();
    const a = new THREE.MeshBasicMaterial();
    const { renderer, programs } = fakeRenderer([a]);
    let done = false;
    void compile(renderer, root, camera, scene).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(false);
    programs.set(a, { ready: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
  });

  it('stops waiting for a material disposed mid-compile instead of throwing', async () => {
    vi.useFakeTimers();
    const kept = new THREE.MeshBasicMaterial();
    const disposed = new THREE.MeshBasicMaterial();
    const { renderer, programs } = fakeRenderer([kept, disposed]);
    let done = false;
    void compile(renderer, root, camera, scene).then(() => (done = true));
    // Disposal removes the material's properties: no `currentProgram` to ask.
    programs.delete(disposed);
    programs.set(kept, { ready: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
  });

  it(`gives up after ${COMPILE_GIVE_UP_MS} ms on a program that never reports linked`, async () => {
    vi.useFakeTimers();
    const { renderer } = fakeRenderer([new THREE.MeshBasicMaterial()]);
    let done = false;
    void compile(renderer, root, camera, scene).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(COMPILE_GIVE_UP_MS - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });

  it('resolves when the compile itself throws', async () => {
    const renderer = {
      compile: () => {
        throw new Error('lost context');
      },
    } as unknown as Compiler;
    await expect(compile(renderer, root, camera, scene)).resolves.toBeUndefined();
  });
});
