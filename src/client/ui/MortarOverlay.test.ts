import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Brush, MapDef } from '../../shared/world/maps/types';
import { MortarOverlay } from './MortarOverlay';
import { FakeElement } from './testing/dom';

/**
 * Characterization tests for the mortar targeting overlay (refactor unit C15, written before
 * the refactor).
 *
 * The same recording 2D context `Minimap.test.ts` uses, and for the same reason: a canvas is
 * only testable as the calls it makes. The classification tests here are deliberately the same
 * cases as the minimap's, because this file's own header says the two **cannot disagree** about
 * what a wall is — and they do. See the side task this unit opened; the divergent case is
 * pinned below as it behaves today.
 */

// ---------------------------------------------------------------------------- the DOM double

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
  drawImage(): void {
    this.push('drawImage');
  }
}

/**
 * The element class is shared: `testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 31 lines of it. This file keeps its own environment: the shared
 * `installFakeDom` installs globals this suite has never run with, and handing a suite a
 * `window` on the way past is how a green suite starts meaning something else.
 *
 * Its `getContext` is the one thing it needs its own answer for, and `OverlayElement` below keeps it --
 * see that class. Its `className` was a plain string field rather than a view over a token set;
 * every write in this screen is one class string and every assertion reads it back whole, so the
 * shared getter answers identically.
 */


/**
 * The recording canvas, which is the whole reason this suite has a double at all.
 *
 * The shared `getContext` hands back a `Proxy` that refuses nothing and records nothing --
 * right for a screen that merely has to finish drawing, wrong here, where what the screen drew
 * *is* the assertion. One context per canvas, built on first ask and kept, so a test can read
 * `calls` after the frame.
 */
class OverlayElement extends FakeElement {
  ctx: RecordingContext | null = null;

  override getContext(kind: string): RecordingContext | null {
    if (kind !== '2d') return null;
    this.ctx ??= new RecordingContext();
    return this.ctx;
  }
}

let canvases: OverlayElement[] = [];

beforeEach(() => {
  canvases = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      const el = new OverlayElement(tag);
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
  readonly overlay: MortarOverlay;
  readonly host: FakeElement;
  readonly root: FakeElement;
  readonly live: RecordingContext;
  readonly confirmed: Array<[number, number]>;
  readonly cancelled: { count: number };
}

function rig(def: MapDef = mapDef()): Rig {
  const host = new FakeElement('div');
  const confirmed: Array<[number, number]> = [];
  const cancelled = { count: 0 };
  const overlay = new MortarOverlay({
    host: host as unknown as HTMLElement,
    mapDef: def,
    onConfirm: (x, z) => void confirmed.push([x, z]),
    onCancel: () => void (cancelled.count += 1),
  });
  // The overlay's own canvas is the last one built, so a test may build more than one.
  const live = canvases[canvases.length - 1]?.ctx;
  if (live == null) throw new Error('no live canvas');
  return { overlay, host, root: host.children[0] as FakeElement, live, confirmed, cancelled };
}

/** The raster context, which only exists once the overlay has been opened. */
function rasterCalls(): string[] {
  const raster = canvases[canvases.length - 1]?.ctx;
  if (raster == null) throw new Error('no raster canvas');
  return raster.calls;
}

function fillsOf(calls: readonly string[]): string[] {
  const out: string[] = [];
  let current = '';
  for (const call of calls) {
    if (call.startsWith('fillStyle=')) current = call.slice('fillStyle='.length);
    else if (call.startsWith('rect(')) out.push(current);
  }
  return out;
}

const WALL = '#2b313b';
const DECK = '#4a5462';

// ---------------------------------------------------------------------------- construction

describe('construction', () => {
  it('mounts hidden, with a framed canvas and the control hint', () => {
    const r = rig();
    expect(r.root.className).toBe('hud-mortar');
    expect(r.root.hidden).toBe(true);
    const frame = r.root.children[0] as FakeElement;
    expect(frame.className).toBe('hud-mortar__frame');
    expect(frame.children[0]?.className).toBe('hud-mortar__canvas');
    expect(frame.children[1]?.textContent).toBe('MOVE TO AIM · FIRE TO CONFIRM · ESC TO CANCEL');
  });

  it('sizes the canvas from the nav bounds at nine pixels a metre', () => {
    rig(mapDef({ navBounds: { min: { x: -10, y: 0, z: -5 }, max: { x: 10, y: 4, z: 15 } } } as Partial<MapDef>));
    expect(canvases[0]?.width).toBe(180);
    expect(canvases[0]?.height).toBe(180);
  });

  it('builds no raster until the overlay is first opened', () => {
    rig(mapDef({ brushes: [brush()] }));
    expect(canvases).toHaveLength(1);
  });

  it('builds the raster once, however many times it is opened', () => {
    const r = rig(mapDef({ brushes: [brush()] }));
    r.overlay.show(0, 0);
    r.overlay.hide();
    r.overlay.show(1, 1);
    expect(canvases).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------- the raster

describe('the raster', () => {
  function raster(def: MapDef): string[] {
    const r = rig(def);
    r.overlay.show(0, 0);
    return rasterCalls();
  }

  it('places world coordinates straight onto the canvas', () => {
    const calls = raster(mapDef());
    expect(calls[0]).toBe('setTransform(9,0,0,9,90,90)');
    expect(calls[1]).toBe('lineWidth=0.1');
  });

  it('rules a ten-metre grid, so distances are read rather than guessed', () => {
    const calls = raster(mapDef());
    // Two verticals and two horizontals over a twenty-metre map: the line on the far edge is
    // outside the loop's bound, which is why there are two and not three.
    expect(calls.filter((c) => c.startsWith('lineTo(') && c.endsWith(',10)'))).toEqual([
      'lineTo(-10,10)',
      'lineTo(0,10)',
    ]);
    expect(calls.filter((c) => c.startsWith('lineTo(10,'))).toEqual(['lineTo(10,-10)', 'lineTo(10,0)']);
    expect(calls[2]).toBe('strokeStyle=rgba(232, 234, 238, 0.06)');
  });

  it('skips a brush whose top is at or under 0.1 m', () => {
    const calls = raster(mapDef({ brushes: [brush({ position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 0.2, z: 4 } })] }));
    expect(fillsOf(calls)).toEqual([]);
  });

  it('skips a brush sitting entirely above 5.5 m', () => {
    const calls = raster(mapDef({ brushes: [brush({ position: { x: 0, y: 7, z: 0 }, size: { x: 4, y: 1, z: 4 } })] }));
    expect(fillsOf(calls)).toEqual([]);
  });

  it('draws a brush that starts above 3 m as a deck, and everything else as a wall', () => {
    expect(fillsOf(raster(mapDef({ brushes: [brush({ position: { x: 0, y: 4, z: 0 }, size: { x: 4, y: 1, z: 4 } })] })))).toEqual([DECK]);
    expect(fillsOf(raster(mapDef({ brushes: [brush()] })))).toEqual([WALL]);
  });

  it('draws a low pitched brush as a deck, the same as the minimap does', () => {
    /*
     * BACKLOG #69, decided 2026-11-22. This case asserted `[WALL]`: the overlay had its own
     * `classify` with no pitched-brush branch, so a ramp below 3 m was a wall here and a deck
     * on the minimap — against this file's own header, which said the two "cannot disagree
     * about what a wall is".
     *
     * The minimap's reading won, and the overlay has no `classify` of its own any more: it
     * draws through `Minimap.drawBrushes`. Both rolled and pitched are checked, because the
     * rule is about either rotation.
     */
    const pitched = brush({ position: { x: 0, y: 1, z: 0 }, size: { x: 4, y: 1, z: 9 }, rotationX: 0.2 });
    expect(fillsOf(raster(mapDef({ brushes: [pitched] })))).toEqual([DECK]);
    const rolled = brush({ position: { x: 0, y: 1, z: 0 }, size: { x: 4, y: 1, z: 9 }, rotationZ: 0.2 });
    expect(fillsOf(raster(mapDef({ brushes: [rolled] })))).toEqual([DECK]);
  });

  it('ignores a brush marked not solid', () => {
    expect(fillsOf(raster(mapDef({ brushes: [brush({ solid: false })] })))).toEqual([]);
  });

  it('draws every wall before every deck', () => {
    const calls = raster(
      mapDef({
        brushes: [
          brush({ position: { x: 0, y: 4, z: 0 }, size: { x: 4, y: 1, z: 4 } }),
          brush({ position: { x: 2, y: 1.5, z: 0 } }),
        ],
      }),
    );
    expect(fillsOf(calls)).toEqual([WALL, DECK]);
  });

  it('draws a footprint as a rotated rectangle around the brush centre', () => {
    const calls = raster(
      mapDef({ brushes: [brush({ position: { x: 3, y: 1.5, z: -2 }, size: { x: 4, y: 3, z: 2 }, rotationY: 0.5 })] }),
    );
    const body = calls.slice(calls.indexOf('save'), calls.indexOf('restore') + 1);
    expect(body).toEqual([
      'save',
      'translate(3,-2)',
      'rotate(-0.5)',
      'beginPath',
      'rect(-2,-1,4,2)',
      'fill',
      'stroke',
      'restore',
    ]);
  });

  it('projects a pitched brush onto its ground plan', () => {
    const calls = raster(
      mapDef({ brushes: [brush({ position: { x: 0, y: 4, z: 0 }, size: { x: 4, y: 1, z: 10 }, rotationX: 0.4 })] }),
    );
    expect(calls.find((c) => c.startsWith('rect('))).toBe(
      `rect(-2,${-(10 * Math.cos(0.4)) / 2},4,${10 * Math.cos(0.4)})`,
    );
  });
});

// ---------------------------------------------------------------------------- open and aim

describe('show, hide and the cursor', () => {
  it('opens over the player own position, which is the least surprising cursor', () => {
    const r = rig();
    r.overlay.show(4, -6);
    expect(r.overlay.isOpen).toBe(true);
    expect(r.root.hidden).toBe(false);
    expect(r.overlay.markX).toBe(4);
    expect(r.overlay.markZ).toBe(-6);
  });

  it('hides without forgetting where the cursor was', () => {
    const r = rig();
    r.overlay.show(4, -6);
    r.overlay.hide();
    expect(r.overlay.isOpen).toBe(false);
    expect(r.root.hidden).toBe(true);
    expect(r.overlay.markX).toBe(4);
  });

  it('nudges the cursor by metres', () => {
    const r = rig();
    r.overlay.show(0, 0);
    r.overlay.moveBy(2.5, -1.5);
    expect(r.overlay.markX).toBe(2.5);
    expect(r.overlay.markZ).toBe(-1.5);
  });

  it('clamps the cursor to the map, because a mark off the navmesh is a strike on nothing', () => {
    const r = rig();
    r.overlay.show(0, 0);
    r.overlay.moveBy(999, 999);
    expect(r.overlay.markX).toBe(10);
    expect(r.overlay.markZ).toBe(10);
    r.overlay.moveBy(-999, -999);
    expect(r.overlay.markX).toBe(-10);
    expect(r.overlay.markZ).toBe(-10);
  });

  it('confirms with world coordinates and closes', () => {
    const r = rig();
    r.overlay.show(3, 4);
    r.overlay.confirm();
    expect(r.confirmed).toEqual([[3, 4]]);
    expect(r.overlay.isOpen).toBe(false);
  });

  it('cancels without confirming, and closes', () => {
    const r = rig();
    r.overlay.show(3, 4);
    r.overlay.cancel();
    expect(r.cancelled.count).toBe(1);
    expect(r.confirmed).toEqual([]);
    expect(r.overlay.isOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------- the frame

describe('update', () => {
  it('draws nothing while closed', () => {
    const r = rig();
    r.overlay.update(0.016, 6);
    expect(r.live.calls).toEqual([]);
  });

  it('washes the map, lays the raster and rings the strike at its real radius', () => {
    const r = rig();
    r.overlay.show(0, 0);
    r.live.calls.length = 0;
    r.overlay.update(0, 6);
    expect(r.live.calls.slice(0, 6)).toEqual([
      'setTransform(1,0,0,1,0,0)',
      'clearRect(0,0,180,180)',
      'fillStyle=rgba(9, 11, 14, 0.88)',
      'fillRect(0,0,180,180)',
      'drawImage',
      'strokeStyle=#e8604c',
    ]);
    // The cursor is the map centre, and six metres is fifty-four pixels.
    expect(r.live.calls).toContain('arc(90,90,54,0,6.283185307179586)');
  });

  it('puts the ring where the cursor is, not where the player was', () => {
    const r = rig();
    r.overlay.show(0, 0);
    r.overlay.moveBy(5, -5);
    r.live.calls.length = 0;
    r.overlay.update(0, 2);
    expect(r.live.calls).toContain('arc(135,45,18,0,6.283185307179586)');
  });

  it('pulses an inner ring at a third of the radius', () => {
    const r = rig();
    r.overlay.show(0, 0);
    r.live.calls.length = 0;
    r.overlay.update(0, 6);
    expect(r.live.calls).toContain('arc(90,90,18.9,0,6.283185307179586)');
    expect(r.live.calls).toContain('globalAlpha=0.45');
    expect(r.live.calls).toContain('globalAlpha=1');
  });

  it('advances the pulse with the frame clock', () => {
    const r = rig();
    r.overlay.show(0, 0);
    r.overlay.update(0.25, 6);
    r.live.calls.length = 0;
    r.overlay.update(0.25, 6);
    const alpha = r.live.calls.find((c) => c.startsWith('globalAlpha=') && c !== 'globalAlpha=1');
    expect(alpha).toBe(`globalAlpha=${0.45 + Math.sin(0.25 * 2.4 * 2) * 0.3}`);
  });

  it('wraps the pulse at a full turn rather than counting up forever', () => {
    const r = rig();
    r.overlay.show(0, 0);
    // 2.4 rad a second: a hundred seconds is thirty-eight turns.
    for (let i = 0; i < 100; i++) r.overlay.update(1, 6);
    r.live.calls.length = 0;
    r.overlay.update(0, 6);
    const alpha = r.live.calls.find((c) => c.startsWith('globalAlpha=') && c !== 'globalAlpha=1');
    const value = Number(alpha?.slice('globalAlpha='.length));
    expect(value).toBeGreaterThanOrEqual(0.15);
    expect(value).toBeLessThanOrEqual(0.75);
  });

  it('rules crosshairs out to the frame edges', () => {
    const r = rig();
    r.overlay.show(0, 0);
    r.live.calls.length = 0;
    r.overlay.update(0, 6);
    const tail = r.live.calls.slice(r.live.calls.lastIndexOf('beginPath'));
    expect(tail).toEqual([
      'beginPath',
      'moveTo(90,0)',
      'lineTo(90,180)',
      'moveTo(0,90)',
      'lineTo(180,90)',
      'strokeStyle=rgba(232, 96, 76, 0.28)',
      'lineWidth=1',
      'stroke',
    ]);
  });
});

// ---------------------------------------------------------------------------- dispose

describe('dispose', () => {
  it('takes the overlay off the host', () => {
    const r = rig();
    expect(r.host.children).toHaveLength(1);
    r.overlay.dispose();
    expect(r.host.children).toHaveLength(0);
  });
});
