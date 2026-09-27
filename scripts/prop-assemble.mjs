#!/usr/bin/env node
/**
 * The station assembler (2026-09-27).
 *
 * `prop-build.mjs` normalises the pieces; `probes/prop-tuner.html` is where the human arranges
 * them; this is what turns that arrangement into the two things the game needs — **the model
 * and the collision** — from the one set of numbers.
 *
 * ## Why both come out of here
 *
 * The first station was laid out in Blender and its collision was four boxes measured off the
 * result by hand. That is two descriptions of one pile, and two descriptions drift: a nudge to
 * the model with no matching nudge to the boxes is a crate you can see and walk through, or a
 * wall where there is nothing. Here the boxes are the *transformed bounds of the very geometry
 * that was welded*, computed in the same pass, so they cannot disagree with it.
 *
 * ## What it does not do
 *
 * It does not re-centre the pile. `STATION_PIECES` is the human's arrangement and the origin
 * they arranged it around is the point the supply marker sits on and the player kneels at —
 * moving the model to balance its own bounding box would move the pile off the mark it was
 * designed against. The footprint is printed instead, so an origin that ended up somewhere
 * surprising is visible rather than silently corrected.
 *
 * Run: `node scripts/prop-assemble.mjs`. It prints the `PROP_SHAPES.ammoCrate` parts to paste
 * into `src/shared/world/maps/props.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from './glb-images.mjs';
import { writeGlb } from './weapon-build.mjs';
import { PIECES, PIECES_DIR } from './prop-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(PIECES_DIR, 'station_ammo.glb');

const CLI = '@gltf-transform/cli@4.5.0';
const NPX_CLI = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');

/**
 * The arrangement, posed by the human in the prop tuner (2026-09-27).
 *
 * Position in metres, rotation in degrees applied **YXZ** — the order the tuner used, so the
 * numbers mean here exactly what they meant on screen — and one uniform scale. The stand is at
 * 2.5 and the cans at 1.5 because the pieces are normalised to their real-world sizes and this
 * station is not a real-world one: it reads at the distance a player has to recognise it from.
 *
 * Two entries share `ammo_can`. That is why an item has an id of its own and why the merge
 * below clones nodes rather than files: one can's geometry, in two places.
 */
export const STATION_PIECES = [
  { id: 'stand', piece: 'crate_stand', position: [0.0, 0.0, -0.45], rotation: [0.0, 4.0, 0.0], scale: 2.5 },
  { id: 'open', piece: 'crate_open', position: [1.05, 0.0, 0.39], rotation: [0.0, -19.0, 0.0], scale: 1.0 },
  { id: 'can_a', piece: 'ammo_can', position: [-0.93, 0.0, 0.105], rotation: [0.0, 118.0, 0.0], scale: 1.5 },
  { id: 'can_b', piece: 'ammo_can', position: [-0.755, 0.0, -0.05], rotation: [0.0, 118.0, 0.0], scale: 1.5 },
];

/** What a collider is allowed to be shaved by, metres: a box tight to the mesh snags a shoulder. */
const COLLIDER_SHRINK = 0.01;

function run(args) {
  execFileSync(process.execPath, [NPX_CLI, '--yes', CLI, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// -- matrices ---------------------------------------------------------------------------

const DEG2RAD = Math.PI / 180;

/** Column-major 4x4, as glTF stores them. */
function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

const rotX = (t) => [1, 0, 0, 0, 0, Math.cos(t), Math.sin(t), 0, 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 0, 1];
const rotY = (t) => [Math.cos(t), 0, -Math.sin(t), 0, 0, 1, 0, 0, Math.sin(t), 0, Math.cos(t), 0, 0, 0, 0, 1];
const rotZ = (t) => [Math.cos(t), Math.sin(t), 0, 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * The item's placement as one matrix.
 *
 * **YXZ**, because that is the order `THREE.Euler` was given in the tuner and the numbers were
 * chosen against what it drew. Getting this order wrong would put every piece somewhere
 * plausible and nowhere right, which is the kind of wrong that survives a review.
 */
function placement(item) {
  const [x, y, z] = item.position;
  const [rx, ry, rz] = item.rotation;
  const r = mul(mul(rotY(ry * DEG2RAD), rotX(rx * DEG2RAD)), rotZ(rz * DEG2RAD));
  const s = item.scale;
  const m = r.map((v, i) => (i % 4 === 3 || i >= 12 ? v : v * s));
  m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
}

function localMatrix(node) {
  if (node.matrix !== undefined) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[c * 4 + k] *= [sx, sy, sz][c];
  m[12] = tx; m[13] = ty; m[14] = tz;
  return m;
}

const applyPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// -- reading geometry -------------------------------------------------------------------

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function* positions(glb, accessorIndex) {
  const { json, bin } = glb;
  const acc = json.accessors[accessorIndex];
  const view = json.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? COMPONENT_BYTES[acc.componentType] * TYPE_COUNT[acc.type];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    yield [bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)];
  }
}

// -- the merge --------------------------------------------------------------------------

/**
 * Append `src` into `dst`, offsetting every index it holds, and answer where its scene's roots
 * landed.
 *
 * Mechanical and complete: accessors, buffer views, meshes, materials, textures, images and
 * samplers each get their own offset, and the binary chunk is concatenated on a four-byte
 * boundary because that is what the format asks for and a one-byte slip corrupts everything
 * after it. Nothing is re-welded and no vertex is touched — a piece in the output is byte for
 * byte the piece that went in, under a different node.
 */
function append(dst, src) {
  const off = {
    accessor: dst.json.accessors.length,
    bufferView: dst.json.bufferViews.length,
    mesh: dst.json.meshes.length,
    material: (dst.json.materials ?? []).length,
    texture: (dst.json.textures ?? []).length,
    image: (dst.json.images ?? []).length,
    sampler: (dst.json.samplers ?? []).length,
    node: dst.json.nodes.length,
  };
  const pad = (4 - (dst.bin.length % 4)) % 4;
  const binOffset = dst.bin.length + pad;
  dst.bin = Buffer.concat([dst.bin, Buffer.alloc(pad), src.bin]);

  for (const v of src.json.bufferViews ?? []) dst.json.bufferViews.push({ ...v, byteOffset: (v.byteOffset ?? 0) + binOffset });
  for (const a of src.json.accessors ?? []) dst.json.accessors.push({ ...a, bufferView: a.bufferView + off.bufferView });
  for (const s of src.json.samplers ?? []) (dst.json.samplers ??= []).push({ ...s });
  for (const im of src.json.images ?? []) {
    const next = { ...im };
    if (next.bufferView !== undefined) next.bufferView += off.bufferView;
    (dst.json.images ??= []).push(next);
  }
  for (const t of src.json.textures ?? []) {
    const next = { ...t };
    if (next.source !== undefined) next.source += off.image;
    if (next.sampler !== undefined) next.sampler += off.sampler;
    (dst.json.textures ??= []).push(next);
  }
  const retarget = (slot) => (slot === undefined ? undefined : { ...slot, index: slot.index + off.texture });
  for (const m of src.json.materials ?? []) {
    const next = structuredClone(m);
    if (next.pbrMetallicRoughness !== undefined) {
      const p = next.pbrMetallicRoughness;
      p.baseColorTexture = retarget(p.baseColorTexture);
      p.metallicRoughnessTexture = retarget(p.metallicRoughnessTexture);
    }
    next.normalTexture = retarget(next.normalTexture);
    next.occlusionTexture = retarget(next.occlusionTexture);
    next.emissiveTexture = retarget(next.emissiveTexture);
    (dst.json.materials ??= []).push(next);
  }
  for (const mesh of src.json.meshes ?? []) {
    const next = structuredClone(mesh);
    for (const prim of next.primitives) {
      for (const [k, v] of Object.entries(prim.attributes)) prim.attributes[k] = v + off.accessor;
      if (prim.indices !== undefined) prim.indices += off.accessor;
      if (prim.material !== undefined) prim.material += off.material;
    }
    dst.json.meshes.push(next);
  }
  for (const node of src.json.nodes ?? []) {
    const next = structuredClone(node);
    if (next.mesh !== undefined) next.mesh += off.mesh;
    if (next.children !== undefined) next.children = next.children.map((c) => c + off.node);
    dst.json.nodes.push(next);
  }
  const scene = src.json.scenes[src.json.scene ?? 0];
  return scene.nodes.map((i) => i + off.node);
}

/**
 * Deep-copy a node subtree, sharing its meshes. Two cans, one can's geometry.
 *
 * Only ever for a **repeat** use: the first item that wants a piece takes that piece's own
 * root, so nothing is left behind. A clone for every item instead orphaned the originals, and
 * an orphan is not a harmless leftover — `prune` kept them (they are still referenced by their
 * own children) and Blender's importer walks every node rather than the scene, so the file
 * measured 200 units across in one reader and 2.9 metres in another.
 */
function cloneSubtree(json, index) {
  const src = json.nodes[index];
  const copy = { ...src };
  delete copy.children;
  const at = json.nodes.push(copy) - 1;
  if (src.children !== undefined) json.nodes[at].children = src.children.map((c) => cloneSubtree(json, c));
  return at;
}

/** World bounds of a node subtree under `parent`. */
function subtreeBounds(glb, index, parent) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const walk = (i, m) => {
    const node = glb.json.nodes[i];
    const world = mul(m, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of glb.json.meshes[node.mesh].primitives) {
        for (const p of positions(glb, prim.attributes.POSITION)) {
          const v = applyPoint(world, p);
          for (let k = 0; k < 3; k++) {
            if (v[k] < min[k]) min[k] = v[k];
            if (v[k] > max[k]) max[k] = v[k];
          }
        }
      }
    }
    for (const c of node.children ?? []) walk(c, world);
  };
  walk(index, parent);
  return { min, max };
}

// -- the build --------------------------------------------------------------------------

function main() {
  mkdirSync(PIECES_DIR, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'operator-station-'));
  try {
    // One read per distinct piece; the roots it landed on are reused by every item that wants it.
    const used = [...new Set(STATION_PIECES.map((i) => i.piece))];
    const first = readGlb(path.join(PIECES_DIR, `${used[0]}.glb`));
    const dst = { json: structuredClone(first.json), bin: Buffer.from(first.bin) };
    dst.json.buffers = [{ byteLength: 0 }];
    const rootsOf = new Map();
    rootsOf.set(used[0], dst.json.scenes[dst.json.scene ?? 0].nodes.slice());
    for (const piece of used.slice(1)) {
      rootsOf.set(piece, append(dst, readGlb(path.join(PIECES_DIR, `${piece}.glb`))));
    }

    const parts = [];
    const sceneRoots = [];
    /** Pieces already standing in the scene; the next item that wants one gets a clone. */
    const usedOnce = new Set();
    const whole = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const item of STATION_PIECES) {
      const matrix = placement(item);
      const taken = usedOnce.has(item.piece);
      usedOnce.add(item.piece);
      const children = rootsOf.get(item.piece).map((i) => (taken ? cloneSubtree(dst.json, i) : i));
      const wrapper = { name: item.id, children, matrix: matrix.map((v) => Math.round(v * 1e7) / 1e7) };
      const at = dst.json.nodes.push(wrapper) - 1;
      sceneRoots.push(at);

      // The collider: this item's own geometry, through this item's own placement.
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const c of children) {
        const b = subtreeBounds(dst, c, matrix);
        for (let k = 0; k < 3; k++) {
          box.min[k] = Math.min(box.min[k], b.min[k]);
          box.max[k] = Math.max(box.max[k], b.max[k]);
        }
      }
      for (let k = 0; k < 3; k++) {
        whole.min[k] = Math.min(whole.min[k], box.min[k]);
        whole.max[k] = Math.max(whole.max[k], box.max[k]);
      }
      parts.push({ id: item.id, box });
    }

    dst.json.scenes = [{ name: 'station_ammo.scene', nodes: sceneRoots }];
    dst.json.scene = 0;
    dst.json.asset = dst.json.asset ?? { version: '2.0' };
    dst.json.asset.extras = {
      attribution: used.map((id) => {
        const s = PIECES[id].source;
        return { title: s.title, author: s.author, authorUrl: s.authorUrl, license: s.license, licenseUrl: s.licenseUrl, url: s.url };
      }),
      protocolSeven: { prop: 'station_ammo', pieces: STATION_PIECES.map((i) => i.id) },
    };

    const staged = path.join(work, 'station.glb');
    // The buffer's length is part of the format: a `byteLength` of 0 tells a reader the binary
    // chunk is empty, and some of them believe it.
    dst.json.buffers = [{ byteLength: dst.bin.length }];
    writeGlb(staged, dst.json, dst.bin);
    // `prune` drops what no item kept; `dedup` merges the can's two copies back to one set.
    const pruned = path.join(work, 'station.pruned.glb');
    run(['prune', staged, pruned]);
    run(['dedup', pruned, OUT]);

    const tri = (json) => {
      let n = 0;
      for (const m of json.meshes ?? []) for (const p of m.primitives) n += ((p.indices !== undefined ? json.accessors[p.indices].count : 0) / 3);
      return Math.round(n);
    };
    const out = readGlb(OUT);
    const f = (v) => v.map((x) => x.toFixed(2)).join(', ');
    console.log(`station_ammo  ${tri(out.json).toLocaleString('en-US')} tris, ${(statSync(OUT).size / 1048576).toFixed(2)} MB`);
    console.log(`  footprint   x [${f([whole.min[0], whole.max[0]])}]  y [${f([whole.min[1], whole.max[1]])}]  z [${f([whole.min[2], whole.max[2]])}]`);
    console.log(`  size        ${(whole.max[0] - whole.min[0]).toFixed(2)} x ${(whole.max[1] - whole.min[1]).toFixed(2)} x ${(whole.max[2] - whole.min[2]).toFixed(2)} m`);
    console.log('');
    console.log('// paste into PROP_SHAPES.ammoCrate in src/shared/world/maps/props.ts');
    for (const { id, box } of parts) {
      const c = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
      const s = [0, 1, 2].map((k) => Math.max(0.02, box.max[k] - box.min[k] - COLLIDER_SHRINK));
      // Y is measured from the ground the prop stands on, so the box keeps its own base.
      c[1] = box.min[1] + s[1] / 2;
      const n3 = (v) => Number(v.toFixed(3));
      console.log(
        `  { offset: { x: ${n3(c[0])}, y: ${n3(c[1])}, z: ${n3(c[2])} }, ` +
          `size: { x: ${n3(s[0])}, y: ${n3(s[1])}, z: ${n3(s[2])} }, material: 'metal', solid: true, hidden: true }, // ${id}`,
      );
    }
  } finally {
    // `PROP_KEEP_WORK=1` leaves the intermediates where they can be opened, which is how the
    // wrapper matrices were found to be going missing between the weld and the CLI passes.
    if (process.env.PROP_KEEP_WORK === '1') console.log(`
work kept at ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) main();
