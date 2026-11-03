/**
 * Turns box volumes into render geometry.
 *
 * Three things happen here that a naive `new THREE.BoxGeometry()` per brush would not
 * give us:
 *
 *  1. World-projected UVs. Texture coordinates come from the vertex's world position
 *     projected onto the face tangents, so a wall built from four brushes tiles
 *     continuously instead of restarting per brush.
 *  2. Edge-refined tessellation. Faces are subdivided with extra rows near their
 *     borders, which is where contact shadows live.
 *  3. Baked vertex AO. Short rays against the collision hash, once at load. This is
 *     the "cheap AO approximation" the brief asks for — no post-process, no cost at
 *     runtime, and it is what stops grey-box from reading as muddy.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import { Rng } from '../../shared/core/Rng';
import type { CollisionWorld } from '../../shared/world/CollisionWorld';
import { makeRayHit } from '../../shared/world/Geometry';
import type { MaterialKey } from '../../shared/world/maps/types';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface BoxSpec {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  /** 9 floats, columns are the box's local axes in world space. */
  basis: Float32Array | number[];
  material: MaterialKey;
  uvScale: number;
}

export interface AoSettings {
  /** Ray length, metres. Contact AO only — this is not global illumination. */
  distance: number;
  /** Rays per vertex. */
  samples: number;
  /** Darkest the bake is allowed to go, 0..1. */
  floor: number;
  /** How far off the surface rays start, to avoid self-hits. */
  bias: number;
}

interface Build {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

/**
 * One face's world-space frame, rewritten per face rather than rebuilt.
 *
 * `n` is the outward normal, `u` and `v` the face tangents with u x v = n, and `f` the face
 * centre. One of these is made per `emitBox` call and overwritten six times, because the brush
 * build is reached from `MapBuildQueue.pump` on a live frame and an object per face would be a
 * few thousand allocations across a build.
 */
interface FaceFrame {
  nx: number;
  ny: number;
  nz: number;
  ux: number;
  uy: number;
  uz: number;
  vx: number;
  vy: number;
  vz: number;
  fx: number;
  fy: number;
  fz: number;
  uvScale: number;
}

/**
 * What one AO bake needs for every vertex of one geometry.
 *
 * Made once per `bakeAo` call: the ray hit and the tangent frame are written into per vertex,
 * and neither ever escapes the bake.
 */
/** The tangent, the bitangent and the normal a vertex's hemisphere is rotated into. */
interface AoFrame {
  tx: number;
  ty: number;
  tz: number;
  bx: number;
  by: number;
  bz: number;
  nx: number;
  ny: number;
  nz: number;
}

interface AoPass {
  world: CollisionWorld;
  ao: AoSettings;
  hit: ReturnType<typeof makeRayHit>;
  /** The orthonormal frame around the vertex normal, rewritten per vertex. */
  frame: AoFrame;
  samples: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const DEFAULT_AO: AoSettings = { distance: 2.2, samples: 6, floor: 0.32, bias: 0.02 };

/** Local face frames: [normalAxis, normalSign, uAxis, vAxis], with u x v = n. */
const FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 1, 2],
  [0, -1, 2, 1],
  [1, 1, 2, 0],
  [1, -1, 0, 2],
  [2, 1, 0, 1],
  [2, -1, 1, 0],
];
//#endregion

// ===================================== DERIVED CONSTANTS ====================================== \\
//#region Derived Constants
/**
 * Hemisphere ray bundle, generated once with a fixed seed so the bake is identical
 * on every load. Stored as (x, y, z) triples around +Y and rotated per vertex.
 *
 * Below the functions it calls in the file's reading order, and above them in its load order:
 * `buildHemisphere` is a hoisted `function` declaration, which is what makes that legal.
 */
const AO_DIRECTIONS = buildHemisphere(16);
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Build one merged, indexed geometry per material.
 * Pass `world` to bake AO; pass null to skip it (used by the prop path).
 */
export function buildBoxGeometry(
  boxes: readonly BoxSpec[],
  world: CollisionWorld | null,
  targetSpacing: number,
  ao: AoSettings = DEFAULT_AO,
): Map<MaterialKey, THREE.BufferGeometry> {
  const builds = new Map<MaterialKey, Build>();

  for (const box of boxes) {
    let build = builds.get(box.material);
    if (build === undefined) {
      build = newBuild();
      builds.set(box.material, build);
    }
    emitBox(build, box, targetSpacing);
  }

  if (world !== null) {
    for (const build of builds.values()) bakeAo(build, world, ao);
  } else {
    for (const build of builds.values()) bakeVerticalGradient(build);
  }

  const out = new Map<MaterialKey, THREE.BufferGeometry>();
  for (const [material, build] of builds) {
    out.set(material, toGeometry(build));
  }
  return out;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function newBuild(): Build {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

/** One merged, indexed `BufferGeometry` out of the four parallel arrays. */
function toGeometry(build: Build): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(build.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(build.normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(build.uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(build.colors, 3));
  geo.setIndex(build.indices);
  geo.computeBoundingSphere();
  return geo;
}

/** Six tessellated faces, appended to whatever the build already holds. */
function emitBox(build: Build, box: BoxSpec, targetSpacing: number): void {
  const frame = newFaceFrame();

  for (const face of FACES) {
    const hu = halfExtentOf(box, face[2]);
    const hv = halfExtentOf(box, face[3]);
    writeFaceFrame(frame, box, face);

    const us = axisSamples(hu, targetSpacing);
    const vs = axisSamples(hv, targetSpacing);
    const base = build.positions.length / 3;
    pushFaceVertices(build, frame, us, vs);
    pushFaceQuads(build, base, us.length, vs.length);
  }
}

function newFaceFrame(): FaceFrame {
  return { nx: 0, ny: 0, nz: 0, ux: 0, uy: 0, uz: 0, vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0, uvScale: 1 };
}

/** The box's half-extent along one of its local axes. */
function halfExtentOf(box: BoxSpec, axis: number): number {
  if (axis === 0) return box.hx;
  if (axis === 1) return box.hy;
  if (axis === 2) return box.hz;
  return 0;
}

/** World-space axes and centre for one face, written into the frame the caller reuses. */
function writeFaceFrame(frame: FaceFrame, box: BoxSpec, face: readonly [number, number, number, number]): void {
  const b = box.basis;
  const na = face[0];
  const ns = face[1];
  const ua = face[2];
  const va = face[3];
  const hn = halfExtentOf(box, na);

  // World-space axes for this face.
  frame.nx = (b[na * 3] ?? 0) * ns;
  frame.ny = (b[na * 3 + 1] ?? 0) * ns;
  frame.nz = (b[na * 3 + 2] ?? 0) * ns;
  frame.ux = b[ua * 3] ?? 0;
  frame.uy = b[ua * 3 + 1] ?? 0;
  frame.uz = b[ua * 3 + 2] ?? 0;
  frame.vx = b[va * 3] ?? 0;
  frame.vy = b[va * 3 + 1] ?? 0;
  frame.vz = b[va * 3 + 2] ?? 0;

  // Face centre in world space.
  frame.fx = box.cx + frame.nx * hn;
  frame.fy = box.cy + frame.ny * hn;
  frame.fz = box.cz + frame.nz * hn;

  frame.uvScale = box.uvScale;
}

/** The face's grid of vertices, in v-major order so the quad indices below line up. */
function pushFaceVertices(build: Build, frame: FaceFrame, us: readonly number[], vs: readonly number[]): void {
  const { nx, ny, nz, ux, uy, uz, vx, vy, vz, fx, fy, fz, uvScale } = frame;
  for (let j = 0; j < vs.length; j++) {
    const sv = vs[j] ?? 0;
    for (let i = 0; i < us.length; i++) {
      const su = us[i] ?? 0;
      const px = fx + ux * su + vx * sv;
      const py = fy + uy * su + vy * sv;
      const pz = fz + uz * su + vz * sv;
      build.positions.push(px, py, pz);
      build.normals.push(nx, ny, nz);
      // World-projected UVs: continuous across neighbouring brushes.
      build.uvs.push((px * ux + py * uy + pz * uz) / uvScale, (px * vx + py * vy + pz * vz) / uvScale);
      build.colors.push(1, 1, 1);
    }
  }
}

/** Two triangles per cell of the grid `pushFaceVertices` just appended. */
function pushFaceQuads(build: Build, base: number, uCount: number, vCount: number): void {
  const stride = uCount;
  for (let j = 0; j < vCount - 1; j++) {
    for (let i = 0; i < uCount - 1; i++) {
      const a = base + j * stride + i;
      const bIdx = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      build.indices.push(a, bIdx, c, a, c, d);
    }
  }
}

/**
 * Sample positions across a face half-extent, in metres from the centre.
 * Uniform in the middle, with two extra rows tucked in near each edge so contact
 * shadows are crisp without paying for a uniformly dense grid.
 */
function axisSamples(halfExtent: number, targetSpacing: number): number[] {
  const full = halfExtent * 2;
  const divisions = Math.max(1, Math.min(24, Math.round(full / targetSpacing)));
  const set: number[] = [];
  for (let i = 0; i <= divisions; i++) set.push(-halfExtent + (full * i) / divisions);

  if (full > 0.45) {
    for (const inset of [0.09, 0.3]) {
      if (inset < halfExtent * 0.7) {
        set.push(-halfExtent + inset, halfExtent - inset);
      }
    }
  }
  set.sort((a, z) => a - z);

  // Drop samples that landed on top of each other.
  const out: number[] = [];
  for (const s of set) {
    const last = out[out.length - 1];
    if (last === undefined || s - last > 1e-4) out.push(s);
  }
  return out;
}

function buildHemisphere(count: number): Float32Array {
  const rng = new Rng(0x51de1105);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Cosine-weighted around +Y.
    const u = (i + 0.5) / count;
    const r = Math.sqrt(u);
    const phi = rng.float() * Math.PI * 2;
    const x = r * Math.cos(phi);
    const z = r * Math.sin(phi);
    const y = Math.sqrt(Math.max(0, 1 - u));
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

function bakeAo(build: Build, world: CollisionWorld, ao: AoSettings): void {
  const pass: AoPass = {
    world,
    ao,
    hit: makeRayHit(),
    frame: { tx: 0, ty: 0, tz: 0, bx: 0, by: 0, bz: 0, nx: 0, ny: 0, nz: 0 },
    samples: Math.max(1, Math.min(ao.samples, AO_DIRECTIONS.length / 3)),
  };
  const count = build.positions.length / 3;
  for (let v = 0; v < count; v++) shadeVertex(build, v, pass);
}

/** One vertex's openness, written into all three of its colour channels. */
function shadeVertex(build: Build, v: number, pass: AoPass): void {
  const ao = pass.ao;
  const p3 = v * 3;
  const nx = build.normals[p3] ?? 0;
  const ny = build.normals[p3 + 1] ?? 0;
  const nz = build.normals[p3 + 2] ?? 0;
  writeTangentFrame(nx, ny, nz, pass.frame);

  const ox = (build.positions[p3] ?? 0) + nx * ao.bias;
  const oy = (build.positions[p3 + 1] ?? 0) + ny * ao.bias;
  const oz = (build.positions[p3 + 2] ?? 0) + nz * ao.bias;
  const occluded = occlusionAt(pass, ox, oy, oz);

  const openness = 1 - occluded / pass.samples;
  const shade = ao.floor + (1 - ao.floor) * Math.max(0, Math.min(1, openness));
  build.colors[p3] = shade;
  build.colors[p3 + 1] = shade;
  build.colors[p3 + 2] = shade;
}

/**
 * Orthonormal basis around the vertex normal, rebuilt per vertex without allocating.
 *
 * Tangent: cross the normal with whichever world axis it is least aligned to.
 */
function writeTangentFrame(nx: number, ny: number, nz: number, out: AoFrame): void {
  let tx: number;
  let ty: number;
  let tz: number;
  if (Math.abs(ny) < 0.9) {
    tx = -nz;
    ty = 0;
    tz = nx;
  } else {
    tx = 1;
    ty = 0;
    tz = 0;
  }
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  out.tx = tx;
  out.ty = ty;
  out.tz = tz;
  out.bx = ny * tz - nz * ty;
  out.by = nz * tx - nx * tz;
  out.bz = nx * ty - ny * tx;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
}

/** The hemisphere bundle, rotated into the vertex frame and cast against the world. */
function occlusionAt(pass: AoPass, ox: number, oy: number, oz: number): number {
  const { tx, ty, tz, bx, by, bz, nx, ny, nz } = pass.frame;
  const ao = pass.ao;

  let occluded = 0;
  for (let s = 0; s < pass.samples; s++) {
    const s3 = s * 3;
    const hx = AO_DIRECTIONS[s3] ?? 0;
    const hy = AO_DIRECTIONS[s3 + 1] ?? 1;
    const hz = AO_DIRECTIONS[s3 + 2] ?? 0;
    const dx = tx * hx + nx * hy + bx * hz;
    const dy = ty * hx + ny * hy + by * hz;
    const dz = tz * hx + nz * hy + bz * hz;
    const len = Math.hypot(dx, dy, dz) || 1;
    if (pass.world.raycast(ox, oy, oz, dx / len, dy / len, dz / len, ao.distance, pass.hit)) {
      // Near hits darken more than distant ones.
      occluded += 1 - Math.min(1, pass.hit.t / ao.distance) * 0.65;
    }
  }
  return occluded;
}

/**
 * Props are instanced, so per-instance vertex AO is not available. They get a static
 * bottom-darkening gradient instead, which combined with the shadow map is enough to
 * seat them on the floor.
 */
function bakeVerticalGradient(build: Build): void {
  const count = build.positions.length / 3;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < count; v++) {
    const y = build.positions[v * 3 + 1] ?? 0;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(1e-3, maxY - minY);
  for (let v = 0; v < count; v++) {
    const p3 = v * 3;
    const t = ((build.positions[p3 + 1] ?? 0) - minY) / span;
    const shade = 0.55 + 0.45 * Math.min(1, t * 1.6);
    build.colors[p3] = shade;
    build.colors[p3 + 1] = shade;
    build.colors[p3 + 2] = shade;
  }
}
//#endregion
