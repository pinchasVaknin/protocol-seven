import * as THREE from 'three';
import { Rng } from '../../shared/core/Rng';

/**
 * The flamethrower's jet (2026-09-28).
 *
 * The weapon fired a muzzle flash and a gunshot voice ten times a second and nothing else, so
 * the one weapon in the game that is not a bullet read as a machine gun with an orange light —
 * which is what the report said. This draws the thing the damage already was: a cone of fire
 * from the barrel to wherever the jet stops.
 *
 * ## One event, a continuous stream
 *
 * Fuel is spent in ticks — `WeaponFired` arrives at the weapon's 600 rpm, every 0.1 s — and a
 * burst of particles on each would be a jet that pulses. So each tick's particles are born
 * *spread back across the interval it covers*: particle `i` is advanced along its own path by a
 * random fraction of `TICK_SECONDS` at birth, exactly as if it had been emitted then. The stream
 * is continuous at any frame rate, and nothing here has to know whether the trigger is still down;
 * when the ticks stop, the stream simply runs out of fuel.
 *
 * ## Where it starts and where it stops
 *
 * It stops where `WeaponSystem.fireFlame` said the jet did — its reach or the first wall — and a
 * particle that gets there loses its forward speed and spreads, so fire held on a wall splashes
 * on the wall. That end point is on the wire, so a remote player's jet stops at the same wall.
 *
 * It starts at the muzzle. For everybody else that is the event's muzzle; for the local player it
 * is the viewmodel's, carried across into the world camera — the gun is drawn with its own field
 * of view, so the muzzle the player sees is not where the world thinks the barrel is, and a jet
 * from the world's muzzle would leave the screen a hand's width from the nozzle.
 *
 * Pooled and preallocated like `Fx`: one instanced mesh, one draw, nothing allocated per shot.
 */

const FLAME_CAP = 720;
/** Particles per tick of fuel. Twelve at ten ticks a second, about a hundred alive per jet. */
const PER_TICK = 12;
/** The interval a tick's particles are spread back across: the flamethrower's 600 rpm. */
const TICK_SECONDS = 0.1;
/**
 * Launch speed, m/s, and the drag that bleeds it: `v0 / k` is the furthest a particle can go.
 *
 * Slow and nearly even, and measured into it twice. At 24 m/s with a drag of 2 a particle crossed
 * the first two metres in a tenth of its life and spent the rest slowing down at the tip, so the
 * fire piled up where the jet ends — which from behind the gun is the one spot on screen everything
 * converges to: a white ball on the crosshair with nothing joining it to the nozzle. At 16 and 1
 * the pile was gone but the metre after the nozzle held one particle in fifty-seven, because
 * anything that fast is only there for a few frames. At 10 and 0.3 a particle takes an eighth of a
 * second to clear it, so the stream leaving the nozzle is there on every frame.
 */
const SPEED = 10;
const SPEED_JITTER = 1.5;
const DRAG = 0.3;
/** Hot gas rises. m/s², applied upward. */
const BUOYANCY = 1.6;
/** Radians of scatter around the aim. Narrower than the damage cone: this is the core. */
const SCATTER = 0.085;
/** 0.7–0.9 s at that speed is 6–8 m of jet, most of the 9 m the damage reaches. */
const LIFE_MIN = 0.7;
const LIFE_MAX = 0.9;
/** Metres across at birth and at death: the jet opens as it goes. */
const SIZE_START = 0.12;
const SIZE_END = 0.85;
/**
 * The brightness of one particle. Additive, so a hundred of them overlapping where the jet
 * converges clip to white at full strength; at this they sum to a hot yellow core with an orange body.
 */
const INTENSITY = 0.5;
/** A particle that reaches the end of the jet is gone within this long. */
const SPLASH_SECONDS = 0.14;

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

interface Flame {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Where the jet stops, along the direction this particle was launched on. */
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  reach: number;
  splashed: boolean;
  life: number;
  maxLife: number;
  spin: number;
}

export class FlameFx {
  /** Added to the world scene. */
  readonly group = new THREE.Group();

  private readonly rng = new Rng(0x0f1a_4e55);
  private readonly flames: Flame[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly disposables: Array<{ dispose(): void }> = [];

  /** The local player's viewmodel muzzle, and the camera it is drawn with. See the note above. */
  private muzzleAnchor: THREE.Object3D | null = null;
  private viewmodelCamera: THREE.Camera | null = null;
  private worldCamera: THREE.Camera | null = null;

  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly spinQuat = new THREE.Quaternion();
  private readonly viewAxis = new THREE.Vector3(0, 0, 1);
  private readonly scratchColor = new THREE.Color();
  private readonly origin = new THREE.Vector3();

  constructor() {
    this.group.name = 'fx:flame';
    for (let i = 0; i < FLAME_CAP; i++) this.flames.push(makeFlame());

    const texture = buildFlameTexture();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.disposables.push(texture, geometry, material);

    this.mesh = new THREE.InstancedMesh(geometry, material, FLAME_CAP);
    this.mesh.name = 'fx:flame:particles';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FLAME_CAP; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, this.scratchColor.setRGB(0, 0, 0));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    this.group.add(this.mesh);
  }

  get activeParticles(): number {
    let n = 0;
    for (const f of this.flames) if (f.active) n++;
    return n;
  }

  /**
   * The local player's muzzle, as the viewmodel draws it. Called wherever `Fx.attachMuzzle` is, so
   * a swap to the flamethrower's model brings its nozzle with it.
   */
  setLocalMuzzle(anchor: THREE.Object3D | null, viewmodelCamera: THREE.Camera | null): void {
    this.muzzleAnchor = anchor;
    this.viewmodelCamera = viewmodelCamera;
  }

  /**
   * One tick of fuel, from the muzzle at `(x, y, z)` to where the jet stops at `(endX, endY, endZ)`.
   * `local` swaps the muzzle for the one the player can see.
   */
  emit(x: number, y: number, z: number, endX: number, endY: number, endZ: number, local: boolean): void {
    const origin = this.origin.set(x, y, z);
    if (local) this.localMuzzle(origin);

    let dx = endX - origin.x;
    let dy = endY - origin.y;
    let dz = endZ - origin.z;
    const reach = Math.hypot(dx, dy, dz);
    if (reach < 0.05) return;
    dx /= reach;
    dy /= reach;
    dz /= reach;

    for (let n = 0; n < PER_TICK; n++) {
      const at = firstFree(this.flames);
      if (at < 0) return;
      const f = this.flames[at];
      if (f === undefined) return;

      // Scatter inside a narrow cone: two jitters perpendicular to the aim, then renormalise.
      let sx = dx + this.rng.spread() * SCATTER;
      let sy = dy + this.rng.spread() * SCATTER;
      let sz = dz + this.rng.spread() * SCATTER;
      const inv = 1 / Math.max(Math.hypot(sx, sy, sz), 1e-4);
      sx *= inv;
      sy *= inv;
      sz *= inv;
      const speed = SPEED + this.rng.spread() * SPEED_JITTER;

      f.active = true;
      f.splashed = false;
      f.x = origin.x;
      f.y = origin.y;
      f.z = origin.z;
      f.vx = sx * speed;
      f.vy = sy * speed;
      f.vz = sz * speed;
      f.ox = origin.x;
      f.oy = origin.y;
      f.oz = origin.z;
      f.dx = dx;
      f.dy = dy;
      f.dz = dz;
      f.reach = reach;
      f.maxLife = this.rng.range(LIFE_MIN, LIFE_MAX);
      f.life = f.maxLife;
      f.spin = this.rng.range(0, Math.PI * 2);

      // Born somewhere in the interval this tick stands for, not all at its start.
      this.advance(f, this.rng.float() * TICK_SECONDS);
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    this.worldCamera = camera;
    const step = Math.min(Math.max(dt, 0), 1 / 20);
    let dirty = false;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      if (f === undefined || !f.active) continue;
      dirty = true;
      this.advance(f, step);
      if (!f.active) {
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      const age = 1 - f.life / f.maxLife;
      const size = SIZE_START + (SIZE_END - SIZE_START) * Math.sqrt(age);
      this.scratchPos.set(f.x, f.y, f.z);
      // Facing the camera, turned about the view axis so no two puffs share an outline.
      this.spinQuat.setFromAxisAngle(this.viewAxis, f.spin + age * 1.6);
      this.scratchQuat.copy(camera.quaternion).multiply(this.spinQuat);
      this.scratchScale.set(size, size, size);
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.mesh.setMatrixAt(i, this.scratchMatrix);
      flameColor(age, this.scratchColor);
      this.mesh.setColorAt(i, this.scratchColor);
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }

  // -- internals --------------------------------------------------------------

  /** Move one particle on by `dt`: drag, lift, and the splash at the end of the jet. */
  private advance(f: Flame, dt: number): void {
    f.life -= dt;
    if (f.life <= 0) {
      f.active = false;
      return;
    }
    const keep = Math.exp(-DRAG * dt);
    f.vx *= keep;
    f.vy = f.vy * keep + BUOYANCY * dt;
    f.vz *= keep;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;

    if (f.splashed) return;
    const along = (f.x - f.ox) * f.dx + (f.y - f.oy) * f.dy + (f.z - f.oz) * f.dz;
    if (along < f.reach) return;
    // At the tip: lose the forward speed, keep the scatter, and go out quickly.
    f.splashed = true;
    const forward = f.vx * f.dx + f.vy * f.dy + f.vz * f.dz;
    f.vx = (f.vx - forward * f.dx) * 1.6;
    f.vy = (f.vy - forward * f.dy) * 1.6;
    f.vz = (f.vz - forward * f.dz) * 1.6;
    f.x -= (along - f.reach) * f.dx;
    f.y -= (along - f.reach) * f.dy;
    f.z -= (along - f.reach) * f.dz;
    f.life = Math.min(f.life, SPLASH_SECONDS);
  }

  /**
   * The viewmodel muzzle carried into the world camera: projected with the camera that draws it,
   * then put back on the same screen point at the same distance with the camera that draws the
   * world. The two cameras share a position and a rotation and differ only in field of view
   * (`CameraRig`), so this is exact rather than an offset tuned by eye.
   */
  private localMuzzle(out: THREE.Vector3): void {
    const anchor = this.muzzleAnchor;
    const vmCamera = this.viewmodelCamera;
    const camera = this.worldCamera;
    if (anchor === null || vmCamera === null || camera === null) return;
    anchor.getWorldPosition(out);
    const cameraPos = this.scratchPos.setFromMatrixPosition(camera.matrixWorld);
    const distance = out.distanceTo(cameraPos);
    out.project(vmCamera).unproject(camera);
    out.sub(cameraPos).normalize().multiplyScalar(distance).add(cameraPos);
  }
}

function makeFlame(): Flame {
  return {
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ox: 0,
    oy: 0,
    oz: 0,
    dx: 0,
    dy: 0,
    dz: -1,
    reach: 0,
    splashed: false,
    life: 0,
    maxLife: 1,
    spin: 0,
  };
}

/**
 * The colour of a flame at `age` (0 born, 1 gone), written into `out`. Additive, so the colour is
 * the brightness: white-yellow at the nozzle, orange through the body of the jet, a dark red at
 * the edge, and black — nothing — as it burns out.
 */
function flameColor(age: number, out: THREE.Color): void {
  if (age < 0.12) {
    const t = age / 0.12;
    out.setRGB(1, 0.95 - 0.3 * t, 0.7 - 0.5 * t);
  } else if (age < 0.5) {
    const t = (age - 0.12) / 0.38;
    out.setRGB(1, 0.65 - 0.3 * t, 0.2 - 0.12 * t);
  } else {
    const t = (age - 0.5) / 0.5;
    const fade = (1 - t) * (1 - t);
    out.setRGB(0.95 * fade, 0.35 * fade, 0.08 * fade);
  }
  out.multiplyScalar(INTENSITY);
}

/** A soft round puff: bright core, feathered edge. No spokes — that is the muzzle flash's shape. */
function buildFlameTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas context unavailable; cannot build the flame.');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function firstFree(list: readonly Flame[]): number {
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f !== undefined && !f.active) return i;
  }
  return -1;
}
