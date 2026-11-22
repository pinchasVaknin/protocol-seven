/**
 * The chrome a front-end screen shares (playtest round 3, R3.1; the bars unified by M17, C1):
 * the header across the top and the footer across the bottom, the same two elements on the
 * menu, Play Solo, Create-a-Class and Settings.
 *
 * *"We have a bar at the top that persists across the windows, where only the name of the
 * place changes on the left."* So one element shape, left to right: the skull mark
 * (`Emblem.ts`) with its breathing eyes and the wordmark beside it, a rule, then whatever
 * names the place — a title over a subtitle: PLAY SOLO over SELECT COMBAT SCENARIO, SYSTEM
 * CONTROL over CONFIGURE OPERATIVE PARAMETERS — and the player card (`PlayerCard.ts`) at the
 * right end. The footer is the human's line at the left — the accent tick and FIGHT · SURVIVE
 * · WIN — and a second row beneath it: a hairline running to the right end, the stamp
 * `PROTOCOL 7 // <PLACE> // V <version>`, and three slanted bars of which two are lit.
 *
 * Both mount on the screen's *viewport*, not its frame (R1.1), which is what puts the mark at
 * the window's edge on a window wider than 16:9; each screen sets the bars' inset with a
 * modifier class, because the menu's frame fills the viewport and the others' do not.
 *
 * The version is the one in `package.json`, injected at build time by `vite.config.ts` —
 * one number, read where it is written, rather than a second copy of it in a source file.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { el } from './Dom';
import { makeMark } from './Emblem';
import { makeIconSvg } from './WeaponIcons';

declare const __APP_VERSION__: string | undefined;
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** What names the place in the header, and what the footer's stamp calls it. */
export interface ScreenPlace {
  readonly title: string;
  readonly subtitle: string;
}

/** One arrow of a pager. See `pagerArrow`. */
export interface PagerArrowSpec {
  /** The button's own class: two screens page with the editor's `lo-arrow`, PLAY SOLO has its own. */
  readonly className: string;
  /** A chevron to write as text, or — with `icon` set — the SVG path to draw inside the button. */
  readonly glyph: string;
  /** The `aria-label`, and the `title` as well when `titled` is set. */
  readonly label: string;
  /** Draw `glyph` as an SVG of this view box and class instead of writing it as text. */
  readonly icon?: { readonly viewBox: string; readonly className: string };
  /** A tooltip as well as a label. */
  readonly titled?: boolean;
  /** A page that is not there: the arrow stays in place and refuses. */
  readonly disabled?: boolean;
  readonly onClick: () => void;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** The one line on the footer (playtest round 3, decision 9): the human's own words, in the house style. */
export const CHROME_LINE = 'FIGHT · SURVIVE · WIN';

/** The bars at the footer's right end, two of three lit. The third is the one still to earn. */
const FOOT_BARS = 3;
const FOOT_BARS_LIT = 2;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** The build's version for the stamp, or `dev` when the define is absent (a test, a probe page built without it). */
export function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ !== '' ? __APP_VERSION__ : 'dev';
}

export function makeScreenHeader(modifier: string, place: ScreenPlace, card: HTMLElement): HTMLElement {
  const head = el('header', `op-head ${modifier}`);

  const brand = el('div', 'op-head__brand');

  const wordmark = el('span', 'op-head__wordmark', 'PROTOCOL SEVEN');

  const rule = el('span', 'op-head__rule');

  const where = el('div', 'op-head__place');
  const title = document.createElement('h1');
  title.className = 'op-head__title';
  title.textContent = place.title;
  const sub = el('span', 'op-head__sub', place.subtitle);
  where.append(title, sub);

  brand.append(makeMark('op-head__mark'), wordmark, rule, where);
  head.append(brand, card);
  return head;
}

export function makeScreenFooter(modifier: string, place: ScreenPlace): HTMLElement {
  const foot = el('footer', `op-foot ${modifier}`);
  foot.append(makeFootLine(), makeFootStamp(place));
  return foot;
}
/**
 * One arrow of a pager, for the three screens that have one.
 *
 * Create-a-Class, INFO's credits and PLAY SOLO's map picker each built this button themselves,
 * four to seven lines each, and two of the three used the same two classes — the credits pager
 * is deliberately the editor's control and says so in its own comment (BACKLOG #74). The third
 * is the same button in different clothes: its own class, an SVG glyph instead of a text
 * chevron, and a tooltip. So the differences are arguments and the element is this.
 *
 * It lives here rather than in one of the three because all three are finished and fenced, and
 * no one of them can own a control the other two reach for. Each still keeps a three-line
 * function of its own naming the classes and the handler it pages with; what is shared is the
 * element, which was the thing written three times.
 *
 * **The attributes go on in the order the three screens put them on**, because two browser
 * checksums digest these buttons' serialised trees and `outerHTML` prints attributes in
 * insertion order. `disabled` is assigned either way: assigning `false` adds nothing.
 */
export function pagerArrow(spec: PagerArrowSpec): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = spec.className;
  if (spec.titled === true) b.title = spec.label;
  if (spec.icon === undefined) b.textContent = spec.glyph;
  else b.appendChild(makeIconSvg(spec.glyph, spec.icon.viewBox, spec.icon.className));
  b.setAttribute('aria-label', spec.label);
  b.disabled = spec.disabled ?? false;
  b.addEventListener('click', spec.onClick);
  return b;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** The footer's first row: the tick, and the game's own three words. */
function makeFootLine(): HTMLElement {
  const row = el('div', 'op-foot__row');
  const tick = el('i', 'op-foot__tick');
  const line = el('span', 'op-label op-foot__line', CHROME_LINE);
  row.append(tick, line);
  return row;
}

/** The footer's second row: the rule, the stamp with this screen's name on it, and the bars. */
function makeFootStamp(place: ScreenPlace): HTMLElement {
  const row = el('div', 'op-foot__row op-foot__row--stamp');
  const rule = el('span', 'op-foot__rule');
  const stamp = el('span', 'op-label op-foot__stamp', `PROTOCOL 7 // ${place.title} // V ${appVersion()}`);
  const bars = el('span', 'op-foot__bars');
  for (let i = 0; i < FOOT_BARS; i++) {
    const bar = el('i', 'op-foot__bar');
    // Two of the three lit, as drawn: the third is the one still to earn.
    if (i < FOOT_BARS_LIT) bar.classList.add('is-lit');
    bars.appendChild(bar);
  }
  row.append(rule, stamp, bars);
  return row;
}
//#endregion
