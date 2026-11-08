import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameEvents } from '../../shared/core/Events';
import { RAD2DEG } from '../../shared/core/MathUtil';
import type { HeaderSlot } from '../../shared/modes/GameMode';
import {
  CROSSHAIR_LINE_LENGTH,
  crosshairGapPx,
  crosshairOpacity,
} from '../../shared/ui/Crosshair';
import type { ViewerContext } from '../../shared/ui/TeamColour';
import type { MapDef } from '../../shared/world/maps/types';
import { Hud, LOW_HEALTH_THRESHOLD, makeHudState, type DeathReport, type HudState } from './Hud';
import { viewport } from './Viewport';

/**
 * Characterization tests for the in-match HUD (refactor unit C14, written before the refactor).
 *
 * The same DOM double as the other three HUD tests — see the note in `HudBanner.test.ts` — with
 * two additions this file needs: a canvas with a recording 2D context, because `Hud` builds a
 * real `Minimap` and bakes a raster at construction, and `createElementNS` with `cloneNode`,
 * because a killfeed row paints a weapon icon. `Minimap`, `KillfeedView`, `HudBanner` and
 * `HudTactical` are all the real classes; nothing about the HUD's composition is stubbed.
 *
 * `performance.now` is replaced by a counter the tests move, so the two measurements this class
 * publishes — `lastUpdateMs` and `lastHitLatencyMs` — are exact numbers rather than samples of
 * a wall clock.
 */

// ---------------------------------------------------------------------------- the DOM double

/** Every 2D context call Minimap makes, recorded in order so a baked raster is still a fact. */
class RecordingContext {
  readonly calls: string[] = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  globalAlpha = 1;

  private push(name: string, ...args: number[]): void {
    this.calls.push(args.length === 0 ? name : `${name}(${args.join(',')})`);
  }

  setTransform(...a: number[]): void {
    this.push('setTransform', ...a);
  }
  clearRect(...a: number[]): void {
    this.push('clearRect', ...a);
  }
  fillRect(...a: number[]): void {
    this.push('fillRect', ...a);
  }
  beginPath(): void {
    this.push('beginPath');
  }
  closePath(): void {
    this.push('closePath');
  }
  moveTo(...a: number[]): void {
    this.push('moveTo', ...a);
  }
  lineTo(...a: number[]): void {
    this.push('lineTo', ...a);
  }
  arc(...a: number[]): void {
    this.push('arc', ...a);
  }
  rect(...a: number[]): void {
    this.push('rect', ...a);
  }
  fill(): void {
    this.push('fill');
  }
  stroke(): void {
    this.push('stroke');
  }
  clip(): void {
    this.push('clip');
  }
  save(): void {
    this.push('save');
  }
  restore(): void {
    this.push('restore');
  }
  translate(...a: number[]): void {
    this.push('translate', ...a);
  }
  rotate(...a: number[]): void {
    this.push('rotate', ...a);
  }
  scale(...a: number[]): void {
    this.push('scale', ...a);
  }
  drawImage(): void {
    this.push('drawImage');
  }
  createLinearGradient(...a: number[]): { addColorStop: () => void } {
    this.push('createLinearGradient', ...a);
    return { addColorStop: () => undefined };
  }
}

class FakeElement {
  readonly tokens = new Set<string>();
  /** Unset properties read back as `''`, which is what a real `CSSStyleDeclaration` does. */
  readonly style: Record<string, string> = { opacity: '', transform: '', visibility: '' };
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  textContent = '';
  hidden = false;
  width = 0;
  height = 0;
  parent: FakeElement | null = null;
  ctx: RecordingContext | null = null;

  constructor(readonly tag: string) {}

  get className(): string {
    return [...this.tokens].join(' ');
  }

  set className(value: string) {
    this.tokens.clear();
    for (const token of value.split(' ')) if (token !== '') this.tokens.add(token);
  }

  readonly classList = {
    toggle: (token: string, on?: boolean): void => {
      const want = on ?? !this.tokens.has(token);
      if (want) this.tokens.add(token);
      else this.tokens.delete(token);
    },
    add: (token: string): void => void this.tokens.add(token),
    remove: (token: string): void => void this.tokens.delete(token),
    contains: (token: string): boolean => this.tokens.has(token),
  };

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  cloneNode(_deep?: boolean): FakeElement {
    const copy = new FakeElement(this.tag);
    for (const [key, value] of this.attributes) copy.setAttribute(key, value);
    return copy;
  }

  getContext(kind: string): RecordingContext | null {
    if (kind !== '2d') return null;
    this.ctx ??= new RecordingContext();
    return this.ctx;
  }
}

let nowMs = 1_000;
const realNow = performance.now.bind(performance);

beforeEach(() => {
  nowMs = 1_000;
  performance.now = () => nowMs;
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  };
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
  // The crosshair asks `ui/Viewport` for the window height. Setting it keeps the gap a
  // function of the state alone, and stops the getter reaching for a `window` that is not here.
  viewport.set(1920, 1080);
});

afterEach(() => {
  performance.now = realNow;
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).HTMLElement;
});

// ---------------------------------------------------------------------------- the rig

/** The smallest map the minimap can bake: bounds, and nothing in them. */
const EMPTY_MAP = {
  objectives: [],
  navBounds: { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 4, z: 10 } },
  brushes: [],
  props: [],
} as unknown as MapDef;

const SEAT_A: ViewerContext = { team: 'A', freeForAll: false };
const SEAT_B: ViewerContext = { team: 'B', freeForAll: false };

interface Rig {
  readonly hud: Hud;
  readonly host: FakeElement;
  readonly root: FakeElement;
  readonly crosshair: FakeElement;
  readonly lines: readonly FakeElement[];
  readonly hitmarker: FakeElement;
  readonly ammoBox: FakeElement;
  readonly ammoMag: FakeElement;
  readonly ammoReserve: FakeElement;
  readonly reloadBar: FakeElement;
  readonly numbers: readonly FakeElement[];
  readonly lowVignette: FakeElement;
  readonly hurtVignette: FakeElement;
  readonly directions: readonly FakeElement[];
  readonly healthBar: FakeElement;
  readonly healthFill: FakeElement;
  readonly deadOverlay: FakeElement;
  readonly deadCount: FakeElement;
  readonly deadDetail: FakeElement;
  readonly cheatTag: FakeElement;
  readonly aimWarning: FakeElement;
  readonly headerStrip: FakeElement;
  readonly feed: FakeElement;
}

function at(el: FakeElement, ...path: number[]): FakeElement {
  let node = el;
  for (const index of path) {
    const next = node.children[index];
    if (next === undefined) throw new Error(`no child ${index} of ${node.className}`);
    node = next;
  }
  return node;
}

function rig(maxFriendlies = 4): Rig {
  const host = new FakeElement('div');
  const hud = new Hud({ host: host as unknown as HTMLElement, mapDef: EMPTY_MAP, maxFriendlies });
  const root = host.children[0];
  if (root === undefined) throw new Error('the HUD did not mount');
  return {
    hud,
    host,
    root,
    crosshair: at(root, 0),
    lines: at(root, 0).children.slice(0, 4),
    hitmarker: at(root, 1),
    ammoBox: at(root, 2),
    ammoMag: at(root, 2, 0),
    ammoReserve: at(root, 2, 2),
    reloadBar: at(root, 3),
    numbers: at(root, 4).children,
    lowVignette: at(root, 5),
    hurtVignette: at(root, 6),
    directions: at(root, 7).children,
    healthBar: at(root, 8),
    healthFill: at(root, 8, 0),
    deadOverlay: at(root, 9),
    deadCount: at(root, 9, 1),
    deadDetail: at(root, 9, 2),
    cheatTag: at(root, 10),
    aimWarning: at(root, 11),
    headerStrip: at(root, 12),
    feed: at(root, 15),
  };
}

function state(over: Partial<HudState> = {}): HudState {
  return { ...makeHudState(), ...over };
}

function report(over: Partial<DeathReport> = {}): DeathReport {
  return { killerName: 'vulture', weaponName: '', distanceM: -1, killerHealth: 0, headshot: false, ...over };
}

function slot(label: string, owner: HeaderSlot['owner'], progress = 0, capturing: HeaderSlot['capturing'] = 'NONE'): HeaderSlot {
  return { label, owner, progress, capturing };
}

// ---------------------------------------------------------------------------- the state record

describe('makeHudState', () => {
  it('starts alive at full health with a 30-round magazine and a 90 degree field', () => {
    const fresh = makeHudState();
    expect(fresh.mag).toBe(0);
    expect(fresh.magSize).toBe(30);
    expect(fresh.reserveInfinite).toBe(false);
    expect(fresh.fovDeg).toBe(90);
    expect(fresh.health).toBe(100);
    expect(fresh.healthMax).toBe(100);
    expect(fresh.dead).toBe(false);
    expect(fresh.awaitingRound).toBe(false);
    expect(fresh.deathReport).toBeNull();
  });

  it('carries a fresh banner and tactical record inside it', () => {
    const fresh = makeHudState();
    expect(fresh.banner.round).toBe(1);
    expect(fresh.tactical.breath).toBe(1);
    const other = makeHudState();
    expect(other.banner).not.toBe(fresh.banner);
    expect(other.tactical).not.toBe(fresh.tactical);
  });
});

describe('LOW_HEALTH_THRESHOLD', () => {
  it('is a hard threshold at 35, not a ramp from full health', () => {
    expect(LOW_HEALTH_THRESHOLD).toBe(35);
  });
});

// ---------------------------------------------------------------------------- the tree

describe('the tree it builds', () => {
  it('mounts one root on the host, hidden, and takes it down on dispose', () => {
    const r = rig();
    expect(r.host.children).toHaveLength(1);
    expect(r.root.className).toBe('hud');
    expect(r.root.hidden).toBe(true);
    r.hud.dispose();
    expect(r.host.children).toHaveLength(0);
  });

  it('is twenty-four layers, in the order the stylesheet and the cascade expect', () => {
    // The scope tube goes in before everything else so the HUD draws over it, and the flash
    // white-out goes in last so being flashed hides the HUD.
    const r = rig();
    expect(r.root.children.map((el) => el.className)).toEqual([
      'hud-cross',
      'hud-hit',
      'hud-ammo',
      'hud-reload',
      'hud-numbers',
      'hud-low',
      'hud-hurt',
      'hud-dirs',
      'hud-health',
      'hud-dead',
      'hud-cheat',
      'hud-aim',
      'hud-header',
      'hud-banner',
      'hud-phase',
      'hud-feed',
      'hud-map',
      'hud-scope',
      'hud-tac',
      'hud-cook',
      'hud-breath',
      'hud-bearing hud-bearing--threat',
      'hud-bearing hud-bearing--objective',
      'hud-flash',
    ]);
  });

  it('builds four crosshair lines and a dot', () => {
    const r = rig();
    expect(r.crosshair.children.map((el) => el.className)).toEqual([
      'hud-cross__line hud-cross__line--t',
      'hud-cross__line hud-cross__line--b',
      'hud-cross__line hud-cross__line--l',
      'hud-cross__line hud-cross__line--r',
      'hud-cross__dot',
    ]);
  });

  it('pools fourteen damage numbers and four hit directions, all invisible', () => {
    const r = rig();
    expect(r.numbers).toHaveLength(14);
    expect(r.directions).toHaveLength(4);
    expect(r.numbers.every((el) => el.style.opacity === '0')).toBe(true);
    expect(r.directions.every((el) => el.style.opacity === '0')).toBe(true);
    expect(r.numbers[0]?.className).toBe('hud-number op-num');
  });

  it('builds the hitmarker out of four strokes and the ammo box out of three spans', () => {
    const r = rig();
    expect(r.hitmarker.children).toHaveLength(4);
    expect(r.ammoBox.children.map((el) => el.className)).toEqual([
      'hud-ammo__mag op-num',
      'hud-ammo__sep',
      'hud-ammo__reserve op-num',
    ]);
    expect(at(r.ammoBox, 1).textContent).toBe('/');
  });

  it('writes the death screen label once, at construction', () => {
    const r = rig();
    expect(at(r.deadOverlay, 0).textContent).toBe('You were killed');
    expect(r.deadCount.className).toBe('hud-dead__count op-num');
    expect(r.deadDetail.className).toBe('hud-dead__detail op-label');
  });

  it('leaves the header strip empty — the HUD knows the name of no mode', () => {
    const r = rig();
    expect(r.headerStrip.children).toHaveLength(0);
    expect(r.headerStrip.tokens.has('hud-header--on')).toBe(false);
  });

  it('bakes the minimap raster at construction rather than per frame', () => {
    const r = rig();
    const canvas = at(r.root, 16, 0);
    expect(canvas.className).toBe('hud-map__canvas');
    // 168 px drawn at 2x, which is what keeps the lines crisp without reading devicePixelRatio.
    expect(canvas.width).toBe(336);
    expect(canvas.height).toBe(336);
  });
});

// ---------------------------------------------------------------------------- visibility

describe('setVisible', () => {
  it('shows and hides the root', () => {
    const r = rig();
    r.hud.setVisible(true);
    expect(r.root.hidden).toBe(false);
    r.hud.setVisible(false);
    expect(r.root.hidden).toBe(true);
  });

  it('clears every marker on the way out, so a hidden HUD cannot come back mid-hitmarker', () => {
    const r = rig();
    r.hud.damageNumbersEnabled = true;
    r.hud.showHitmarker(false, nowMs);
    r.hud.showDamageNumber(10, 20, 30, 'torso');
    r.hud.showHitDirection(0);
    r.hud.update(state(), 0);
    expect(r.hitmarker.style.opacity).toBe('1');

    r.hud.setVisible(false);
    expect(r.hitmarker.style.opacity).toBe('0');
    expect(r.numbers[0]?.style.opacity).toBe('0');
    expect(r.directions[0]?.style.opacity).toBe('0');
  });
});

describe('setIntro', () => {
  it('marks the root while the intro camera is flying', () => {
    const r = rig();
    r.hud.setIntro(true);
    expect(r.root.tokens.has('hud--intro')).toBe(true);
    r.hud.setIntro(false);
    expect(r.root.tokens.has('hud--intro')).toBe(false);
  });

  it('is guarded, so a frame that changes nothing writes nothing', () => {
    const r = rig();
    r.hud.setIntro(true);
    r.root.classList.remove('hud--intro');
    r.hud.setIntro(true);
    expect(r.root.tokens.has('hud--intro')).toBe(false);
  });
});

// ---------------------------------------------------------------------------- the two tags

describe('setCheatTag and setAimWarning', () => {
  it('writes the text and brings the tag up through a class, never the hidden attribute', () => {
    const r = rig();
    r.hud.setCheatTag('GOD MODE');
    expect(at(r.cheatTag, 0).textContent).toBe('GOD MODE');
    expect(r.cheatTag.tokens.has('hud-cheat--on')).toBe(true);
    expect(r.cheatTag.hidden).toBe(false);
  });

  it('takes the tag down on an empty string', () => {
    const r = rig();
    r.hud.setCheatTag('GOD MODE');
    r.hud.setCheatTag('');
    expect(at(r.cheatTag, 0).textContent).toBe('');
    expect(r.cheatTag.tokens.has('hud-cheat--on')).toBe(false);
  });

  it('writes once per change, not once per frame', () => {
    const r = rig();
    r.hud.setCheatTag('GOD MODE');
    at(r.cheatTag, 0).textContent = 'TOUCHED';
    r.hud.setCheatTag('GOD MODE');
    expect(at(r.cheatTag, 0).textContent).toBe('TOUCHED');
    r.hud.setCheatTag('INFINITE AMMO');
    expect(at(r.cheatTag, 0).textContent).toBe('INFINITE AMMO');
  });

  it('keeps the aim warning on its own element, because both can be up at once', () => {
    const r = rig();
    r.hud.setCheatTag('GOD MODE');
    r.hud.setAimWarning('MOUSE NOT CAPTURED');
    expect(at(r.cheatTag, 0).textContent).toBe('GOD MODE');
    expect(at(r.aimWarning, 0).textContent).toBe('MOUSE NOT CAPTURED');
    expect(r.aimWarning.tokens.has('hud-aim--on')).toBe(true);
  });

  it('guards the aim warning the same way', () => {
    const r = rig();
    r.hud.setAimWarning('MOUSE NOT CAPTURED');
    at(r.aimWarning, 0).textContent = 'TOUCHED';
    r.hud.setAimWarning('MOUSE NOT CAPTURED');
    expect(at(r.aimWarning, 0).textContent).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the header strip

describe('setHeaderSlots', () => {
  it('stays off and empty for a mode with no slots', () => {
    const r = rig();
    r.hud.setHeaderSlots(SEAT_A, []);
    expect(r.headerStrip.children).toHaveLength(0);
    expect(r.headerStrip.tokens.has('hud-header--on')).toBe(false);
  });

  it('grows one cell per slot and comes on', () => {
    const r = rig();
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A'), slot('B', 'NONE'), slot('C', 'B')]);
    expect(r.headerStrip.children).toHaveLength(3);
    expect(r.headerStrip.tokens.has('hud-header--on')).toBe(true);
    expect(r.headerStrip.children.map((cell) => at(cell, 0).textContent)).toEqual(['A', 'B', 'C']);
  });

  it('paints each cell by what its owner is to this viewer, not by the team letter', () => {
    const a = rig();
    a.hud.setHeaderSlots(SEAT_A, [slot('A', 'A'), slot('B', 'NONE'), slot('C', 'B')]);
    expect(a.headerStrip.children.map((cell) => cell.className)).toEqual([
      'hud-header__cell hud-header__cell--friendly',
      'hud-header__cell hud-header__cell--neutral',
      'hud-header__cell hud-header__cell--hostile',
    ]);

    // The same three slots from the other seat read the other way round, which is the whole
    // reason the guard is keyed on the relation rather than on the team.
    const b = rig();
    b.hud.setHeaderSlots(SEAT_B, [slot('A', 'A'), slot('B', 'NONE'), slot('C', 'B')]);
    expect(b.headerStrip.children.map((cell) => cell.className)).toEqual([
      'hud-header__cell hud-header__cell--hostile',
      'hud-header__cell hud-header__cell--neutral',
      'hud-header__cell hud-header__cell--friendly',
    ]);
  });

  it('fills in the colour of whoever is taking it, which is not always the owner', () => {
    const r = rig();
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', 0.25, 'B')]);
    const fill = at(r.headerStrip, 0, 1);
    expect(fill.className).toBe('hud-header__fill hud-header__fill--hostile');
    expect(fill.style.transform).toBe('scaleX(0.250)');
  });

  it('clamps a progress outside 0..1', () => {
    const r = rig();
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', 4, 'A')]);
    expect(at(r.headerStrip, 0, 1).style.transform).toBe('scaleX(1.000)');
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', -4, 'A')]);
    expect(at(r.headerStrip, 0, 1).style.transform).toBe('scaleX(0.000)');
  });

  it('writes nothing while the signature is unchanged', () => {
    const r = rig();
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', 0.25, 'B')]);
    at(r.headerStrip, 0, 0).textContent = 'TOUCHED';
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', 0.25, 'B')]);
    expect(at(r.headerStrip, 0, 0).textContent).toBe('TOUCHED');
  });

  it('quantises the fill to a whole percent, so a moving flag does not write every frame', () => {
    const r = rig();
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', 0.251, 'B')]);
    at(r.headerStrip, 0, 0).textContent = 'TOUCHED';
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', 0.2512, 'B')]);
    expect(at(r.headerStrip, 0, 0).textContent).toBe('TOUCHED');
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', 0.26, 'B')]);
    expect(at(r.headerStrip, 0, 0).textContent).toBe('A');
  });

  it('rebuilds the strip when the slot count changes, and keeps the cells otherwise', () => {
    const r = rig();
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A')]);
    const firstCell = at(r.headerStrip, 0);
    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A', 0.5, 'A')]);
    expect(at(r.headerStrip, 0)).toBe(firstCell);

    r.hud.setHeaderSlots(SEAT_A, [slot('A', 'A'), slot('B', 'B')]);
    expect(r.headerStrip.children).toHaveLength(2);
    expect(at(r.headerStrip, 0)).not.toBe(firstCell);
    expect(firstCell.parent).toBeNull();
  });
});

// ---------------------------------------------------------------------------- the crosshair

describe('update: the crosshair', () => {
  it('places the four lines at the gap the shared rule computes', () => {
    const r = rig();
    r.hud.update(state({ spreadDeg: 2, fovDeg: 90 }), 0);
    const gap = crosshairGapPx(2, 90, 1080);
    const offset = gap + CROSSHAIR_LINE_LENGTH * 0.5;
    expect(r.lines[0]?.style.transform).toBe(`translate(-50%, -50%) translateY(${-offset}px)`);
    expect(r.lines[1]?.style.transform).toBe(`translate(-50%, -50%) translateY(${offset}px)`);
    expect(r.lines[2]?.style.transform).toBe(`translate(-50%, -50%) translateX(${-offset}px)`);
    expect(r.lines[3]?.style.transform).toBe(`translate(-50%, -50%) translateX(${offset}px)`);
  });

  it('opens the gap as the cone widens', () => {
    const r = rig();
    r.hud.update(state({ spreadDeg: 0.5, fovDeg: 90 }), 0);
    const tight = r.lines[0]?.style.transform;
    r.hud.update(state({ spreadDeg: 6, fovDeg: 90 }), 0);
    expect(r.lines[0]?.style.transform).not.toBe(tight);
  });

  it('writes the lines only when the whole-pixel gap changed', () => {
    const r = rig();
    r.hud.update(state({ spreadDeg: 2, fovDeg: 90 }), 0);
    const line = r.lines[0];
    if (line !== undefined) line.style.transform = 'TOUCHED';
    r.hud.update(state({ spreadDeg: 2, fovDeg: 90 }), 0);
    expect(line?.style.transform).toBe('TOUCHED');
  });

  it('fades out on ADS, because the sights are the aiming reference', () => {
    const r = rig();
    r.hud.update(state({ adsFraction: 0 }), 0);
    expect(r.crosshair.style.opacity).toBe(String(crosshairOpacity(0)));
    r.hud.update(state({ adsFraction: 1 }), 0);
    expect(r.crosshair.style.opacity).toBe(String(crosshairOpacity(1)));
  });

  it('hides itself while the player is dead, and comes back on the respawn', () => {
    const r = rig();
    r.hud.update(state({ dead: true, respawnSeconds: 3 }), 0);
    expect(r.crosshair.style.visibility).toBe('hidden');
    r.hud.update(state({ dead: false }), 0);
    expect(r.crosshair.style.visibility).toBe('');
  });
});

// ---------------------------------------------------------------------------- the ammo counter

describe('update: the ammo counter', () => {
  it('writes the magazine and the reserve', () => {
    const r = rig();
    r.hud.update(state({ mag: 24, reserve: 90 }), 0);
    expect(r.ammoMag.textContent).toBe('24');
    expect(r.ammoReserve.textContent).toBe('90');
  });

  it('draws an infinite belt as a glyph rather than inventing a number', () => {
    const r = rig();
    r.hud.update(state({ mag: 100, reserve: 0, reserveInfinite: true }), 0);
    expect(r.ammoReserve.textContent).toBe('∞');
  });

  it('marks a low magazine at a quarter of its size, rounded up', () => {
    const r = rig();
    r.hud.update(state({ mag: 9, magSize: 30 }), 0);
    expect(r.ammoBox.tokens.has('hud-ammo--low')).toBe(false);
    r.hud.update(state({ mag: 8, magSize: 30 }), 0);
    expect(r.ammoBox.tokens.has('hud-ammo--low')).toBe(true);
  });

  it('keeps at least one round as the low threshold, whatever the magazine size', () => {
    const r = rig();
    r.hud.update(state({ mag: 1, magSize: 1 }), 0);
    expect(r.ammoBox.tokens.has('hud-ammo--low')).toBe(true);
    r.hud.update(state({ mag: 2, magSize: 2 }), 0);
    expect(r.ammoBox.tokens.has('hud-ammo--low')).toBe(false);
  });

  it('writes the counters only when the text changed', () => {
    const r = rig();
    r.hud.update(state({ mag: 24 }), 0);
    r.ammoMag.textContent = 'TOUCHED';
    r.hud.update(state({ mag: 24 }), 0);
    expect(r.ammoMag.textContent).toBe('TOUCHED');
  });

  it('shows the reload bar and fills it while a reload runs', () => {
    const r = rig();
    r.hud.update(state({ reloading: true, reloadFraction: 0.3 }), 0);
    expect(r.reloadBar.tokens.has('hud-reload--on')).toBe(true);
    expect(at(r.reloadBar, 0).style.transform).toBe('scaleX(0.300)');
  });

  it('stops writing the fill the moment the reload ends', () => {
    const r = rig();
    r.hud.update(state({ reloading: true, reloadFraction: 0.3 }), 0);
    at(r.reloadBar, 0).style.transform = 'TOUCHED';
    r.hud.update(state({ reloading: false, reloadFraction: 0.9 }), 0);
    expect(r.reloadBar.tokens.has('hud-reload--on')).toBe(false);
    expect(at(r.reloadBar, 0).style.transform).toBe('TOUCHED');
  });

  it('clamps a reload fraction outside 0..1', () => {
    const r = rig();
    r.hud.update(state({ reloading: true, reloadFraction: 4 }), 0);
    expect(at(r.reloadBar, 0).style.transform).toBe('scaleX(1.000)');
  });
});

// ---------------------------------------------------------------------------- the hitmarker

describe('showHitmarker', () => {
  it('becomes visible on the next frame and reports the latency from the sim', () => {
    const r = rig();
    r.hud.showHitmarker(false, 1_000);
    nowMs = 1_050;
    r.hud.update(state(), 0);
    expect(r.hitmarker.style.opacity).toBe('1');
    expect(r.hud.lastHitLatencyMs).toBe(50);
  });

  it('is red for a kill and carries the killstreak mark for an autonomous one', () => {
    const r = rig();
    r.hud.showHitmarker(true, nowMs, true);
    r.hud.update(state(), 0);
    expect(r.hitmarker.tokens.has('hud-hit--kill')).toBe(true);
    expect(r.hitmarker.tokens.has('hud-hit--auto')).toBe(true);
  });

  it('lets a kill outrank a hit on the same frame, in either order', () => {
    const first = rig();
    first.hud.showHitmarker(true, nowMs);
    first.hud.showHitmarker(false, nowMs);
    first.hud.update(state(), 0);
    expect(first.hitmarker.tokens.has('hud-hit--kill')).toBe(true);

    const second = rig();
    second.hud.showHitmarker(false, nowMs);
    second.hud.showHitmarker(true, nowMs);
    second.hud.update(state(), 0);
    expect(second.hitmarker.tokens.has('hud-hit--kill')).toBe(true);
  });

  it('holds at full for the first third and then falls away', () => {
    const r = rig();
    r.hud.showHitmarker(false, nowMs);
    r.hud.update(state(), 0);
    r.hud.update(state(), 0.05);
    expect(r.hitmarker.style.opacity).toBe('1.00');
    expect(r.hitmarker.style.transform).toBe('translate(-50%, -50%) scale(1.067)');
    r.hud.update(state(), 0.05);
    expect(r.hitmarker.style.opacity).toBe('0.93');
  });

  it('goes away when its time is up, and stays away', () => {
    const r = rig();
    r.hud.showHitmarker(false, nowMs);
    r.hud.update(state(), 0);
    r.hud.update(state(), 1);
    expect(r.hitmarker.style.opacity).toBe('0');
    r.hitmarker.style.opacity = 'TOUCHED';
    r.hud.update(state(), 1);
    expect(r.hitmarker.style.opacity).toBe('TOUCHED');
  });

  it('gives a kill a longer mark than a hit', () => {
    const hit = rig();
    hit.hud.showHitmarker(false, nowMs);
    hit.hud.update(state(), 0);
    hit.hud.update(state(), 0.3);
    expect(hit.hitmarker.style.opacity).toBe('0');

    const kill = rig();
    kill.hud.showHitmarker(true, nowMs);
    kill.hud.update(state(), 0);
    kill.hud.update(state(), 0.3);
    expect(kill.hitmarker.style.opacity).not.toBe('0');
  });

  it('drops the marks and the latency when the player dies', () => {
    const r = rig();
    r.hud.showHitmarker(false, 1_000);
    nowMs = 1_010;
    r.hud.update(state(), 0);
    r.hud.update(state({ dead: true, respawnSeconds: 5 }), 0);
    expect(r.hitmarker.style.opacity).toBe('0');
  });
});

// ---------------------------------------------------------------------------- damage numbers

describe('showDamageNumber', () => {
  it('is off by default', () => {
    const r = rig();
    r.hud.showDamageNumber(100, 200, 42, 'torso');
    expect(r.numbers[0]?.textContent).toBe('');
    expect(r.numbers[0]?.style.opacity).toBe('0');
  });

  it('writes a rounded amount and marks a headshot', () => {
    const r = rig();
    r.hud.damageNumbersEnabled = true;
    r.hud.showDamageNumber(100, 200, 42.6, 'head');
    expect(r.numbers[0]?.textContent).toBe('43');
    expect(r.numbers[0]?.style.opacity).toBe('1');
    expect(r.numbers[0]?.tokens.has('hud-number--head')).toBe(true);

    r.hud.showDamageNumber(0, 0, 10, 'leg');
    expect(r.numbers[1]?.tokens.has('hud-number--head')).toBe(false);
  });

  it('places the number on a transform and floats it up, never on left and top', () => {
    const r = rig();
    r.hud.damageNumbersEnabled = true;
    r.hud.showDamageNumber(100, 200, 42, 'torso');
    r.hud.update(state(), 0.1);
    expect(r.numbers[0]?.style.transform).toBe(
      'translate(100px, 200px) translate(-50%, -50%) translateY(-3.5px)',
    );
    expect(r.numbers[0]?.style.opacity).toBe('0.98');
  });

  it('takes the next free slot and drops the fifteenth', () => {
    const r = rig();
    r.hud.damageNumbersEnabled = true;
    for (let i = 0; i < 14; i++) r.hud.showDamageNumber(i, 0, i + 1, 'torso');
    expect(r.numbers.map((el) => el.textContent)).toEqual(
      Array.from({ length: 14 }, (_, i) => String(i + 1)),
    );
    r.hud.showDamageNumber(99, 0, 99, 'torso');
    expect(r.numbers.some((el) => el.textContent === '99')).toBe(false);
  });

  it('frees a slot when its number expires', () => {
    const r = rig();
    r.hud.damageNumbersEnabled = true;
    r.hud.showDamageNumber(1, 0, 11, 'torso');
    r.hud.update(state(), 1);
    expect(r.numbers[0]?.style.opacity).toBe('0');
    r.hud.showDamageNumber(2, 0, 22, 'torso');
    expect(r.numbers[0]?.textContent).toBe('22');
  });
});

// ---------------------------------------------------------------------------- hit directions

describe('showHitDirection', () => {
  it('rotates a chevron to a tenth of a degree', () => {
    const r = rig();
    r.hud.showHitDirection(Math.PI / 2);
    expect(r.directions[0]?.style.transform).toBe(`rotate(${((Math.PI / 2) * RAD2DEG).toFixed(1)}deg)`);
    expect(r.directions[0]?.style.opacity).toBe('1');
  });

  it('pools four, because being shot by two bots at once has to read as two directions', () => {
    const r = rig();
    for (let i = 0; i < 4; i++) r.hud.showHitDirection(i);
    expect(r.directions.every((el) => el.style.opacity === '1')).toBe(true);
  });

  it('evicts the oldest when a fifth round arrives', () => {
    const r = rig();
    for (let i = 0; i < 4; i++) {
      r.hud.showHitDirection(i);
      // Each one is a little older than the last, so the first is the one with least life.
      r.hud.update(state(), 0.01);
    }
    const firstTransform = r.directions[0]?.style.transform;
    r.hud.showHitDirection(Math.PI);
    expect(r.directions[0]?.style.transform).not.toBe(firstTransform);
    expect(r.directions[0]?.style.transform).toBe(`rotate(${(Math.PI * RAD2DEG).toFixed(1)}deg)`);
  });

  it('fades on a square, and frees the slot at the end', () => {
    const r = rig();
    r.hud.showHitDirection(0);
    r.hud.update(state(), 0.55);
    expect(r.directions[0]?.style.opacity).toBe('0.25');
    r.hud.update(state(), 0.55);
    expect(r.directions[0]?.style.opacity).toBe('0');
  });
});

// ---------------------------------------------------------------------------- the hurt flash

describe('showHurt', () => {
  it('scales the flash by how much of the player it took', () => {
    const r = rig();
    r.hud.showHurt(35, 100);
    r.hud.update(state(), 0);
    expect(r.hurtVignette.style.opacity).toBe('1.00');
  });

  it('decays on a square, so a tint does not read as still being shot', () => {
    const r = rig();
    r.hud.showHurt(35, 100);
    r.hud.update(state(), 0);
    r.hud.update(state(), 0.21);
    expect(r.hurtVignette.style.opacity).toBe('0.25');
    r.hud.update(state(), 0.21);
    expect(r.hurtVignette.style.opacity).toBe('0.00');
  });

  it('keeps whichever flash is stronger, so a burst does not restart at its weakest hit', () => {
    const r = rig();
    r.hud.showHurt(35, 100);
    r.hud.update(state(), 0.21);
    r.hud.showHurt(3.5, 100);
    r.hud.update(state(), 0);
    expect(r.hurtVignette.style.opacity).toBe('0.50');
  });

  it('clamps a graze and a near-death burst to the same ends', () => {
    const r = rig();
    r.hud.showHurt(400, 100);
    r.hud.update(state(), 0);
    expect(r.hurtVignette.style.opacity).toBe('1.00');
  });

  it('survives a maximum health of zero rather than dividing by it', () => {
    const r = rig();
    r.hud.showHurt(1, 0);
    r.hud.update(state(), 0);
    expect(r.hurtVignette.style.opacity).toBe('1.00');
  });

  it('writes nothing while the rounded alpha is unchanged', () => {
    const r = rig();
    r.hud.showHurt(35, 100);
    r.hud.update(state(), 0);
    r.hurtVignette.style.opacity = 'TOUCHED';
    r.hud.update(state(), 0);
    expect(r.hurtVignette.style.opacity).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the health bar

describe('update: the health bar', () => {
  it('scales the fill by the fraction left, quantised to a hundredth', () => {
    const r = rig();
    r.hud.update(state({ health: 50, healthMax: 100 }), 0);
    expect(r.healthFill.style.transform).toBe('scaleX(0.50)');
  });

  it('is on screen only while it means something', () => {
    const r = rig();
    r.hud.update(state({ health: 100, healthMax: 100 }), 0);
    expect(r.healthBar.tokens.has('hud-health--on')).toBe(false);
    r.hud.update(state({ health: 99, healthMax: 100 }), 0);
    expect(r.healthBar.tokens.has('hud-health--on')).toBe(true);
  });

  it('goes away while the player is dead', () => {
    const r = rig();
    r.hud.update(state({ health: 50, healthMax: 100 }), 0);
    r.hud.update(state({ health: 50, healthMax: 100, dead: true }), 0);
    expect(r.healthBar.tokens.has('hud-health--on')).toBe(false);
  });

  it('goes critical at a third', () => {
    const r = rig();
    r.hud.update(state({ health: 35, healthMax: 100 }), 0);
    expect(r.healthBar.tokens.has('hud-health--critical')).toBe(false);
    r.hud.update(state({ health: 34, healthMax: 100 }), 0);
    expect(r.healthBar.tokens.has('hud-health--critical')).toBe(true);
  });

  it('reads an empty maximum as no health rather than as a division', () => {
    const r = rig();
    r.hud.update(state({ health: 50, healthMax: 0 }), 0);
    expect(r.healthFill.style.transform).toBe('scaleX(0.00)');
  });

  it('writes the fill only when the quantised scale changed', () => {
    const r = rig();
    r.hud.update(state({ health: 50, healthMax: 100 }), 0);
    r.healthFill.style.transform = 'TOUCHED';
    r.hud.update(state({ health: 50.4, healthMax: 100 }), 0);
    expect(r.healthFill.style.transform).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the low-health rim

describe('update: the low-health state', () => {
  it('is nothing at all above the threshold', () => {
    const r = rig();
    r.hud.update(state({ health: LOW_HEALTH_THRESHOLD, healthMax: 100 }), 0);
    expect(r.hud.lowHealthIntensity).toBe(0);
    expect(r.lowVignette.style.opacity).toBe('0.00');
  });

  it('rises the closer to zero the player gets', () => {
    const r = rig();
    r.hud.update(state({ health: 20, healthMax: 100 }), 0);
    expect(r.hud.lowHealthIntensity).toBeCloseTo((35 - 20) / 35, 12);
    expect(r.lowVignette.style.opacity).toBe('0.31');
  });

  it('never goes fully opaque, because the centre has to stay readable at 5 HP', () => {
    const r = rig();
    r.hud.update(state({ health: 0, healthMax: 100 }), 0);
    expect(r.hud.lowHealthIntensity).toBe(1);
    expect(r.lowVignette.style.opacity).toBe('0.72');
  });

  it('reads a dead player as healthy, so the rim is not held up over the death screen', () => {
    const r = rig();
    r.hud.update(state({ health: 0, healthMax: 100, dead: true, respawnSeconds: 5 }), 0);
    expect(r.hud.lowHealthIntensity).toBe(0);
    expect(r.lowVignette.style.opacity).toBe('0.00');
  });

  it('writes nothing while the rounded alpha is unchanged', () => {
    const r = rig();
    r.hud.update(state({ health: 20, healthMax: 100 }), 0);
    r.lowVignette.style.opacity = 'TOUCHED';
    r.hud.update(state({ health: 20.1, healthMax: 100 }), 0);
    expect(r.lowVignette.style.opacity).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the death screen

describe('update: the death screen', () => {
  it('comes up with the player death and goes down on the respawn', () => {
    const r = rig();
    r.hud.update(state({ dead: true, respawnSeconds: 5 }), 0);
    expect(r.deadOverlay.tokens.has('hud-dead--on')).toBe(true);
    r.hud.update(state({ dead: false }), 0);
    expect(r.deadOverlay.tokens.has('hud-dead--on')).toBe(false);
  });

  it('counts the respawn down to a tenth', () => {
    const r = rig();
    r.hud.update(state({ dead: true, respawnSeconds: 4.2 }), 0);
    expect(r.deadCount.textContent).toBe('4.2');
  });

  it('says RESPAWNING once the count is spent', () => {
    const r = rig();
    r.hud.update(state({ dead: true, respawnSeconds: 0 }), 0);
    expect(r.deadCount.textContent).toBe('RESPAWNING');
  });

  it('replaces the number with the truth in a one-life mode', () => {
    const r = rig();
    r.hud.update(state({ dead: true, respawnSeconds: 0, awaitingRound: true }), 0);
    expect(r.deadCount.textContent).toBe('WAITING FOR NEXT ROUND');
  });

  it('says nothing more than that while the player is alive', () => {
    const r = rig();
    r.hud.update(state({ dead: false, respawnSeconds: 5 }), 0);
    expect(r.deadCount.textContent).toBe('');
  });

  it('writes the countdown only when the string changed', () => {
    const r = rig();
    r.hud.update(state({ dead: true, respawnSeconds: 4.21 }), 0);
    r.deadCount.textContent = 'TOUCHED';
    r.hud.update(state({ dead: true, respawnSeconds: 4.24 }), 0);
    expect(r.deadCount.textContent).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the death report

describe('the death report line', () => {
  function detailFor(over: Partial<DeathReport> | null): string {
    const r = rig();
    r.hud.update(state({ dead: true, respawnSeconds: 5, deathReport: over === null ? null : report(over) }), 0);
    return r.deadDetail.textContent;
  }

  it('says nothing when nobody knows what happened', () => {
    expect(detailFor(null)).toBe('');
  });

  it('says nothing when there was no killer to name', () => {
    expect(detailFor({ killerName: '' })).toBe('');
  });

  it('names the killer alone when that is all there is', () => {
    expect(detailFor({})).toBe('VULTURE');
  });

  it('puts the four facts in a fixed order, so the eye lands in the same place', () => {
    expect(
      detailFor({ weaponName: 'mk18', distanceM: 12.6, headshot: true, killerHealth: 36.6 }),
    ).toBe('VULTURE · MK18 · 13M · HEADSHOT · 37 HP LEFT');
  });

  it('drops a weapon nobody carries rather than printing an empty field', () => {
    expect(detailFor({ weaponName: '', distanceM: 4 })).toBe('VULTURE · 4M');
  });

  it('drops the distance when the killer position is unknown', () => {
    expect(detailFor({ weaponName: 'mk18', distanceM: -1 })).toBe('VULTURE · MK18');
  });

  it('keeps a distance of zero, which is a real answer', () => {
    expect(detailFor({ distanceM: 0 })).toBe('VULTURE · 0M');
  });

  it('drops the health when there was no person to ask — a sentry gun has none', () => {
    expect(detailFor({ killerHealth: 0 })).toBe('VULTURE');
  });

  it('comes on with the line and off with it', () => {
    const r = rig();
    r.hud.update(state({ dead: true, respawnSeconds: 5, deathReport: report({ distanceM: 9 }) }), 0);
    expect(r.deadDetail.tokens.has('hud-dead__detail--on')).toBe(true);
    r.hud.update(state({ dead: true, respawnSeconds: 5, deathReport: null }), 0);
    expect(r.deadDetail.tokens.has('hud-dead__detail--on')).toBe(false);
  });

  it('writes the line once per death, not once per frame', () => {
    const r = rig();
    const dead = state({ dead: true, respawnSeconds: 5, deathReport: report({ distanceM: 9 }) });
    r.hud.update(dead, 0);
    r.deadDetail.textContent = 'TOUCHED';
    r.hud.update(dead, 0);
    expect(r.deadDetail.textContent).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- pushed facts

describe('the facts pushed from the sim rather than pulled through HudState', () => {
  it('holds the flash until MatchHud composes the tactical state', () => {
    const r = rig();
    expect(r.hud.pendingFlash).toBe(0);
    r.hud.setFlash(0.75);
    expect(r.hud.pendingFlash).toBe(0.75);
  });

  it('reads the threat back into a record the caller owns, one per frame', () => {
    const r = rig();
    const out = { active: false, x: 0, y: 0, z: 0 };
    r.hud.setThreat(true, 1, 2, 3);
    r.hud.readThreat(out);
    expect(out).toEqual({ active: true, x: 1, y: 2, z: 3 });
    r.hud.setThreat(false, 0, 0, 0);
    r.hud.readThreat(out);
    expect(out).toEqual({ active: false, x: 0, y: 0, z: 0 });
  });

  it('reads the objective bearing back the same way, with no y', () => {
    const r = rig();
    const out = { active: false, x: 0, z: 0 };
    r.hud.setObjectiveBearing(true, 5, 6);
    r.hud.readObjectiveBearing(out);
    expect(out).toEqual({ active: true, x: 5, z: 6 });
  });
});

describe('pushKillfeed', () => {
  it('puts the line at the top of the feed', () => {
    const r = rig();
    const entry: GameEvents['killfeed.entry'] = {
      killerName: 'VULTURE',
      victimName: 'MAGPIE',
      killerTeam: 'A',
      victimTeam: 'B',
      weaponId: 'mk18',
      headshot: true,
      suicide: false,
      involvesLocal: true,
    };
    r.hud.pushKillfeed(entry);
    const row = at(r.feed, 0);
    expect(at(row, 0).textContent).toBe('VULTURE');
    expect(at(row, 4).textContent).toBe('MAGPIE');
  });
});

// ---------------------------------------------------------------------------- the frame cost

describe('update', () => {
  it('measures its own wall time', () => {
    const r = rig();
    r.hud.update(state(), 0);
    expect(r.hud.lastUpdateMs).toBe(0);
  });

  it('drives the banner, the tactical half and the minimap from the one record', () => {
    const r = rig();
    const s = state({ playerX: 1, playerZ: 2, playerYaw: 0.5 });
    s.banner.scoreA = 7;
    s.banner.secondsRemaining = 61;
    s.tactical.weaponName = 'MK18';
    s.tactical.flash = 0.5;
    r.hud.update(s, 0.016);
    // The banner's own left slot, its clock, the tactical weapon plate and the flash layer.
    expect(at(r.root, 13, 0, 1).textContent).toBe('7');
    expect(at(r.root, 13, 1, 0).textContent).toBe('1:01');
    expect(at(r.root, 18, 0, 0).textContent).toBe('MK18');
    expect(at(r.root, 23).style.opacity).toBe('0.500');
  });
});

// ---------------------------------------------------------------------------- teardown

describe('resetForMatch', () => {
  it('wipes every per-match trace, so a second match starts clean', () => {
    const r = rig();
    r.hud.damageNumbersEnabled = true;
    r.hud.showHitmarker(false, 1_000);
    nowMs = 1_020;
    r.hud.showDamageNumber(1, 2, 30, 'torso');
    r.hud.showHitDirection(1);
    r.hud.showHurt(35, 100);
    r.hud.setFlash(0.9);
    r.hud.setThreat(true, 1, 2, 3);
    r.hud.setObjectiveBearing(true, 4, 5);
    r.hud.update(state({ health: 10, healthMax: 100 }), 0);
    expect(r.hud.lastHitLatencyMs).toBe(20);
    expect(r.hud.lowHealthIntensity).toBeGreaterThan(0);

    r.hud.resetForMatch();

    expect(r.hud.lastHitLatencyMs).toBe(-1);
    expect(r.hud.lowHealthIntensity).toBe(0);
    expect(r.lowVignette.style.opacity).toBe('0');
    expect(r.hud.pendingFlash).toBe(0);
    expect(r.hitmarker.style.opacity).toBe('0');
    expect(r.numbers[0]?.style.opacity).toBe('0');
    expect(r.directions[0]?.style.opacity).toBe('0');

    const threat = { active: true, x: 9, y: 9, z: 9 };
    r.hud.readThreat(threat);
    expect(threat.active).toBe(false);
    const objective = { active: true, x: 9, z: 9 };
    r.hud.readObjectiveBearing(objective);
    expect(objective.active).toBe(false);
  });

  it('resets the pieces it composes, not only its own', () => {
    const r = rig();
    const s = state();
    s.banner.phaseLabel = 'WARMUP';
    s.tactical.flash = 0.8;
    r.hud.update(s, 0);
    expect(at(r.root, 14).tokens.has('hud-phase--on')).toBe(true);
    expect(at(r.root, 23).style.opacity).toBe('0.800');

    r.hud.resetForMatch();
    expect(at(r.root, 14).tokens.has('hud-phase--on')).toBe(false);
    expect(at(r.root, 23).style.opacity).toBe('0');
  });

  it('clears the killfeed', () => {
    const r = rig();
    r.hud.pushKillfeed({
      killerName: 'VULTURE',
      victimName: 'MAGPIE',
      killerTeam: 'A',
      victimTeam: 'B',
      weaponId: 'mk18',
      headshot: false,
      suicide: false,
      involvesLocal: false,
    });
    r.hud.resetForMatch();
    expect(at(r.feed, 0).style.opacity).toBe('0');
  });
});
