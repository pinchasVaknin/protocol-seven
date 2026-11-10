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
import { makeMark } from './Emblem';

declare const __APP_VERSION__: string | undefined;
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** What names the place in the header, and what the footer's stamp calls it. */
export interface ScreenPlace {
  readonly title: string;
  readonly subtitle: string;
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
  const head = document.createElement('header');
  head.className = `op-head ${modifier}`;

  const brand = document.createElement('div');
  brand.className = 'op-head__brand';

  const wordmark = document.createElement('span');
  wordmark.className = 'op-head__wordmark';
  wordmark.textContent = 'PROTOCOL SEVEN';

  const rule = document.createElement('span');
  rule.className = 'op-head__rule';

  const where = document.createElement('div');
  where.className = 'op-head__place';
  const title = document.createElement('h1');
  title.className = 'op-head__title';
  title.textContent = place.title;
  const sub = document.createElement('span');
  sub.className = 'op-head__sub';
  sub.textContent = place.subtitle;
  where.append(title, sub);

  brand.append(makeMark('op-head__mark'), wordmark, rule, where);
  head.append(brand, card);
  return head;
}

export function makeScreenFooter(modifier: string, place: ScreenPlace): HTMLElement {
  const foot = document.createElement('footer');
  foot.className = `op-foot ${modifier}`;
  foot.append(makeFootLine(), makeFootStamp(place));
  return foot;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** The footer's first row: the tick, and the game's own three words. */
function makeFootLine(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'op-foot__row';
  const tick = document.createElement('i');
  tick.className = 'op-foot__tick';
  const line = document.createElement('span');
  line.className = 'op-label op-foot__line';
  line.textContent = CHROME_LINE;
  row.append(tick, line);
  return row;
}

/** The footer's second row: the rule, the stamp with this screen's name on it, and the bars. */
function makeFootStamp(place: ScreenPlace): HTMLElement {
  const row = document.createElement('div');
  row.className = 'op-foot__row op-foot__row--stamp';
  const rule = document.createElement('span');
  rule.className = 'op-foot__rule';
  const stamp = document.createElement('span');
  stamp.className = 'op-label op-foot__stamp';
  stamp.textContent = `PROTOCOL 7 // ${place.title} // V ${appVersion()}`;
  const bars = document.createElement('span');
  bars.className = 'op-foot__bars';
  for (let i = 0; i < FOOT_BARS; i++) {
    const bar = document.createElement('i');
    bar.className = 'op-foot__bar';
    // Two of the three lit, as drawn: the third is the one still to earn.
    if (i < FOOT_BARS_LIT) bar.classList.add('is-lit');
    bars.appendChild(bar);
  }
  row.append(rule, stamp, bars);
  return row;
}
//#endregion
