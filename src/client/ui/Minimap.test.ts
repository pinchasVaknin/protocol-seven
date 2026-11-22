import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Brush, MapDef } from '../../shared/world/maps/types';
import { Minimap } from './Minimap';

/**
 * Characterization tests for the minimap (refactor unit C15, written before the refactor).
 *
 * The minimap is a canvas, so the double is a **recording 2D context**: every call and every
 * style assignment is written into a list in order, which makes a raster and a frame into text
 * a test can hold exactly. The map is authored per test rather than loaded, so the brush
 * classification — the thing this file decides and nothing else does — is pinned brush by
 * brush rather than inferred from a real map's eight hundred of them.
 */

// ---------------------------------------------------------------------------- the DOM double

/** Every call and style write, in order. */
class RecordingContext {
  readonly calls: string[] = [];
  private fillValue = '';
  private strokeValue = '';
  private widthValue = 0;
  private alphaValue = 1;

  private push(name: string, ...args: unknown[]): void {
    this.calls.push(args.length === 0 ? name : `${name}(${args.map((a) => String(a)).join(',')})`);
  }

  get fillStyle(): string {
    return this.fillValue;
  }
  set fillStyle(v: string) {
    this.fillValue = v;
    this.calls.push('fillStyle=' + String(v));
  }
  get strokeStyle(): string {
    return this.strokeValue;
  }
  set strokeStyle(v: string) {
    this.strokeValue = v;
    this.calls.push('strokeStyle=' + String(v));
  }
  get lineWidth(): number {
    return this.widthValue;
  }
  set lineWidth(v: number) {
    this.widthValue = v;
    this.calls.push('lineWidth=' + String(v));
  }
  get globalAlpha(): number {
    return this.alphaValue;
  }
  set globalAlpha(v: number) {
    this.alphaValue = v;
    this.calls.push('globalAlpha=' + String(v));
  }

  fill(): void {
    this.push('fill');
  }
  stroke(): void {
    this.push('stroke');
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
  createLinearGradient(...a: number[]): { addColorStop: (o: number, c: string) => void } {
    this.push('createLinearGradient', ...a);
    return {
      addColorStop: (o: number, c: string) => this.push('addColorStop', o, c),
    };
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  width = 0;
  height = 0;
  className = '';
  parent: FakeElement | null = null;
  ctx: RecordingContext | null = null;

  constructor(readonly tag: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  getContext(kind: string): RecordingContext | null {
    if (kind !== '2d') return null;
    this.ctx ??= new RecordingContext();
    return this.ctx;
  }
}

/** Canvases in creation order: the live one first, then the raster. */
let canvases: FakeElement[] = [];

beforeEach(() => {
  canvases = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      const el = new FakeElement(tag);
      if (tag === 'canvas') canvases.push(el);
      return el;
    },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
});

// ---------------------------------------------------------------------------- the rig

function brush(over: Partial<Brush> = {}): Brush {
  return {
    position: { x: 0, y: 1.5, z: 0 },
    size: { x: 4, y: 3, z: 2 },
    rotationY: 0,
    material: 'concrete',
    ...over,
  } as Brush;
}

function mapDef(over: Partial<MapDef> = {}): MapDef {
  return {
    objectives: [],
    navBounds: { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 4, z: 10 } },
    brushes: [],
    props: [],
    ...over,
  } as unknown as MapDef;
}

interface Rig {
  readonly map: Minimap;
  readonly live: RecordingContext;
  readonly raster: string[];
}

function rig(def: MapDef = mapDef(), maxFriendlies = 2): Rig {
  const map = new Minimap(def, maxFriendlies);
  // The last two: the live canvas then the raster, so a test may build more than one map.
  const liveCanvas = canvases[canvases.length - 2];
  const rasterCanvas = canvases[canvases.length - 1];
  if (liveCanvas?.ctx == null || rasterCanvas?.ctx == null) throw new Error('no canvases');
  const raster = [...rasterCanvas.ctx.calls];
  liveCanvas.ctx.calls.length = 0;
  return { map, live: liveCanvas.ctx, raster };
}

/**
 * The fill colour in force at each footprint, one entry per `rect`.
 *
 * Read per rectangle rather than by listing every `fillStyle=` write, because the raster sets
 * the wall colour once more before the props pass whether or not the map has any props.
 */
function fillsOf(calls: readonly string[]): string[] {
  const out: string[] = [];
  let current = '';
  for (const call of calls) {
    if (call.startsWith('fillStyle=')) current = call.slice('fillStyle='.length);
    else if (call.startsWith('rect(')) out.push(current);
  }
  return out;
}

/** Every arc except the two that cut the disc itself. */
function arcsOf(calls: readonly string[]): string[] {
  return calls.filter((c) => c.startsWith('arc(') && !c.startsWith('arc(168,168,167'));
}

const WALL = '#2b313b';
const DECK = '#4a5462';
/** The default palette, as `Palette.ts` hands it to the module-level `ink` cache. */
const INK_FRIENDLY = '#57a9ff';
const INK_HOSTILE = '#e8604c';
const INK_LOCAL = '#e8eaee';
const INK_NEUTRAL = 'rgba(200, 153, 83, 0.85)';

// ---------------------------------------------------------------------------- construction

describe('construction', () => {
  it('draws at twice the CSS size so the lines stay crisp', () => {
    rig(mapDef(), 2);
    expect(canvases[0]?.width).toBe(336);
    expect(canvases[0]?.height).toBe(336);
    expect(canvases[0]?.className).toBe('hud-map__canvas');
  });

  it('sizes the raster from the nav bounds at six pixels a metre', () => {
    rig(mapDef({ navBounds: { min: { x: -10, y: 0, z: -5 }, max: { x: 10, y: 4, z: 15 } } } as Partial<MapDef>));
    expect(canvases[1]?.width).toBe(120);
    expect(canvases[1]?.height).toBe(120);
  });

  it('places the raster origin on the bounds, so world coordinates draw straight', () => {
    const r = rig();
    expect(r.raster[0]).toBe('setTransform(6,0,0,6,60,60)');
    expect(r.raster[1]).toBe('lineWidth=0.12');
  });

  it('pools the markers, the contacts and the pings without allocating per dot', () => {
    const r = rig(mapDef(), 4);
    expect(r.map.friendlies).toHaveLength(4);
    expect(r.map.contacts).toHaveLength(10);
  });

  it('builds the element with a canvas and a ring', () => {
    const r = rig();
    const el = r.map.element as unknown as FakeElement;
    expect(el.className).toBe('hud-map');
    expect(el.children.map((c) => c.className)).toEqual(['hud-map__canvas', 'hud-map__ring']);
  });
});

// ---------------------------------------------------------------------------- classification

describe('the raster: which brushes are drawn, and as what', () => {
  it('skips a brush whose top is at or under 0.1 m — floor slabs and painted trim', () => {
    const r = rig(mapDef({ brushes: [brush({ position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 0.2, z: 4 } })] }));
    expect(fillsOf(r.raster)).toEqual([]);
  });

  it('skips a brush sitting entirely above 5.5 m — a roof would hide the catwalk under it', () => {
    const r = rig(mapDef({ brushes: [brush({ position: { x: 0, y: 7, z: 0 }, size: { x: 4, y: 1, z: 4 } })] }));
    expect(fillsOf(r.raster)).toEqual([]);
  });

  it('draws a brush that starts above 3 m as a deck', () => {
    const r = rig(mapDef({ brushes: [brush({ position: { x: 0, y: 4, z: 0 }, size: { x: 4, y: 1, z: 4 } })] }));
    expect(fillsOf(r.raster)).toEqual([DECK]);
  });

  it('draws everything else as a wall', () => {
    const r = rig(mapDef({ brushes: [brush()] }));
    expect(fillsOf(r.raster)).toEqual([WALL]);
  });

  it('draws a pitched brush as a deck however low it sits — a ramp is somewhere to walk', () => {
    // The rule was the minimap's alone until BACKLOG #69 was decided on 2026-11-22; the mortar
    // overlay draws through `drawBrushes` now, so `MortarOverlay.test.ts` asserts the same two
    // cases and the divergence cannot come back.
    const low = brush({ position: { x: 0, y: 1, z: 0 }, size: { x: 4, y: 1, z: 9 }, rotationX: 0.2 });
    expect(fillsOf(rig(mapDef({ brushes: [low] })).raster)).toEqual([DECK]);
    const rolled = brush({ position: { x: 0, y: 1, z: 0 }, size: { x: 4, y: 1, z: 9 }, rotationZ: 0.2 });
    expect(fillsOf(rig(mapDef({ brushes: [rolled] })).raster)).toEqual([DECK]);
  });

  it('ignores a brush marked not solid', () => {
    const r = rig(mapDef({ brushes: [brush({ solid: false })] }));
    expect(fillsOf(r.raster)).toEqual([]);
  });

  it('draws every wall before every deck, whatever order the map lists them in', () => {
    const r = rig(
      mapDef({
        brushes: [
          brush({ position: { x: 0, y: 4, z: 0 }, size: { x: 4, y: 1, z: 4 } }),
          brush({ position: { x: 2, y: 1.5, z: 0 } }),
          brush({ position: { x: 4, y: 4, z: 0 }, size: { x: 4, y: 1, z: 4 } }),
        ],
      }),
    );
    expect(fillsOf(r.raster)).toEqual([WALL, DECK, DECK]);
  });
});

// ---------------------------------------------------------------------------- footprints

describe('the raster: the footprint it draws', () => {
  it('is a rotated rectangle around the brush centre, filled and outlined', () => {
    const r = rig(mapDef({ brushes: [brush({ position: { x: 3, y: 1.5, z: -2 }, size: { x: 4, y: 3, z: 2 }, rotationY: 0.5 })] }));
    const body = r.raster.slice(r.raster.indexOf('save'), r.raster.indexOf('restore') + 1);
    expect(body).toEqual([
      'save',
      'translate(3,-2)',
      // The prop mesher's yaw convention rotates +X toward -Z, hence the negated angle.
      'rotate(-0.5)',
      'beginPath',
      'rect(-2,-1,4,2)',
      'fill',
      'stroke',
      'restore',
    ]);
  });

  it('projects a pitched brush onto its ground plan rather than drawing its own length', () => {
    // 9.85 m of ramp covers 9.0 m of ground.
    const r = rig(mapDef({ brushes: [brush({ position: { x: 0, y: 4, z: 0 }, size: { x: 4, y: 1, z: 10 }, rotationX: 0.4 })] }));
    const rect = r.raster.find((c) => c.startsWith('rect('));
    expect(rect).toBe(`rect(-2,${-(10 * Math.cos(0.4)) / 2},4,${10 * Math.cos(0.4)})`);
  });

  it('draws each solid part of a prop at its rotated offset, and skips the trim', () => {
    const r = rig(
      mapDef({
        brushes: [],
        props: [{ shape: 'crate', position: { x: 5, y: 0, z: 5 }, rotationY: 0 }],
      } as unknown as Partial<MapDef>),
    );
    // Whatever `crate` is made of, every rect the pass drew is centred on the placement.
    const translates = r.raster.filter((c) => c.startsWith('translate('));
    expect(translates.length).toBeGreaterThan(0);
    expect(translates.every((t) => t.startsWith('translate(5') || t.includes(',5'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------- the frame

describe('update: the frame', () => {
  it('clears, lays the backdrop disc, clips to it and places the world under the player', () => {
    const r = rig();
    r.map.update(12, -4, 0.75, 0);
    expect(r.live.calls.slice(0, 12)).toEqual([
      'setTransform(1,0,0,1,0,0)',
      'clearRect(0,0,336,336)',
      'fillStyle=rgba(9, 11, 14, 0.72)',
      'beginPath',
      'arc(168,168,167,0,6.283185307179586)',
      'fill',
      'save',
      'beginPath',
      'arc(168,168,167,0,6.283185307179586)',
      'clip',
      'translate(168,168)',
      'rotate(0.75)',
    ]);
  });

  it('scales the disc to a 34 m view radius and draws the raster at its world origin', () => {
    const r = rig();
    r.map.update(0, 0, 0, 0);
    const scale = 168 / 34;
    expect(r.live.calls).toContain(`scale(${scale},${scale})`);
    expect(r.live.calls).toContain('translate(0,0)');
    expect(r.live.calls).toContain('drawImage');
  });

  it('pops the world transform before the sweep and the player', () => {
    const r = rig();
    r.map.update(0, 0, 0, 0);
    const restore = r.live.calls.lastIndexOf('restore');
    const identity = r.live.calls.lastIndexOf('setTransform(1,0,0,1,0,0)');
    expect(identity).toBeGreaterThan(restore);
  });

  it('draws the player as an arrow at the centre, always pointing up', () => {
    const r = rig();
    r.map.update(9, 9, 2, 0);
    const tail = r.live.calls.slice(r.live.calls.lastIndexOf('setTransform(1,0,0,1,0,0)'));
    expect(tail).toEqual([
      'setTransform(1,0,0,1,0,0)',
      `fillStyle=${INK_LOCAL}`,
      'beginPath',
      'moveTo(168,159)',
      'lineTo(174,175)',
      'lineTo(168,171)',
      'lineTo(162,175)',
      'closePath',
      'fill',
    ]);
  });

  it('draws no objectives until the mode asks for them', () => {
    const def = mapDef({
      objectives: [{ id: 'A', kind: 'flag', position: { x: 1, y: 0, z: 2 }, radius: 3, label: 'A' }],
    } as Partial<MapDef>);
    const r = rig(def);
    r.map.update(0, 0, 0, 0);
    const before = r.live.calls.length;
    r.live.calls.length = 0;
    r.map.showObjectives = true;
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls.length).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------- objectives

describe('update: the objective pips', () => {
  const def = mapDef({
    objectives: [
      { id: 'A', kind: 'flag', position: { x: 1, y: 0, z: 2 }, radius: 3, label: 'A' },
      { id: 'BOMB', kind: 'bombsite', position: { x: -4, y: 0, z: 6 }, radius: 3, label: 'B' },
    ],
  } as Partial<MapDef>);

  function draw(r: Rig): string[] {
    r.map.showObjectives = true;
    r.live.calls.length = 0;
    r.map.update(0, 0, 0, 0);
    return r.live.calls;
  }

  it('draws a flag as a circle and a bomb site as a triangle', () => {
    const r = rig(def);
    const calls = draw(r);
    expect(calls).toContain('arc(1,2,1.5,0,6.283185307179586)');
    expect(calls).toContain('moveTo(-4,4.4)');
    expect(calls).toContain('lineTo(-2.4,7.6)');
    expect(calls).toContain('lineTo(-5.6,7.6)');
  });

  it('draws only the kinds the mode says it uses', () => {
    const r = rig(def);
    r.map.objectiveKinds = ['bombsite'];
    const calls = draw(r);
    expect(calls.some((c) => c.startsWith('arc(1,2'))).toBe(false);
    expect(calls).toContain('moveTo(-4,4.4)');
  });

  it('is neutral ink with no state, and outline only', () => {
    const r = rig(def);
    const calls = draw(r);
    const pip = calls.slice(calls.indexOf('drawImage') + 1);
    expect(pip[1]).toBe(`fillStyle=${INK_NEUTRAL}`);
    expect(pip[2]).toBe(`strokeStyle=${INK_NEUTRAL}`);
    expect(calls.filter((c) => c === 'globalAlpha=0.35')).toHaveLength(0);
  });

  it('fills a held objective and leaves a contested one outlined', () => {
    const r = rig(def);
    r.map.objectiveStates.push({ id: 'A', owner: 'FRIENDLY', progress: 0, contested: false });
    expect(draw(r).filter((c) => c === 'globalAlpha=0.35')).toHaveLength(1);

    const contested = rig(def);
    contested.map.objectiveStates.push({ id: 'A', owner: 'FRIENDLY', progress: 0, contested: true });
    expect(draw(contested).filter((c) => c === 'globalAlpha=0.35')).toHaveLength(0);
  });

  it('paints the pip by who holds it', () => {
    const friendly = rig(def);
    friendly.map.objectiveStates.push({ id: 'A', owner: 'FRIENDLY', progress: 0, contested: false });
    expect(draw(friendly)).toContain(`fillStyle=${INK_FRIENDLY}`);

    const hostile = rig(def);
    hostile.map.objectiveStates.push({ id: 'A', owner: 'ENEMY', progress: 0, contested: false });
    expect(draw(hostile)).toContain(`fillStyle=${INK_HOSTILE}`);
  });

  it('draws a capture arc from twelve o clock once progress has started', () => {
    const r = rig(def);
    r.map.objectiveStates.push({ id: 'A', owner: 'NONE', progress: 0.25, contested: true });
    const calls = draw(r);
    expect(calls).toContain(`arc(1,2,2.4,${-Math.PI / 2},${-Math.PI / 2 + 0.25 * Math.PI * 2})`);
  });

  it('draws no arc for progress under a thousandth', () => {
    const r = rig(def);
    r.map.objectiveStates.push({ id: 'A', owner: 'NONE', progress: 0.0005, contested: true });
    expect(draw(r).some((c) => c.startsWith('arc(1,2,2.4,'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------- pings

describe('pings', () => {
  it('rings the shot and grows as it fades', () => {
    const r = rig();
    r.map.addPing(5, 6);
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls).toContain('globalAlpha=1');
    expect(r.live.calls).toContain('arc(5,6,0.8,0,6.283185307179586)');

    r.live.calls.length = 0;
    r.map.update(0, 0, 0, 1.2);
    const alpha = r.live.calls.find((c) => c.startsWith('globalAlpha=') && c !== 'globalAlpha=1');
    expect(alpha).toBe('globalAlpha=0.25');
    expect(r.live.calls).toContain('arc(5,6,2.4000000000000004,0,6.283185307179586)');
  });

  it('expires after 2.4 seconds', () => {
    const r = rig();
    r.map.addPing(5, 6);
    r.map.update(0, 0, 0, 2.4);
    r.live.calls.length = 0;
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls.some((c) => c.startsWith('arc(5,6'))).toBe(false);
  });

  it('pools twenty-four and then takes the one with least life left', () => {
    const r = rig();
    for (let i = 0; i < 24; i++) r.map.addPing(i, 0);
    r.map.update(0, 0, 0, 0.1);
    r.live.calls.length = 0;
    r.map.addPing(99, 99);
    r.map.update(0, 0, 0, 0);
    expect(arcsOf(r.live.calls)).toHaveLength(24);
    expect(r.live.calls.some((c) => c.startsWith('arc(99,99'))).toBe(true);
    expect(r.live.calls.some((c) => c.startsWith('arc(0,0'))).toBe(false);
  });

  it('clears every ping on request', () => {
    const r = rig();
    r.map.addPing(5, 6);
    r.map.clearPings();
    r.live.calls.length = 0;
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls.some((c) => c.startsWith('arc(5,6'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------- contacts

describe('UAV contacts', () => {
  it('draws an active contact and fades it by its age', () => {
    const r = rig();
    const contact = r.map.contacts[0];
    if (contact === undefined) throw new Error('no contact slot');
    contact.active = true;
    contact.x = 2;
    contact.z = 3;
    contact.age = 0;
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls).toContain('arc(2,3,1.15,0,6.283185307179586)');

    contact.age = r.map.contactFadeSeconds / 2;
    r.live.calls.length = 0;
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls).toContain('globalAlpha=0.5');
  });

  it('drops a contact older than the fade', () => {
    const r = rig();
    const contact = r.map.contacts[0];
    if (contact === undefined) throw new Error('no contact slot');
    contact.active = true;
    contact.age = 99;
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls.some((c) => c.startsWith('arc(0,0,1.15'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------- sweep and jam

describe('the sweep and the scramble', () => {
  it('draws nothing while no UAV is up', () => {
    const r = rig();
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls.some((c) => c.startsWith('createLinearGradient'))).toBe(false);
  });

  it('rotates the beam with the map under it', () => {
    const r = rig();
    r.map.sweepAngle = 0;
    r.map.update(0, 0, 1, 0);
    const angle = 0 + 1;
    expect(r.live.calls).toContain(
      `createLinearGradient(168,168,${168 + Math.cos(angle) * 168},${168 + Math.sin(angle) * 168})`,
    );
    expect(r.live.calls).toContain('addColorStop(1,rgba(232, 96, 76, 0))');
  });

  it('jams the disc last, over everything, and moves the noise every frame', () => {
    const r = rig();
    r.map.scrambled = true;
    r.map.update(0, 0, 0, 0.016);
    const bands = r.live.calls.filter((c) => c.startsWith('fillRect(')).length;
    // One wash plus twenty-two bands.
    expect(bands).toBe(23);
    const first = r.live.calls.filter((c) => c.startsWith('fillRect(')).join('|');

    r.live.calls.length = 0;
    r.map.update(0, 0, 0, 0.016);
    expect(r.live.calls.filter((c) => c.startsWith('fillRect(')).join('|')).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------- friendlies

describe('friendly chevrons', () => {
  it('draws one chevron per active marker, pointing where it looks', () => {
    const r = rig(mapDef(), 2);
    const marker = r.map.friendlies[0];
    if (marker === undefined) throw new Error('no marker');
    marker.active = true;
    marker.x = 4;
    marker.z = 5;
    marker.yaw = 0;
    r.map.update(0, 0, 0, 0);
    // Forward is (-sin yaw, -cos yaw), so at yaw 0 the tip is 1.5 m toward -z.
    expect(r.live.calls).toContain('moveTo(4,3.5)');
  });

  it('draws nothing for an inactive marker', () => {
    const r = rig(mapDef(), 2);
    r.map.update(0, 0, 0, 0);
    expect(r.live.calls).toContain(`fillStyle=${INK_FRIENDLY}`);
    expect(r.live.calls.some((c) => c.startsWith('moveTo(4,'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------- dispose

describe('dispose', () => {
  it('takes the element off its host', () => {
    const host = new FakeElement('div');
    const r = rig();
    host.appendChild(r.map.element as unknown as FakeElement);
    r.map.dispose();
    expect(host.children).toHaveLength(0);
  });
});
