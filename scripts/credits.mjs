#!/usr/bin/env node
/**
 * The project's credits: written into the files, into `CREDITS.md`, and into the game.
 *
 * Nothing in this project is drawn from a source we own. The weapons, the attachments, the
 * knife and the first-person hands are Sketchfab models built by `weapon-build.mjs`; the
 * characters and every animation clip are Mixamo's. Two of those licences are conditions —
 * CC-BY asks for the author, the title, the links and the licence *wherever the work is
 * distributed* — and the third (Mixamo) asks for nothing, which is a reason to record it
 * rather than a reason to leave it out: a file nobody can source is a file nobody can clear.
 *
 * So the credit is written in three places, from one set of records:
 *
 *   1. **Inside every `.glb`**, as `asset.extras.attribution`. The file carries its own
 *      provenance wherever it is copied to, and `check:weapons` / `check:credits` refuse a
 *      model that has lost it.
 *   2. **`CREDITS.md`** — one at the root for the whole project, one beside the weapons for
 *      the folder — each ending in the sentence the licence asks to be reproduced.
 *   3. **In the game**, SETTINGS → INFO, from `src/client/ui/CreditsData.ts`, which this
 *      script generates. The built client is what actually reaches a player; a credit that
 *      lives only in the repository does not travel with it.
 *
 * `node scripts/credits.mjs` writes all of it. `--check` (which is `npm run check:credits`)
 * writes nothing and reports what has drifted, so the gate fails on a source added to a
 * recipe and never credited, or a model whose record was stripped by a tool.
 *
 * After a run that touched `public/models/bots/`, bump `CHARACTER_VERSION` in
 * `CharacterCatalog.ts`: the bytes changed, and the URL is what busts a player's cache.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGlb } from './glb-images.mjs';
import { creditSentence, creditsMarkdown, OUT_DIR, RECIPES, sources, writeGlb } from './weapon-build.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BOTS_DIR = path.join(ROOT, 'public/models/bots');
export const ROOT_CREDITS = path.join(ROOT, 'CREDITS.md');
export const WEAPON_CREDITS = path.join(OUT_DIR, 'CREDITS.md');
export const CREDITS_MODULE = path.join(ROOT, 'src/client/ui/CreditsData.ts');

/**
 * Mixamo, for the seven skins and every clip in the animation library.
 *
 * Adobe's terms make Mixamo content royalty-free for use in a project and ask for **no**
 * attribution — which is why there was none to find when the files were downloaded. The
 * record still goes in the files and in `CREDITS.md`, because the question a year from now is
 * not "must we credit this?" but "where did this come from, and may we ship it?".
 */
export const MIXAMO = {
  title: 'Mixamo characters and animations',
  author: 'Adobe (Mixamo)',
  authorUrl: 'https://www.mixamo.com/',
  license: 'Mixamo Terms of Use',
  licenseUrl: 'https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html',
  url: 'https://www.mixamo.com/',
  note: 'Royalty-free for use in a project under the Mixamo terms; Adobe asks for no attribution. Credited here as provenance.',
};

/** The folders `MIXAMO` covers, and what they hold. Every `.glb` under them carries the record. */
const MIXAMO_FOLDERS = [
  { dir: 'skins', what: 'character skins' },
  { dir: 'animations', what: 'animation clips' },
];

/** `ar_vulcan.lod1.glb` → `ar_vulcan`: which recipe built a file in the weapons folder. */
function recipeOf(file) {
  return file.replace(/\.lod1\.glb$/, '').replace(/\.glb$/, '');
}

/** `att_suppressor` → `SUPPRESSOR`: the name the game shows, from the file's own id. */
function shortName(id) {
  return id.replace(/^(ar|smg|lmg|sniper|shotgun|pistol|att)_/, '').replace(/_/g, ' ').toUpperCase();
}

/** Every `.glb` under a folder, recursively, repo-relative and sorted. */
function glbFiles(dir) {
  const out = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.glb')) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** The attribution record a file should carry, or `undefined` for a file nothing credits. */
export function attributionFor(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel.startsWith('public/models/weapons/')) {
    const recipe = RECIPES[recipeOf(path.basename(file))];
    if (recipe === undefined) return undefined;
    const s = recipe.source;
    return { title: s.title, author: s.author, authorUrl: s.authorUrl, license: s.license, licenseUrl: s.licenseUrl, url: s.url };
  }
  if (rel.startsWith('public/models/bots/')) return { ...MIXAMO };
  return undefined;
}

/** Every file that must carry a record, with the record it must carry. */
export function credited() {
  return [...glbFiles(OUT_DIR), ...glbFiles(BOTS_DIR)]
    .map((file) => ({ file, want: attributionFor(file) }))
    .filter((e) => e.want !== undefined);
}

/** True when the file's `asset.extras.attribution` is already the record it should carry. */
function stamped(file, want) {
  const { json } = readGlb(file);
  const have = json.asset?.extras?.attribution;
  return have !== undefined && JSON.stringify(have) === JSON.stringify(want);
}

/**
 * Write the record into a file, keeping everything else — the JSON chunk is re-emitted, the
 * binary chunk is copied through untouched, so a stamp costs the credit's bytes and nothing
 * else. Returns true when the file was changed.
 */
function stamp(file, want) {
  const { json, bin } = readGlb(file);
  if (json.asset?.extras?.attribution !== undefined && JSON.stringify(json.asset.extras.attribution) === JSON.stringify(want)) return false;
  json.asset = json.asset ?? { version: '2.0' };
  json.asset.extras = { ...(json.asset.extras ?? {}), attribution: want };
  writeGlb(file, json, Buffer.from(bin));
  return true;
}

/**
 * The root `CREDITS.md`: the whole project in one page, weapons through characters, each
 * section ending in the sentence its licence asks to be reproduced.
 */
export function rootCreditsMarkdown() {
  const list = sources();
  const files = (outputs) => outputs.map((o) => `\`${o}\``).join(', ');
  const counts = MIXAMO_FOLDERS.map(({ dir, what }) => `${glbFiles(path.join(BOTS_DIR, dir)).length} ${what}`).join(' and ');
  return [
    '# Credits',
    '',
    'PROTOCOL SEVEN builds its maps, effects, textures and audio in code. Its **models** are not',
    'its own: every weapon, attachment, the knife, the first-person hands and every character and',
    'animation come from an artist who published them under a licence. This page is that credit,',
    'and for the CC-BY models it is a condition of use rather than a courtesy.',
    '',
    'It is generated by `node scripts/credits.mjs` from the build’s own records — the same records',
    'each `.glb` carries in `asset.extras.attribution` and the game shows under **SETTINGS → INFO**.',
    'Edit the recipes in `scripts/weapon-build.mjs`, not this file.',
    '',
    '## Weapons, attachments, knife and hands',
    '',
    'Sketchfab models, built into the shipped files by `scripts/weapon-build.mjs`.',
    '',
    '| Source | Author | Licence | Built files |',
    '|---|---|---|---|',
    ...list.map(({ source, outputs }) => `| [${source.title}](${source.url}) | [${source.author}](${source.authorUrl}) | [${source.license}](${source.licenseUrl}) | ${files(outputs)} |`),
    '',
    '### Attribution',
    '',
    ...list.map(({ source }) => `- ${creditSentence(source)}`),
    '',
    '## Characters and animations',
    '',
    `The ${counts} under \`public/models/bots/\` are [Mixamo](${MIXAMO.url}) content, used`,
    `under the [Mixamo terms of use](${MIXAMO.licenseUrl}): royalty-free in a`,
    'project, and Adobe asks for no attribution. It is credited anyway, because provenance is what',
    'lets the next person clear the file. Each of those `.glb` files carries the same record in',
    '`asset.extras.attribution`.',
    '',
    `- Characters and animations by ${MIXAMO.author} — ${MIXAMO.url}`,
    '',
    '## Everything else',
    '',
    'Maps, weapon behaviour, particles, textures, UI and audio are generated in code in this',
    'repository. The two LMGs are still built in code as well, and are nobody’s model.',
    '',
  ].join('\n');
}

/**
 * `src/client/ui/CreditsData.ts`: the same records as data the client can render.
 *
 * The screen is short on purpose (see `Settings.ts`): the licence asks for the author, the
 * title, the licence and the links, which is one line per source, and the full page with every
 * built file is in `CREDITS.md` beside it. Generated, because a credits screen maintained by
 * hand is a credits screen that is wrong by the next model.
 */
export function creditsModule() {
  const list = sources();
  // Single quotes, like every other file in src/: the generated module is read as source.
  const lit = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const fields = (o, indent) => Object.entries(o).map(([k, v]) => `${indent}${k}: ${lit(v)},`);
  const entryOf = ({ source, outputs }) => ({
    title: source.title,
    author: source.author,
    license: source.license,
    licenseUrl: source.licenseUrl,
    url: source.url,
    used: outputs.map((o) => shortName(recipeOf(o))).join(', '),
  });
  return [
    '/**',
    ' * The credits the game shows, generated by `node scripts/credits.mjs` from the build’s records.',
    ' *',
    ' * Do not edit: `npm run check:credits` regenerates it and fails the gate on a difference. The',
    ' * source of truth is the recipes in `scripts/weapon-build.mjs` and `MIXAMO` in that script.',
    ' */',
    '',
    '/** One source, as a player reads it: what it is, who made it, and the licence it comes under. */',
    'export interface CreditEntry {',
    '  readonly title: string;',
    '  readonly author: string;',
    '  readonly license: string;',
    '  /** The licence deed. CC-BY asks for the link, not only the name. */',
    '  readonly licenseUrl: string;',
    '  /** The model’s page: the "material" CC-BY asks to be linked. */',
    '  readonly url: string;',
    '  /** What the game draws from it, in the names the player sees. */',
    '  readonly used: string;',
    '}',
    '',
    '/** The Sketchfab models: weapons, attachments, the knife and the first-person hands. */',
    'export const MODEL_CREDITS: readonly CreditEntry[] = [',
    ...list.flatMap((s) => ['  {', ...fields(entryOf(s), '    '), '  },']),
    '];',
    '',
    '/** Mixamo: every character skin and every animation clip. Attribution is not required for it. */',
    'export const CHARACTER_CREDIT: CreditEntry = {',
    ...fields(
      {
        title: MIXAMO.title,
        author: MIXAMO.author,
        license: MIXAMO.license,
        licenseUrl: MIXAMO.licenseUrl,
        url: MIXAMO.url,
        used: 'CHARACTERS, ANIMATIONS',
      },
      '  ',
    ),
    '};',
    '',
    '/** Where the full page is, for the reader who wants every file and every link. */',
    "export const CREDITS_NOTE = 'Full attribution, with every built file and every link: CREDITS.md in the project repository.';",
    '',
  ].join('\n');
}

/** What a run would write, as `[path, contents]`. */
function generated() {
  return [
    [ROOT_CREDITS, rootCreditsMarkdown()],
    [WEAPON_CREDITS, creditsMarkdown()],
    [CREDITS_MODULE, creditsModule()],
  ];
}

/** `--check`: every problem, as lines. Empty when the tree is what this script would write. */
export function problems() {
  const found = [];
  for (const [file, want] of generated()) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (!existsSync(file)) found.push(`${rel} is missing — run \`node scripts/credits.mjs\`.`);
    else if (readFileSync(file, 'utf8') !== want) found.push(`${rel} does not match the records — run \`node scripts/credits.mjs\`.`);
  }
  const all = credited();
  if (all.length === 0) found.push('no model files were found to credit — is public/models/ present?');
  for (const { file, want } of all) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (!stamped(file, want)) found.push(`${rel} does not carry its attribution in asset.extras — run \`node scripts/credits.mjs\`.`);
  }
  return found;
}

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const found = problems();
    for (const p of found) console.error(`  ${p}`);
    if (found.length > 0) {
      console.error(`\n${found.length} credit problem(s).`);
      process.exit(1);
    }
    const n = credited().length;
    console.log(`Credits: ${n} model file(s) carry their attribution; CREDITS.md and the in-game screen match the records.`);
    return;
  }

  for (const [file, contents] of generated()) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (before === contents) {
      console.log(`${rel.padEnd(34)} unchanged`);
      continue;
    }
    writeFileSync(file, contents);
    console.log(`${rel.padEnd(34)} written (${statSync(file).size} bytes)`);
  }

  let changed = 0;
  let bots = 0;
  for (const { file, want } of credited()) {
    if (!stamp(file, want)) continue;
    changed++;
    if (path.relative(BOTS_DIR, file).startsWith('..')) continue;
    bots++;
  }
  console.log(`\nStamped ${changed} model file(s) with asset.extras.attribution.`);
  if (bots > 0) console.log(`${bots} of them are under public/models/bots/ — bump CHARACTER_VERSION in CharacterCatalog.ts so caches drop the old bytes.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
