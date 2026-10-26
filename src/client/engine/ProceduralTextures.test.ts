import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MATERIAL_KEYS, type MaterialKey } from '../../shared/world/maps/types';
import { ProceduralTextures } from './ProceduralTextures';

/**
 * The procedurally painted surfaces, pinned before unit C4's refactor.
 *
 * All sixteen materials are built from a seeded `Rng` into a canvas, so none of it needs a GPU
 * and only the canvas is out of reach on `environment: 'node'`. The fake below records every
 * drawing command *and* keeps a real pixel buffer, because the two halves of a painter are
 * different in kind: the authored structure — panel lines, hazard stripes, brick courses — is a
 * sequence of vector calls, while `grainNoise` is per-pixel value noise that reads and writes
 * `ImageData`. The command log holds the first and the pixel checksum holds the second.
 *
 * `build` is the function being replaced by a lookup table, and every one of its sixteen cases
 * is a painter plus a `worldScale`. The checksums below are what make that a provable no-op:
 * sixteen numbers, one per material, taken off the unmodified code.
 */

// ===================================== the recording canvas ===================================

const TEX_SIZE = 256;

interface Op {
  readonly op: string;
  readonly args: readonly unknown[];
}

class RecordingContext {
  readonly ops: Op[] = [];
  /** A real buffer, so `grainNoise` reads and writes real numbers. */
  readonly pixels = new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4);
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

  private gradient(kind: string, args: number[]): unknown {
    const id = this.gradients++;
    this.push(kind, id, ...args);
    return { addColorStop: (at: number, color: string): void => this.push('addColorStop', id, at, color) };
  }

  createRadialGradient(...args: number[]): unknown {
    return this.gradient('radialGradient', args);
  }
  createLinearGradient(...args: number[]): unknown {
    return this.gradient('linearGradient', args);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.push('fillRect', x, y, w, h);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.push('rect', x, y, w, h);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number): void {
    this.push('arc', x, y, r, a0, a1);
  }
  moveTo(x: number, y: number): void {
    this.push('moveTo', x, y);
  }
  lineTo(x: number, y: number): void {
    this.push('lineTo', x, y);
  }
  translate(x: number, y: number): void {
    this.push('translate', x, y);
  }
  rotate(a: number): void {
    this.push('rotate', a);
  }
  beginPath(): void {
    this.push('beginPath');
  }
  stroke(): void {
    this.push('stroke');
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

  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    this.push('getImageData', x, y, w, h);
    return { data: new Uint8ClampedArray(this.pixels), width: w, height: h };
  }

  putImageData(img: { data: Uint8ClampedArray }, x: number, y: number): void {
    this.push('putImageData', x, y);
    this.pixels.set(img.data);
  }
}

/** One recorder per material, in the order `MATERIAL_KEYS` builds them. */
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

function build(maxAnisotropy = 16): ProceduralTextures {
  const renderer = { capabilities: { getMaxAnisotropy: () => maxAnisotropy } } as unknown as THREE.WebGLRenderer;
  return new ProceduralTextures(renderer);
}

function fnv(text: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193) >>> 0;
  }
  return h >>> 0;
}

/** The painter's whole command sequence, as one number. */
function commandSum(ctx: RecordingContext): number {
  return fnv(JSON.stringify(ctx.ops));
}

/** What `grainNoise` left in the pixel buffer. */
function pixelSum(ctx: RecordingContext): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < ctx.pixels.length; i++) {
    h ^= ctx.pixels[i] as number;
    h = Math.imul(h, 0x0100_0193) >>> 0;
  }
  return h >>> 0;
}

/** Every material, keyed, in build order. */
function byKey(): Map<MaterialKey, RecordingContext> {
  const map = new Map<MaterialKey, RecordingContext>();
  MATERIAL_KEYS.forEach((key, i) => map.set(key, recorded[i] as RecordingContext));
  return map;
}

// ======================================== the test cases ======================================

describe('ProceduralTextures: the cache', () => {
  it('builds one texture for every material key, at construction', () => {
    const textures = build();
    expect(recorded.length).toBe(MATERIAL_KEYS.length);
    expect(MATERIAL_KEYS.length).toBe(16);
    for (const key of MATERIAL_KEYS) expect(textures.get(key).texture).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('throws for a material it was never asked to build', () => {
    const textures = build();
    expect(() => textures.get('nope' as MaterialKey)).toThrow(/No procedural material/);
  });

  it('hands out the same profile object every time', () => {
    const textures = build();
    expect(textures.get('concrete')).toBe(textures.get('concrete'));
  });

  it('caps the anisotropy it shares with everything else at eight', () => {
    expect(build(16).anisotropy).toBe(8);
    expect(build(4).anisotropy).toBe(4);
  });

  it('puts that anisotropy on every texture', () => {
    const textures = build(4);
    for (const key of MATERIAL_KEYS) expect(textures.get(key).texture.anisotropy).toBe(4);
  });

  it('tiles every texture and mipmaps it', () => {
    const textures = build();
    for (const key of MATERIAL_KEYS) {
      const t = textures.get(key).texture;
      expect(t.wrapS, key).toBe(THREE.RepeatWrapping);
      expect(t.wrapT, key).toBe(THREE.RepeatWrapping);
      expect(t.generateMipmaps, key).toBe(true);
      expect(t.minFilter, key).toBe(THREE.LinearMipmapLinearFilter);
      expect(t.colorSpace, key).toBe(THREE.SRGBColorSpace);
    }
  });

  it('empties the cache on dispose', () => {
    const textures = build();
    textures.dispose();
    expect(() => textures.get('concrete')).toThrow();
  });
});

describe('ProceduralTextures: the world scale of each material', () => {
  it('is the authored metres per repeat', () => {
    const textures = build();
    const scales: Record<string, number> = {};
    for (const key of MATERIAL_KEYS) scales[key] = textures.get(key).worldScale;
    expect(scales).toEqual({
      concrete: 2,
      concreteDark: 2,
      floor: 2,
      metal: 1,
      hazard: 1,
      accent: 1,
      rubber: 1,
      brick: 2,
      rust: 2.4,
      grate: 1,
      sand: 3,
      plaster: 2.4,
      clayTile: 1.4,
      wood: 1.6,
      asphalt: 3,
      paintedSteel: 2.4,
    });
  });

  it('gives the big flat outdoor surfaces the longest repeat', () => {
    const textures = build();
    // A 1 m tile on a desert street reads as a chequerboard at a sprint.
    expect(textures.get('sand').worldScale).toBe(3);
    expect(textures.get('asphalt').worldScale).toBe(3);
    expect(textures.get('metal').worldScale).toBeLessThan(textures.get('sand').worldScale);
  });
});

describe('ProceduralTextures: what each painter draws', () => {
  it('issues the same command sequence for every material', () => {
    build();
    const sums: Record<string, number> = {};
    for (const [key, ctx] of byKey()) sums[key] = commandSum(ctx);
    expect(sums).toEqual({
      concrete: 1557248668,
      concreteDark: 1688359592,
      floor: 4104755875,
      metal: 3397570400,
      hazard: 3579436697,
      accent: 1199338458,
      rubber: 1271748124,
      brick: 1137773278,
      rust: 3271828956,
      grate: 1945826965,
      sand: 953552459,
      plaster: 3360838453,
      clayTile: 1688206053,
      wood: 3176718840,
      asphalt: 490041749,
      paintedSteel: 1329265531,
    });
  });

  it('leaves the same value noise in the pixels for every material', () => {
    build();
    const sums: Record<string, number> = {};
    for (const [key, ctx] of byKey()) sums[key] = pixelSum(ctx);
    expect(sums).toEqual({
      concrete: 3332657458,
      concreteDark: 4145139013,
      floor: 1108646926,
      metal: 285005182,
      hazard: 1376440263,
      accent: 972994290,
      rubber: 2607278796,
      brick: 2360653371,
      rust: 1288652687,
      grate: 1988803577,
      sand: 2491434047,
      plaster: 3677316316,
      clayTile: 370292653,
      wood: 1223090424,
      asphalt: 1118481660,
      paintedSteel: 2123164107,
    });
  });

  it('is identical across two builds, because every seed is fixed', () => {
    build();
    const first = [...byKey().values()].map(commandSum);
    recorded = [];
    build();
    expect([...byKey().values()].map(commandSum)).toEqual(first);
  });

  it('gives every material its own seed, so no two share a grain', () => {
    build();
    const sums = [...byKey().values()].map(commandSum);
    expect(new Set(sums).size).toBe(sums.length);
  });

  it('separates the two concretes by their grain alone', () => {
    build();
    const map = byKey();
    const light = map.get('concrete') as RecordingContext;
    const dark = map.get('concreteDark') as RecordingContext;
    // Same painter, so the same shape of command log...
    expect(light.ops.map((o) => o.op)).toEqual(dark.ops.map((o) => o.op));
    // ...and different numbers in it.
    expect(commandSum(light)).not.toBe(commandSum(dark));
  });

  it('starts every painter by filling the tile with its base colour', () => {
    build();
    for (const [key, ctx] of byKey()) {
      expect(ctx.ops[0]?.op, key).toBe('fillStyle=');
      expect(String(ctx.ops[0]?.args[0]), key).toMatch(/^#[0-9a-f]{6}$/);
      expect(ctx.ops[1], key).toEqual({ op: 'fillRect', args: [0, 0, TEX_SIZE, TEX_SIZE] });
    }
  });

  it('wraps every blotch across all four edges, so the tile stays seamless', () => {
    build();
    const concrete = byKey().get('concrete') as RecordingContext;
    const radial = concrete.ops.filter((o) => o.op === 'radialGradient');
    // 26 blotches, each drawn once in place and four times offset.
    expect(radial.length).toBe(26 * 5);
  });

  it('runs the value noise exactly once per material', () => {
    build();
    for (const [key, ctx] of byKey()) {
      expect(ctx.ops.filter((o) => o.op === 'getImageData').length, key).toBe(1);
      expect(ctx.ops.filter((o) => o.op === 'putImageData').length, key).toBe(1);
    }
  });
});

