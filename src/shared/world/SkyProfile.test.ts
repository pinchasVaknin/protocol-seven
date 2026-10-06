import { describe, expect, it } from 'vitest';
import { readSkyline, SKY_PROFILE_SAMPLES, skylineFeatureHeight, skylineProfile } from './SkyProfile';
import type { SkylineDef } from './maps/types';

/**
 * The distant ridge line, as numbers.
 *
 * `npm run readability` already asserts the one rule this file has — that the profile joins up
 * where it wraps — but it asserts it on the shipped maps, and it reports rather than fails on
 * everything else. These tests pin the generator itself: the exact curve for a seed, and the
 * three properties that make it a horizon rather than an array.
 *
 * **Periodicity is the assertion and the rest are readings.** A generator that indexes its
 * control points without the modulo leaves a vertical step at exactly one azimuth: a crack in
 * the horizon, in one direction, that a playtester finds and nobody reproduces from the
 * description. Comparing the two *ends* by size cannot catch it on a hard-edged skyline, where
 * a step the size of a building is the point. Comparing one turn of the circle with the next
 * can, and does so with no threshold.
 */

/** A smooth ridge: Dunes' shape. */
const RIDGE: SkylineDef = { color: 0x101010, heightDeg: 8, count: 12, hardness: 0, seed: 1234 };

/** Hard-edged blocks: a rooftop skyline, the other end of the same generator. */
const BLOCKS: SkylineDef = { color: 0x101010, heightDeg: 14, count: 9, hardness: 1, seed: 77 };

describe('the skyline profile', () => {
  it('samples the full circle at 0.7 degrees of azimuth', () => {
    expect(SKY_PROFILE_SAMPLES).toBe(512);
    expect(skylineProfile(RIDGE).length).toBe(512);
    expect(skylineProfile(RIDGE, 16).length).toBe(16);
  });

  it('gives a seed the same ridge for ever', () => {
    expect(skylineProfile(RIDGE, 16)).toEqual([
      0.05433167991391955, 0.06142089577397557, 0.06533970669183717, 0.07146684855783252,
      0.09048105153781072, 0.12151679460508402, 0.09042184089602887, 0.06622220587987443,
      0.13449266988881162, 0.10936855833100513, 0.11079581107796327, 0.11555593379808601,
      0.1084293200953683, 0.07926915043645585, 0.09806542303419505, 0.11164765718519953,
    ]);
    // A second call is the same array: there is no generator state threaded through the loop.
    expect(skylineProfile(RIDGE, 16)).toEqual(skylineProfile(RIDGE, 16));
  });

  it('holds a block across its cell and turns over at the edge', () => {
    const profile = skylineProfile(BLOCKS, 16);
    // 9 features over 16 samples, so most cells cover two samples at one height, and the edge
    // ramp is where the turn happens. Pairs that repeat are the held parts.
    expect(profile[0]).toBe(profile[1]);
    expect(profile[2]).toBe(profile[3]);
    expect(profile[0]).not.toBe(profile[2]);
    // The smooth version of the same seed holds nothing: every sample is its own value.
    const ridge = skylineProfile({ ...BLOCKS, hardness: 0 }, 16);
    expect(ridge[0]).not.toBe(ridge[1]);
  });

  it('is a function of azimuth, so one turn of the circle equals the next', () => {
    // No threshold in the comparison, and none needed: the generator takes the modulo or it
    // does not.
    expect(readSkyline(RIDGE).worstPeriodicityDeg).toBe(0);
    expect(readSkyline(BLOCKS, 16).worstPeriodicityDeg).toBe(0);
    expect(readSkyline({ ...RIDGE, count: 1 }).worstPeriodicityDeg).toBe(0);
    expect(readSkyline({ ...RIDGE, count: 0 }).worstPeriodicityDeg).toBe(0);
  });

  it('reads the same heights and steps it has always read', () => {
    expect(readSkyline(RIDGE, 16)).toEqual({
      worstPeriodicityDeg: 0,
      worstStepDeg: 3.911609453111887,
      seamStepDeg: 3.2839635963120957,
      minDeg: 3.112975952923298,
      maxDeg: 7.705862360075116,
    });
    expect(readSkyline(RIDGE)).toEqual({
      worstPeriodicityDeg: 0,
      worstStepDeg: 0.16294393626396708,
      seamStepDeg: 0.006313772783436811,
      minDeg: 3.0706497977676968,
      maxDeg: 7.705862360075116,
    });
    expect(readSkyline(BLOCKS, 16)).toEqual({
      worstPeriodicityDeg: 0,
      worstStepDeg: 6.9489473096374414,
      seamStepDeg: 2.570029232371599,
      minDeg: 5.001388284312561,
      maxDeg: 11.950335593950003,
    });
  });

  it('keeps the lowest saddle a third of the way up, so a gap is distance and not a hole', () => {
    for (const def of [RIDGE, BLOCKS]) {
      const reading = readSkyline(def, 64);
      // MIN_FRACTION is 0.34 of heightDeg, and no sample may fall below it.
      expect(reading.minDeg).toBeGreaterThanOrEqual(def.heightDeg * 0.34 - 1e-12);
      // Nothing may stand above the authored peak either.
      expect(reading.maxDeg).toBeLessThanOrEqual(def.heightDeg + 1e-12);
    }
  });

  it('samples finer without changing the horizon it describes', () => {
    // The curve is the same shape read at two resolutions, so the tallest feature is the same
    // height and the steps between samples only get smaller.
    expect(readSkyline(RIDGE, 512).maxDeg).toBe(readSkyline(RIDGE, 16).maxDeg);
    expect(readSkyline(RIDGE, 512).worstStepDeg).toBeLessThan(readSkyline(RIDGE, 16).worstStepDeg);
  });

  it('exposes the feature hash itself, for the probe control and nothing else', () => {
    expect(skylineFeatureHeight(0, 1234)).toBe(0.07442726381123066);
    expect(skylineFeatureHeight(1, 1234)).toBe(0.1656017079949379);
    // A different seed is a different horizon; the same index and seed is the same number.
    expect(skylineFeatureHeight(0, 1235)).not.toBe(skylineFeatureHeight(0, 1234));
    expect(skylineFeatureHeight(0, 1234)).toBe(skylineFeatureHeight(0, 1234));
    // Every value is a height fraction, which is what the profile multiplies the peak by.
    for (let index = -4; index < 40; index++) {
      const height = skylineFeatureHeight(index, 99);
      expect(height).toBeGreaterThanOrEqual(0);
      expect(height).toBeLessThan(1);
    }
  });
});
