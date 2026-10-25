import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile, COMPILE_GIVE_UP_MS, gpuWarmup, type Compiler } from './GpuWarmup';

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

/**
 * The warm-up itself, pinned before unit C2's refactor.
 *
 * `gpuWarmup` is one object for the whole page, so the cases below share its state and are
 * written to run in order: the first two are the only chance to see it before a renderer is
 * attached, and nothing afterwards asserts an absolute hold count.
 *
 * Everything is driven through the public surface — `attach`, `requestScene`, `hold`, `adopt`,
 * `report` — so the shadow pass, the texture upload and the compile-until-still loop are all
 * covered without exporting one of them. What the fake renderer records is what the real one
 * would have been asked to do: which roots were compiled, which textures were uploaded, and
 * what the scene looked like while the shadow proxies were prepared.
 */

// ===================================== the fake renderer ======================================

interface SceneState {
  readonly fog: THREE.Fog | THREE.FogExp2 | null;
  readonly environment: THREE.Texture | null;
  readonly target: THREE.WebGLRenderTarget | null;
}

interface FakeWarmupRenderer {
  readonly renderer: THREE.WebGLRenderer;
  /** Every root `compile` was handed, in order. */
  readonly compiled: THREE.Object3D[];
  /** What the scene looked like at each compile: the shadow pass takes fog and environment off. */
  readonly sceneStates: SceneState[];
  readonly uploaded: THREE.Texture[];
  /** False keeps every program unlinked, so a compile never settles. */
  linkImmediately: boolean;
}

function fakeWarmup(scene: THREE.Scene, options: { shadows?: boolean } = {}): FakeWarmupRenderer {
  const compiled: THREE.Object3D[] = [];
  const sceneStates: SceneState[] = [];
  const uploaded: THREE.Texture[] = [];
  let bound: THREE.WebGLRenderTarget | null = null;
  const fake: FakeWarmupRenderer = {
    compiled,
    sceneStates,
    uploaded,
    linkImmediately: true,
    renderer: {
      info: { programs: [] },
      shadowMap: { enabled: options.shadows ?? false },
      getRenderTarget: (): THREE.WebGLRenderTarget | null => bound,
      setRenderTarget: (target: THREE.WebGLRenderTarget | null): void => void (bound = target),
      initTexture: (tex: THREE.Texture): void => void uploaded.push(tex),
      compile: (root: THREE.Object3D): Set<THREE.Material> => {
        compiled.push(root);
        sceneStates.push({ fog: scene.fog, environment: scene.environment, target: bound });
        return fake.linkImmediately ? new Set<THREE.Material>() : new Set([new THREE.MeshBasicMaterial()]);
      },
      properties: { get: () => ({ currentProgram: { isReady: () => false } }) },
      extensions: { has: () => true },
    } as unknown as THREE.WebGLRenderer,
  };
  return fake;
}

/** Let every microtask of a compile pass run. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function imaged(): THREE.Texture {
  const tex = new THREE.Texture();
  // `uploadTextures` skips a texture with no image: there is nothing on the GPU to put there yet.
  tex.image = { width: 1, height: 1 };
  return tex;
}

function caster(material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.castShadow = true;
  return mesh;
}

function proxyGroups(fake: FakeWarmupRenderer): THREE.Group[] {
  return fake.compiled.filter((root): root is THREE.Group => root instanceof THREE.Group);
}

// ======================================== the test cases ======================================

const warmupCamera = new THREE.Camera();

describe('gpuWarmup', () => {
  it('holds nothing before a renderer is attached', () => {
    expect(gpuWarmup.hold(new THREE.Scene(), warmupCamera)).toBe(false);
  });

  it('resolves an adopt with no renderer rather than throwing', async () => {
    await expect(gpuWarmup.adopt(new THREE.Object3D())).resolves.toBeUndefined();
  });

  it('holds the frame after a request, and lets go once the compile is done', async () => {
    const scene = new THREE.Scene();
    const fake = fakeWarmup(scene);
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    const before = gpuWarmup.report().holds;

    gpuWarmup.requestScene();
    expect(gpuWarmup.hold(scene, warmupCamera)).toBe(true);
    expect(gpuWarmup.report().holding).toBe(true);

    await settle();
    expect(gpuWarmup.hold(scene, warmupCamera)).toBe(false);
    expect(gpuWarmup.report().holds).toBe(before + 1);
    expect(gpuWarmup.report().holding).toBe(false);
    expect(Number.isInteger(gpuWarmup.report().lastHoldMs)).toBe(true);
  });

  it('does not hold a frame nothing asked for', () => {
    const scene = new THREE.Scene();
    const fake = fakeWarmup(scene);
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    expect(gpuWarmup.hold(scene, warmupCamera)).toBe(false);
  });

  it('compiles the scene it is handed, and goes round again until a pass adds no program', async () => {
    const scene = new THREE.Scene();
    const fake = fakeWarmup(scene);
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    gpuWarmup.requestScene();
    gpuWarmup.hold(scene, warmupCamera);
    await settle();
    // Two passes, because the first cannot know whether the frames still being prepared
    // underneath it added anything.
    expect(fake.compiled.filter((root) => root === scene).length).toBe(2);
  });

  it('compiles the viewmodel layer alongside the world it is drawn over', async () => {
    const scene = new THREE.Scene();
    const viewmodelScene = new THREE.Scene();
    const fake = fakeWarmup(scene);
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    gpuWarmup.requestScene();
    gpuWarmup.hold(scene, warmupCamera, { scene: viewmodelScene, camera: warmupCamera });
    await settle();
    expect(fake.compiled).toContain(viewmodelScene);
  });

  it('uploads every texture under the scene once a pass, and skips one with no image', async () => {
    const scene = new THREE.Scene();
    const shared = imaged();
    const empty = new THREE.Texture();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: shared })));
    scene.add(
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: shared, alphaMap: empty })),
    );
    const fake = fakeWarmup(scene);
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    gpuWarmup.requestScene();
    gpuWarmup.hold(scene, warmupCamera);
    await settle();
    // The set that dedupes is per traversal, so two passes mean one upload each.
    expect(fake.uploaded.filter((tex) => tex === shared).length).toBe(2);
    expect(fake.uploaded).not.toContain(empty);
  });
});

describe('gpuWarmup: the shadow pass', () => {
  it('is skipped entirely while the shadow map is off', async () => {
    const scene = new THREE.Scene();
    scene.add(caster(new THREE.MeshStandardMaterial()));
    const fake = fakeWarmup(scene, { shadows: false });
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    gpuWarmup.requestScene();
    gpuWarmup.hold(scene, warmupCamera);
    await settle();
    expect(proxyGroups(fake).length).toBe(0);
  });

  it('compiles one proxy per distinct kind of caster', async () => {
    const scene = new THREE.Scene();
    scene.add(caster(new THREE.MeshStandardMaterial()));
    // The same kind as the first: one proxy covers both.
    scene.add(caster(new THREE.MeshStandardMaterial()));
    // A cut-out is a different depth program.
    scene.add(caster(new THREE.MeshStandardMaterial({ alphaTest: 0.5 })));
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    skinned.castShadow = true;
    skinned.bind(new THREE.Skeleton([new THREE.Bone()]));
    scene.add(skinned);
    const fake = fakeWarmup(scene, { shadows: true });
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    gpuWarmup.requestScene();
    gpuWarmup.hold(scene, warmupCamera);
    await settle();
    const groups = proxyGroups(fake);
    expect(groups.length).toBe(2);
    expect(groups[0]?.children.length).toBe(3);
  });

  it('takes no proxy from something that is not a visible caster', async () => {
    const scene = new THREE.Scene();
    const hidden = caster(new THREE.MeshStandardMaterial());
    hidden.visible = false;
    scene.add(hidden);
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    scene.add(caster(new THREE.MeshStandardMaterial({ visible: false })));
    const fake = fakeWarmup(scene, { shadows: true });
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    gpuWarmup.requestScene();
    gpuWarmup.hold(scene, warmupCamera);
    await settle();
    expect(proxyGroups(fake).length).toBe(0);
  });

  it('takes the fog and the environment off for the compile and puts them back', async () => {
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x101010, 1, 100);
    const environment = imaged();
    scene.fog = fog;
    scene.environment = environment;
    scene.add(caster(new THREE.MeshStandardMaterial()));
    const fake = fakeWarmup(scene, { shadows: true });
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    gpuWarmup.requestScene();
    gpuWarmup.hold(scene, warmupCamera);
    await settle();

    const pass = fake.compiled.findIndex((root) => root instanceof THREE.Group);
    expect(pass).toBeGreaterThanOrEqual(0);
    expect(fake.sceneStates[pass]?.fog).toBe(null);
    expect(fake.sceneStates[pass]?.environment).toBe(null);
    // A render target has to be bound, or the depth programs compile for the canvas instead.
    expect(fake.sceneStates[pass]?.target).not.toBe(null);
    expect(scene.fog).toBe(fog);
    expect(scene.environment).toBe(environment);
    expect(fake.renderer.getRenderTarget()).toBe(null);
  });
});

describe('gpuWarmup: adopting a template', () => {
  it('uploads the template textures and compiles it for the world lights', async () => {
    const scene = new THREE.Scene();
    const fake = fakeWarmup(scene);
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    const tex = imaged();
    const template = new THREE.Object3D();
    template.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: tex })));
    await gpuWarmup.adopt(template);
    expect(fake.uploaded).toContain(tex);
    expect(fake.compiled).toContain(template);
  });

  it('asks the next frame to compile its scene as well', () => {
    const scene = new THREE.Scene();
    const fake = fakeWarmup(scene);
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    void gpuWarmup.adopt(new THREE.Object3D());
    expect(gpuWarmup.hold(scene, warmupCamera)).toBe(true);
  });
});

describe('gpuWarmup: the hold limit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws the frame anyway once a compile has outlasted the limit', async () => {
    const scene = new THREE.Scene();
    const fake = fakeWarmup(scene);
    fake.linkImmediately = false;
    gpuWarmup.attach(fake.renderer, scene, warmupCamera);
    vi.useFakeTimers();
    gpuWarmup.requestScene();
    expect(gpuWarmup.hold(scene, warmupCamera)).toBe(true);
    await vi.advanceTimersByTimeAsync(1400);
    expect(gpuWarmup.hold(scene, warmupCamera)).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(gpuWarmup.hold(scene, warmupCamera)).toBe(false);
  });
});
