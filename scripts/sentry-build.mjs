#!/usr/bin/env node
/**
 * The sentry gun's model (2026-09-28).
 *
 * `prop-build.mjs` normalises scenery, which has no moving parts; `weapon-build.mjs` builds
 * things that go in a hand, on the contract of eight sockets. A sentry is neither. It is the
 * first **articulated** model in the game: a base that stands still, a collar that yaws and a
 * gun that pitches, driven every frame from two numbers `shared/streaks/SentryGun.ts` computes.
 * So it gets its own pass, and the pass's whole job is to turn one artist's scene into those
 * three nodes under names the client can rely on.
 *
 * ## Why this source needed almost no surgery
 *
 * Leonardo Carvalho's turret was authored for exactly this and says so on its Sketchfab page —
 * *"3 separated objects (top, neck, bottom) with singular origins each one"*. The file bears it
 * out: `Swivel` and `MGMain` carry no geometry offset of their own, only a translation, and
 * their vertices are written **relative to that translation**. The two translations are the yaw
 * axis and the trunnion, placed by the person who modelled the gun. Nothing here computes a
 * pivot, because computing one would be second-guessing a measurement already in the file.
 *
 * The one structural change is parentage. In the source `Swivel` and `MGMain` are *siblings*,
 * which is right for a turntable in a modelling package and wrong for a scene graph: the gun
 * has to inherit the collar's yaw or it stays pointing north while the mount turns. So `MGMain`
 * moves under `Swivel` and its translation is rebased onto it — a subtraction, and the same
 * trunnion.
 *
 * ## The two things the source did not come with
 *
 * **A cold paint.** The albedo is not an unwrapped atlas, it is a tiled grunge sheet — one
 * square of rusted steel that every UV island samples. Measured, its mean is `#2b2823`:
 * already dark and nearly grey (11% saturation), so the model was never loud. But it leans
 * *warm* — R exceeds B by 9 — where every other piece of hardware in the game is cold, down to
 * the `0x2b3038` the procedural legs were painted. `repaint` rotates that lean without
 * touching anything else: each pixel is pulled toward its own luminance times the gunmetal
 * hue, so the rust, the scratches and the weld seams all survive and only the cast moves.
 *
 * **Somewhere to put the team colour.** A tiled sheet has nowhere to paint a lamp — a pixel
 * changed once appears everywhere the sheet repeats — so the IFF light has to be geometry.
 * `band()` generates a strip that wraps the mount, on a material of its own called `iff`, and
 * `client/streaks/SentryMesh.ts` is what gives it a colour.
 *
 * It goes round the **tripod's neck**, not the `Swivel` collar it was first built on: the gun
 * body overhangs that collar on every side, and a light there was invisible from all four
 * quarters — checked in `probes/sentry-check.html` before it was moved. The neck below it is
 * clear from every horizontal direction, which is the only property an IFF marker has to have.
 * It also means the band belongs to the base and does not turn with the gun, which is right:
 * it answers *whose* turret this is, and that does not change when the turret traverses.
 *
 * The strip is the offset hull of the mount's own cross-section rather than a circle or an
 * ellipse, because the neck is a tapered square column and the collar above it is a rounded
 * block — one radius cannot hug both. `sliceHull` takes the silhouette at the band's own
 * height and `band` walks it outward along mitred normals, so the strip fits whatever it is
 * wrapped around and would still fit if the model were replaced.
 *
 * The armour itself stays neutral, which is the point: the brief asks for a turret you can
 * read the owner of, not a turret painted the owner's colour. It is also what
 * `StreakMeshes.ts` already argued for — *"the emissive points on a body are the IFF tell"*.
 *
 * Run: `node scripts/sentry-build.mjs`. The source lives outside the repository, beside it in
 * `../GLB_files/weapons/`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from './glb-images.mjs';
import { writeGlb } from './weapon-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(ROOT, '../GLB_files/weapons');
const PROPS_DIR = path.join(ROOT, 'public/models/props');

const CLI = '@gltf-transform/cli@4.5.0';
const NPX_CLI = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
const TEXTURE_SIDE = 512;
const WEBP_QUALITY = 85;

/** The id the file is built under, and the name of its root node. */
export const SENTRY_ID = 'sentry_turret';

/**
 * The source.
 *
 * **Sketchfab Free Standard, not CC-BY** — the one model in the game's turret shortlist that
 * is not, and it was taken anyway for the reason `smg_wasp` and `knife` were: the licence
 * permits commercial use and asks for credit, which this project gives every model whether the
 * licence demands it or not. The CC-BY alternative (`seangorman`'s 'Darwin' auto cannon) is a
 * single welded mesh with no pivots in it at all.
 */
export const SENTRY_SOURCE = {
  file: 'fixed_machine_gun_turret.glb',
  title: 'Fixed Machine Gun (Turret)',
  author: 'Leonardo Carvalho',
  authorUrl: 'https://sketchfab.com/livrosparacriancas',
  license: 'SKETCHFAB Standard',
  licenseUrl: 'https://sketchfab.com/licenses',
  url: 'https://sketchfab.com/3d-models/fixed-machine-gun-turret-282a894d2a594db79b4a1e95e0cb09e0',
};

/**
 * How tall the turret stands, in metres.
 *
 * Not a look: `SENTRY_RIG` in `shared/streaks/SentryGun.ts` is 0.89 m from the ground to the
 * top of the body box, and the model is the thing a player aims at. At this height the source's
 * own proportions put the gun mass at 0.50–0.89 m, which is the rig's body box (0.47–0.89) to
 * within three centimetres — so the hitboxes were not moved to fit the model and did not need
 * to be. The tripod's feet and the muzzle do reach past the boxes; a shot through a leg misses,
 * which is the same bargain every box collider in this game makes.
 */
const HEIGHT_M = 0.89;

/**
 * The cold the repaint pulls toward, and how hard.
 *
 * `0x2b3038` is not a new colour: it is the literal `StreakMeshes.ts` painted the procedural
 * legs, so the model arrives in the palette the thing it replaces already had. The strength is
 * high because the correction is small — the source is 11% saturated, so even at 0.8 the
 * texture keeps every mark on it and only the warm cast goes.
 */
const GUNMETAL = [0x2b, 0x30, 0x38];
const REPAINT = 0.8;

/**
 * How far the armour is lifted out of the dark, as the exponent of `1 - (1 - v)^LIFT`.
 *
 * The source is a **black** gun: its albedo means `#2b2823`, a value of 16%, which is paint
 * for a model lit by an HDRI in a turntable render. This game lights a grey-box map with a
 * hemisphere and a key and has no environment at all, and a human looking at the turret on a
 * bright testbed floor could not find it. Fixing the metalness got its shape back (see
 * `METAL_FACTOR`) and left it still reading darker than the concrete under it — measured in
 * `probes/sentry-check.html`, which samples what the thing actually renders at rather than
 * asking someone to judge it: the floor came out at 61 of 255 and the gun body at 29.
 *
 * A screen curve rather than a multiply, because a multiply on a 16% albedo needs a factor
 * that clips every rivet and weld seam the texture has. This one lifts the low end hardest and
 * asymptotes at white, so the marks survive the move: the mean goes 41 -> ~105 and nothing in
 * the image reaches 255. It is applied per channel after the tint, which on a texture this
 * close to grey keeps the cold cast and only washes the saturation out by a point or two.
 *
 * Set it to 1 to ship the artist's own values.
 */
const LIFT = 2.9;

/**
 * Taming the source's metal, which is why the turret rendered black (2026-09-28).
 *
 * A human looked at it in a bright testbed and could barely find it against a lit floor. It
 * was not the repaint — that moved the albedo's luminance by 0.3 of a unit out of 255. It was
 * the material: the source declares **no `metallicFactor`**, so glTF's default 1.0 applies, and
 * its metalness map averages **0.927** with 69% of its pixels above 0.94. In a
 * `MeshStandardMaterial` the diffuse response scales with `1 - metalness`, and this project has
 * no environment map anywhere, so the turret kept about 7% of an albedo that was already dark
 * and reflected nothing in place of the rest.
 *
 * `WeaponMesh.ts` wrote this down the first time it happened: *"A physically honest 0.85 metal
 * has almost no diffuse response and gets nearly all its colour from reflections — with no
 * environment map in the scene there is nothing to reflect, and the gun renders black."* Every
 * material in the project sits between 0.02 and 0.6 for that reason, and its gunmetal is 0.3.
 *
 * So the factor is set so the **product** with the map lands there — 0.32 × 0.927 ≈ 0.30 — and
 * `KHR_materials_specular` goes with it, because the source sets `specularFactor: 0` and a
 * surface that is now mostly dielectric with its dielectric highlight switched off is flat
 * paint. Roughness comes down to the project's gunmetal too: the map's green channel is a
 * saturated 1.0 everywhere, so the factor was the whole story and 0.67 was simply matte.
 *
 * Fixed here rather than in `SentryMesh` because it is a fact about the asset, not about the
 * renderer: a viewer opening the file should see the turret the game sees. `weapon-build.mjs`
 * strips `KHR_materials_transmission` from imported materials for the same kind of reason.
 */
const METAL_FACTOR = 0.32;
const ROUGHNESS_FACTOR = 0.44;
const DROP_EXTENSIONS = ['KHR_materials_specular'];

/**
 * The IFF band, in the source's own units, round the shoulder plate of the mount.
 *
 * `bottom`/`top` bracket the plate at y 3.9 — the widest ring on the tripod, 12.2 by 9.4, and
 * therefore the one ring nothing on the model can hide. That is the whole reason for the
 * height: a band lower down the column is under the plate's overhang, and a player looks
 * *down* at a turret 0.89 m tall, so an overhung light is a light that is never seen. Because
 * the hull is measured over this same slab it comes out as the plate's own outline, and the
 * strip hugs its rim instead of floating around the narrower column beneath.
 *
 * `clearance` is how far proud of the armour it stands: 0.3 of a unit is 7 mm at the built
 * scale — enough to catch its own silhouette, not enough to look bolted on.
 */
const BAND = { bottom: 3.5, top: 4.25, clearance: 0.3 };

/**
 * The node names the client binds to. `SentryMesh.ts` looks up exactly these.
 *
 * Exported because `check-props.mjs` holds the built file to them and holds
 * `client/streaks/SentryModel.ts` to the same strings. The client names only the two it turns;
 * this is the whole contract, which is what a file has to carry.
 */
export const SENTRY_NODES = {
  base: `${SENTRY_ID}_base`,
  yaw: `${SENTRY_ID}_yaw`,
  pitch: `${SENTRY_ID}_pitch`,
  iff: `${SENTRY_ID}_iff`,
};
/** The material the client recolours. Named, not indexed: `dedup` may reorder materials. */
export const SENTRY_IFF_MATERIAL = 'iff';

const { base: BASE, yaw: YAW, pitch: PITCH, iff: IFF } = SENTRY_NODES;
const IFF_MATERIAL = SENTRY_IFF_MATERIAL;

// -- matrices ------------------------------------------------------------------------

/** Column-major 4×4, as glTF stores them. */
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

function worldMatrices(json) {
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const cache = new Map();
  const world = (i) => {
    if (cache.has(i)) return cache.get(i);
    const p = parent.get(i);
    const m = p === undefined ? localMatrix(json.nodes[i]) : mul(world(p), localMatrix(json.nodes[i]));
    cache.set(i, m);
    return m;
  };
  return world;
}

/**
 * The translation of a world matrix, with an assertion that it is *only* a translation.
 *
 * The source wraps its scene in two nodes that rotate ±90° about X and cancel, so every pivot
 * below them is a plain offset. That cancellation is the assumption the whole rebase rests on,
 * and it is worth a throw rather than a silently rotated turret if a future re-export breaks it.
 */
function pivotOf(m, label) {
  const basis = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < 9; i++) {
    if (Math.abs(basis[i] - identity[i]) > 1e-5) {
      throw new Error(`${label} is rotated or scaled in the source (basis ${basis.map((v) => v.toFixed(3)).join(',')}); the rebase assumes a plain offset.`);
    }
  }
  return [m[12], m[13], m[14]];
}

// -- reading the source's geometry ---------------------------------------------------

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

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

/** Bounds of one mesh's vertices, in the space the mesh is written in. */
function meshBounds(glb, meshIndex) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const prim of glb.json.meshes[meshIndex].primitives) {
    for (const p of positions(glb, prim.attributes.POSITION)) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
  }
  return { min, max };
}

// -- the repaint ---------------------------------------------------------------------

const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * An 8-bit non-interlaced PNG, decoded on `node:zlib` alone.
 *
 * S2 admits no new package and this needs no new package: a PNG is chunks, one inflate and a
 * per-scanline filter to undo. `glb-images.mjs` reads the same files far enough to measure
 * them; this is the twenty further lines that let a pass change a pixel.
 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8, header = null, palette = null;
  const idat = [];
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (header === null) throw new Error('PNG has no IHDR');
  if (header.depth !== 8) throw new Error(`PNG bit depth ${header.depth} is not supported`);
  if (header.interlace !== 0) throw new Error('interlaced PNG is not supported');
  const channels = PNG_CHANNELS[header.colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev === null ? 0 : prev[i];
      const c = prev === null || i < channels ? 0 : prev[i - channels];
      let v = row[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  if (header.colorType === 3) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = palette[out[i] * 3];
      rgb[i * 3 + 1] = palette[out[i] * 3 + 1];
      rgb[i * 3 + 2] = palette[out[i] * 3 + 2];
    }
    return { width, height, channels: 3, data: rgb };
  }
  return { width, height, channels, data: out };
}

let CRC_TABLE = null;
function crc32(buf) {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Filter 0 on every row: `resize` re-encodes this image minutes later, so deflate is enough. */
function encodePng({ width, height, channels, data }) {
  const colorType = channels === 3 ? 2 : channels === 4 ? 6 : channels === 1 ? 0 : 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rec. 709 luminance — the quantity the repaint is not allowed to change. */
function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Pull every pixel toward its own luminance in the gunmetal hue.
 *
 * Written as a lerp rather than a hue rotation because a hue rotation on an 11%-saturated
 * texture is arithmetic on noise: at this saturation the hue of a given pixel is whatever its
 * two least significant bits happen to be. Luminance is the signal, the cast is the thing being
 * replaced, and this replaces exactly that.
 */
function repaint(image) {
  const tintLuminance = luminance(GUNMETAL[0], GUNMETAL[1], GUNMETAL[2]);
  const tint = GUNMETAL.map((v) => v / tintLuminance);
  const { data, channels } = image;
  const pixels = image.width * image.height;
  for (let i = 0; i < pixels; i++) {
    const o = i * channels;
    const l = luminance(data[o], data[o + 1], data[o + 2]);
    for (let k = 0; k < 3; k++) {
      const wanted = l * tint[k];
      const tinted = Math.max(0, Math.min(255, data[o + k] * (1 - REPAINT) + wanted * REPAINT));
      // The lift, as the screen curve `LIFT` describes. At LIFT 1 this is the identity, so an
      // armour left at the artist's own values costs nothing but the multiply.
      const lifted = 255 * (1 - Math.pow(1 - tinted / 255, LIFT));
      data[o + k] = Math.round(Math.max(0, Math.min(255, lifted)));
    }
  }
  return image;
}

/** The mean colour, for the line the build prints. */
function meanOf(image) {
  const { data, channels } = image;
  const pixels = image.width * image.height;
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels; i++) for (let k = 0; k < 3; k++) sum[k] += data[i * channels + k];
  return sum.map((v) => Math.round(v / pixels));
}

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

// -- the IFF band --------------------------------------------------------------------

/**
 * The silhouette of a mesh between two heights, as a convex hull in XZ (Andrew's monotone chain).
 *
 * Convex rather than the true outline because the band has to *enclose* the mount: a concave
 * outline followed inward would put the strip inside the armour wherever the column is waisted,
 * and on a tapered square column the difference everywhere else is nothing.
 */
function sliceHull(glb, meshIndex, bottom, top) {
  const points = [];
  for (const prim of glb.json.meshes[meshIndex].primitives) {
    for (const p of positions(glb, prim.attributes.POSITION)) {
      if (p[1] >= bottom && p[1] <= top) points.push([p[0], p[2]]);
    }
  }
  if (points.length < 3) throw new Error(`mesh ${meshIndex} has ${points.length} vertices between y ${bottom} and ${top}`);
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(points), ...half([...points].reverse())];
}

/**
 * An open strip that wraps a hull, standing `clearance` proud of it: positions, normals, indices.
 *
 * Each hull vertex moves out along the **mitre** of its two edge normals, not their average — an
 * average leaves the corners of a square column touching the armour while the flats stand clear,
 * which reads as a band that has slipped. The mitre is clamped, because a hull with a nearly
 * degenerate corner would otherwise throw a spike halfway across the map.
 *
 * No UVs: the material it wears carries no texture — the client sets one flat colour on it — and
 * a coordinate nothing samples is bytes in every player's download.
 */
function band(hull, bottom, top, clearance) {
  const n = hull.length;
  const edgeNormal = hull.map((p, i) => {
    const q = hull[(i + 1) % n];
    const [dx, dz] = [q[0] - p[0], q[1] - p[1]];
    const len = Math.hypot(dx, dz) || 1;
    // The hull runs counter-clockwise in XZ, so the outward side is the edge turned right.
    return [dz / len, -dx / len];
  });
  const position = [];
  const normal = [];
  const index = [];
  for (let i = 0; i < n; i++) {
    const a = edgeNormal[(i + n - 1) % n];
    const b = edgeNormal[i];
    const mx = a[0] + b[0], mz = a[1] + b[1];
    const len = Math.hypot(mx, mz) || 1;
    const dir = [mx / len, mz / len];
    // 0.35 caps the mitre at about three times the clearance: past that the corner is a spike.
    const reach = clearance / Math.max(0.35, dir[0] * b[0] + dir[1] * b[1]);
    const x = hull[i][0] + dir[0] * reach;
    const z = hull[i][1] + dir[1] * reach;
    position.push([x, bottom, z], [x, top, z]);
    normal.push([dir[0], 0, dir[1]], [dir[0], 0, dir[1]]);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1;
    const c = ((i + 1) % n) * 2, d = c + 1;
    // bottom→top→next, then top→next-top→next: counter-clockwise seen from outside, which is
    // what puts the face on the side the normal points at. The other order builds the band
    // inside out, and an inside-out band is invisible rather than wrong-looking.
    index.push(a, b, c, b, d, c);
  }
  return { position, normal, index };
}

// -- the build -----------------------------------------------------------------------

/** Append bytes to the binary chunk at a 4-byte boundary and return the bufferView index. */
function addView(json, chunks, bytes, target) {
  let offset = chunks.reduce((n, c) => n + c.length, 0);
  const pad = (4 - (offset % 4)) % 4;
  if (pad > 0) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  chunks.push(bytes);
  const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
  if (target !== undefined) view.target = target;
  return json.bufferViews.push(view) - 1;
}

function addAccessor(json, chunks, values, componentType, type, target) {
  const count = TYPE_COUNT[type];
  const bytes = Buffer.alloc(values.length * count * COMPONENT_BYTES[componentType]);
  const min = new Array(count).fill(Infinity);
  const max = new Array(count).fill(-Infinity);
  values.forEach((v, i) => {
    const tuple = Array.isArray(v) ? v : [v];
    tuple.forEach((x, k) => {
      const at = (i * count + k) * COMPONENT_BYTES[componentType];
      if (componentType === 5126) bytes.writeFloatLE(x, at);
      else bytes.writeUInt16LE(x, at);
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    });
  });
  const accessor = { bufferView: addView(json, chunks, bytes, target), componentType, count: values.length, type, min, max };
  return json.accessors.push(accessor) - 1;
}

/**
 * Re-emit the binary chunk so every bufferView is contiguous and aligned.
 *
 * The repaint changes the albedo's byte length, which moves every view after it. Rebuilding is
 * simpler than patching offsets and it drops whatever the source left unreferenced.
 */
function compact(json, bin) {
  const chunks = [];
  let offset = 0;
  const views = json.bufferViews.map((view) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    const bytes = view.data ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    chunks.push(bytes);
    const next = { ...view, byteOffset: offset, byteLength: bytes.length };
    delete next.data;
    offset += bytes.length;
    return next;
  });
  json.bufferViews = views;
  const out = Buffer.concat(chunks);
  json.buffers = [{ byteLength: out.length }];
  return out;
}

function run(args) {
  execFileSync(process.execPath, [NPX_CLI, '--yes', CLI, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function build(work) {
  const sourceFile = path.join(SOURCE_DIR, SENTRY_SOURCE.file);
  if (!existsSync(sourceFile)) {
    throw new Error(`source ${path.relative(ROOT, sourceFile)} is missing; the sources live outside the repository`);
  }
  const glb = readGlb(sourceFile);
  const json = glb.json;
  const bin = Buffer.from(glb.bin);

  // -- the three parts, by the names the artist gave them --------------------------
  const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
  const need = (name) => {
    const i = byName.get(name);
    if (i === undefined) throw new Error(`the source has no node "${name}"; it has ${json.nodes.map((n) => n.name).join(', ')}`);
    return i;
  };
  const stand = need('Stand');
  const swivel = need('Swivel');
  const mgMain = need('MGMain');
  const world = worldMatrices(json);
  const standPivot = pivotOf(world(stand), 'Stand');
  const swivelPivot = pivotOf(world(swivel), 'Swivel');
  const gunPivot = pivotOf(world(mgMain), 'MGMain');

  /** A part's mesh: the node itself if it carries one, else its only child's. */
  const meshOf = (i) => {
    const node = json.nodes[i];
    if (node.mesh !== undefined) return node.mesh;
    const children = (node.children ?? []).filter((c) => json.nodes[c].mesh !== undefined);
    if (children.length !== 1) throw new Error(`node "${node.name}" holds ${children.length} meshes; expected one`);
    return json.nodes[children[0]].mesh;
  };

  // -- how big, and around what point ----------------------------------------------
  const standBounds = meshBounds(glb, meshOf(stand));
  const gunBounds = meshBounds(glb, meshOf(mgMain));
  // Height is ground (the tripod's lowest foot) to the highest point of the gun.
  const ground = standPivot[1] + standBounds.min[1];
  const top = gunPivot[1] + gunBounds.max[1];
  const scale = HEIGHT_M / (top - ground);
  // The origin is the **tripod's** footprint centre, not the scene's: the barrel hangs a long
  // way out in front, and a sentry is placed where its legs are, not where its bbox is.
  const anchor = [
    standPivot[0] + (standBounds.min[0] + standBounds.max[0]) / 2,
    ground,
    standPivot[2] + (standBounds.min[2] + standBounds.max[2]) / 2,
  ];

  // -- the IFF band -----------------------------------------------------------------
  // Wrapped round the tripod's neck, in the base's own space — see the header for why not the
  // collar. The hull is measured on the same mesh the band will be a child of, so the two
  // cannot drift apart.
  const hull = sliceHull(glb, meshOf(stand), BAND.bottom, BAND.top);
  const geometry = band(hull, BAND.bottom, BAND.top, BAND.clearance);
  const chunks = [bin];
  const bandMesh = json.meshes.push({
    name: IFF,
    primitives: [{
      attributes: {
        POSITION: addAccessor(json, chunks, geometry.position, 5126, 'VEC3', 34962),
        NORMAL: addAccessor(json, chunks, geometry.normal, 5126, 'VEC3', 34962),
      },
      indices: addAccessor(json, chunks, geometry.index, 5123, 'SCALAR', 34963),
      material: json.materials.push({
        name: IFF_MATERIAL,
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
        emissiveFactor: [1, 1, 1],
      }) - 1,
    }],
  }) - 1;
  const bandBin = Buffer.concat(chunks);

  // -- the armour's material, brought into a world with no reflections ---------------
  // See METAL_FACTOR for the measurement that made this necessary.
  const armour = json.materials.filter((m) => m.name !== IFF_MATERIAL);
  for (const m of armour) {
    const pbr = (m.pbrMetallicRoughness ??= {});
    pbr.metallicFactor = METAL_FACTOR;
    pbr.roughnessFactor = ROUGHNESS_FACTOR;
    for (const name of DROP_EXTENSIONS) delete m.extensions?.[name];
    if (m.extensions !== undefined && Object.keys(m.extensions).length === 0) delete m.extensions;
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => !DROP_EXTENSIONS.includes(e));
  if (json.extensionsUsed.length === 0) delete json.extensionsUsed;

  // -- the repaint ------------------------------------------------------------------
  const albedo = json.materials.find((m) => m.name !== IFF_MATERIAL)?.pbrMetallicRoughness?.baseColorTexture;
  if (albedo === undefined) throw new Error('the source material has no baseColorTexture to repaint');
  const albedoView = json.bufferViews[json.images[json.textures[albedo.index].source].bufferView];
  const before = decodePng(bandBin.subarray(albedoView.byteOffset ?? 0, (albedoView.byteOffset ?? 0) + albedoView.byteLength));
  const was = meanOf(before);
  const after = repaint(before);
  const now = meanOf(after);
  // `compact` reads this instead of the old bytes; it is the only view whose length changes.
  albedoView.data = encodePng(after);

  // -- the scene the client binds to ------------------------------------------------
  // -s, +s, -s: the source's muzzle points +Z and the game's forward is -Z (`SentryGun`'s
  // direction at yaw 0 is (0,0,-1)), so the root turns the model about Y on its way into metres.
  // Mirroring two axes is a rotation, so nothing is inside out.
  const root = {
    name: SENTRY_ID,
    matrix: [-scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, -scale, 0, scale * anchor[0], -scale * anchor[1], scale * anchor[2], 1],
    children: [],
  };
  const node = (n) => json.nodes.push(n) - 1;
  const pitchNode = node({
    name: PITCH,
    mesh: meshOf(mgMain),
    translation: [gunPivot[0] - swivelPivot[0], gunPivot[1] - swivelPivot[1], gunPivot[2] - swivelPivot[2]],
  });
  const iffNode = node({ name: IFF, mesh: bandMesh });
  const yawNode = node({ name: YAW, mesh: meshOf(swivel), translation: swivelPivot, children: [pitchNode] });
  const baseNode = node({ name: BASE, mesh: meshOf(stand), translation: standPivot, children: [yawNode, iffNode] });
  root.children.push(baseNode);
  const rootNode = node(root);
  json.scenes = [{ name: `${SENTRY_ID}.scene`, nodes: [rootNode] }];
  json.scene = 0;

  json.asset = json.asset ?? { version: '2.0' };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    attribution: { ...SENTRY_SOURCE, file: undefined },
    protocolSeven: {
      prop: SENTRY_ID,
      source: SENTRY_SOURCE.file,
      metres: HEIGHT_M,
      nodes: { base: BASE, yaw: YAW, pitch: PITCH, iff: IFF },
      iffMaterial: IFF_MATERIAL,
    },
  };
  // `attribution` is compared field for field by `credits.mjs`; an undefined `file` would
  // survive into the JSON as a missing key rather than an extra one, so drop it explicitly.
  delete json.asset.extras.attribution.file;

  const out = compact(json, bandBin);
  const staged = path.join(work, `${SENTRY_ID}.staged.glb`);
  writeGlb(staged, json, out);
  const resized = path.join(work, `${SENTRY_ID}.resized.glb`);
  run(['resize', staged, resized, '--width', String(TEXTURE_SIDE), '--height', String(TEXTURE_SIDE)]);
  const final = path.join(PROPS_DIR, `${SENTRY_ID}.glb`);
  run(['webp', resized, final, '--quality', String(WEBP_QUALITY)]);

  return {
    file: final,
    scale,
    height: HEIGHT_M,
    footprint: [(standBounds.max[0] - standBounds.min[0]) * scale, (standBounds.max[2] - standBounds.min[2]) * scale],
    pivots: { yaw: swivelPivot.map((v) => (v - anchor[1] * 0) * scale), trunnion: (gunPivot[1] - ground) * scale },
    paint: { was, now },
    bytes: statSync(final).size,
    sourceBytes: statSync(sourceFile).size,
  };
}

function main() {
  mkdirSync(PROPS_DIR, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'operator-sentry-'));
  try {
    const r = build(work);
    console.log(`${SENTRY_ID}  ${r.height.toFixed(2)} m tall, footprint ${r.footprint.map((v) => v.toFixed(2)).join(' x ')} m  (scale ${r.scale.toFixed(6)})`);
    console.log(`  trunnion at ${r.pivots.trunnion.toFixed(3)} m`);
    console.log(`  albedo ${hex(r.paint.was)} -> ${hex(r.paint.now)}  (warm bias ${(r.paint.was[0] - r.paint.was[2]).toFixed(0)} -> ${(r.paint.now[0] - r.paint.now[2]).toFixed(0)})`);
    console.log(`  ${(r.sourceBytes / 1048576).toFixed(2)} MB -> ${(r.bytes / 1024).toFixed(0)} KB`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) main();
