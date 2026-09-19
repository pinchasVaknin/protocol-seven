import { BOT_DIFFICULTIES, BOT_DIFFICULTY_BLURBS, type BotDifficulty } from '../../shared/ai/DifficultyTiers';
import type { GameModeId } from '../../shared/modes/GameMode';
import { findMap, MAPS, MODES, modesForMap, type MapEntry, type ModeEntry } from '../../shared/modes/ModeRegistry';
import type { MenuSelection } from './Menus';
import { makeIconSvg } from './WeaponIcons';

/**
 * The Play Solo page (M17, C3): the reference's screen, on the menu's frame between the bars.
 *
 * Two columns and a bar. **Left**, the map: the chosen one large — its picture, COMBAT MAP,
 * its name, its tagline and its three tags, with a pager in the corner — and under it the
 * MAPS strip, one card per map, the chosen one in the accent. **Right**, the match: `01 MAP`
 * as a row that steps to the next map, `02 GAME MODE` as five cards with their glyphs, `03
 * BOT DIFFICULTY` as five cards with the chosen tier's line beneath, and the TESTBED plate
 * with its own door. **The bar** is OPERATION SUMMARY — map, mode, difficulty — and START
 * MATCH, the one button that starts a match, which is load-bearing because pointer lock can
 * only be asked for from a user gesture.
 *
 * ## The testbed is a card and a plate, and it locks the other two sections (decision 5)
 *
 * The greybox is in the strip as the fourth card, badged, and it is the plate's ENTER TESTBED
 * as well. Picking it — either way — makes the mode the Shooting Range and greys the mode and
 * difficulty sections, because the range has no roster to set a difficulty for and is the one
 * mode the greybox is offered in; the summary then reads SHOOTING RANGE and START MATCH
 * enters it. Picking a real map again restores the mode the player had before, so a look at
 * the testbed costs nothing. The lock is drawn rather than the sections hidden, for the
 * reason the old picker's locked columns were: a control that vanishes tells the player less
 * than one that says why.
 *
 * ## Pictures, rendered once
 *
 * `MapEntry.picture` is `public/maps/<id>.jpg`, made by `npm run maps:thumbs` through the
 * menu's own backdrop (decision 3). The hero and the card crop the same file with
 * `object-fit`, so there is one picture per map and it is the picture the menu stands over.
 *
 * Painted whole on every change, like the menu it sits in: the page is a few dozen elements,
 * and a rebuilt `<img>` with the same `src` comes back from the cache without a flash.
 */

export interface PlaySoloDeps {
  readonly selection: MenuSelection;
  readonly onPickMap: (mapId: string) => void;
  readonly onPickMode: (modeId: GameModeId) => void;
  readonly onPickDifficulty: (difficulty: BotDifficulty) => void;
  /** Start the match as the selection stands. */
  readonly onLaunch: () => void;
}

/** The mode that is the testbed's: the one with a forced map. */
export function testbedMode(): ModeEntry {
  const range = MODES.find((m) => m.forcedMapId !== null);
  if (range === undefined) throw new Error('no mode pins a map; the testbed has no door');
  return range;
}


/**
 * The glyphs, one path each in a 24-box, filled with `currentColor` — drawn here for the
 * reason `WeaponIcons` draws the rifles: there are no image assets, and a glyph in a source
 * file is one the frame scales without a second copy. `fill-rule: evenodd` in the stylesheet
 * is what makes the skull's eyes holes and the tag's ring a ring.
 */
const MODE_GLYPH: Readonly<Record<GameModeId, string>> = {
  TDM:
    'M12 2 C6.5 2 3 6 3 11 c0 2.6 1.2 4.7 3 6 V21 h3 v-2.4 h1.6 V21 h2.8 v-2.4 H15 V21 h3 v-4 ' +
    'c1.8-1.3 3-3.4 3-6 C21 6 17.5 2 12 2 Z M8.4 8.6 a2.3 2.3 0 1 0 0 4.6 a2.3 2.3 0 1 0 0-4.6 Z ' +
    'M15.6 8.6 a2.3 2.3 0 1 0 0 4.6 a2.3 2.3 0 1 0 0-4.6 Z M12 13.4 l1.4 2.6 h-2.8 Z',
  DOM: 'M5 2 h2 v20 H5 Z M7 3 h12 l-3 4.5 3 4.5 H7 Z',
  KC:
    'M9 3 h6 a3 3 0 0 1 3 3 v11 a3 3 0 0 1 -3 3 H9 a3 3 0 0 1 -3 -3 V6 a3 3 0 0 1 3 -3 Z ' +
    'M12 5.2 a1.4 1.4 0 1 0 0 2.8 a1.4 1.4 0 1 0 0-2.8 Z M8.5 11 h7 v1.6 h-7 Z M8.5 14.2 h5 v1.6 h-5 Z',
  FFA:
    'M12 4 A8 8 0 1 0 12 20 A8 8 0 1 0 12 4 Z M12 7 A5 5 0 1 1 12 17 A5 5 0 1 1 12 7 Z ' +
    'M11 1h2v4h-2z M11 19h2v4h-2z M1 11h4v2H1z M19 11h4v2h-4z ' +
    'M12 10.5 A1.5 1.5 0 1 0 12 13.5 A1.5 1.5 0 1 0 12 10.5 Z',
  SND:
    'M10 3 h4 v2.5 h-4 Z M11 6 h2 v2 h-2 Z M6 8 h12 a1 1 0 0 1 1 1 v11 a1 1 0 0 1 -1 1 H6 ' +
    'a1 1 0 0 1 -1 -1 V9 a1 1 0 0 1 1 -1 Z M8 11 h8 v1.8 H8 Z M8 14.5 h5 v1.8 H8 Z M14.5 14.5 h1.5 v1.8 h-1.5 Z',
  RANGE:
    'M9 2 h6 v2 h-1 v4.6 l4.5 9.4 a1.5 1.5 0 0 1 -1.35 2.15 H6.85 A1.5 1.5 0 0 1 5.5 18 L10 8.6 V4 H9 Z ' +
    'M8.2 15 h7.6 l1.4 3 H6.8 Z',
};

/** Chevrons stacked one to four; MIXED is two facing each other. */
const DIFFICULTY_GLYPH: Readonly<Record<BotDifficulty, string>> = {
  RECRUIT: 'M12 8 l7 5.5 -1.5 1.8 L12 11 6.5 15.3 5 13.5 Z',
  REGULAR: 'M12 5 l7 5.5 -1.5 1.8 L12 8 6.5 12.3 5 10.5 Z M12 11.5 l7 5.5 -1.5 1.8 L12 14.5 6.5 18.8 5 17 Z',
  HARDENED:
    'M12 3 l7 5.5 -1.5 1.8 L12 6 6.5 10.3 5 8.5 Z M12 8.5 l7 5.5 -1.5 1.8 L12 11.5 6.5 15.8 5 14 Z ' +
    'M12 14 l7 5.5 -1.5 1.8 L12 17 6.5 21.3 5 19.5 Z',
  VETERAN:
    'M12 1.5 l7 5.5 -1.5 1.8 L12 4.5 6.5 8.8 5 7 Z M12 6.5 l7 5.5 -1.5 1.8 L12 9.5 6.5 13.8 5 12 Z ' +
    'M12 11.5 l7 5.5 -1.5 1.8 L12 14.5 6.5 18.8 5 17 Z M12 16.5 l7 5.5 -1.5 1.8 L12 19.5 6.5 23.8 5 22 Z',
  MIX: 'M12 3 l7 5.5 -1.5 1.8 L12 6 6.5 10.3 5 8.5 Z M12 21 l-7 -5.5 1.5 -1.8 L12 18 l5.5 -4.3 1.5 1.8 Z',
};

const CHEVRON = 'M9 4 L17 12 L9 20 L7.4 18.4 L13.8 12 L7.4 5.6 Z';
const CHEVRON_LEFT = 'M15 4 L7 12 L15 20 L16.6 18.4 L10.2 12 L16.6 5.6 Z';
const DOUBLE_CHEVRON = 'M4 4 L12 12 L4 20 L2.4 18.4 L8.8 12 L2.4 5.6 Z M12 4 L20 12 L12 20 L10.4 18.4 L16.8 12 L10.4 5.6 Z';
const FLASK = 'M9 2 h6 v2 h-1 v4.6 l4.5 9.4 a1.5 1.5 0 0 1 -1.35 2.15 H6.85 A1.5 1.5 0 0 1 5.5 18 L10 8.6 V4 H9 Z M8.2 15 h7.6 l1.4 3 H6.8 Z';
const INFO = 'M12 2 a10 10 0 1 0 0 20 a10 10 0 1 0 0-20 Z M12 4 a8 8 0 1 1 0 16 a8 8 0 1 1 0-16 Z M11 10 h2 v7 h-2 Z M11 7 h2 v2 h-2 Z';
const CLOCK = 'M12 2 a10 10 0 1 0 0 20 a10 10 0 1 0 0-20 Z M12 4 a8 8 0 1 1 0 16 a8 8 0 1 1 0-16 Z M11 6 h2 v6.5 l4 2.4 -1 1.7 -5 -3 Z';
const TAG_MARK = 'M4 4 h16 v16 H4 Z M7 7 h10 v10 H7 Z';

const DIFFICULTY_NAME: Readonly<Record<BotDifficulty, string>> = {
  RECRUIT: 'RECRUIT',
  REGULAR: 'REGULAR',
  HARDENED: 'HARDENED',
  VETERAN: 'VETERAN',
  MIX: 'MIXED',
};

export function paintPlaySolo(deps: PlaySoloDeps): { root: HTMLElement; focus: HTMLElement } {
  const { selection } = deps;
  const map = findMap(selection.mapId);
  const testbed = map.testbed;
  const modeEntry = MODES.find((m) => m.id === selection.modeId) ?? MODES[0]!;

  const root = document.createElement('section');
  root.className = 'ps';
  root.classList.toggle('ps--testbed', testbed);

  root.appendChild(paintLeft(map, deps));
  root.appendChild(paintRight(map, modeEntry, deps));
  const { bar, launch } = paintBar(map, modeEntry, deps);
  root.appendChild(bar);
  return { root, focus: launch };
}

// -- the left column: the hero and the strip ---------------------------------------

function paintLeft(map: MapEntry, deps: PlaySoloDeps): HTMLElement {
  const left = document.createElement('div');
  left.className = 'ps-left';

  // The hero: the picture, the pager over it, the name and the tags in its foot.
  const hero = document.createElement('div');
  hero.className = 'ps-hero';
  const img = document.createElement('img');
  img.className = 'ps-hero__img';
  img.src = map.picture;
  img.alt = '';
  img.draggable = false;
  const shade = document.createElement('div');
  shade.className = 'ps-hero__shade';

  const index = MAPS.indexOf(map);
  const pager = document.createElement('div');
  pager.className = 'ps-pager';
  const prev = arrowButton(CHEVRON_LEFT, 'Previous map', () => deps.onPickMap(MAPS[(index + MAPS.length - 1) % MAPS.length]!.id));
  const count = document.createElement('span');
  count.className = 'ps-pager__count op-num';
  count.textContent = `${pad(index + 1)} / ${pad(MAPS.length)}`;
  const next = arrowButton(CHEVRON, 'Next map', () => deps.onPickMap(MAPS[(index + 1) % MAPS.length]!.id));
  pager.append(prev, count, next);

  const body = document.createElement('div');
  body.className = 'ps-hero__body';
  const label = document.createElement('span');
  label.className = 'op-label ps-hero__label';
  label.textContent = map.testbed ? 'TRAINING MAP' : 'COMBAT MAP';
  const name = document.createElement('h2');
  name.className = 'ps-hero__name';
  name.textContent = map.name;
  const tagline = document.createElement('span');
  tagline.className = 'ps-hero__tagline';
  tagline.textContent = map.tagline;
  const tags = document.createElement('div');
  tags.className = 'ps-tags';
  for (const text of map.tags) {
    const tag = document.createElement('span');
    tag.className = 'ps-tag';
    tag.appendChild(makeIconSvg(TAG_MARK, '0 0 24 24', 'ps-tag__mark'));
    const t = document.createElement('span');
    t.textContent = text;
    tag.appendChild(t);
    tags.appendChild(tag);
  }
  body.append(label, name, tagline, tags);
  hero.append(img, shade, pager, body);

  // The strip: every map as a card, the testbed badged.
  const maps = document.createElement('div');
  maps.className = 'ps-maps';
  const head = document.createElement('div');
  head.className = 'ps-sec__head';
  head.appendChild(sectionLabel('MAPS'));
  const strip = document.createElement('div');
  strip.className = 'ps-maps__strip';
  strip.setAttribute('role', 'listbox');
  strip.setAttribute('aria-label', 'Maps');
  for (const entry of MAPS) {
    const on = entry.id === map.id;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ps-card';
    card.classList.toggle('is-on', on);
    card.classList.toggle('ps-card--testbed', entry.testbed);
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', on ? 'true' : 'false');
    const pic = document.createElement('img');
    pic.className = 'ps-card__img';
    pic.src = entry.picture;
    pic.alt = '';
    pic.draggable = false;
    const foot = document.createElement('span');
    foot.className = 'ps-card__foot';
    if (entry.testbed) foot.appendChild(makeIconSvg(FLASK, '0 0 24 24', 'ps-card__badge'));
    const cname = document.createElement('span');
    cname.className = 'ps-card__name';
    cname.textContent = entry.name;
    foot.appendChild(cname);
    card.append(pic, foot);
    card.addEventListener('click', () => deps.onPickMap(entry.id));
    strip.appendChild(card);
  }
  maps.append(head, strip);

  left.append(hero, maps);
  return left;
}

// -- the right column: the map row, the modes, the difficulty, the testbed ------------

function paintRight(map: MapEntry, modeEntry: ModeEntry, deps: PlaySoloDeps): HTMLElement {
  const right = document.createElement('div');
  right.className = 'ps-right';
  const testbed = map.testbed;

  // 01 MAP: the chosen map as a row that steps to the next one.
  const mapSec = section('01', 'MAP');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'ps-maprow';
  row.title = 'Next map';
  const thumb = document.createElement('img');
  thumb.className = 'ps-maprow__img';
  thumb.src = map.picture;
  thumb.alt = '';
  thumb.draggable = false;
  const rname = document.createElement('span');
  rname.className = 'ps-maprow__name';
  rname.textContent = map.name;
  row.append(thumb, rname, makeIconSvg(CHEVRON, '0 0 24 24', 'ps-maprow__chevron'));
  const index = MAPS.indexOf(map);
  row.addEventListener('click', () => deps.onPickMap(MAPS[(index + 1) % MAPS.length]!.id));
  mapSec.appendChild(row);

  // 02 GAME MODE: the five, locked to the range on the testbed.
  const modeSec = section('02', 'GAME MODE', testbed ? 'SHOOTING RANGE ONLY' : '');
  modeSec.classList.toggle('is-locked', testbed);
  const modes = document.createElement('div');
  modes.className = 'ps-cards ps-cards--modes';
  modes.setAttribute('role', 'listbox');
  modes.setAttribute('aria-label', 'Game mode');
  const playable = new Set(modesForMap(map.id).map((m) => m.id));
  for (const mode of MODES) {
    if (mode.forcedMapId !== null) continue; // the range is the testbed's door, not a card
    const on = mode.id === modeEntry.id;
    const card = optionCard(MODE_GLYPH[mode.id], mode.name, on, testbed || !playable.has(mode.id));
    card.title = mode.blurb;
    card.addEventListener('click', () => deps.onPickMode(mode.id));
    modes.appendChild(card);
  }
  modeSec.appendChild(modes);

  // 03 BOT DIFFICULTY: the five, with the chosen one's line beneath.
  const diffSec = section('03', 'BOT DIFFICULTY', testbed ? 'NO BOTS IN THE RANGE' : '');
  diffSec.classList.toggle('is-locked', testbed);
  const diffs = document.createElement('div');
  diffs.className = 'ps-cards ps-cards--diffs';
  diffs.setAttribute('role', 'listbox');
  diffs.setAttribute('aria-label', 'Bot difficulty');
  for (const tier of BOT_DIFFICULTIES) {
    const on = tier === deps.selection.difficulty;
    const card = optionCard(DIFFICULTY_GLYPH[tier], DIFFICULTY_NAME[tier], on, testbed);
    card.addEventListener('click', () => deps.onPickDifficulty(tier));
    diffs.appendChild(card);
  }
  const blurb = document.createElement('p');
  blurb.className = 'ps-blurb';
  blurb.textContent = testbed ? 'The range fills no roster; there is nobody for a difficulty to describe.' : `${BOT_DIFFICULTY_BLURBS[deps.selection.difficulty]}.`;
  diffSec.append(diffs, blurb);

  // The TESTBED plate: its own door.
  const plate = document.createElement('div');
  plate.className = 'ps-testbed';
  plate.classList.toggle('is-on', testbed);
  const top = document.createElement('div');
  top.className = 'ps-testbed__top';
  top.appendChild(makeIconSvg(FLASK, '0 0 24 24', 'ps-testbed__icon'));
  const titles = document.createElement('div');
  titles.className = 'ps-testbed__titles';
  const tt = document.createElement('span');
  tt.className = 'ps-testbed__title';
  tt.textContent = 'TESTBED';
  const ts = document.createElement('span');
  ts.className = 'op-label ps-testbed__sub';
  ts.textContent = 'WEAPON TEST FACILITY';
  titles.append(tt, ts);
  const enter = document.createElement('button');
  enter.type = 'button';
  enter.className = 'op-cta op-cta--quiet ps-testbed__enter';
  const el = document.createElement('span');
  el.textContent = 'ENTER TESTBED';
  enter.append(el, makeIconSvg(CHEVRON, '0 0 24 24', 'op-cta__chevron'));
  const testbedEntry = MAPS.find((m) => m.testbed);
  enter.addEventListener('click', () => {
    if (testbedEntry !== undefined) deps.onPickMap(testbedEntry.id);
    deps.onLaunch();
  });
  top.append(titles, enter);
  const note = document.createElement('div');
  note.className = 'ps-testbed__note';
  note.appendChild(makeIconSvg(INFO, '0 0 24 24', 'ps-testbed__info'));
  const nt = document.createElement('span');
  nt.textContent = 'This map is for training and experimentation only. Game modes and bot difficulty are disabled.';
  note.appendChild(nt);
  plate.append(top, note);

  right.append(mapSec, modeSec, diffSec, plate);
  return right;
}

// -- the bar: the summary and START MATCH ----------------------------------------------

function paintBar(
  map: MapEntry,
  modeEntry: ModeEntry,
  deps: PlaySoloDeps,
): { bar: HTMLElement; launch: HTMLButtonElement } {
  const bar = document.createElement('div');
  bar.className = 'op-actionbar ps-bar';

  const summary = document.createElement('div');
  summary.className = 'op-actionbar__lead ps-summary';
  const head = document.createElement('span');
  head.className = 'ps-summary__head';
  head.appendChild(makeIconSvg(CLOCK, '0 0 24 24', 'ps-summary__icon'));
  const ht = document.createElement('span');
  ht.className = 'ps-summary__title';
  ht.textContent = 'OPERATION SUMMARY';
  head.appendChild(ht);
  summary.appendChild(head);
  const facts: readonly (readonly [string, string])[] = [
    ['MAP', map.name],
    ['MODE', modeEntry.name],
    ['DIFFICULTY', map.testbed ? '—' : DIFFICULTY_NAME[deps.selection.difficulty]],
  ];
  for (const [label, value] of facts) {
    const fact = document.createElement('span');
    fact.className = 'ps-fact';
    const l = document.createElement('span');
    l.className = 'op-label ps-fact__label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'ps-fact__value';
    v.textContent = value;
    fact.append(l, v);
    summary.appendChild(fact);
  }

  const launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'op-cta op-cta--primary ps-launch';
  launch.appendChild(makeIconSvg(DOUBLE_CHEVRON, '0 0 24 24', 'op-cta__lead'));
  const text = document.createElement('span');
  text.textContent = map.testbed ? 'ENTER TESTBED' : 'START MATCH';
  launch.appendChild(text);
  launch.addEventListener('click', () => deps.onLaunch());

  bar.append(summary, launch);
  return { bar, launch };
}

// -- primitives ---------------------------------------------------------------------------

function section(number: string, title: string, note = ''): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'ps-sec';
  const head = document.createElement('div');
  head.className = 'ps-sec__head';
  const num = document.createElement('span');
  num.className = 'ps-sec__num op-num';
  num.textContent = number;
  head.append(num, sectionLabel(title));
  if (note !== '') {
    const n = document.createElement('span');
    n.className = 'op-label ps-sec__note';
    n.textContent = note;
    head.appendChild(n);
  }
  sec.appendChild(head);
  return sec;
}

function sectionLabel(text: string): HTMLElement {
  const label = document.createElement('span');
  label.className = 'ps-sec__label';
  label.textContent = text;
  return label;
}

/** A card with a glyph over a name: the mode and the difficulty options. */
function optionCard(glyph: string, name: string, on: boolean, disabled: boolean): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'ps-opt';
  card.classList.toggle('is-on', on);
  card.disabled = disabled;
  card.setAttribute('role', 'option');
  card.setAttribute('aria-selected', on ? 'true' : 'false');
  card.appendChild(makeIconSvg(glyph, '0 0 24 24', 'ps-opt__glyph'));
  const label = document.createElement('span');
  label.className = 'ps-opt__name';
  label.textContent = name;
  card.appendChild(label);
  return card;
}

function arrowButton(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ps-pager__arrow';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(makeIconSvg(glyph, '0 0 24 24', 'ps-pager__glyph'));
  b.addEventListener('click', onClick);
  return b;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
