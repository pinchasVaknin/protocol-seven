import { describe, expect, it } from 'vitest';
import { linearLuminance, readFloor } from './MapLuminance';
import { GREYBOX_MAP } from './maps/greybox';
import type { Box, LightDef, MapDef } from './maps/types';

/**
 * The lighting instrument, pinned.
 *
 * This file exists because three Depot passes each raised a number and nobody could say by how
 * much the picture had moved. It reproduces the renderer's arithmetic — sRGB decode, three.js'
 * own irradiance formulations, Lambert, ACES and exposure — so a claim about darkness is
 * arithmetic rather than an impression. That makes it an *instrument*, and an instrument whose
 * readings drift silently is worse than no instrument: `npm run readability` would keep
 * printing numbers and the numbers would mean something new.
 *
 * So these pin the readings exactly, on a map built here with all three light kinds, which is
 * what runs every branch of the irradiance sum. The upper-bound caveats the file states — no
 * shadowing, no baked AO, no fog, no texture detail — are the reason a reading is quoted and
 * never used to declare a map bright enough; nothing here asserts otherwise.
 */

/** One of each kind, so the hemisphere, directional and point terms all contribute. */
const LIGHTS: readonly LightDef[] = [
  { kind: 'hemisphere', skyColor: 0x8899aa, groundColor: 0x202428, intensity: 0.8 },
  {
    kind: 'directional',
    color: 0xfff0d8,
    intensity: 1.4,
    direction: { x: -0.4, y: -1, z: 0.3 },
    castShadow: true,
    shadowExtent: 40,
  },
  { kind: 'point', color: 0xffcc88, intensity: 6, position: { x: 2, y: 4, z: -2 }, distance: 18, decay: 2 },
];

const BOUNDS: Box = { min: { x: -4, y: 0, z: -4 }, max: { x: 4, y: 3, z: 4 } };

/** The grey box with its lighting replaced: everything `readFloor` reads, and nothing else. */
function lit(lights: readonly LightDef[], navBounds: Box = BOUNDS): MapDef {
  return { ...GREYBOX_MAP, navBounds, lights: lights as LightDef[] };
}

describe('the linear luminance of an authored colour', () => {
  it('is the number F9 turns on', () => {
    // These two look like near neighbours in a palette and are a factor of five apart in the
    // space the renderer multiplies in. That sentence is the whole of the finding.
    //
    // Both channels are above the sRGB threshold, so both go through `Math.pow` — the same
    // implementation-approximated call as the irradiance figures below, and so the same
    // tolerance for the same reason. See `IRRADIANCE_DIGITS`.
    expect(linearLuminance(0x24262b)).toBeCloseTo(0.019357125143412927, 13);
    expect(linearLuminance(0x555a63)).toBeCloseTo(0.10144476053010315, 13);
    expect(linearLuminance(0x555a63) / linearLuminance(0x24262b)).toBeGreaterThan(5);
  });

  it('decodes the ends of the range exactly', () => {
    expect(linearLuminance(0x000000)).toBe(0);
    expect(linearLuminance(0xffffff)).toBe(1);
    // The curve is below the diagonal everywhere between, which is the whole point of it:
    // mid grey is not half the light.
    expect(linearLuminance(0x808080)).toBeLessThan(0.25);
  });

  it('weights the channels by Rec. 709, so green carries most of the light', () => {
    expect(linearLuminance(0x00ff00)).toBe(0.7152);
    expect(linearLuminance(0xff0000)).toBe(0.2126);
    expect(linearLuminance(0x0000ff)).toBe(0.0722);
  });

  it('is below the linear decode of the darkest asphalt the dark-map reports were about', () => {
    // Under the sRGB threshold the curve is linear, so a near-black is proportional and tiny.
    expect(linearLuminance(0x050505)).toBeLessThan(0.002);
  });
});

/**
 * How precisely a reading can be pinned, and why the two halves differ.
 *
 * The screen values are pinned exactly. `screenValue` ends in `Math.round`, `mean` is a sum of
 * those integers over their count, and IEEE 754 specifies `/` exactly — so every conformant
 * engine must produce these same numbers, and they are the reading the instrument is actually
 * for.
 *
 * The raw irradiance figures cannot be, and the reason is measured rather than assumed. The
 * only operations in that path the ECMAScript spec leaves *implementation-approximated* are
 * `Math.pow` (the sRGB decode, and both halves of the distance falloff) and `Math.hypot`;
 * everything else is `+ - * /` and `Math.min`/`Math.max`, which are exact. On 2026-10-12 a
 * Render build on Node 22 reported `irradianceMax` for the second case below as
 * 1.4897219552777616 against this machine's 1.4897219552777619 — **adjacent doubles, one ULP
 * apart**, which is the signature of exactly those two functions and of nothing else.
 *
 * That extends the M9 table in `shared/core/SimMath.ts`, which measured `pow` and `hypot` as
 * agreeing — between Node 24 (V8 13.6) and Chrome 148 (V8 14.x). Node 22 is V8 12.4, an engine
 * that table never covered. `render.yaml` now pins NODE_VERSION to 24, but it pins the *major*:
 * V8 still moves inside 24.x, so an exact literal here is a test that depends on a number
 * nobody controls.
 *
 * 13 digits is 5e-14, about 225 ULP at this magnitude: some thirteen orders of magnitude
 * tighter than any real change to the arithmetic — a moved formula shifts these by percent —
 * and far above engine noise. The instrument still cannot drift silently, which is this file's
 * whole purpose. Note that none of this reaches `npm run readability`, whose own figures go
 * through `toFixed(3)` and `toFixed(4)`.
 */
const IRRADIANCE_DIGITS = 13;

describe('reading what a map floor reads at', () => {
  it('reports the same screen values it has always reported', () => {
    const { irradianceMin, irradianceMax, ...screen } = readFloor(lit(LIGHTS), 0x24262b);
    expect(screen).toEqual({ min: 7, max: 8, mean: 7.2, samples: 25 });
    expect(irradianceMin).toBeCloseTo(1.3725407647139893, IRRADIANCE_DIGITS);
    expect(irradianceMax).toBeCloseTo(1.603151215470804, IRRADIANCE_DIGITS);
  });

  it('takes the step it is given, and the albedo it is given', () => {
    const { irradianceMin, irradianceMax, ...screen } = readFloor(lit(LIGHTS), 0x555a63, 4);
    expect(screen).toEqual({ min: 42, max: 45, mean: 43.333333333333336, samples: 9 });
    expect(irradianceMin).toBeCloseTo(1.3725407647139893, IRRADIANCE_DIGITS);
    expect(irradianceMax).toBeCloseTo(1.4897219552777619, IRRADIANCE_DIGITS);
    // 20/255 is "I cannot see anything" and 42/255 is a lit floor: the same lights over a
    // brighter ground, which is the lever two failed Depot passes argued about.
    expect(readFloor(lit(LIGHTS), 0x555a63).mean).toBeGreaterThan(readFloor(lit(LIGHTS), 0x24262b).mean);
  });

  it('separates the lights from the albedo, so pooling is a property of the lights alone', () => {
    const dark = readFloor(lit(LIGHTS), 0x24262b);
    const pale = readFloor(lit(LIGHTS), 0x555a63);
    // Albedo multiplies both ends equally, so this pair is identical across two grounds. That
    // is what settles whether raising a ground colour would "flatten the pools": it cannot.
    expect(pale.irradianceMin).toBe(dark.irradianceMin);
    expect(pale.irradianceMax).toBe(dark.irradianceMax);
  });

  it('carries the denominator, so an empty grid cannot read as black', () => {
    // A zero that means "the grid was empty" has to be distinguishable from one that means
    // "it is black", and `samples` is how.
    const empty = readFloor(lit(LIGHTS, { min: { x: 4, y: 0, z: 4 }, max: { x: -4, y: 3, z: -4 } }), 0x24262b);
    expect(empty).toEqual({ min: 0, max: 0, mean: 0, samples: 0, irradianceMin: 0, irradianceMax: 0 });

    const black = readFloor(lit([]), 0x555a63);
    expect(black).toEqual({ min: 0, max: 0, mean: 0, samples: 25, irradianceMin: 0, irradianceMax: 0 });
  });

  it('adds each kind of light, and only the kinds the map authored', () => {
    const hemisphere = readFloor(lit([LIGHTS[0]!]), 0x555a63);
    const directional = readFloor(lit([LIGHTS[1]!]), 0x555a63);
    const point = readFloor(lit([LIGHTS[2]!]), 0x555a63);
    const all = readFloor(lit(LIGHTS), 0x555a63);

    // The hemisphere term is a constant over a flat floor: every sample takes the sky colour
    // outright, so there is nothing for it to pool.
    expect(hemisphere.irradianceMin).toBe(hemisphere.irradianceMax);
    // So is the directional term, which has no distance in it at all.
    expect(directional.irradianceMin).toBe(directional.irradianceMax);
    // The point light is the only one that varies across the floor, which is what makes it the
    // lever that lifts the gaps between mast pools.
    expect(point.irradianceMax).toBeGreaterThan(point.irradianceMin);

    // Irradiance is a sum, so the three add exactly.
    expect(all.irradianceMax).toBeCloseTo(
      hemisphere.irradianceMax + directional.irradianceMax + point.irradianceMax,
      12,
    );
    // The screen value does not add, because ACES and the sRGB encode are not linear. At this
    // end of the curve the two are close enough that the difference goes the unintuitive way,
    // which is exactly why the chain is reproduced here rather than reasoned about.
    expect(all.mean).toBe(43.8);
    expect(hemisphere.mean + directional.mean + point.mean).toBe(42.96);
  });

  it('gives a surface nothing from a light pointing the other way', () => {
    // `direction` is the direction the light travels, so a light travelling upward misses an
    // up-facing floor entirely — the sign convention `MapRender` places the light with.
    const upward: LightDef = { ...LIGHTS[1]!, direction: { x: 0, y: 1, z: 0 } } as LightDef;
    expect(readFloor(lit([upward]), 0x555a63).irradianceMax).toBe(0);
  });

  it('windows a point light to its cutoff, which is the lever round 2 identified', () => {
    const near: LightDef = { ...LIGHTS[2]!, distance: 6 } as LightDef;
    const far: LightDef = { ...LIGHTS[2]!, distance: 36 } as LightDef;
    const tight = readFloor(lit([near]), 0x555a63);
    const wide = readFloor(lit([far]), 0x555a63);
    // Widening the cutoff lifts the band away from the mast without touching the pool centre:
    // the attenuation window is ~1 near the light and collapses to 0 at the cutoff.
    expect(wide.irradianceMin).toBeGreaterThan(tight.irradianceMin);
    expect(wide.irradianceMax).toBeGreaterThan(tight.irradianceMax);
    // A cutoff of zero removes the window and leaves the inverse square alone.
    const unbounded = readFloor(lit([{ ...LIGHTS[2]!, distance: 0 } as LightDef]), 0x555a63);
    expect(unbounded.irradianceMax).toBeGreaterThan(wide.irradianceMax);
  });
});
