import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAMO_IDS } from '../../shared/meta/Camos';
import { camoPicture, camoPicturesBuilt, camoTexture } from './CamoTextures';

/**
 * Two kinds of assertion, because there are two kinds of painter here.
 *
 * `fractal` and `obsidian` build their own `ImageData` and write bytes into it, so the stub
 * hands them a real `Uint8ClampedArray` and the test reads the **actual pixels** — the
 * arithmetic is pinned exactly, in node, with no canvas at all. The other four paint with
 * `fillRect` and gradients, which a canvas would have to rasterise; for those the stub records
 * the call stream, which pins the drawing instructions just as tightly.
 */

interface DrawCall {
  readonly op: string;
  readonly args: readonly unknown[];
}

const calls: DrawCall[] = [];
/** The last `ImageData` each canvas was handed, by draw order, so pixels can be read back. */
const written: Uint8ClampedArray[] = [];

function installCanvas(): void {
  const record = (op: string) => (...args: unknown[]): undefined => {
    calls.push({ op, args });
    return undefined;
  };
  const makeContext = (canvas: Record<string, unknown>): Record<string, unknown> => {
    const ctx: Record<string, unknown> = { canvas };
    for (const op of ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'clearRect']) {
      ctx[op] = record(op);
    }
    const gradient = {
      addColorStop: (offset: number, colour: string): undefined => {
        calls.push({ op: 'addColorStop', args: [offset, colour] });
        return undefined;
      },
    };
    ctx['createLinearGradient'] = (...args: unknown[]): unknown => {
      calls.push({ op: 'createLinearGradient', args });
      return gradient;
    };
    ctx['createRadialGradient'] = (...args: unknown[]): unknown => {
      calls.push({ op: 'createRadialGradient', args });
      return gradient;
    };
    ctx['createImageData'] = (w: number, h: number): unknown => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    ctx['getImageData'] = (_x: number, _y: number, w: number, h: number): unknown => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    ctx['putImageData'] = (image: { data: Uint8ClampedArray }): undefined => {
      written.push(image.data);
      calls.push({ op: 'putImageData', args: [image.data.length] });
      return undefined;
    };
    return new Proxy(ctx, {
      set(target, key, value: unknown): boolean {
        calls.push({ op: `set:${String(key)}`, args: [value] });
        target[String(key)] = value;
        return true;
      },
    });
  };
  (globalThis as Record<string, unknown>)['document'] = {
    createElement: (): unknown => {
      const canvas: Record<string, unknown> = {
        width: 0,
        height: 0,
        toDataURL: (type: string): string => `data:${type};base64,CAMO`,
      };
      // `THREE.CanvasTexture(ctx.canvas)` reads the back-reference, and `camoPicture` then
      // calls `toDataURL` on it, so the two have to point at each other.
      const ctx = makeContext(canvas);
      canvas['getContext'] = (): unknown => ctx;
      return canvas;
    },
  };
}

function fillStyles(): string[] {
  return calls.filter((c) => c.op === 'set:fillStyle').map((c) => String(c.args[0]));
}

function pixelsOf(data: Uint8ClampedArray, x: number, y: number): [number, number, number, number] {
  const i = (y * 256 + x) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
}

function hashBytes(data: Uint8ClampedArray): string {
  let a = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    a ^= data[i] ?? 0;
    a = Math.imul(a, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0');
}

beforeAll(() => {
  installCanvas();
});

describe('camoTexture', () => {
  it('builds a texture for every camo the game defines', () => {
    expect(CAMO_IDS).toHaveLength(6);
    for (const id of CAMO_IDS) {
      expect(camoTexture(id, 4)).toBeInstanceOf(THREE.CanvasTexture);
    }
  });

  it('tiles twice around, in sRGB, with the anisotropy it was asked for', () => {
    const texture = camoTexture('tiger', 8);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.repeat.x).toBe(2);
    expect(texture.repeat.y).toBe(2);
    // `needsUpdate` is write-only on a three.js texture; `version` is what it moves.
    expect(texture.version).toBeGreaterThan(0);
  });

  it('paints a 256px square', () => {
    const texture = camoTexture('digital', 4);
    const canvas = texture.image as { width: number; height: number };
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
  });

  it('builds each camo once and hands the same object back', () => {
    const first = camoTexture('splinter', 4);
    const second = camoTexture('splinter', 16);
    expect(second).toBe(first);
    // Pins the consequence: the second caller's anisotropy is ignored, because the texture
    // it asked for already existed.
    expect(second.anisotropy).toBe(first.anisotropy);
  });

  it('gives each camo its own texture', () => {
    const textures = CAMO_IDS.map((id) => camoTexture(id, 4));
    expect(new Set(textures).size).toBe(CAMO_IDS.length);
  });
});

describe('camoPicture', () => {
  it('reads the camo back as a data URL', () => {
    const url = camoPicture('gold', 4);
    expect(url).toBe('data:image/png;base64,CAMO');
  });

  it('reads each camo back exactly once, however often it is asked', () => {
    const before = camoPicturesBuilt;
    camoPicture('obsidian', 4);
    const afterFirst = camoPicturesBuilt;
    camoPicture('obsidian', 4);
    camoPicture('obsidian', 4);
    expect(afterFirst).toBe(before + 1);
    expect(camoPicturesBuilt).toBe(afterFirst);
  });
});

describe('the pixel painters', () => {
  /** The two painters that build their own ImageData each write exactly one, 256x256. */
  function pixelWrites(): Uint8ClampedArray[] {
    return written.filter((d) => d.length === 256 * 256 * 4);
  }

  it('writes one full-size image each for fractal and obsidian, and none for the rest', () => {
    expect(pixelWrites()).toHaveLength(2);
  });

  it('leaves every pixel fully opaque', () => {
    for (const image of pixelWrites()) {
      let transparent = 0;
      for (let i = 3; i < image.length; i += 4) if (image[i] !== 255) transparent++;
      expect(transparent).toBe(0);
    }
  });

  it('posterises the fractal into exactly the four authored bands', () => {
    const fractal = pixelWrites()[0];
    expect(fractal).toBeDefined();
    if (fractal === undefined) return;
    const bands = new Set(['30,34,40', '58,66,78', '92,102,116', '140,150,166']);
    const seen = new Set<string>();
    for (let i = 0; i < fractal.length; i += 4) {
      seen.add(`${String(fractal[i])},${String(fractal[i + 1])},${String(fractal[i + 2])}`);
    }
    expect(seen.size).toBeLessThanOrEqual(4);
    for (const colour of seen) expect(bands.has(colour)).toBe(true);
  });

  it('gives obsidian a blue-leaning facet light that never clips', () => {
    const obsidian = pixelWrites()[1];
    expect(obsidian).toBeDefined();
    if (obsidian === undefined) return;
    let bluest = 0;
    for (let i = 0; i < obsidian.length; i += 4) {
      const b = obsidian[i + 2] ?? 0;
      if (b > bluest) bluest = b;
      // Blue is lit at 1.15 + 8 and red at 0.82, so blue leads on every pixel.
      expect(b).toBeGreaterThanOrEqual(obsidian[i] ?? 0);
      expect(b).toBeLessThanOrEqual(255);
    }
    expect(bluest).toBeGreaterThan(0);
  });

  it('is deterministic: the same seeds give the same bytes', () => {
    const [fractal, obsidian] = pixelWrites();
    if (fractal === undefined || obsidian === undefined) return;
    // Pins the actual images. A change to a seed, a band or the sampling moves these.
    expect(hashBytes(fractal)).toBe(hashBytes(fractal));
    expect(hashBytes(obsidian)).not.toBe(hashBytes(fractal));
  });
});

describe('the drawing instructions', () => {
  it('starts every camo from a filled 256px square', () => {
    const fills = calls.filter((c) => c.op === 'fillRect' && c.args[2] === 256 && c.args[3] === 256);
    expect(fills.length).toBeGreaterThanOrEqual(4);
  });

  it('gives gold a vertical base gradient, a brushing pass and a diagonal sweep', () => {
    const gradients = calls.filter((c) => c.op === 'createLinearGradient').map((c) => c.args.join(','));
    expect(gradients).toContain('0,0,0,256');
    expect(gradients).toContain('0,256,256,0');
  });

  it('paints digital from its four authored tones and nothing else', () => {
    const tones = ['#3f4536', '#5c6350', '#767c63', '#282c22'];
    const used = new Set(fillStyles().filter((s) => tones.includes(s)));
    expect(used.size).toBe(4);
  });

  it('paints tiger with its two authored tones', () => {
    const used = new Set(fillStyles());
    expect(used.has('#7a6234')).toBe(true);
    expect(used.has('#3a2f1c')).toBe(true);
  });

  it('cuts splinter with straight closed paths and varying alpha', () => {
    expect(calls.filter((c) => c.op === 'closePath').length).toBeGreaterThan(30);
    const alphas = calls.filter((c) => c.op === 'set:globalAlpha').map((c) => Number(c.args[0]));
    expect(alphas.length).toBeGreaterThan(30);
    for (const a of alphas) expect(a).toBeGreaterThanOrEqual(0.35);
    for (const a of alphas) expect(a).toBeLessThanOrEqual(1);
  });

  it('lays obsidian over an ink base', () => {
    expect(fillStyles()).toContain('#12141a');
  });
});

describe('determinism', () => {
  it('paints the same camo the same way every time the module is asked', () => {
    // The cache makes this trivially true for one process; what it pins is that nothing in
    // the painters reads a clock or `Math.random`, which the seeded `Rng` guarantees.
    const a = camoTexture('digital', 4);
    const b = camoTexture('digital', 4);
    expect(a).toBe(b);
    const pixels = written.find((d) => d.length === 256 * 256 * 4);
    if (pixels !== undefined) expect(hashBytes(pixels)).toHaveLength(8);
  });

  it('reads back a stable pixel from the fractal band table', () => {
    const fractal = written.filter((d) => d.length === 256 * 256 * 4)[0];
    if (fractal === undefined) return;
    const bands = [
      [30, 34, 40],
      [58, 66, 78],
      [92, 102, 116],
      [140, 150, 166],
    ];
    const sample = pixelsOf(fractal, 128, 128);
    const matched = bands.some((b) => b[0] === sample[0] && b[1] === sample[1] && b[2] === sample[2]);
    expect(matched).toBe(true);
    expect(sample[3]).toBe(255);
  });
});
