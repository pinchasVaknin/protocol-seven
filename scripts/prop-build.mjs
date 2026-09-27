#!/usr/bin/env node
/**
 * The prop pieces (2026-09-27).
 *
 * `weapon-build.mjs` turns a Sketchfab download into a weapon: one source, one output, on a
 * contract of sockets and groups. A prop is a different job. The resupply station is **four
 * things from three models**, and the human arranges them by eye in `probes/prop-tuner.html`
 * the way they pose hands in the hand tuner — so what this builds is not the station, it is the
 * four pieces the station is made of, each on its own and each ready to be placed.
 *
 * ## What "ready to be placed" means
 *
 * Every piece comes out **in metres, upright, and standing on its own origin**: the origin is
 * the centre of its footprint at the height of its lowest vertex. So a piece at position
 * `[0, 0, 0]` sits on the ground with its middle over the mark, and the tuner's numbers are
 * pure placement — no piece carries a scale or a lift of its own that the next reader has to
 * know about.
 *
 * The size each is normalised to is its own real-world size, not a guess: an ammunition can is
 * 30 cm long because that is what a 7.62 can is. `scale` in the tuner is then a *correction*,
 * and a piece left at 1 is a piece at life size.
 *
 * ## Why a wrapper node rather than baked vertices
 *
 * The scale and the lift go on one node above the source's own scene. Nothing is re-welded, so
 * the file keeps exactly the geometry its author uploaded and the change is four numbers a
 * reader can see. The textures are taken to 512 WebP because four of these stand in one pile
 * two metres across, and 1024 on a crate nobody presses their face against is bytes spent on
 * nothing.
 *
 * Run: `node scripts/prop-build.mjs` — or with piece ids to build only those.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from './glb-images.mjs';
import { writeGlb } from './weapon-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, '../GLB_files/weapons');
export const PIECES_DIR = path.join(ROOT, 'public/models/props');

const CLI = '@gltf-transform/cli@4.5.0';
const NPX_CLI = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
const TEXTURE_SIDE = 512;
const WEBP_QUALITY = 85;

const CC_BY_4 = 'http://creativecommons.org/licenses/by/4.0/';

const SPECTER_CRATE = {
  file: 'wooden_ammo_crate_-_specter_rounds.glb',
  title: 'Wooden Ammo Crate - Specter Rounds',
  author: 'Andrew Jepson',
  authorUrl: 'https://sketchfab.com/ajepson',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/wooden-ammo-crate-specter-rounds-69401adea118441faa9b7978183cc657',
};
const DIRTY_CRATE = {
  file: 'dirty_wooden_crate.glb',
  title: 'Dirty wooden crate',
  author: 'AK',
  authorUrl: 'https://sketchfab.com/skaf13',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/dirty-wooden-crate-3c29fb738a864640aa1df42eb0e04c4e',
};
const AMMO_CAN = {
  file: 'ammo_box.glb',
  title: 'Ammo Box',
  author: 'murilojones',
  authorUrl: 'https://sketchfab.com/murilojones',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/ammo-box-7769cee68de94d56ab1f15065091e917',
};

/**
 * The pieces, and the size each is life size at.
 *
 * `longest` is the metres its longest **horizontal** axis comes out at — horizontal because
 * that is the measurement a crate is described by and the one a reader can check against a
 * photograph. Height follows from the source's own proportions and is never forced.
 */
export const PIECES = {
  crate_stand: { source: SPECTER_CRATE, longest: 1.05 },
  crate_open: { source: DIRTY_CRATE, longest: 1.0 },
  ammo_can: { source: AMMO_CAN, longest: 0.3 },
};

function run(args) {
  execFileSync(process.execPath, [NPX_CLI, '--yes', CLI, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// -- reading the source's geometry ------------------------------------------------

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

/** Column-major 4x4, as glTF stores them. */
function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
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

function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** World-space bounds of every mesh in the file. */
function bounds(glb) {
  const { json } = glb;
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const worlds = new Map();
  const world = (i) => {
    const cached = worlds.get(i);
    if (cached !== undefined) return cached;
    const p = parent.get(i);
    const m = p === undefined ? localMatrix(json.nodes[i]) : mul(world(p), localMatrix(json.nodes[i]));
    worlds.set(i, m);
    return m;
  };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  json.nodes.forEach((node, i) => {
    if (node.mesh === undefined) return;
    const m = world(i);
    for (const prim of json.meshes[node.mesh].primitives) {
      for (const p of positions(glb, prim.attributes.POSITION)) {
        const v = apply(m, p);
        for (let k = 0; k < 3; k++) {
          if (v[k] < min[k]) min[k] = v[k];
          if (v[k] > max[k]) max[k] = v[k];
        }
      }
    }
  });
  return { min, max };
}

// -- the build --------------------------------------------------------------------

/**
 * Wrap the source's scene in one node that scales it to life size and stands it on the origin.
 *
 * The node is named for the piece, so a reader opening the file — or the tuner, or the
 * assembler — finds the piece by the id it is known by rather than by whatever the artist
 * called their collection.
 */
function normalise(id, piece, glb) {
  const { json } = glb;
  const { min, max } = bounds(glb);
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const scale = piece.longest / Math.max(size[0], size[2]);
  // The centre of the footprint, at the lowest vertex: the point the piece stands on.
  const anchor = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const scene = json.scenes[json.scene ?? 0];
  const root = {
    name: id,
    children: [...scene.nodes],
    matrix: [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, -anchor[0] * scale, -anchor[1] * scale, -anchor[2] * scale, 1],
  };
  const index = json.nodes.push(root) - 1;
  json.scenes = [{ name: `${id}.scene`, nodes: [index] }];
  json.scene = 0;
  json.asset = json.asset ?? { version: '2.0' };
  const s = piece.source;
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    attribution: { title: s.title, author: s.author, authorUrl: s.authorUrl, license: s.license, licenseUrl: s.licenseUrl, url: s.url },
    protocolSeven: { piece: id, source: s.file, metres: size.map((v) => Math.round(v * scale * 1000) / 1000) },
  };
  return { scale, size: size.map((v) => v * scale) };
}

function buildOne(id, work) {
  const piece = PIECES[id];
  if (piece === undefined) throw new Error(`no piece "${id}"; known: ${Object.keys(PIECES).join(', ')}`);
  const glb = readGlb(path.join(SOURCE_DIR, piece.source.file));
  const { size } = normalise(id, piece, glb);

  const staged = path.join(work, `${id}.staged.glb`);
  writeGlb(staged, glb.json, Buffer.from(glb.bin));
  const deduped = path.join(work, `${id}.dedup.glb`);
  run(['dedup', staged, deduped]);
  const resized = path.join(work, `${id}.resized.glb`);
  run(['resize', deduped, resized, '--width', String(TEXTURE_SIDE), '--height', String(TEXTURE_SIDE)]);
  const out = path.join(PIECES_DIR, `${id}.glb`);
  run(['webp', resized, out, '--quality', String(WEBP_QUALITY)]);
  return { id, size, bytes: statSync(out).size };
}

function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const ids = wanted.length > 0 ? wanted : Object.keys(PIECES);
  mkdirSync(PIECES_DIR, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'operator-props-'));
  try {
    for (const id of ids) {
      const r = buildOne(id, work);
      const dims = r.size.map((v) => v.toFixed(2)).join(' x ');
      console.log(`${id.padEnd(14)} ${dims} m   ${(r.bytes / 1048576).toFixed(2)} MB`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\nWrote ${ids.length} piece(s) to ${path.relative(ROOT, PIECES_DIR)}; open probes/prop-tuner.html to arrange them.`);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) main();
