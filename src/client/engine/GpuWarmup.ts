import * as THREE from 'three';
import { logger } from '../../shared/core/Log';

const log = logger('GpuWarmup');

/**
 * Shaders and textures onto the GPU before the frame that needs them (2026-09-28, part 5).
 *
 * ## What it is fixing
 *
 * Nothing in the client compiled a program or uploaded a texture ahead of time, so both happened
 * inside the first `renderer.render` that drew the thing: a model's first frame, and — because a
 * program is compiled *for a light setup* and every map has its own number of point lights — the
 * first frame of every new map, for everything in it. Measured in this tree, entering a match:
 * two frames of 116 ms and 211 ms compiling 10 and 7 programs, and more as the bots' weapons and
 * the sentry arrived. The playtest measured the same stalls at about a second on its machine.
 *
 * The frame is only half of the cost. A blocked main thread runs no simulation ticks and sends no
 * commands, so every stall also tripped the netcode's catch-up — the 62–67-tick resyncs the report
 * found after each one.
 *
 * ## What it does instead
 *
 * Two things, and they cover each other's gaps:
 *
 * 1. **The scene, before the frame that would first draw it.** Anything that changes what the next
 *    frame needs — a new map, a template that has just arrived — calls `requestScene`. The next
 *    frame then does all of its usual work (the bots' avatars are created, the weapons put in their
 *    hands) and, instead of drawing, hands the scene to `compileAsync` and uploads its textures.
 *    The frames after that are skipped — the canvas keeps the last picture — until the GPU says the
 *    programs are linked. Compiling the real objects, already configured, is what makes it exact: a
 *    program's key includes per-object facts like `receiveShadow`, which a template need not share.
 *    The simulation and the network keep running underneath, because nothing is blocked.
 * 2. **Templates, when they arrive** (`adopt`). A sentry model lands at the start of a match and is
 *    not drawn until somebody places one, so no scene contains it; its programs are compiled against
 *    the world's lights as it arrives, and its textures uploaded.
 *
 * A hold never outlasts `MAX_HOLD_MS`: past that the frame is drawn and whatever is left compiles
 * the old way, so a driver that never reports completion cannot freeze the picture.
 */

/** The longest the picture is held for a compile. */
const MAX_HOLD_MS = 1500;

interface Target {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
}

class GpuWarmup {
  private renderer: THREE.WebGLRenderer | null = null;
  private world: Target | null = null;
  /**
   * Every template adopted so far, compiled again for each new scene's lights. A skin warmed for
   * the menu's lights is the wrong program on a map with another number of point lamps — measured:
   * the first frame after the arena's hold compiled a body's two programs the hold had not, for a
   * bot whose skinned avatar replaced its placeholder two frames into the hold.
   */
  private readonly adopted = new Set<THREE.Object3D>();
  private requested = false;
  private inFlight: Promise<void> | null = null;
  private holdStartedMs = 0;
  /** For the console: how many holds there have been, and how long the last one lasted. */
  private holds = 0;
  private lastHoldMs = 0;

  /**
   * The renderer and the scene every template is drawn into. `camera` decides only which lights
   * count (their layers); any camera in the scene will do.
   */
  attach(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer = renderer;
    this.world = { scene, camera };
  }

  /** The next frame should prepare its scene before drawing it. */
  requestScene(): void {
    this.requested = true;
  }

  /**
   * A template has arrived: upload its textures and compile its programs for the world's lights,
   * so the first copy drawn costs nothing. Also asks the next frame to compile its scene, which is
   * where the copies already placed by then are covered exactly. Resolves either way.
   */
  adopt(root: THREE.Object3D): Promise<void> {
    this.adopted.add(root);
    this.requestScene();
    const renderer = this.renderer;
    const world = this.world;
    if (renderer === null || world === null) return Promise.resolve();
    uploadTextures(renderer, root);
    return compile(renderer, root, world.camera, world.scene);
  }

  /**
   * Called just before a frame is drawn, with what it is about to draw. True means **do not draw
   * this frame**: the scene is being compiled. Starts that compile on the first frame after a
   * request, and answers true until it finishes or `MAX_HOLD_MS` passes.
   *
   * `extra` is the viewmodel's layer, compiled alongside: it is a scene of its own, with its own
   * lights, drawn over the world in the same frame.
   */
  hold(scene: THREE.Scene, camera: THREE.Camera, extra: Target | null = null): boolean {
    const renderer = this.renderer;
    if (renderer === null) return false;
    if (this.inFlight === null && this.requested) {
      this.requested = false;
      this.holdStartedMs = performance.now();
      const started = this.compileUntilStill(renderer, scene, camera, extra).then(() => {
        this.holds++;
        this.lastHoldMs = performance.now() - this.holdStartedMs;
        if (this.inFlight === started) this.inFlight = null;
      });
      this.inFlight = started;
    }
    if (this.inFlight === null) return false;
    if (performance.now() - this.holdStartedMs > MAX_HOLD_MS) {
      log.warn(`a scene compile outlasted ${MAX_HOLD_MS} ms; drawing anyway.`);
      this.inFlight = null;
      return false;
    }
    return true;
  }

  /**
   * Compile the scene, and every adopted template for its lights, and go again until a pass adds
   * no program.
   *
   * Again, because the frames go on being prepared while the first pass compiles: the bodies are
   * built two a frame (`BotRenderer`), so a skinned avatar that replaces its placeholder during the
   * hold, and the weapon put in its hand, were not in the scene the first pass saw. A second pass
   * over a scene whose programs are already cached costs a traversal; it stops the moment nothing
   * new turns up, and `MAX_HOLD_MS` stops it regardless.
   */
  private async compileUntilStill(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    extra: Target | null,
  ): Promise<void> {
    for (let pass = 0; pass < 6; pass++) {
      const before = renderer.info.programs?.length ?? 0;
      uploadTextures(renderer, scene);
      const work = [compile(renderer, scene, camera, scene), compileShadowPass(renderer, scene, camera)];
      if (pass === 0) {
        for (const root of this.adopted) work.push(compile(renderer, root, camera, scene));
      }
      if (extra !== null) {
        uploadTextures(renderer, extra.scene);
        work.push(compile(renderer, extra.scene, extra.camera, extra.scene));
      }
      await Promise.all(work);
      if (pass > 0 && (renderer.info.programs?.length ?? 0) === before) return;
      if (performance.now() - this.holdStartedMs > MAX_HOLD_MS) return;
    }
  }

  /** For the console: how many holds there have been and how long the last one took. */
  report(): { holds: number; lastHoldMs: number; holding: boolean } {
    return { holds: this.holds, lastHoldMs: Math.round(this.lastHoldMs), holding: this.inFlight !== null };
  }
}

/** The longest `compile` waits for the GPU to report a program linked before it stops asking. */
export const COMPILE_GIVE_UP_MS = 10_000;

/** What `compile` uses of a renderer. */
export type Compiler = Pick<THREE.WebGLRenderer, 'compile' | 'properties' | 'extensions'>;

/**
 * `WebGLRenderer.compileAsync`, with the wait done here instead of by three.js.
 *
 * Its wait polls every material it compiled, every 10 ms, for `currentProgram.isReady()` — and a
 * material disposed in the meantime has had its properties removed, so `currentProgram` is
 * undefined and the poll throws inside a `setTimeout`, where nobody can catch it, and its promise
 * never settles (r185). Materials are disposed during a wait whenever a scene is torn down
 * mid-compile: a reconnect, a map change, an avatar replacing its placeholder. Here a disposed
 * material is simply not waited for — nothing will draw it. And the wait ends after
 * `COMPILE_GIVE_UP_MS` whatever the GPU says: a lost context never reports a program linked, and
 * whatever is left compiles in the first frame that draws it, as before warm-up existed.
 */
export function compile(renderer: Compiler, root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
  let waiting: Set<THREE.Material>;
  try {
    waiting = renderer.compile(root, camera, scene);
  } catch (error) {
    log.warn(`compile failed; the first frame will compile instead. ${String(error)}`);
    return Promise.resolve();
  }
  const startedMs = performance.now();
  return new Promise((resolve) => {
    const check = (): void => {
      for (const material of waiting) {
        const program = (renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } }).currentProgram;
        if (program === undefined || program.isReady()) waiting.delete(material);
      }
      if (waiting.size === 0 || performance.now() - startedMs > COMPILE_GIVE_UP_MS) resolve();
      else setTimeout(check, 10);
    };
    // As three.js does: at once when the GPU can report progress; without the extension every
    // program reports ready, and the answer waits a turn.
    if (renderer.extensions.has('KHR_parallel_shader_compile')) check();
    else setTimeout(check, 10);
  });
}

/**
 * The shadow pass's programs, which `compile` does not reach.
 *
 * `WebGLRenderer.compile` prepares each object's own material. The shadow map draws every caster a
 * second time with an internal `MeshDepthMaterial`, set from the caster's material (its side, its
 * cut-out map) and drawn into the shadow map's render target with no scene — so no fog, no
 * environment, no tone mapping, linear output. Measured on entering a match after the scene had
 * been compiled: one frame of 152 ms building four unnamed programs, which were these.
 *
 * So the pass is imitated: one proxy per distinct kind of caster — plain, instanced or skinned,
 * and the depth material's variant — sharing the caster's geometry (and skeleton) with a depth
 * material set the way `WebGLShadowMap.getDepthMaterial` sets its own, compiled for the scene's
 * lights with a render target bound and the fog and environment taken off for the synchronous
 * moment `compile` reads them. Nothing is drawn, and everything is put back before it returns.
 */
const SHADOW_SIDE: Record<number, THREE.Side> = {
  [THREE.FrontSide]: THREE.BackSide,
  [THREE.BackSide]: THREE.FrontSide,
  [THREE.DoubleSide]: THREE.DoubleSide,
};
let shadowTarget: THREE.WebGLRenderTarget | null = null;

function compileShadowPass(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  if (!renderer.shadowMap.enabled) return Promise.resolve();
  const proxies = new THREE.Group();
  const seen = new Set<string>();
  scene.traverseVisible((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh !== true || !mesh.castShadow || (mesh as THREE.BatchedMesh).isBatchedMesh === true) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material === undefined || !material.visible) continue;
      const depth = depthMaterialFor(material);
      const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
      const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true;
      const key = [
        skinned,
        instanced,
        instanced && (mesh as THREE.InstancedMesh).instanceColor !== null,
        mesh.geometry.morphAttributes.position?.length ?? 0,
        depth.side,
        depth.map !== null,
        depth.alphaMap !== null,
        depth.alphaTest > 0,
        depth.displacementMap !== null,
      ].join();
      if (seen.has(key)) continue;
      seen.add(key);
      proxies.add(proxyFor(mesh, depth));
    }
  });
  if (proxies.children.length === 0) return Promise.resolve();

  shadowTarget ??= new THREE.WebGLRenderTarget(1, 1);
  const previousTarget = renderer.getRenderTarget();
  const fog = scene.fog;
  const environment = scene.environment;
  scene.fog = null;
  scene.environment = null;
  renderer.setRenderTarget(shadowTarget);
  try {
    return compile(renderer, proxies, camera, scene);
  } finally {
    renderer.setRenderTarget(previousTarget);
    scene.fog = fog;
    scene.environment = environment;
  }
}

/** A depth material as `WebGLShadowMap.getDepthMaterial` would set one up for `material`. */
function depthMaterialFor(material: THREE.Material): THREE.MeshDepthMaterial {
  const source = material as THREE.MeshStandardMaterial;
  const depth = new THREE.MeshDepthMaterial();
  depth.side = material.shadowSide ?? SHADOW_SIDE[material.side] ?? THREE.BackSide;
  depth.alphaMap = source.alphaMap ?? null;
  depth.alphaTest = material.alphaToCoverage ? 0.5 : material.alphaTest;
  depth.map = source.map ?? null;
  depth.displacementMap = source.displacementMap ?? null;
  depth.displacementScale = source.displacementScale ?? 1;
  depth.wireframe = (source as { wireframe?: boolean }).wireframe === true;
  return depth;
}

/** An object of the caster's kind, on its geometry, wearing `depth`. Never added to a scene. */
function proxyFor(mesh: THREE.Mesh, depth: THREE.MeshDepthMaterial): THREE.Mesh {
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh === true) {
    const skinned = mesh as THREE.SkinnedMesh;
    const proxy = new THREE.SkinnedMesh(skinned.geometry, depth);
    proxy.bind(skinned.skeleton, skinned.bindMatrix);
    return proxy;
  }
  if ((mesh as THREE.InstancedMesh).isInstancedMesh === true) {
    const instanced = mesh as THREE.InstancedMesh;
    const proxy = new THREE.InstancedMesh(instanced.geometry, depth, 1);
    proxy.instanceColor = instanced.instanceColor;
    return proxy;
  }
  return new THREE.Mesh(mesh.geometry, depth);
}

/** Every texture under `root`, onto the GPU now rather than in the frame that first samples it. */
function uploadTextures(renderer: THREE.WebGLRenderer, root: THREE.Object3D): void {
  const seen = new Set<THREE.Texture>();
  root.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material === undefined) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture && !seen.has(value) && value.image !== undefined && value.image !== null) {
          seen.add(value);
          renderer.initTexture(value);
        }
      }
    }
  });
}

/**
 * One for the page, like `palette`: templates arrive deep inside services that have no renderer,
 * and threading one down to each of them to hold one reference would be ceremony. `Game` attaches
 * the renderer and the scene once, at boot.
 */
export const gpuWarmup = new GpuWarmup();
