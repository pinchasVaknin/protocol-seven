import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDecalTexture, buildFlashGeometry, buildFlashTexture } from './FxAssets';

/**
 * The generated art for `Fx`, pinned before unit C4's refactor.
 *
 * These are canvases, and a canvas is unreachable on `environment: 'node'` — but what the
 * functions actually *do* is issue a sequence of drawing commands, and a context that records
 * them is enough to hold every one exactly. The seeds are fixed, so the sequence is the same on
 * every run and a checksum over it is a faithful stand-in for the image: any moved gradient stop,
 * reordered call or changed radius moves the number.
 *
 * `buildFlashGeometry` needs no canvas at all — it is three.js geometry, merged by hand.
 */

// ===================================== the recording canvas ===================================

interface Op {
  readonly op: string;
  readonly args: readonly unknown[];
}

class RecordingContext {
  readonly ops: Op[] = [];
  private gradients = 0;

  private push(op: string, ...args: unknown[]): void {
    this.ops.push({ op, args });
  }

  set fillStyle(v: unknown) {
    this.push('fillStyle=', typeof v === 'object' ? 'gradient' : v);
  }

  set strokeStyle(v: unknown) {
    this.push('strokeStyle=', v);
  }

  set lineWidth(v: unknown) {
    this.push('lineWidth=', v);
  }

  set globalCompositeOperation(v: unknown) {
    this.push('composite=', v);
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): unknown {
    const id = this.gradients++;
    this.push('createRadialGradient', id, x0, y0, r0, x1, y1, r1);
    return {
      addColorStop: (at: number, color: string): void => this.push('addColorStop', id, at, color),
    };
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.push('fillRect', x, y, w, h);
  }

  beginPath(): void {
    this.push('beginPath');
  }

  arc(x: number, y: number, r: number, a0: number, a1: number): void {
    this.push('arc', x, y, r, a0, a1);
  }

  fill(): void {
    this.push('fill');
  }

  save(): void {
    this.push('save');
  }

  restore(): void {
    this.push('restore');
  }

  translate(x: number, y: number): void {
    this.push('translate', x, y);
  }

  rotate(a: number): void {
    this.push('rotate', a);
  }
}

let recorded: RecordingContext[];

beforeEach(() => {
  recorded = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: () => {
      const ctx = new RecordingContext();
      recorded.push(ctx);
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
});

/** FNV-1a over the whole command log. Any changed argument or reordered call moves it. */
function checksum(ops: readonly Op[]): number {
  const text = JSON.stringify(ops);
  let h = 0x811c_9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193) >>> 0;
  }
  return h >>> 0;
}

function only(): RecordingContext {
  expect(recorded.length).toBe(1);
  return recorded[0] as RecordingContext;
}

function countOf(ctx: RecordingContext, op: string): number {
  return ctx.ops.filter((o) => o.op === op).length;
}

// ======================================== the test cases ======================================

describe('buildFlashGeometry', () => {
  it('merges the three quads into one geometry', () => {
    const geometry = buildFlashGeometry();
    // Three PlaneGeometry, four vertices each.
    expect(geometry.getAttribute('position').count).toBe(12);
    expect(geometry.getAttribute('uv').count).toBe(8 / 2 * 3);
    expect(geometry.getIndex()?.count).toBe(18);
  });

  it('offsets each part’s indices so the three do not share vertices', () => {
    const index = buildFlashGeometry().getIndex();
    expect(index).not.toBeNull();
    const values: number[] = [];
    for (let i = 0; i < (index?.count ?? 0); i++) values.push(index?.getX(i) as number);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(11);
    // Each quad's six indices stay inside its own block of four.
    expect(values.slice(0, 6).every((v) => v < 4)).toBe(true);
    expect(values.slice(6, 12).every((v) => v >= 4 && v < 8)).toBe(true);
    expect(values.slice(12).every((v) => v >= 8)).toBe(true);
  });

  it('crosses the quads so the flash reads from every angle', () => {
    const position = buildFlashGeometry().getAttribute('position');
    const spans = { x: new Set<number>(), y: new Set<number>(), z: new Set<number>() };
    for (let i = 0; i < position.count; i++) {
      spans.x.add(Number(position.getX(i).toFixed(4)));
      spans.y.add(Number(position.getY(i).toFixed(4)));
      spans.z.add(Number(position.getZ(i).toFixed(4)));
    }
    // A single plane would be flat on one axis; three crossed ones span all of them.
    expect(spans.x.size).toBeGreaterThan(1);
    expect(spans.y.size).toBeGreaterThan(1);
    expect(spans.z.size).toBeGreaterThan(1);
  });

  it('is the same geometry every build', () => {
    const a = buildFlashGeometry().getAttribute('position');
    const b = buildFlashGeometry().getAttribute('position');
    expect([...(a.array as Float32Array)]).toEqual([...(b.array as Float32Array)]);
  });
});

describe('buildFlashTexture', () => {
  it('is a 64px sRGB canvas texture', () => {
    const texture = buildFlashTexture();
    expect(texture).toBeInstanceOf(THREE.CanvasTexture);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    // `needsUpdate` is write-only in three; the version counter is what it moves.
    expect(texture.version).toBeGreaterThan(0);
  });

  it('paints a radial core and then four lighter spokes', () => {
    buildFlashTexture();
    const ctx = only();
    expect(countOf(ctx, 'createRadialGradient')).toBe(1);
    expect(countOf(ctx, 'addColorStop')).toBe(4);
    // The spokes: composite to lighter, then four save/rotate/fillRect/restore.
    expect(ctx.ops.some((o) => o.op === 'composite=' && o.args[0] === 'lighter')).toBe(true);
    expect(countOf(ctx, 'save')).toBe(4);
    expect(countOf(ctx, 'rotate')).toBe(4);
    expect(countOf(ctx, 'restore')).toBe(4);
  });

  it('turns each spoke an eighth of a turn from the last', () => {
    buildFlashTexture();
    const angles = only().ops.filter((o) => o.op === 'rotate').map((o) => o.args[0] as number);
    expect(angles).toEqual([0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]);
  });

  it('issues the same command sequence every build', () => {
    buildFlashTexture();
    expect(checksum(only().ops)).toBe(424153190);
  });
});

describe('buildDecalTexture', () => {
  it('carries the anisotropy it was handed', () => {
    expect(buildDecalTexture(16).anisotropy).toBe(16);
    expect(recorded.length).toBe(1);
  });

  it('paints the rim first and the hole over it', () => {
    buildDecalTexture(4);
    const ctx = only();
    const gradients = ctx.ops.filter((o) => o.op === 'createRadialGradient');
    expect(gradients.length).toBe(2);
    // The rim's outer radius is larger than the hole's, and it is drawn first.
    const rimOuter = gradients[0]?.args[6] as number;
    const holeOuter = gradients[1]?.args[6] as number;
    expect(rimOuter).toBeGreaterThan(holeOuter);
  });

  it('starts the rim at the hole’s edge rather than at the centre', () => {
    buildDecalTexture(4);
    const rim = only().ops.find((o) => o.op === 'createRadialGradient');
    // Inner radius is 90% of the hole radius: displaced material sits just outside the hole.
    expect(rim?.args[3] as number).toBeGreaterThan(0);
  });

  it('keeps the hole dark to its edge and lets the rim fall to nothing', () => {
    buildDecalTexture(4);
    const stops = only().ops.filter((o) => o.op === 'addColorStop');
    const rimStops = stops.filter((o) => o.args[0] === 0).map((o) => o.args[2] as string);
    const holeStops = stops.filter((o) => o.args[0] === 1).map((o) => o.args[2] as string);
    expect(rimStops[rimStops.length - 1]).toContain(',0)');
    expect(holeStops[0]).toContain('rgba(10,10,12,1)');
  });

  it('scatters forty chips through the rim band', () => {
    buildDecalTexture(4);
    const ctx = only();
    // One fillStyle and one fillRect per chip, after the two gradient fills.
    expect(countOf(ctx, 'fillRect')).toBe(40);
  });

  it('issues the same command sequence every build, whatever the anisotropy', () => {
    buildDecalTexture(4);
    const first = checksum(only().ops);
    recorded = [];
    buildDecalTexture(16);
    expect(checksum(only().ops)).toBe(first);
    expect(first).toBe(2691807899);
  });
});
