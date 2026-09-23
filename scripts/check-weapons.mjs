#!/usr/bin/env node
/**
 * The weapon asset audit (M19, stage 0).
 *
 * `check-skins` holds the bodies' library to a size; this holds the weapons' to a size and to
 * the contract `WeaponMesh` will read. The contract is the point: a GLB with the right
 * triangles and the wrong node names loads, renders, and then the reload drops nothing
 * because there is no `magazine`, and the suppressor floats because there is no
 * `socket_muzzle`. The names are checked here, once, where the file is, rather than in the
 * loader at match time.
 *
 *   1. **The recipes and the folder agree.** Every recipe in `weapon-build.mjs` has its output
 *      (and its `.lod1.glb` where it asks for one), and every `.glb` in the folder came from a
 *      recipe — a file dropped in by hand has no attribution record and no measured sockets.
 *   2. **Sizes.** A weapon ≤ `MAX_WEAPON_BYTES` (4 MB), its LOD ≤ 1 MB, a pack part ≤ 1 MB.
 *      The client is 1.4 MB; a loadout's primary must not cost three of it.
 *   3. **Triangles.** A weapon ≤ 30k, its LOD ≤ 10k, a pack part ≤ 8k. The LOD's 10k is what
 *      meshopt reaches on kit meshes (the build script says why); ten bodies at 10k each is
 *      nothing for the GPU and the draw calls are joined per material.
 *   4. **Textures ≤ 1024 on a side (the LOD 256), WebP or JPEG.** A 2048 PNG normal map is
 *      the usual way a 4 MB file becomes a 20 MB one.
 *   5. **The contract's nodes.** A weapon carries a root named for it, `body`, `magazine`,
 *      (the knife only a root and a `body`),
 *      `charge` and the seven sockets (the muzzle, the three rails, the sight line, the two
 *      hands); its LOD the root and `socket_muzzle`; a pack part `part`, and the optic its
 *      own `socket_sight` (the sight line the ADS pose cancels once it is mounted), the
 *      suppressor its own `socket_muzzle` (where the flash moves to); the arms' rig (stage 4)
 *      its skin and the six arm bones `ViewmodelHands` poses, within 1 MB and 10k triangles.
 *   6. **Scale.** A weapon's length along Z is between 0.15 m and 1.5 m — the axis and the
 *      unit are the two things a recipe gets wrong first, and both show up here.
 *   7. **Attribution.** `asset.extras.attribution` names a title, an author, a licence and a
 *      URL, and `CREDITS.md` is what the build regenerates from the same records. CC-BY is a
 *      condition of use.
 *   8. **The client's list and the recipes agree** (stage 1). `WeaponAssetCatalog.ts` names
 *      the weapon ids the loader will fetch; a weapon recipe missing from it is a file nothing
 *      loads, and an id in it with no recipe is a 404 at match time.
 *
 * Nothing here decodes a pixel or a vertex; the JSON chunk and the image headers are enough,
 * as they are for the skins. Exit code 1 on any violation.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glbImages, readGlb } from './glb-images.mjs';
import { creditsMarkdown, RECIPES } from './weapon-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = 'public/models/weapons';
const CATALOG = 'src/client/weapons/WeaponAssetCatalog.ts';

const MAX_WEAPON_BYTES = 4 * 1024 * 1024;
const MAX_LOD_BYTES = 1024 * 1024;
const MAX_PART_BYTES = 1024 * 1024;
const MAX_WEAPON_TRIS = 30_000;
const MAX_LOD_TRIS = 10_000;
const MAX_PART_TRIS = 8_000;
const MAX_SIDE = 1024;
const MAX_LOD_SIDE = 256;
const FORMATS = new Set(['image/webp', 'image/jpeg']);
const FIX = 'edit the recipe in scripts/weapon-build.mjs and run `node scripts/weapon-build.mjs`';

const WEAPON_NODES = ['body', 'magazine', 'charge', 'socket_muzzle', 'socket_rail_top', 'socket_rail_bottom', 'socket_rail_front', 'socket_sight', 'socket_grip', 'socket_support'];
const LOD_NODES = ['socket_muzzle'];
const PART_NODES = { att_optic: ['part', 'socket_sight'], att_suppressor: ['part', 'socket_muzzle'] };
/** The bones `ViewmodelHands` poses (stage 4); the rig must keep its skin to be posed at all. */
const HANDS_NODES = ['upperarm_R', 'lowerarm_R', 'hand_R', 'upperarm_L', 'lowerarm_L', 'hand_L'];
const MAX_HANDS_BYTES = 1024 * 1024;
const MAX_HANDS_TRIS = 10_000;

const problems = [];

// ---- 1. the recipes and the folder agree ----------------------------------------
const expected = new Map();
for (const [id, recipe] of Object.entries(RECIPES)) {
  expected.set(`${id}.glb`, { id, recipe, lod: false });
  if (recipe.lod) expected.set(`${id}.lod1.glb`, { id, recipe, lod: true });
}
const onDisk = existsSync(path.join(ROOT, DIR)) ? readdirSync(path.join(ROOT, DIR)).filter((f) => f.endsWith('.glb')).sort() : [];
for (const file of expected.keys()) {
  if (!onDisk.includes(file)) problems.push(`${DIR}/${file} is missing — run \`node scripts/weapon-build.mjs ${expected.get(file).id}\`.`);
}
for (const file of onDisk) {
  if (!expected.has(file)) problems.push(`${DIR}/${file} has no recipe in scripts/weapon-build.mjs; the folder holds built files only.`);
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

/** The scene's extent along one axis, from the accessors' bounds through the baked node matrices. */
function extentZ(json) {
  let min = Infinity;
  let max = -Infinity;
  const visit = (index, parentMatrix) => {
    const node = json.nodes[index];
    const m = compose(parentMatrix, node);
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (!acc.min || !acc.max) continue;
        for (let c = 0; c < 8; c++) {
          const v = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
          const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
          if (z < min) min = z;
          if (z > max) max = z;
        }
      }
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  for (const r of json.scenes[json.scene ?? 0].nodes) visit(r, null);
  return max - min;
}

function compose(parent, node) {
  let local = node.matrix;
  if (local === undefined) {
    const t = node.translation ?? [0, 0, 0];
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    local = [
      (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + w * z) * s[0], 2 * (x * z - w * y) * s[0], 0,
      2 * (x * y - w * z) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + w * x) * s[1], 0,
      2 * (x * z + w * y) * s[2], 2 * (y * z - w * x) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
      t[0], t[1], t[2], 1,
    ];
  }
  if (parent === null) return local;
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += parent[k * 4 + r] * local[c * 4 + k];
  return o;
}

for (const file of onDisk) {
  const spec = expected.get(file);
  if (spec === undefined) continue;
  const full = path.join(ROOT, DIR, file);
  const glb = readGlb(full);
  const { json } = glb;
  const isWeapon = spec.recipe.kind === 'weapon';
  const isHands = spec.recipe.kind === 'hands';
  const label = `${DIR}/${file}`;

  // ---- 2 and 3. size and triangles ---------------------------------------------
  const maxBytes = spec.lod ? MAX_LOD_BYTES : isWeapon ? MAX_WEAPON_BYTES : isHands ? MAX_HANDS_BYTES : MAX_PART_BYTES;
  if (glb.bytes > maxBytes) {
    problems.push(`${label} is ${(glb.bytes / 1048576).toFixed(2)} MB; the limit is ${(maxBytes / 1048576).toFixed(0)} MB — ${FIX}.`);
  }
  const tris = triangles(json);
  const maxTris = spec.lod ? MAX_LOD_TRIS : isWeapon ? MAX_WEAPON_TRIS : isHands ? MAX_HANDS_TRIS : MAX_PART_TRIS;
  if (tris > maxTris) problems.push(`${label} has ${tris.toLocaleString('en-US')} triangles; the limit is ${maxTris.toLocaleString('en-US')} — ${FIX}.`);

  // ---- 4. textures --------------------------------------------------------------
  const side = spec.lod ? MAX_LOD_SIDE : MAX_SIDE;
  for (const im of glbImages(glb)) {
    if (im.width > side || im.height > side) problems.push(`${label} image ${im.index} is ${im.width}x${im.height}; the limit is ${side} on a side — ${FIX}.`);
    if (!FORMATS.has(im.mimeType)) problems.push(`${label} image ${im.index} is ${im.mimeType}; WebP or JPEG only — ${FIX}.`);
  }

  // ---- 5. the contract's nodes ----------------------------------------------------
  const names = new Set((json.nodes ?? []).map((n) => n.name));
  const rootNames = json.scenes[json.scene ?? 0].nodes.map((i) => json.nodes[i].name);
  if (!rootNames.includes(spec.id)) problems.push(`${label} has no root node named "${spec.id}" (roots: ${rootNames.join(', ') || 'none'}).`);
  const required = spec.lod ? LOD_NODES : isWeapon ? WEAPON_NODES : isHands ? HANDS_NODES : spec.recipe.kind === 'knife' ? ['body'] : (PART_NODES[spec.id] ?? ['part']);
  if (isHands && !(json.skins?.length > 0)) problems.push(`${label} has no skin; the arms are posed at runtime and a rigid rig cannot be — ${FIX}.`);
  for (const name of required) {
    if (!names.has(name)) problems.push(`${label} has no node "${name}"; the contract needs it — ${FIX}.`);
  }

  // ---- 6. scale -------------------------------------------------------------------
  if (isWeapon) {
    const z = extentZ(json);
    if (!(z >= 0.15 && z <= 1.5)) problems.push(`${label} is ${z.toFixed(3)} m long along Z; a weapon is 0.15–1.5 m — the recipe's unit or forward axis is wrong.`);
  }

  // ---- 7. attribution -------------------------------------------------------------
  const a = json.asset?.extras?.attribution;
  if (!a || !a.title || !a.author || !a.license || !a.url) problems.push(`${label} carries no asset.extras.attribution (title, author, license, url) — ${FIX}.`);
}

// ---- 8. the client's list and the recipes agree ------------------------------------
const catalogSource = readFileSync(path.join(ROOT, CATALOG), 'utf8');
const listed = /WEAPON_ASSET_IDS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(catalogSource);
if (listed === null) {
  problems.push(`${CATALOG} has no WEAPON_ASSET_IDS = new Set([...]) the audit can read.`);
} else {
  const ids = new Set([...listed[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
  const weaponRecipes = new Set(Object.entries(RECIPES).filter(([, r]) => r.kind === 'weapon').map(([id]) => id));
  for (const id of weaponRecipes) {
    if (!ids.has(id)) problems.push(`recipe "${id}" builds a weapon file that ${CATALOG} does not list; add it to WEAPON_ASSET_IDS.`);
  }
  for (const id of ids) {
    if (!weaponRecipes.has(id)) problems.push(`${CATALOG} lists "${id}" but no weapon recipe builds it; the loader would fetch a file that is not there.`);
  }
}

const credits = path.join(ROOT, DIR, 'CREDITS.md');
if (!existsSync(credits)) problems.push(`${DIR}/CREDITS.md is missing — the build writes it.`);
else if (readFileSync(credits, 'utf8').replace(/\r\n/g, '\n') !== creditsMarkdown()) {
  problems.push(`${DIR}/CREDITS.md does not match the recipes — run \`node scripts/weapon-build.mjs\` to regenerate it.`);
}

if (problems.length > 0) {
  console.error('weapon audit FAILED:\n');
  for (const p of problems) console.error(`  ${p}\n`);
  console.error(`${problems.length} problem(s). See scripts/check-weapons.mjs.`);
  process.exit(1);
}

const total = onDisk.reduce((sum, f) => sum + readGlb(path.join(ROOT, DIR, f)).bytes, 0);
console.log(
  `weapon audit ok — ${onDisk.length} file(s) in ${DIR} from ${Object.keys(RECIPES).length} recipe(s), ` +
    `${(total / 1048576).toFixed(2)} MB in all; every file within budget, on the contract, attributed, and the client's list agrees.`,
);
