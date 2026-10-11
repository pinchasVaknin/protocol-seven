import { describe, expect, it } from 'vitest';
import { DT } from '../core/Loop';
import { DEFAULT_EQUIPMENT_CONFIG } from './EquipmentConfig';
import { SmokeField, type SmokeVolume } from './SmokeField';

/**
 * Smoke that actually blocks line of sight, pinned.
 *
 * The brief is explicit that this must not be a visual effect only, and the three properties
 * that make the mechanic behave are all properties of the *integration* rather than of a sphere
 * test: clipping the rim does not hide you, standing in the middle does, and two half-grown
 * clouds in a row add up to one that works. Each is a test below.
 *
 * `adopt` gets its own section because it is the fix for a shipped bug: rebuilding a replicated
 * cloud with `spawn` every snapshot reset `age` to 0 twenty times a second, so `density` never
 * got past about 0.05 and the server was rejecting sight lines through a cloud the player could
 * see straight through.
 *
 * `opticalDepth` and `blocksSight` are also what `public/verify/arsenal.js` reads for criterion 6.
 */

const CFG = DEFAULT_EQUIPMENT_CONFIG;
const SCALE = CFG.smokeDepthScale;

function field(capacity = 4): SmokeField {
  return new SmokeField(capacity, CFG);
}

/**
 * A cloud at `(x, 0, 0)` of radius 4, fully grown and nowhere near its fade.
 *
 * Through `adopt`, because that is the one door that can place a cloud part-way along its own
 * curves; a fresh `spawn` has `age === 0` and a density below `MIN_DENSITY`, so it contributes
 * nothing and could not express any of the chord tests.
 */
function grownCloud(f: SmokeField, x = 0): SmokeVolume {
  const v = f.adopt(x, 0, 0, 4, 6, 12, 1.6);
  expect(v).not.toBe(null);
  return v as SmokeVolume;
}

describe('a field nothing has been thrown into', () => {
  it('holds its capacity of inactive volumes and counts none of them', () => {
    const f = field(3);
    expect(f.volumes.length).toBe(3);
    expect(f.volumes.every((v) => !v.active)).toBe(true);
    expect(f.liveCount).toBe(0);
  });

  it('takes the fast out, so a map with no smoke on it pays for one pass', () => {
    const f = field();
    expect(f.blocksSight(-10, 0, 0, 10, 0, 0)).toBe(false);
    expect(f.totalQueries).toBe(1);
    expect(f.blockedQueries).toBe(0);
    expect(f.opticalDepth(-10, 0, 0, 10, 0, 0)).toBe(0);
  });
});

describe('a cloud that has just been thrown', () => {
  it('starts its clock at zero, at the position and the authored life it was given', () => {
    const f = field();
    const v = f.spawn(1, 2, 3, 4.2, 12, 1.6);
    expect(v).toEqual({
      active: true,
      x: 1,
      y: 2,
      z: 3,
      radius: 4.2,
      remaining: 12,
      total: 12,
      bloom: 1.6,
      age: 0,
    } satisfies SmokeVolume);
    expect(f.liveCount).toBe(1);
  });

  it('is a wisp until it has bloomed, which is why it blocks nothing yet', () => {
    const f = field();
    f.spawn(0, 0, 0, 4, 12, 1.6);
    expect(f.density(f.volumes[0] as SmokeVolume)).toBe(0);
    expect(f.opticalDepth(-10, 0, 0, 10, 0, 0)).toBe(0);
    expect(f.blocksSight(-10, 0, 0, 10, 0, 0)).toBe(false);
  });

  it('never has a zero bloom, so the density cannot divide by it', () => {
    const f = field();
    const v = f.spawn(0, 0, 0, 4, 12, 0);
    expect(v?.bloom).toBe(1e-3);
  });

  it('refuses once every volume is live rather than growing the field', () => {
    const f = field(2);
    expect(f.spawn(0, 0, 0, 4, 12, 1.6)).not.toBe(null);
    expect(f.spawn(1, 0, 0, 4, 12, 1.6)).not.toBe(null);
    expect(f.spawn(2, 0, 0, 4, 12, 1.6)).toBe(null);
    expect(f.liveCount).toBe(2);
  });
});

describe('a replicated cloud', () => {
  it('is placed where it already is on its own curves', () => {
    const f = field();
    const v = grownCloud(f);
    expect(v.total).toBe(12);
    expect(v.remaining).toBe(6);
    expect(v.age).toBe(6);
    expect(v.bloom).toBe(1.6);
    // Six seconds into a 1.6 s bloom is a grown cloud, which is the whole of the fix.
    expect(f.density(v)).toBe(1);
    expect(f.currentRadius(v)).toBe(4);
  });

  it('takes its total from the authored def, not from a shorter remaining life', () => {
    const f = field();
    const v = f.adopt(0, 0, 0, 4, 20, 12, 1.6) as SmokeVolume;
    // A remaining life longer than the authored total is the wire disagreeing; the longer wins
    // so `age` cannot go negative.
    expect(v.total).toBe(20);
    expect(v.age).toBe(0);
  });

  it('refuses when the field is full, like a thrown one', () => {
    const f = field(1);
    grownCloud(f);
    expect(f.adopt(5, 0, 0, 4, 6, 12, 1.6)).toBe(null);
  });
});

describe('a cloud over its life', () => {
  it('ages and thins by one tick a tick, and goes out when it runs out', () => {
    const f = field();
    // Two ticks of life: doubling and halving a float is exact, so the second tick takes
    // `remaining` to exactly zero rather than to a hair above it.
    const v = f.spawn(0, 0, 0, 4, DT * 2, 1.6) as SmokeVolume;
    f.step();
    expect(v.age).toBe(DT);
    expect(v.remaining).toBe(DT);
    expect(v.active).toBe(true);
    f.step();
    expect(v.active).toBe(false);
    expect(f.liveCount).toBe(0);
  });

  it('grows to full over the bloom and holds there', () => {
    const f = field();
    const v = f.spawn(0, 0, 0, 4, 12, 1.6) as SmokeVolume;
    const half = grownCloud(f, 9);
    half.age = 0.8;
    expect(f.density(half)).toBe(0.5);
    expect(f.currentRadius(half)).toBe(2.7);
    v.age = 1.6;
    v.remaining = 12;
    expect(f.density(v)).toBe(1);
    v.age = 9;
    expect(f.density(v)).toBe(1);
  });

  it('thins over the last quarter of its life rather than vanishing at full opacity', () => {
    const f = field();
    const v = grownCloud(f);
    // The fade starts at a quarter of the total, which is 3 s of a 12 s cloud.
    v.remaining = 3;
    expect(f.density(v)).toBe(1);
    v.remaining = 1.5;
    expect(f.density(v)).toBe(0.5);
    v.remaining = 0;
    expect(f.density(v)).toBe(0);
  });
});

describe('the optical depth along a sight line', () => {
  it('is the chord through the cloud, weighted by its density', () => {
    const f = field();
    grownCloud(f);
    // Straight through the centre of a radius-4 cloud: an 8 m chord at full density.
    expect(f.opticalDepth(-10, 0, 0, 10, 0, 0)).toBe(8 * SCALE);
  });

  it('is clamped to the segment, so a line that stops inside counts only what it crossed', () => {
    const f = field();
    grownCloud(f);
    // Four of the eight metres, and its midpoint is 2 m off the centre — so the rim weight
    // applies as well: 1 - (2/4)^2.
    expect(f.opticalDepth(-10, 0, 0, 0, 0, 0)).toBe(4 * 0.75 * SCALE);
    expect(f.opticalDepth(0, 0, 0, 10, 0, 0)).toBe(4 * 0.75 * SCALE);
  });

  it('counts far less for a chord that only grazes the thin rim', () => {
    const f = field();
    grownCloud(f);
    const centre = f.opticalDepth(-10, 0, 0, 10, 0, 0);
    const graze = f.opticalDepth(-10, 3.9, 0, 10, 3.9, 0);
    expect(graze).toBeGreaterThan(0);
    expect(graze).toBeLessThan(centre * 0.05);
  });

  it('adds two clouds in a row, so neither has to work alone', () => {
    const f = field();
    grownCloud(f, -5);
    grownCloud(f, 5);
    expect(f.opticalDepth(-20, 0, 0, 20, 0, 0)).toBe(16 * SCALE);
  });

  it('ignores a cloud the line misses, and one behind the segment start', () => {
    const f = field();
    grownCloud(f, 40);
    expect(f.opticalDepth(-10, 0, 0, 10, 0, 0)).toBe(0);
    expect(f.opticalDepth(10, 0, 0, 20, 0, 0)).toBe(0);
  });

  it('ignores a wisp below the density floor', () => {
    const f = field();
    const v = grownCloud(f);
    v.age = 0.04;
    expect(f.density(v)).toBeLessThan(0.05);
    expect(f.opticalDepth(-10, 0, 0, 10, 0, 0)).toBe(0);
  });

  it('is zero for a segment with no length', () => {
    const f = field();
    grownCloud(f);
    expect(f.opticalDepth(0, 0, 0, 0, 0, 0)).toBe(0);
  });
});

describe('the occluder contract perception consumes', () => {
  it('blocks a line whose depth reaches the threshold, and counts it', () => {
    const f = field();
    grownCloud(f);
    expect(f.blocksSight(-10, 0, 0, 10, 0, 0)).toBe(true);
    expect(f.totalQueries).toBe(1);
    expect(f.blockedQueries).toBe(1);
  });

  it('passes a line that only grazed the rim, and counts the query but not the block', () => {
    const f = field();
    grownCloud(f);
    expect(f.blocksSight(-10, 3.9, 0, 10, 3.9, 0)).toBe(false);
    expect(f.totalQueries).toBe(1);
    expect(f.blockedQueries).toBe(0);
  });

  it('forgets its counters on request and its clouds on clear', () => {
    const f = field();
    grownCloud(f);
    f.blocksSight(-10, 0, 0, 10, 0, 0);
    f.resetStats();
    expect(f.totalQueries).toBe(0);
    expect(f.blockedQueries).toBe(0);
    f.clear();
    expect(f.liveCount).toBe(0);
    expect(f.blocksSight(-10, 0, 0, 10, 0, 0)).toBe(false);
  });
});
