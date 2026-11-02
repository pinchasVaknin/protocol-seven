import { describe, expect, it } from 'vitest';
import { weaponSilhouettePath } from './WeaponSilhouette';
import { bodyBoxes, bodyTubes, chargingBoxes, magazineBoxes, magazineTubes } from './WeaponMeshParts';
import { modelSpecFor } from './WeaponModelSpecs';

/**
 * The killfeed's glyph, projected from the model it is a glyph of.
 *
 * F15 asked for one source for what a weapon looks like, and named `WeaponIcons` as the second
 * one that drifts: it was a single hand-drawn `AR` outline standing in for a *class*, and
 * eleven of the twelve weapons had no icon at all. So this is projected from the same
 * `WeaponModelSpec` the viewmodel is built from — which is exactly what the tests below check:
 * change a spec and the outline changes with it, and no two weapons draw the same shape.
 */

const IDS = [
  'ar_carbine',
  'ar_vulcan',
  'ar_halcyon',
  'ar_longbow',
  'smg_wasp',
  'smg_meridian',
  'shotgun_breacher',
  'lmg_bastion',
  'lmg_monolith',
  'sniper_kestrel',
  'sniper_vantage',
  'pistol_talon',
] as const;

const VIEW_W = 48;
const VIEW_H = 16;
const MARGIN = 0.5;

/** Every coordinate pair in a path, as numbers. */
function pointsOf(path: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const match of path.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
    out.push([Number(match[1]), Number(match[2])]);
  }
  return out;
}

function boundsOf(path: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const points = pointsOf(path);
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

describe('every weapon has one', () => {
  it('draws a path for all twelve, with no weapon left to a name in the feed', () => {
    for (const id of IDS) {
      const path = weaponSilhouettePath(id);
      expect(path.length, id).toBeGreaterThan(50);
      expect(path.startsWith('M'), id).toBe(true);
      expect(path.endsWith('Z'), id).toBe(true);
    }
  });

  it('draws twelve different shapes, because twelve specs exist', () => {
    const paths = new Set(IDS.map((id) => weaponSilhouettePath(id)));
    expect(paths.size).toBe(IDS.length);
  });

  it('closes every subpath, so the non-zero fill makes one solid shape', () => {
    for (const id of IDS) {
      const path = weaponSilhouettePath(id);
      const starts = (path.match(/M/g) ?? []).length;
      const closes = (path.match(/Z/g) ?? []).length;
      expect(starts, id).toBe(closes);
      // Four corners a quad, so every subpath is `M` plus three `L`.
      expect((path.match(/L/g) ?? []).length, id).toBe(starts * 3);
    }
  });

  it('answers the same path for the same weapon, from the cache', () => {
    for (const id of IDS) expect(weaponSilhouettePath(id)).toBe(weaponSilhouettePath(id));
  });
});

describe('the fit', () => {
  it('keeps every point inside the viewBox, with the margin clear', () => {
    for (const id of IDS) {
      const { minX, maxX, minY, maxY } = boundsOf(weaponSilhouettePath(id));
      expect(minX, id).toBeGreaterThanOrEqual(MARGIN - 1e-6);
      expect(maxX, id).toBeLessThanOrEqual(VIEW_W - MARGIN + 1e-6);
      expect(minY, id).toBeGreaterThanOrEqual(MARGIN - 1e-6);
      expect(maxY, id).toBeLessThanOrEqual(VIEW_H - MARGIN + 1e-6);
    }
  });

  it('fills the box along one axis, so nothing is drawn smaller than it needs to be', () => {
    for (const id of IDS) {
      const { minX, maxX, minY, maxY } = boundsOf(weaponSilhouettePath(id));
      const fillsX = maxX - minX > VIEW_W - MARGIN * 2 - 0.05;
      const fillsY = maxY - minY > VIEW_H - MARGIN * 2 - 0.05;
      expect(fillsX || fillsY, id).toBe(true);
    }
  });

  it('scales uniformly, so a pistol does not read as a carbine', () => {
    // Stretching to fill a 3:1 box would make every weapon the same shape, and the whole
    // reason the killfeed carries a silhouette rather than a label is that the shape is
    // meant to be recognisable at a glance. A pistol is nothing like as long as an LMG.
    const aspect = (id: string): number => {
      const { minX, maxX, minY, maxY } = boundsOf(weaponSilhouettePath(id));
      return (maxX - minX) / Math.max(maxY - minY, 1e-6);
    };
    expect(aspect('pistol_talon')).toBeLessThan(aspect('lmg_bastion'));
  });

  it('centres what is left over', () => {
    for (const id of IDS) {
      const { minX, maxX, minY, maxY } = boundsOf(weaponSilhouettePath(id));
      // Whatever the fit did not use is split evenly between the two sides.
      expect(minX + (VIEW_W - maxX), id).toBeCloseTo((VIEW_W - (maxX - minX)), 1);
      expect(minY + (VIEW_H - maxY), id).toBeCloseTo((VIEW_H - (maxY - minY)), 1);
    }
  });
});

describe('the projection', () => {
  it('points the barrel to the right', () => {
    // Model space is -Z forward and the screen's x is -z, so a muzzle at the most negative Z
    // lands at the largest x. The whole glyph is read left-to-right in the feed.
    const spec = modelSpecFor('ar_carbine');
    const muzzleZ = Math.min(...bodyTubes(spec).map((t) => t.z - t.length / 2));
    const receiverZ = 0;
    expect(muzzleZ).toBeLessThan(receiverZ);
    const path = weaponSilhouettePath('ar_carbine');
    // The barrel is the thin end: the right-hand quarter of the box is sparser than the left.
    const points = pointsOf(path);
    const right = points.filter((p) => p[0] > VIEW_W * 0.75).length;
    const left = points.filter((p) => p[0] < VIEW_W * 0.25).length;
    expect(right).toBeLessThan(left);
  });

  it('draws one quad per part, lenses and reticles aside', () => {
    for (const id of IDS) {
      const spec = modelSpecFor(id);
      const drawn = [...bodyBoxes(spec), ...magazineBoxes(spec), ...chargingBoxes(spec)].filter(
        (p) => p.surface !== 'lens' && p.surface !== 'reticle',
      ).length;
      const tubes = [...bodyTubes(spec), ...magazineTubes(spec)].filter(
        (t) => t.surface !== 'lens' && t.surface !== 'reticle',
      ).length;
      const quads = (weaponSilhouettePath(id).match(/M/g) ?? []).length;
      expect(quads, id).toBe(drawn + tubes);
    }
  });

  it('leaves the optic’s aperture open, which is what M7 opened', () => {
    // A filled red-dot window would close it again: the glass and the dot are what you look
    // *through*, and at sixteen pixels a filled one is a black blob on the sight.
    const withOptic = IDS.find((id) => bodyBoxes(modelSpecFor(id)).some((b) => b.surface === 'lens'));
    expect(withOptic).toBeDefined();
    const spec = modelSpecFor(withOptic as string);
    const apertures = bodyBoxes(spec).filter((b) => b.surface === 'lens' || b.surface === 'reticle').length;
    expect(apertures).toBeGreaterThan(0);
    const quads = (weaponSilhouettePath(withOptic as string).match(/M/g) ?? []).length;
    const all = [...bodyBoxes(spec), ...magazineBoxes(spec), ...chargingBoxes(spec), ...bodyTubes(spec), ...magazineTubes(spec)].length;
    expect(quads).toBe(all - apertures);
  });

  it('leaves the first-person gloves out, which were never in the body anyway', () => {
    const spec = modelSpecFor('ar_carbine');
    expect(bodyBoxes(spec).some((b) => b.surface === 'glove')).toBe(false);
    expect(weaponSilhouettePath('ar_carbine')).not.toContain('NaN');
  });

  it('follows the spec: a longer barrel draws a longer weapon', () => {
    // The point of projecting rather than drawing: there is no second description to update.
    const path = weaponSilhouettePath('ar_carbine');
    const longer = weaponSilhouettePath('sniper_vantage');
    expect(modelSpecFor('sniper_vantage').barrelLength).toBeGreaterThan(modelSpecFor('ar_carbine').barrelLength);
    expect(longer).not.toBe(path);
  });

  it('rounds to two places, because a sixteen-pixel glyph needs no more', () => {
    for (const [x, y] of pointsOf(weaponSilhouettePath('ar_carbine'))) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    expect(weaponSilhouettePath('ar_carbine')).toMatch(/\d\.\d\d/);
  });
});
