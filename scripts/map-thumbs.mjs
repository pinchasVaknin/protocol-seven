#!/usr/bin/env node
/**
 * The map pictures (M17, C3).
 *
 * Renders every registered map through `probes/map-thumb.html` — the menu's own backdrop,
 * built and lit as the menu builds and lights it, the fight off — in the headless Chrome
 * `layout-probe.mjs` already drives, and writes the JPEGs to `public/maps/<id>.jpg`. Play
 * Solo shows the chosen one large and every one as a card (both crop the same file), and the
 * project has no other picture of a map. Committed like any other asset; re-made when a map
 * is added or changed.
 *
 * Software WebGL (`--disable-gpu`, SwiftShader) on purpose, as `skin-thumbs.mjs`: the bytes
 * are then the same on every machine that regenerates them. A map is a few seconds each.
 *
 * `node scripts/map-thumbs.mjs [id ...]` — no ids renders every map.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, withPage } from './headless-chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public/maps');

/** The map ids, read off the map files the way `check-*` scripts read their tables. */
function registered() {
  const dir = path.join(ROOT, 'src/shared/world/maps');
  const out = [];
  for (const file of ['foundry.ts', 'dunes.ts', 'depot.ts', 'greybox.ts']) {
    const source = readFileSync(path.join(dir, file), 'utf8');
    const m = /^\s*id: '([a-z_]+)',/m.exec(source);
    if (m !== null) out.push(m[1]);
  }
  return out;
}

const all = registered();
const asked = process.argv.slice(2);
const ids = asked.length > 0 ? asked : all;
for (const id of ids) {
  if (!all.includes(id)) {
    console.error(`no map "${id}". Known: ${all.join(', ')}`);
    process.exit(1);
  }
}

mkdirSync(OUT_DIR, { recursive: true });

await withPage('maps', `/probes/map-thumb.html?map=${ids[0]}`, async ({ cdp, sessionId, load }) => {
  let first = true;
  for (const id of ids) {
    if (!first) await load(`/probes/map-thumb.html?map=${id}`);
    first = false;
    const ready = await evaluate(cdp, sessionId, 'window.__mapThumb !== undefined');
    if (ready !== true) throw new Error(`the picture page loaded but never installed window.__mapThumb for "${id}"`);
    const started = Date.now();
    const dataUrl = await evaluate(cdp, sessionId, 'window.__mapThumb.render()');
    const match = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl);
    if (match === null) throw new Error(`"${id}" did not come back as a JPEG data URL`);
    const bytes = Buffer.from(match[1], 'base64');
    const file = path.join(OUT_DIR, `${id}.jpg`);
    writeFileSync(file, bytes);
    console.log(`${id.padEnd(11)} -> public/maps/${id}.jpg  ${Math.round(bytes.length / 1024)} kB  (${Date.now() - started} ms)`);
  }
});

console.log(`\n${ids.length} picture(s) written to public/maps/.`);
