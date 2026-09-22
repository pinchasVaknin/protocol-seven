#!/usr/bin/env node
/**
 * The weapon asset build (M19, stage 0).
 *
 * The viewmodels were primitives from `WeaponModelSpecs` since M2, and the five attachments
 * were numbers only: nothing on the gun changed when a suppressor went on. M19 moves the
 * weapons to GLB files behind the same `WeaponModel` contract, and mounts an attachment pack
 * on sockets each file carries. This script is where a Sketchfab download becomes a file that
 * contract can read — one recipe per output, and the recipe is the whole record of what was
 * taken from the source and where the sockets were measured.
 *
 * ## What a recipe does
 *
 * A source is a scene as the artist left it: the M4 kit is an assembled rifle with every
 * alternative part spread around it, the AK-74 pack is eight rifles in a row, the laser is a
 * box in inches lying on its side. A recipe names the nodes to keep, groups them under the
 * contract's names (`body`, `magazine`, `charge`, `optic_default`), and places the file in the
 * viewmodel's space — metres, the barrel down -Z, +Y up, the origin at the receiver — by
 * baking every kept node's world matrix through one fix. The sockets are empty nodes at
 * measured points: the bore at the barrel tip (`socket_muzzle`), the rail surface where an
 * optic sits (`socket_rail_top`), the handguard's top rail where the laser sits
 * (`socket_rail_front`), the rail under the handguard (`socket_rail_bottom`), the iron
 * sight line (`socket_sight`, whose Y is `WeaponModel.sightHeight`), and the two hands
 * (`socket_grip`, `socket_support`, where the first-person gloves and a body's palms go). A
 * pack part is the same recipe with its origin on the mating face, so mounting is
 * `socket.add(part)`.
 *
 * The measurements are taken from the vertices, not typed in: the bore is the mean of the
 * barrel's vertices at its tip, the rail is the top of the receiver. A number typed from a
 * screenshot drifts the first time the source is swapped; a number measured from the mesh
 * moves with it.
 *
 * ## The two passes
 *
 * 1. **The JSON chunk, edited directly.** A `.glb` is a header, a JSON chunk and a binary
 *    chunk; selecting, re-parenting, renaming and baking matrices is a rewrite of the JSON
 *    with the binary chunk carried through untouched, so the buffer views stay valid. Forty
 *    lines of matrix maths and no parser package — `glb-images.mjs` set that precedent.
 * 2. **`@gltf-transform/cli` at a pinned version through `npx`**, as `skin-compress.mjs` runs
 *    it and for the same reason (S2 admits no new package): `prune` drops everything the kept
 *    nodes do not reference, `dedup`, `resize` to 1024, `webp`; then `weld` and `simplify` for
 *    the bodies' LOD. The CLI cannot select or rename a node, which is why pass 1 exists.
 *
 * ## Running it
 *
 * Sources live outside the repository in `../GLB_files/weapons/` (the sibling of
 * `../FBX_files`, where the bodies came from) — 313 MB of downloads do not belong in git.
 * `node scripts/weapon-build.mjs` builds every recipe; `node scripts/weapon-build.mjs ar_carbine`
 * builds one. The outputs are committed like any other asset and `check:weapons` holds them to
 * the budget. Attribution is a condition of CC-BY, not a courtesy: every output carries its
 * source's title, author, licence and URL in `asset.extras`, and `CREDITS.md` beside the files
 * is regenerated from the same records. A Sketchfab download carries the same four facts in its
 * own `asset.extras`, and the build refuses a recipe whose record disagrees with its file — the
 * credit line is copied from the artist's upload, not typed from memory.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGlb } from './glb-images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = path.resolve(ROOT, '../GLB_files/weapons');
export const OUT_DIR = path.join(ROOT, 'public/models/weapons');
/** Pinned: the pass should produce the same bytes next year as today. */
const CLI = '@gltf-transform/cli@4.5.0';
const NPX_CLI = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');

/** The viewmodel's texture ceiling; the bodies' LOD takes a quarter of it. */
const MAX_SIDE = 1024;
const LOD_SIDE = 256;
const WEBP_QUALITY = 85;
/**
 * The LOD asks for this fraction of the vertices, with the error limit loose (a fraction of the
 * mesh radius). meshopt cannot collapse across UV seams and hard edges, and a kit mesh is
 * mostly seams — the M4 stalls at about a third whatever the ratio — so `check:weapons` holds
 * the result to 10k triangles rather than the 5k first written down, and the draw calls are
 * what `join` cuts: one primitive per material, five for the M4.
 */
const LOD_RATIO = 0.15;
const LOD_ERROR = 0.1;

// -- the sources ---------------------------------------------------------------

const M4_KIT = {
  file: 'free_-_m4_modular_kit_gun.glb',
  title: 'Free - M4 Modular Kit Gun',
  author: 'Karnaval',
  authorUrl: 'https://sketchfab.com/amadions',
  license: 'CC-BY-4.0',
  url: 'https://sketchfab.com/3d-models/free-m4-modular-kit-gun-1665416c071747bb9c20aa652849b579',
};
const AK74_PACK = {
  file: 'ak-74_pack_game_asset.glb',
  title: 'AK-74 Pack (game asset)',
  author: 'Armored Wave',
  authorUrl: 'https://sketchfab.com/armoredwave',
  license: 'CC-BY-4.0',
  url: 'https://sketchfab.com/3d-models/ak-74-pack-game-asset-29978f495f824173b44a3ba40cb8ebd8',
};
const DBAL_A2 = {
  file: 'rifle_laser_sight.glb',
  title: 'Rifle Laser Sight',
  author: 'trolosqlfod',
  authorUrl: 'https://sketchfab.com/trolosqlfod',
  license: 'CC-BY-4.0',
  url: 'https://sketchfab.com/3d-models/rifle-laser-sight-55d74d7d4f6a4071af856d2ffc2c429a',
};

// -- the recipes ---------------------------------------------------------------

/**
 * A selector names mesh nodes in the source. `name` matches the node or its parent (Sketchfab
 * exports put the mesh on a child called `defaultMaterial`), `material` the first primitive's
 * material; a selector must match exactly one node unless `all` is set.
 *
 * `forward` and `up` are the source's axes for the barrel and the top of the weapon, and the
 * fix rotates them onto -Z and +Y. `unit` is metres per source unit. `origin` and `sockets`
 * receive the measurements (`m`) and answer in source world space, before the fix.
 */
export const RECIPES = {
  ar_carbine: {
    kind: 'weapon',
    source: M4_KIT,
    unit: 0.01,
    forward: 'z+',
    up: 'y+',
    parts: {
      body: [
        { name: 'Upper', material: 'Body' },
        { name: 'Lower', material: 'Body' },
        { name: 'Handguard', material: 'Keymod_material' },
        { name: 'Grip', material: 'Grip_Default' },
        { name: 'Stock', material: 'Classic_Stock' },
        { name: 'Trigger', material: 'Body', pick: 'highest' },
      ],
      // The kit's assembled magazine; its "Large" is thicker, not longer, so the extended
      // magazine is the stretch, not a second mesh.
      magazine: [{ name: 'Magazine', material: 'Magazine_Light' }],
      charge: [],
      optic_default: [],
    },
    // The receiver's centre: the bore's height, the upper and lower's middle along the barrel.
    origin: (m) => {
      const bore = m.tip({ name: 'Handguard', material: 'Keymod_material' });
      const upper = m.bounds({ name: 'Upper', material: 'Body' });
      const lower = m.bounds({ name: 'Lower', material: 'Body' });
      return [0, bore[1], (Math.min(upper.min[2], lower.min[2]) + Math.max(upper.max[2], lower.max[2])) / 2];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'Handguard', material: 'Keymod_material' });
      const upper = m.bounds({ name: 'Upper', material: 'Body' });
      const guard = m.bounds({ name: 'Handguard', material: 'Keymod_material' });
      const grip = m.bounds({ name: 'Grip', material: 'Grip_Default' });
      // The rail surface: the receiver's top over its middle half, where no sight stands.
      const railTop = m.top({ name: 'Upper', material: 'Body' }, 0.35, 0.85);
      return {
        socket_muzzle: bore,
        // Over the receiver, where a red dot sits: the rear third of the rail.
        socket_rail_top: [0, railTop, upper.min[2] + (upper.max[2] - upper.min[2]) * 0.62],
        // Under the handguard, at the middle of its length.
        socket_rail_bottom: [0, guard.min[1], (guard.min[2] + guard.max[2]) / 2],
        // The handguard's top rail, forward of the optic and behind the front sight: the laser's.
        socket_rail_front: [0, m.top({ name: 'Handguard', material: 'Keymod_material' }, 0.2, 0.7), guard.min[2] + (guard.max[2] - guard.min[2]) * 0.45],
        // The irons' line: the aperture sits just under the sight's top edge.
        socket_sight: [0, upper.max[1] - 0.4, 0],
        // Where the hands go (stage 1). The trigger hand's centre sits on the pistol grip,
        // two fifths of the way down it; the support palm cups the handguard's underside a
        // little short of halfway along. The first-person gloves are built on these.
        socket_grip: [0, grip.max[1] - (grip.max[1] - grip.min[1]) * 0.4, (grip.min[2] + grip.max[2]) / 2],
        socket_support: [0, guard.min[1] - 1.8, guard.min[2] + (guard.max[2] - guard.min[2]) * 0.42],
      };
    },
    lod: true,
  },

  att_suppressor: {
    kind: 'attachment',
    source: M4_KIT,
    unit: 0.01,
    forward: 'z+',
    up: 'y+',
    parts: { part: [{ name: 'Suppressor', material: 'Suppressor' }] },
    // The rear face's centre: the face that meets the muzzle.
    origin: (m) => {
      const b = m.bounds({ name: 'Suppressor', material: 'Suppressor' });
      return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
    },
    sockets: (m) => {
      const b = m.bounds({ name: 'Suppressor', material: 'Suppressor' });
      // Where the flash leaves once the can is on: its front face.
      return { socket_muzzle: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]] };
    },
  },

  att_grip: {
    kind: 'attachment',
    source: M4_KIT,
    unit: 0.01,
    forward: 'z+',
    up: 'y+',
    parts: { part: [{ name: 'Front', material: 'Front_grip_vert' }] },
    // The top's centre: the face that meets the rail.
    origin: (m) => {
      const b = m.bounds({ name: 'Front', material: 'Front_grip_vert' });
      return [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];
    },
    sockets: () => ({}),
  },

  att_optic: {
    kind: 'attachment',
    source: AK74_PACK,
    unit: 1,
    forward: 'z-',
    up: 'y+',
    // The AimPoint Pro on the pack's tactical rifle: the tube, its glass and the reticle.
    parts: { part: [{ name: 'Cylinder.002', all: true }] },
    // The mount's underside, centred: the face that meets the rail.
    origin: (m) => {
      const b = m.bounds({ name: 'Cylinder.002', all: true });
      return [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
    },
    sockets: (m) => {
      const glass = m.bounds({ name: 'Cylinder.002', material: 'M_glass' });
      const b = m.bounds({ name: 'Cylinder.002', all: true });
      // The tube's axis: the sight line the ADS pose cancels once this is mounted.
      return { socket_sight: [(b.min[0] + b.max[0]) / 2, (glass.min[1] + glass.max[1]) / 2, (b.min[2] + b.max[2]) / 2] };
    },
  },

  att_laser: {
    kind: 'attachment',
    source: DBAL_A2,
    // Modelled in inches, lying on its side: its height runs along +Z, and the emitters face +X.
    unit: 0.0254,
    forward: 'x+',
    up: 'z+',
    parts: { part: [{ name: 'Object_4' }] },
    // The clamp's underside, centred.
    origin: (m) => {
      const b = m.bounds({ name: 'Object_4' });
      return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
    },
    sockets: () => ({}),
  },
};

// -- matrices, column-major as glTF stores them ---------------------------------

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return o;
}

function localMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function apply(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

const AXES = { 'x+': [1, 0, 0], 'x-': [-1, 0, 0], 'y+': [0, 1, 0], 'y-': [0, -1, 0], 'z+': [0, 0, 1], 'z-': [0, 0, -1] };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The fix: source world space to the viewmodel's. Translate the origin to zero, scale to
 * metres, then rotate the source's forward onto -Z and its up onto +Y. Rotation columns are
 * the images of the source's basis vectors, which for an orthonormal frame is the transpose
 * of the frame.
 */
function fixMatrix(recipe, origin) {
  const f = AXES[recipe.forward];
  const u = AXES[recipe.up];
  if (f === undefined || u === undefined) throw new Error(`unknown axis in recipe: ${recipe.forward} / ${recipe.up}`);
  const r = cross(f, u);
  // Rows of [f u r] are the source frame; R = [F U X] · [f u r]^T with F=-Z, U=+Y, X=+X.
  const F = [0, 0, -1], U = [0, 1, 0], X = [1, 0, 0];
  const R = new Array(16).fill(0);
  R[15] = 1;
  for (let col = 0; col < 3; col++) {
    // Image of source basis vector e_col = f[col]·F + u[col]·U + r[col]·X.
    for (let row = 0; row < 3; row++) R[col * 4 + row] = f[col] * F[row] + u[col] * U[row] + r[col] * X[row];
  }
  const s = recipe.unit;
  const S = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -origin[0], -origin[1], -origin[2], 1];
  return mul(mul(R, S), T);
}

// -- reading the source ----------------------------------------------------------

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** The positions of one primitive, as float triples, honouring the buffer view's stride. */
function* positions(glb, accessorIndex) {
  const { json, bin } = glb;
  const acc = json.accessors[accessorIndex];
  if (acc.componentType !== 5126 || acc.type !== 'VEC3') throw new Error('POSITION is not float VEC3');
  const view = json.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? COMPONENT_BYTES[acc.componentType] * TYPE_COUNT[acc.type];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    yield [bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)];
  }
}

class Source {
  constructor(glb) {
    this.glb = glb;
    this.json = glb.json;
    this.parent = new Map();
    this.json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => this.parent.set(c, i)));
    this.worlds = new Map();
  }

  world(i) {
    const cached = this.worlds.get(i);
    if (cached !== undefined) return cached;
    const local = localMatrix(this.json.nodes[i]);
    const p = this.parent.get(i);
    const w = p === undefined ? local : mul(this.world(p), local);
    this.worlds.set(i, w);
    return w;
  }

  materialName(node) {
    const mesh = this.json.meshes[node.mesh];
    const mat = mesh.primitives[0].material;
    return mat === undefined ? '' : (this.json.materials[mat].name ?? '');
  }

  /** Mesh node indices a selector names. */
  select(sel) {
    const hits = [];
    this.json.nodes.forEach((n, i) => {
      if (n.mesh === undefined) return;
      const parentName = this.parent.has(i) ? (this.json.nodes[this.parent.get(i)].name ?? '') : '';
      if (sel.name !== undefined && n.name !== sel.name && parentName !== sel.name) return;
      if (sel.material !== undefined && this.materialName(n) !== sel.material) return;
      hits.push(i);
    });
    if (hits.length === 0) throw new Error(`selector ${JSON.stringify(sel)} matched nothing`);
    if (sel.all) return hits;
    if (hits.length > 1 && sel.pick === 'highest') {
      hits.sort((a, b) => this.bounds({ index: b }).max[1] - this.bounds({ index: a }).max[1]);
      return [hits[0]];
    }
    if (hits.length > 1) throw new Error(`selector ${JSON.stringify(sel)} matched ${hits.length} nodes; add material, pick or all`);
    return hits;
  }

  /** World-space bounds of a selection, from the vertices. */
  bounds(sel) {
    const indices = sel.index !== undefined ? [sel.index] : this.select(sel);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const i of indices) {
      const m = this.world(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          for (let k = 0; k < 3; k++) {
            if (v[k] < min[k]) min[k] = v[k];
            if (v[k] > max[k]) max[k] = v[k];
          }
        }
      }
    }
    return { min, max };
  }

  /**
   * The highest point of a selection within a band along `forward` — the band given as
   * fractions of the selection's extent, rear to front. The rail surface is the top of the
   * receiver where nothing stands on it; the band leaves the flip-up sight out.
   */
  top(sel, forward, from, to) {
    const indices = this.select(sel);
    const axis = AXES[forward];
    const k = axis.findIndex((c) => c !== 0);
    const b = this.bounds(sel);
    const span = b.max[k] - b.min[k];
    const rear = axis[k] > 0 ? b.min[k] : b.max[k];
    const dir = axis[k];
    let best = -Infinity;
    for (const i of indices) {
      const m = this.world(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          const f = ((v[k] - rear) * dir) / span;
          if (f < from || f > to) continue;
          if (v[1] > best) best = v[1];
        }
      }
    }
    if (best === -Infinity) throw new Error(`top(${JSON.stringify(sel)}): no vertices in the band`);
    return best;
  }

  /**
   * The bore at the barrel's tip: the mean of the vertices within a sliver of the selection's
   * furthest extent along `forward`. A barrel ends in a ring; the ring's centre is the bore.
   */
  tip(sel, forward) {
    const indices = this.select(sel);
    const axis = AXES[forward];
    const k = axis.findIndex((c) => c !== 0);
    const sign = axis[k];
    const b = this.bounds(sel);
    const edge = sign > 0 ? b.max[k] : b.min[k];
    const sliver = (b.max[k] - b.min[k]) * 0.02;
    const sum = [0, 0, 0];
    let n = 0;
    for (const i of indices) {
      const m = this.world(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          if (Math.abs(v[k] - edge) > sliver) continue;
          for (let j = 0; j < 3; j++) sum[j] += v[j];
          n++;
        }
      }
    }
    if (n === 0) throw new Error(`tip(${JSON.stringify(sel)}): no vertices at the edge`);
    const out = sum.map((s) => s / n);
    out[k] = edge;
    return out;
  }
}

// -- the rewrite -----------------------------------------------------------------

function round(v) {
  return v.map((x) => Math.round(x * 1e6) / 1e6);
}

/**
 * The new node list: a root named for the output, one group per part list, the kept mesh
 * nodes under their groups with the fix baked into a `matrix`, and the sockets as empties
 * under the root. Everything else in the JSON — meshes, materials, textures, accessors — is
 * left in place for `prune` to sweep.
 */
function rewrite(id, recipe, src) {
  const forward = recipe.forward;
  const measure = {
    bounds: (sel) => src.bounds(sel),
    tip: (sel) => src.tip(sel, forward),
    top: (sel, from, to) => src.top(sel, forward, from, to),
  };
  const origin = recipe.origin(measure);
  const fix = fixMatrix(recipe, origin);
  const sockets = recipe.sockets(measure);

  const nodes = [];
  const root = { name: id, children: [] };
  nodes.push(root);

  const kept = [];
  for (const [group, selectors] of Object.entries(recipe.parts)) {
    const g = { name: group, children: [] };
    const gi = nodes.push(g) - 1;
    root.children.push(gi);
    for (const sel of selectors) {
      for (const i of src.select(sel)) {
        const n = src.json.nodes[i];
        const parentName = src.parent.has(i) ? src.json.nodes[src.parent.get(i)].name : undefined;
        const label = n.name && n.name !== 'defaultMaterial' ? n.name : (parentName ?? `node${i}`);
        const ni = nodes.push({ name: label, mesh: n.mesh, matrix: mul(fix, src.world(i)).map((x) => Math.round(x * 1e7) / 1e7) }) - 1;
        g.children.push(ni);
        kept.push(i);
      }
    }
  }

  const placed = {};
  for (const [name, point] of Object.entries(sockets)) {
    const t = round(apply(fix, point));
    placed[name] = t;
    root.children.push(nodes.push({ name, translation: t }) - 1);
  }

  const json = structuredClone(src.json);
  json.nodes = nodes;
  json.scenes = [{ name: id, nodes: [0] }];
  json.scene = 0;
  delete json.skins;
  delete json.animations;
  delete json.cameras;
  json.asset = json.asset ?? { version: '2.0' };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    attribution: { title: recipe.source.title, author: recipe.source.author, authorUrl: recipe.source.authorUrl, license: recipe.source.license, url: recipe.source.url },
    protocolSeven: { recipe: id, kind: recipe.kind, source: recipe.source.file, sockets: placed },
  };
  return { json, sockets: placed, kept, origin };
}

/**
 * The recipe's credit against the file's own. Sketchfab writes `author` as "Name (profile
 * URL)", `license` as "CC-BY-4.0 (deed URL)", `source` as the model page and `title` as
 * shown; a recipe that says otherwise is a typo in a legal record, and the build stops on it.
 */
function verifyAttribution(id, source, extras) {
  const problems = [];
  if (!extras) {
    problems.push('the source file carries no asset.extras; supply the credit by hand and note where it came from');
  } else {
    if (extras.title !== undefined && extras.title !== source.title) problems.push(`title: recipe "${source.title}", file "${extras.title}"`);
    if (extras.source !== undefined && extras.source !== source.url) problems.push(`url: recipe ${source.url}, file ${extras.source}`);
    if (extras.author !== undefined && extras.author !== `${source.author} (${source.authorUrl})`) problems.push(`author: recipe "${source.author} (${source.authorUrl})", file "${extras.author}"`);
    if (extras.license !== undefined && !extras.license.startsWith(source.license)) problems.push(`license: recipe ${source.license}, file "${extras.license}"`);
  }
  if (problems.length > 0) {
    throw new Error([`${id}: the recipe's attribution disagrees with ${source.file}:`, ...problems.map((p) => `  ${p}`)].join('\n'));
  }
}

/** Write a GLB: the 12-byte header, the JSON chunk padded with spaces, the binary chunk padded with zeros. */
function writeGlb(file, json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBytes.length + jsonPad, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  const binAt = 20 + jsonBytes.length + jsonPad;
  out.writeUInt32LE(bin.length + binPad, binAt);
  out.writeUInt32LE(0x004e4942, binAt + 4);
  bin.copy(out, binAt + 8);
  writeFileSync(file, out);
}

/** Put a root named for the output over a flattened scene, and the sockets under it. */
function reroot(from, to, id, sockets) {
  const glb = readGlb(from);
  const json = glb.json;
  const scene = json.scenes[json.scene ?? 0];
  const rootIndex = json.nodes.push({ name: id, children: [...scene.nodes] }) - 1;
  for (const [name, translation] of Object.entries(sockets)) {
    json.nodes[rootIndex].children.push(json.nodes.push({ name, translation }) - 1);
  }
  scene.nodes = [rootIndex];
  writeGlb(to, json, glb.bin);
}

// -- the CLI pass --------------------------------------------------------------------

function run(args) {
  execFileSync(process.execPath, [NPX_CLI, '--yes', CLI, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function triangles(json) {
  let n = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const count = prim.indices !== undefined ? json.accessors[prim.indices].count : json.accessors[prim.attributes.POSITION].count;
      if ((prim.mode ?? 4) === 4) n += count / 3;
    }
  }
  return Math.round(n);
}

export function buildOne(id, work) {
  const recipe = RECIPES[id];
  if (recipe === undefined) throw new Error(`no recipe "${id}"; known: ${Object.keys(RECIPES).join(', ')}`);
  const sourceFile = path.join(SOURCE_DIR, recipe.source.file);
  if (!existsSync(sourceFile)) throw new Error(`source ${path.relative(ROOT, sourceFile)} is missing; the sources live outside the repository`);

  const glb = readGlb(sourceFile);
  verifyAttribution(id, recipe.source, glb.json.asset?.extras);
  const src = new Source(glb);
  const { json, sockets, kept, origin } = rewrite(id, recipe, src);

  const staged = path.join(work, `${id}.staged.glb`);
  writeGlb(staged, json, glb.bin);
  const pruned = path.join(work, `${id}.pruned.glb`);
  run(['prune', staged, pruned, '--keep-leaves', 'true']);
  const deduped = path.join(work, `${id}.dedup.glb`);
  run(['dedup', pruned, deduped]);
  const resized = path.join(work, `${id}.resized.glb`);
  run(['resize', deduped, resized, '--width', String(MAX_SIDE), '--height', String(MAX_SIDE)]);
  const out = path.join(OUT_DIR, `${id}.glb`);
  run(['webp', resized, out, '--quality', String(WEBP_QUALITY)]);

  const report = { id, kept: kept.length, origin: round(origin), sockets, triangles: triangles(readGlb(out).json), bytes: statSync(out).size };

  if (recipe.lod) {
    const welded = path.join(work, `${id}.welded.glb`);
    run(['weld', deduped, welded]);
    const simplified = path.join(work, `${id}.simplified.glb`);
    run(['simplify', welded, simplified, '--ratio', String(LOD_RATIO), '--error', String(LOD_ERROR), '--lock-border', 'false']);
    // `join` flattens the scene to one primitive per material and drops the empties with it,
    // so the sockets go back in afterwards: a body at twenty metres still has a muzzle.
    const joined = path.join(work, `${id}.joined.glb`);
    run(['join', simplified, joined]);
    const rerooted = path.join(work, `${id}.rerooted.glb`);
    reroot(joined, rerooted, id, sockets);
    const small = path.join(work, `${id}.small.glb`);
    run(['resize', rerooted, small, '--width', String(LOD_SIDE), '--height', String(LOD_SIDE)]);
    const lod = path.join(OUT_DIR, `${id}.lod1.glb`);
    run(['webp', small, lod, '--quality', String(WEBP_QUALITY)]);
    report.lod1 = { triangles: triangles(readGlb(lod).json), bytes: statSync(lod).size };
  }
  return report;
}

/** `CREDITS.md`: one row per source, regenerated so the file cannot drift from the recipes. */
export function creditsMarkdown() {
  const bySource = new Map();
  for (const [id, r] of Object.entries(RECIPES)) {
    const list = bySource.get(r.source.url) ?? { source: r.source, outputs: [] };
    list.outputs.push(`${id}.glb`);
    bySource.set(r.source.url, list);
  }
  const rows = [...bySource.values()]
    .sort((a, b) => a.source.title.localeCompare(b.source.title))
    .map(({ source, outputs }) => `| [${source.title}](${source.url}) | [${source.author}](${source.authorUrl}) | ${source.license} | ${outputs.join(', ')} |`);
  return [
    '# Weapon model credits',
    '',
    'Every file in this folder is built by `scripts/weapon-build.mjs` from a Sketchfab source',
    'outside the repository. The licences below are conditions of use: CC-BY requires this',
    'attribution wherever the models are distributed, and each `.glb` carries the same record in',
    '`asset.extras.attribution`. This file is regenerated by the build; edit the recipes, not this.',
    '',
    '| Source | Author | Licence | Built files |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const ids = wanted.length > 0 ? wanted : Object.keys(RECIPES);
  mkdirSync(OUT_DIR, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'operator-weapons-'));
  try {
    for (const id of ids) {
      const r = buildOne(id, work);
      const lod = r.lod1 ? `; lod1 ${r.lod1.triangles.toLocaleString('en-US')} tris, ${(r.lod1.bytes / 1048576).toFixed(2)} MB` : '';
      console.log(`${id.padEnd(16)} ${r.kept} node(s), ${r.triangles.toLocaleString('en-US')} tris, ${(r.bytes / 1048576).toFixed(2)} MB${lod}`);
      console.log(`${''.padEnd(16)} origin ${JSON.stringify(r.origin)}; sockets ${JSON.stringify(r.sockets)}`);
    }
    writeFileSync(path.join(OUT_DIR, 'CREDITS.md'), creditsMarkdown());
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\nWrote ${ids.length} recipe(s) to ${path.relative(ROOT, OUT_DIR)}; now run npm run check:weapons.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
