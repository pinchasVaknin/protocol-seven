/**
 * The PROTOCOL SEVEN brand (2026-09-15): the human's logo, as the human's logo.
 *
 * Three files under `public/brand/`, the project's first and only image assets — a decision
 * taken on the day, after a vector reading of the mask was tried and turned down ("I can see
 * you cannot draw it"): the logo on the boot screen and the skull beside the wordmark are the
 * artwork, not an approximation of it.
 *
 * - `logo.png`   — the full logo, its black keyed to alpha, so it stands on any dark ground
 *                  without a box. 1024², 272 kB. The boot screen and the device gate.
 * - `mark.png`   — the skull cut from the logo (438 × 611), keyed the same way; the edge
 *                  pixels un-premultiplied so they composite back to the original over black.
 * - `mark-eyes.png` — only the cyan of the same cut: the eyes and the light across them, alpha
 *                  from the cyan-ness. Laid over the mark and breathed by `app.css`
 *                  (`.op-mark__eyes`), which is how a raster's eyes glow more and less.
 * - `favicon.png`, `favicon.ico` — the mark on a near-black rounded plate (`--c-void`), 256²
 *                  and 16/32/48, for the browser tab (M17, C0; the plate from the human's
 *                  report that the keyed mark alone read white on a light tab strip). Linked
 *                  from `index.html`.
 * - `splash-protocol.png`, `splash-rule.png`, `splash-seven.png` — the word, the rule and the
 *                  word below it, cut from the logo at (480, 400), (478, 487) and (479, 527)
 *                  for the splash (M17, C6; `ui/Splash.ts`), which assembles them with the
 *                  mark — cut at (40, 208) — back into the logo.
 * - `team-allies.png`, `team-axis.png` — the two sides' emblems (M18, decision 7; the human's
 *                  artwork, 2026-09-20): a wolf on a shield with the blue edge, a horned
 *                  demon on the same shield with the red edge. 512², keyed from the JPEGs'
 *                  baked checkerboard (a flood from the border through light neutral pixels,
 *                  a soft edge from the darkest channel, the fringe un-premultiplied). The
 *                  colours are the artwork's, not the palette's: ALLIES and AXIS are relative
 *                  (`ui/TeamColour`), so the wolf is always the viewer's own side and the
 *                  demon always the other, and a colourblind palette recolours the plate and
 *                  the name around them rather than the emblem itself. The debrief's result
 *                  card and board headings (`EndOfMatch.ts`, `app.css` `.dbf`).
 *
 * Made by a one-off Pillow pass from the file the human supplied; the numbers (a key from 12
 * to 72 on the brightest channel, the cyan from 18 to 90 of min(g, b) − r) are in the commit
 * that added them, not in a script the build depends on.
 */

const BRAND_ROOT = '/brand';

/** The side's emblem, by its relation to the viewer: the wolf for the viewer's own, the demon for the other. */
export function teamEmblemUrl(relation: 'FRIENDLY' | 'HOSTILE'): string {
  return `${BRAND_ROOT}/${relation === 'FRIENDLY' ? 'team-allies' : 'team-axis'}.png`;
}

/** The skull beside the name: the mark, with its eyes as a second layer that breathes. */
export function makeMark(className: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `op-mark ${className}`;
  wrap.setAttribute('aria-hidden', 'true');
  const face = document.createElement('img');
  face.className = 'op-mark__face';
  face.src = `${BRAND_ROOT}/mark.png`;
  face.alt = '';
  face.draggable = false;
  const eyes = document.createElement('img');
  eyes.className = 'op-mark__eyes';
  eyes.src = `${BRAND_ROOT}/mark-eyes.png`;
  eyes.alt = '';
  eyes.draggable = false;
  wrap.append(face, eyes);
  return wrap;
}

/** The logo, whole, for the boot screen and the device gate. */
export function makeLockup(): HTMLElement {
  const img = document.createElement('img');
  img.className = 'op-lockup';
  img.src = `${BRAND_ROOT}/logo.png`;
  img.alt = 'PROTOCOL SEVEN';
  img.draggable = false;
  return img;
}
