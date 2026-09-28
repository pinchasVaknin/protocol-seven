#!/usr/bin/env node
/**
 * The prop asset audit (2026-09-28).
 *
 * `check-weapons` holds `public/models/weapons/`; nothing held `public/models/props/`, and the
 * station's triangle count was meant to get a budget row on the day it was built (810fb67) and
 * did not. In the meantime the station was rearranged twice and came out at **17.8k triangles
 * and 1.10 MB**, against the 11k and 0.70 MB the note that asked for this audit remembered. No
 * gate had an opinion either way. That is the whole argument for the file.
 *
 * ## Three kinds of prop, not one
 *
 * **Pieces** — `crate_stand`, `crate_open`, `ammo_can` — are the normalised sources
 * `prop-build.mjs` writes so `probes/prop-tuner.html` can arrange them. Nothing in a match
 * fetches one: `PropModels` asks for the station, `SentryModel` for the turret, and the tuner
 * is a dev page. **The station** is what those three weld into, and **the turret** is the one
 * articulated model in the game. The budgets are per kind and the reasoning is on them, at
 * `MAX_PIECE_BYTES` below, rather than repeated here.
 *
 * ## What is audited
 *
 *   1. **The build scripts and the folder agree.** Every piece in `PIECES`, the welded
 *      `STATION_ID` and `SENTRY_ID` have their file, and every `.glb` in the folder is one of
 *      them — a file dropped in by hand carries no attribution and nothing rebuilds it.
 *   2. **Sizes** and **3. triangles**, per kind, from the budgets above.
 *   4. **Textures at 512 on a side, WebP or JPEG.** Both pipelines resize to 512 and say why
 *      (nobody presses their face against a crate); a prop that arrives at 1024 has been built
 *      by hand or by a pass that lost the step.
 *   5. **Attribution**, the same five fields `check-weapons` audit 7 demands and
 *      `check:credits` regenerates from.
 *   6. **The sentry's node contract, from both ends.** The turret is the only articulated model
 *      in the game: `client/streaks/SentryModel.ts` looks its nodes up by name and `SentryMesh`
 *      throws when yaw or pitch is missing, which would take out the match rather than the
 *      build. So the file must carry the build's whole contract — base, yaw, pitch, the band and
 *      a mesh on the `iff` material — *and* the names the client is compiled with must be the
 *      names the build wrote, read out of the TypeScript the way `check-weapons` reads
 *      `WeaponAssetCatalog.ts`. A rename that only half lands fails here.
 *
 * Nothing here decodes a pixel or a vertex; the JSON chunk and the image headers are enough.
 * Exit code 1 on any violation.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glbImages, readGlb } from './glb-images.mjs';
import { PIECES } from './prop-build.mjs';
import { STATION_ID } from './prop-assemble.mjs';
import { SENTRY_ID, SENTRY_IFF_MATERIAL, SENTRY_NODES } from './sentry-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = 'public/models/props';
const SENTRY_MODULE = 'src/client/streaks/SentryModel.ts';

/**
 * The budgets.
 *
 * Each is a ceiling that a *deliberate* change should fit under and an accident should not. The
 * accidents worth catching are a lost `resize`/`webp` pass, which multiplies a file by ten and
 * would trip any number here, and a source quietly swapped for a heavier one, which roughly
 * doubles it — so none of these is set at twice what the folder holds today. The station is
 * 1.10 MB and 17.8k, the heaviest piece 531 KB and 7.6k, the turret 421 KB and 4.3k.
 *
 * A **piece** is one crate with one material and three 512 WebP maps, so it is geometry and
 * almost nothing else. It is also the only kind no player downloads: `prop-tuner.html` is the
 * only thing that asks for one, so this budget protects the repository and `dist/`, not a match.
 *
 * The **station** is three crates welded, and a map places two of them. It is allowed to be the
 * heaviest file here because it is the one a player has to recognise across a lane.
 *
 * The **turret** is held to less than the station although it is the one with moving parts:
 * several players can have a sentry up at once, each is a clone, and its parts cannot be merged
 * into one draw because the gun has to turn independently of the base. 8k triangles is also
 * enough for the CC-BY alternative the shortlist kept (seangorman's cannon, 7,070) should the
 * licence ever have to change.
 */
const MAX_PIECE_BYTES = 768 * 1024;
const MAX_PIECE_TRIS = 10_000;
const MAX_STATION_BYTES = 1536 * 1024;
const MAX_STATION_TRIS = 20_000;
const MAX_SENTRY_BYTES = 768 * 1024;
const MAX_SENTRY_TRIS = 8_000;
/** Both pipelines resize to this and say why: nobody presses their face against a crate. */
const MAX_SIDE = 512;
const FORMATS = new Set(['image/webp', 'image/jpeg']);

const BUILD = {
  piece: 'node scripts/prop-build.mjs',
  station: 'node scripts/prop-assemble.mjs',
  turret: 'node scripts/sentry-build.mjs',
};
const BUDGET = {
  piece: { bytes: MAX_PIECE_BYTES, tris: MAX_PIECE_TRIS },
  station: { bytes: MAX_STATION_BYTES, tris: MAX_STATION_TRIS },
  turret: { bytes: MAX_SENTRY_BYTES, tris: MAX_SENTRY_TRIS },
};

const problems = [];

// ---- 1. the build scripts and the folder agree ------------------------------------
const expected = new Map();
for (const id of Object.keys(PIECES)) expected.set(`${id}.glb`, { id, kind: 'piece' });
expected.set(`${STATION_ID}.glb`, { id: STATION_ID, kind: 'station' });
expected.set(`${SENTRY_ID}.glb`, { id: SENTRY_ID, kind: 'turret' });

const onDisk = existsSync(path.join(ROOT, DIR))
  ? readdirSync(path.join(ROOT, DIR)).filter((f) => f.endsWith('.glb')).sort()
  : [];
for (const [file, spec] of expected) {
  if (!onDisk.includes(file)) problems.push(`${DIR}/${file} is missing — run \`${BUILD[spec.kind]}\`.`);
}
for (const file of onDisk) {
  if (!expected.has(file)) {
    problems.push(`${DIR}/${file} is built by nothing; the folder holds the pieces, the station and the turret only.`);
  }
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

for (const file of onDisk) {
  const spec = expected.get(file);
  if (spec === undefined) continue;
  const glb = readGlb(path.join(ROOT, DIR, file));
  const { json } = glb;
  const label = `${DIR}/${file}`;
  const fix = `rebuild with \`${BUILD[spec.kind]}\``;
  const budget = BUDGET[spec.kind];

  // ---- 2 and 3. size and triangles -----------------------------------------------
  if (glb.bytes > budget.bytes) {
    problems.push(`${label} is ${(glb.bytes / 1048576).toFixed(2)} MB; the limit for a ${spec.kind} is ${(budget.bytes / 1048576).toFixed(2)} MB — ${fix}.`);
  }
  const tris = triangles(json);
  if (tris > budget.tris) {
    problems.push(`${label} has ${tris.toLocaleString('en-US')} triangles; the limit for a ${spec.kind} is ${budget.tris.toLocaleString('en-US')} — ${fix}.`);
  }

  // ---- 4. textures -----------------------------------------------------------------
  for (const im of glbImages(glb)) {
    if (im.width > MAX_SIDE || im.height > MAX_SIDE) {
      problems.push(`${label} image ${im.index} is ${im.width}x${im.height}; the limit is ${MAX_SIDE} on a side — ${fix}.`);
    }
    if (!FORMATS.has(im.mimeType)) {
      problems.push(`${label} image ${im.index} is ${im.mimeType}; WebP or JPEG only — ${fix}.`);
    }
  }

  // ---- 5. attribution ---------------------------------------------------------------
  // An array for the station, which is welded from three models and credits each of them.
  const carried = json.asset?.extras?.attribution;
  const records = carried === undefined ? [] : Array.isArray(carried) ? carried : [carried];
  if (records.length === 0) {
    problems.push(`${label} carries no asset.extras.attribution — run \`npm run credits\`.`);
  }
  for (const [i, a] of records.entries()) {
    const missing = ['title', 'author', 'authorUrl', 'license', 'licenseUrl', 'url'].filter((k) => !a[k]);
    if (missing.length > 0) {
      const which = records.length > 1 ? ` record ${i}` : '';
      problems.push(`${label}${which} attribution is missing ${missing.join(', ')} — run \`npm run credits\`.`);
    }
  }

  // ---- 6. the sentry's node contract, from both ends ---------------------------------
  if (spec.kind === 'turret') {
    const names = new Set((json.nodes ?? []).map((n) => n.name));
    const rootNames = json.scenes[json.scene ?? 0].nodes.map((i) => json.nodes[i].name);
    if (!rootNames.includes(spec.id)) {
      problems.push(`${label} has no root node named "${spec.id}" (roots: ${rootNames.join(', ') || 'none'}) — ${fix}.`);
    }
    for (const name of Object.values(SENTRY_NODES)) {
      if (!names.has(name)) problems.push(`${label} has no node "${name}"; SentryMesh binds it by name — ${fix}.`);
    }
    // The band's material, not its node: `SentryMesh` finds the mesh to repaint by the
    // material's name, because `dedup` is free to reorder and rename nothing else.
    const iffMeshes = (json.meshes ?? []).filter((mesh) =>
      mesh.primitives.some((p) => p.material !== undefined && json.materials[p.material]?.name === SENTRY_IFF_MATERIAL),
    );
    if (iffMeshes.length === 0) {
      problems.push(`${label} has no mesh on a material named "${SENTRY_IFF_MATERIAL}"; the IFF band is what carries the team colour — ${fix}.`);
    }
  }
}

// ---- 6 (the other end). the client is compiled with the names the build wrote --------
const modulePath = path.join(ROOT, SENTRY_MODULE);
if (!existsSync(modulePath)) {
  problems.push(`${SENTRY_MODULE} is missing; it is what binds the turret's nodes at runtime.`);
} else {
  const source = readFileSync(modulePath, 'utf8');
  const claimed = new Map([...source.matchAll(/(yaw|pitch)\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  for (const key of ['yaw', 'pitch']) {
    const want = SENTRY_NODES[key];
    const have = claimed.get(key);
    if (have === undefined) {
      problems.push(`${SENTRY_MODULE} names no ${key} node; SENTRY_NODES.${key} should be '${want}'.`);
    } else if (have !== want) {
      problems.push(`${SENTRY_MODULE} looks up "${have}" for ${key}, but scripts/sentry-build.mjs writes "${want}" — the match would find nothing.`);
    }
  }
  const material = /SENTRY_IFF_MATERIAL\s*=\s*'([^']+)'/.exec(source);
  if (material === null) {
    problems.push(`${SENTRY_MODULE} exports no SENTRY_IFF_MATERIAL the audit can read.`);
  } else if (material[1] !== SENTRY_IFF_MATERIAL) {
    problems.push(`${SENTRY_MODULE} repaints the material "${material[1]}", but the build names it "${SENTRY_IFF_MATERIAL}".`);
  }
  const url = /SENTRY_URL\s*=\s*'([^']+)'/.exec(source);
  const wantUrl = `/models/props/${SENTRY_ID}.glb`;
  if (url === null) {
    problems.push(`${SENTRY_MODULE} names no SENTRY_URL the audit can read.`);
  } else if (url[1] !== wantUrl) {
    problems.push(`${SENTRY_MODULE} fetches "${url[1]}", but the build writes "${wantUrl}" — a 404 at match time.`);
  }
}

if (problems.length > 0) {
  console.error('prop audit FAILED:\n');
  for (const p of problems) console.error(`  ${p}\n`);
  console.error(`${problems.length} problem(s). See scripts/check-props.mjs.`);
  process.exit(1);
}

const total = onDisk.reduce((sum, f) => sum + readGlb(path.join(ROOT, DIR, f)).bytes, 0);
const shipped = [`${STATION_ID}.glb`, `${SENTRY_ID}.glb`]
  .filter((f) => onDisk.includes(f))
  .reduce((sum, f) => sum + readGlb(path.join(ROOT, DIR, f)).bytes, 0);
console.log(
  `prop audit ok — ${onDisk.length} file(s) in ${DIR}, ${(total / 1048576).toFixed(2)} MB in all and ` +
    `${(shipped / 1024).toFixed(0)} KB of it fetched in a match; every file within budget, at 512 WebP, ` +
    `attributed, and the turret's nodes are the ones ${SENTRY_MODULE} binds.`,
);
