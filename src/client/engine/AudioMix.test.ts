import { describe, expect, it } from 'vitest';
import { DISTANCE_PROFILES, MIX, type DistanceProfileName } from './AudioMix';

/**
 * The mix table, pinned before unit C3's refactor.
 *
 * This is a data file, so there is no behaviour to characterize — what is worth holding is the
 * set of *claims its comments make*, because those are the reasons the numbers are what they are
 * and a later edit that breaks one of them would still look like a tidy change. The file argues
 * three things: that an enemy's gunfire has to carry where a footstep must not, that your own
 * weapon and your own feet sit below everyone else's to buy the headroom for it, and that
 * `maxDistance` clears the largest map's diagonal so far sound fades rather than cutting out.
 *
 * `gainAt` below is the Web Audio `inverse` distance model written out here. It does not test the
 * code — nothing in the project computes it, the `PannerNode` does — it tests that the table is
 * fit for the claims the file makes about it.
 */

/** The `inverse` model, as a `PannerNode` applies it. */
function gainAt(profile: { refDistance: number; rolloff: number; maxDistance: number }, metres: number): number {
  const d = Math.min(Math.max(metres, profile.refDistance), profile.maxDistance);
  return profile.refDistance / (profile.refDistance + profile.rolloff * (d - profile.refDistance));
}

/** The longest diagonal of any shipped map: Dunes, 64 x 76 m. */
const DUNES_DIAGONAL = Math.hypot(64, 76);

describe('DISTANCE_PROFILES', () => {
  it('is the five authored curves', () => {
    expect(DISTANCE_PROFILES).toEqual({
      loud: { refDistance: 6, rolloff: 0.72, maxDistance: 150 },
      impact: { refDistance: 3, rolloff: 1.0, maxDistance: 90 },
      handling: { refDistance: 2.2, rolloff: 1.25, maxDistance: 45 },
      footstep: { refDistance: 1.6, rolloff: 1.6, maxDistance: 26 },
      world: { refDistance: 2.6, rolloff: 1.1, maxDistance: 70 },
    });
  });

  it('names exactly those five, which is what DistanceProfileName admits', () => {
    const names: DistanceProfileName[] = ['loud', 'impact', 'handling', 'footstep', 'world'];
    expect(Object.keys(DISTANCE_PROFILES).sort()).toEqual([...names].sort());
  });

  it('gives gunfire the flattest curve and footsteps the tightest', () => {
    const rolloffs = Object.values(DISTANCE_PROFILES).map((p) => p.rolloff);
    expect(DISTANCE_PROFILES.loud.rolloff).toBe(Math.min(...rolloffs));
    expect(DISTANCE_PROFILES.footstep.rolloff).toBe(Math.max(...rolloffs));
    expect(DISTANCE_PROFILES.footstep.maxDistance).toBe(
      Math.min(...Object.values(DISTANCE_PROFILES).map((p) => p.maxDistance)),
    );
  });

  it('clears the longest map diagonal on the loud curve, so far gunfire fades and never cuts', () => {
    expect(DUNES_DIAGONAL).toBeGreaterThan(99);
    expect(DISTANCE_PROFILES.loud.maxDistance).toBeGreaterThan(DUNES_DIAGONAL);
  });

  it('keeps an enemy rifle plainly audible across a map, which is S6.4 itself', () => {
    // The failure the file was written to fix: M2's one curve put an enemy at 30 m at 5%.
    const oldCurve = { refDistance: 1.6, rolloff: 1.1, maxDistance: 90 };
    expect(gainAt(oldCurve, 30)).toBeLessThan(0.06);
    expect(gainAt(DISTANCE_PROFILES.loud, 30)).toBeGreaterThan(0.2);
    expect(gainAt(DISTANCE_PROFILES.loud, 60)).toBeGreaterThan(0.1);
  });

  it('makes a footstep useless as information past forty metres', () => {
    expect(gainAt(DISTANCE_PROFILES.footstep, 40)).toBeLessThan(0.05);
    // ...while gunfire at the same distance is still there.
    expect(gainAt(DISTANCE_PROFILES.loud, 40)).toBeGreaterThan(gainAt(DISTANCE_PROFILES.footstep, 40) * 4);
  });

  it('orders the five curves by how far each is meant to carry', () => {
    const at25 = (name: DistanceProfileName): number => gainAt(DISTANCE_PROFILES[name], 25);
    expect(at25('loud')).toBeGreaterThan(at25('impact'));
    expect(at25('impact')).toBeGreaterThan(at25('world'));
    expect(at25('world')).toBeGreaterThan(at25('handling'));
    expect(at25('handling')).toBeGreaterThan(at25('footstep'));
  });
});

describe('MIX', () => {
  it('is the authored table', () => {
    expect(MIX).toEqual({
      ownWeapon: 0.62,
      otherWeapon: 1.0,
      ownFootstep: 0.5,
      otherFootstep: 1.0,
      ownHandling: 0.75,
      otherHandling: 1.0,
      impact: 1.15,
      explosion: 1.0,
      announcer: 1.0,
    });
  });

  it('ducks everything of your own below everyone else’s — the headroom the curve spends', () => {
    expect(MIX.ownWeapon).toBeLessThan(MIX.otherWeapon);
    expect(MIX.ownFootstep).toBeLessThan(MIX.otherFootstep);
    expect(MIX.ownHandling).toBeLessThan(MIX.otherHandling);
  });

  it('ducks your own feet hardest, because they are the most constant mask', () => {
    expect(MIX.ownFootstep).toBeLessThan(MIX.ownWeapon);
    expect(MIX.ownFootstep).toBeLessThan(MIX.ownHandling);
    expect(MIX.ownFootstep).toBe(MIX.otherFootstep / 2);
  });

  it('leaves everyone else at the level the voices authored', () => {
    expect(MIX.otherWeapon).toBe(1);
    expect(MIX.otherFootstep).toBe(1);
    expect(MIX.otherHandling).toBe(1);
    expect(MIX.explosion).toBe(1);
    expect(MIX.announcer).toBe(1);
  });

  it('lifts impacts above authored level, which is how you learn you are being shot at', () => {
    expect(MIX.impact).toBeGreaterThan(1);
  });

  it('keeps every trim inside a sane range', () => {
    for (const [name, value] of Object.entries(MIX)) {
      expect(value, name).toBeGreaterThan(0);
      expect(value, name).toBeLessThanOrEqual(1.5);
    }
  });
});
