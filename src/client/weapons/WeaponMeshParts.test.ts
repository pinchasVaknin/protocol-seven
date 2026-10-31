import { describe, expect, it } from 'vitest';
import {
  barrelY,
  bodyBoxes,
  bodyTubes,
  chargingBoxes,
  handBoxes,
  handBoxesAt,
  magazineBoxes,
  magazineTubes,
  muzzleZ,
  supportHandAnchor,
  triggerHandAnchor,
  type BoxPart,
  type TubePart,
} from './WeaponMeshParts';
import { modelSpecFor, type WeaponModelSpec } from './WeaponModelSpecs';

/**
 * Where every primitive goes, checked against the whole shipped arsenal rather than against
 * one weapon.
 *
 * Twelve weapons is what makes these tests worth writing: between them they cover all four
 * stocks, all three optics, all five magazines, the bipod and the pump, so a sweep over the
 * arsenal reaches every branch in the file without a single hand-made spec. Where a test does
 * build a spec it says why.
 *
 * The invariant the file exists to hold is the sight aperture (M7). The M6 playtest reported
 * the SMG optic as "rendering opaque, blocking the target entirely" and the pistol viewmodel
 * as obscuring the target; both were geometry, not materials — solid boxes straddling the
 * sight line. Every placement here is derived from `sightHeight` so that cannot recur, and
 * `the sight aperture` below is that claim as an assertion over all twelve.
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

const SPECS = IDS.map((id) => [id, modelSpecFor(id)] as const);

/** Metres. Everything here is centimetres and millimetres, so this is a generous epsilon. */
const EPS = 1e-9;

function spans(part: BoxPart, y: number): boolean {
  return part.y - part.h / 2 < y - EPS && part.y + part.h / 2 > y + EPS;
}

/** Every part a weapon is drawn from, in the order a builder would merge them. */
function allBoxes(spec: WeaponModelSpec): BoxPart[] {
  return [...bodyBoxes(spec), ...magazineBoxes(spec), ...chargingBoxes(spec)];
}

function allTubes(spec: WeaponModelSpec): TubePart[] {
  return [...bodyTubes(spec), ...magazineTubes(spec)];
}

describe('the arsenal covers the file', () => {
  it('reaches every stock, optic and magazine the spec can name', () => {
    const stocks = new Set(SPECS.map(([, s]) => s.stock));
    const optics = new Set(SPECS.map(([, s]) => s.optic));
    const magazines = new Set(SPECS.map(([, s]) => s.magazine));
    expect([...stocks].sort()).toEqual(['folding', 'full', 'none', 'skeleton']);
    expect([...optics].sort()).toEqual(['irons', 'reddot', 'scope']);
    expect([...magazines].sort()).toEqual(['box', 'curved', 'drum', 'grip', 'tube']);
    // And the two booleans, so the branches that hang off them are exercised too.
    expect(SPECS.some(([, s]) => s.bipod)).toBe(true);
    expect(SPECS.some(([, s]) => s.pump)).toBe(true);
    expect(SPECS.some(([, s]) => s.handguardLength <= 0)).toBe(true);
  });
});

describe('the reference points', () => {
  it('hangs the bore off the receiver at a constant fraction', () => {
    for (const [id, spec] of SPECS) {
      expect(barrelY(spec), id).toBeCloseTo(spec.receiverHeight * 0.13, 12);
    }
  });

  it('puts the muzzle in front of the barrel, in front of the handguard', () => {
    for (const [id, spec] of SPECS) {
      // -Z is forward, so every one of these is more negative than the last.
      const handguardEnd = -spec.receiverLength * 0.5 - spec.handguardLength;
      expect(muzzleZ(spec), id).toBeCloseTo(handguardEnd - spec.barrelLength - spec.muzzleLength * 0.5, 12);
      expect(muzzleZ(spec), id).toBeLessThanOrEqual(handguardEnd);
    }
  });

  it('puts the trigger hand behind the receiver’s middle and under the bore', () => {
    for (const [id, spec] of SPECS) {
      const grip = triggerHandAnchor(spec);
      // A touch right of centre, where a right-handed grip is; well under the bore; behind
      // the receiver's middle. The same datum a third-person character socket uses.
      expect(grip.x, id).toBeCloseTo(0.006, 12);
      expect(grip.y, id).toBeLessThan(-spec.receiverHeight * 0.5);
      expect(grip.z, id).toBeGreaterThan(0);
    }
  });

  it('puts the support hand on the handguard, or back on the grip when there is none', () => {
    for (const [id, spec] of SPECS) {
      const support = supportHandAnchor(spec);
      if (spec.handguardLength <= 0) {
        // A pistol is held in two hands on the grip. The support hand reaching for furniture
        // that does not exist is the M5 hotfix: a 0.2 m forearm between the sights and the eye.
        expect(support.z, id).toBeGreaterThan(0);
        continue;
      }
      expect(support.z, id).toBeLessThan(-spec.receiverLength * 0.5);
      expect(support.z, id).toBeGreaterThan(-spec.receiverLength * 0.5 - spec.handguardLength);
    }
  });
});

describe('the sight aperture', () => {
  /**
   * The claim the optic section's own comment makes: *"the aperture is clear on all twelve
   * weapons by construction: bases stop below it, posts straddle it and frame it, and only
   * the front blade crosses it"*. Here it is, over all twelve.
   */
  it('leaves nothing but the front blade on the centre line, on every weapon with irons', () => {
    for (const [id, spec] of SPECS) {
      if (spec.optic !== 'irons') continue;
      const onLine = bodyBoxes(spec).filter((b) => Math.abs(b.x) < 0.001 && spans(b, spec.sightHeight));
      expect(onLine, id).toHaveLength(1);
      expect(onLine[0]?.surface, id).toBe('gunmetal');
      // The blade is the forward one — ahead of the handguard, not over the receiver.
      expect(onLine[0]?.z, id).toBeLessThan(-spec.receiverLength * 0.5);
    }
  });

  it('leaves only glass and a dot on the line, on every weapon with a red dot', () => {
    for (const [id, spec] of SPECS) {
      if (spec.optic !== 'reddot') continue;
      const onLine = bodyBoxes(spec).filter((b) => Math.abs(b.x) < 0.001 && spans(b, spec.sightHeight));
      expect(onLine.map((b) => b.surface), id).toEqual(['lens', 'reticle']);
      // The dot sits behind the glass, toward the muzzle, so you look through one at the other.
      expect(onLine[1]?.z, id).toBeLessThan(onLine[0]?.z ?? 0);
    }
  });

  it('leaves the line completely clear on a scoped weapon, which looks down a tube', () => {
    for (const [id, spec] of SPECS) {
      if (spec.optic !== 'scope') continue;
      expect(bodyBoxes(spec).filter((b) => Math.abs(b.x) < 0.001 && spans(b, spec.sightHeight)), id).toHaveLength(0);
    }
  });

  it('keeps the rear notch posts off the centre line, so they frame rather than block', () => {
    for (const [id, spec] of SPECS) {
      if (spec.optic !== 'irons') continue;
      const straddling = bodyBoxes(spec).filter((b) => spans(b, spec.sightHeight));
      const posts = straddling.filter((b) => Math.abs(b.x) >= 0.001);
      expect(posts.length, id).toBe(2);
      // One each side, the same distance out.
      expect(posts[0]?.x, id).toBeCloseTo(-(posts[1]?.x ?? 0), 12);
    }
  });

  it('never puts anything through the line on a weapon’s magazine or charging handle', () => {
    for (const [id, spec] of SPECS) {
      const below = [...magazineBoxes(spec), ...chargingBoxes(spec)];
      for (const part of below) expect(spans(part, spec.sightHeight), `${id} ${part.surface}`).toBe(false);
    }
  });
});

describe('bodyBoxes', () => {
  it('opens with the receiver, its rail and an ejection port, on every weapon', () => {
    for (const [id, spec] of SPECS) {
      const boxes = bodyBoxes(spec);
      const [receiver, rail, port] = boxes;
      expect(receiver, id).toMatchObject({ surface: 'gunmetal', x: 0, y: 0, z: 0 });
      expect(receiver?.w, id).toBe(spec.receiverWidth);
      expect(receiver?.h, id).toBe(spec.receiverHeight);
      expect(receiver?.d, id).toBe(spec.receiverLength);
      // The rail is what an optic sits on, so every weapon has one.
      expect(rail?.y, id).toBeGreaterThan(0);
      // The port gives the receiver a right-hand side you can read.
      expect(port?.x, id).toBeGreaterThan(0);
    }
  });

  it('draws a handguard only where there is one', () => {
    for (const [id, spec] of SPECS) {
      const handguards = bodyBoxes(spec).filter((b) => b.surface === 'polymer' && b.d === spec.handguardLength);
      expect(handguards.length, id).toBe(spec.handguardLength > 0 ? 1 : 0);
    }
  });

  it('draws a stock of its own shape for each kind, and nothing for “none”', () => {
    // One weapon, four stocks: everything else about the spec is held still, so the only
    // difference between the four answers is the stock itself.
    const base = modelSpecFor('ar_carbine');
    const bare = bodyBoxes({ ...base, stock: 'none' });
    const shapes = new Map<string, BoxPart[]>();
    for (const stock of ['none', 'full', 'skeleton', 'folding'] as const) {
      const made = bodyBoxes({ ...base, stock });
      // The stock is inserted in the middle of the list, between the grip and the optic, so
      // the boxes it added are the ones from the first difference on.
      let at = 0;
      while (at < bare.length && JSON.stringify(made[at]) === JSON.stringify(bare[at])) at++;
      shapes.set(stock, made.slice(at, at + (made.length - bare.length)));
    }
    expect(shapes.get('none')).toEqual([]);
    for (const stock of ['full', 'skeleton', 'folding'] as const) {
      expect(shapes.get(stock)?.length, stock).toBeGreaterThan(0);
    }
    // A full stock sits behind the receiver on the centre line; a folding one is flat against
    // its right-hand side, which is what folded means.
    expect(shapes.get('full')?.[0]?.x).toBe(0);
    expect(shapes.get('full')?.[0]?.z).toBeGreaterThan(base.receiverLength * 0.5);
    expect(shapes.get('folding')?.[0]?.x).toBeGreaterThan(base.receiverWidth * 0.5);
    expect(shapes.get('folding')?.[0]?.z).toBeLessThan(base.receiverLength * 0.5);
    // And no two of the three are the same shape.
    const printed = ['full', 'skeleton', 'folding'].map((k) => JSON.stringify(shapes.get(k)));
    expect(new Set(printed).size).toBe(3);
  });

  it('gives a bipod two legs, splayed, and only to a weapon that has one', () => {
    for (const [id, spec] of SPECS) {
      const legs = bodyBoxes(spec).filter((b) => b.rz !== undefined && b.rz !== 0 && b.y < barrelY(spec));
      if (!spec.bipod) {
        expect(legs.length, id).toBe(0);
        continue;
      }
      expect(legs.length, id).toBe(2);
      expect(legs[0]?.rz, id).toBeCloseTo(-(legs[1]?.rz ?? 0), 12);
      expect(legs[0]?.x, id).toBeCloseTo(-(legs[1]?.x ?? 0), 12);
    }
  });

  it('builds every weapon out of something, and never out of nothing', () => {
    for (const [id, spec] of SPECS) {
      const boxes = bodyBoxes(spec);
      expect(boxes.length, id).toBeGreaterThan(8);
      for (const b of boxes) {
        expect(b.w, id).toBeGreaterThan(0);
        expect(b.h, id).toBeGreaterThan(0);
        expect(b.d, id).toBeGreaterThan(0);
      }
    }
  });
});

describe('the hands', () => {
  it('are kept out of the body, so a builder that does not want them filters nothing', () => {
    for (const [id, spec] of SPECS) {
      expect(bodyBoxes(spec).some((b) => b.surface === 'glove'), id).toBe(false);
      expect(handBoxes(spec).every((b) => b.surface === 'glove'), id).toBe(true);
    }
  });

  it('are two hands and two forearms, trigger pair first', () => {
    for (const [id, spec] of SPECS) {
      const boxes = handBoxes(spec);
      expect(boxes.length, id).toBe(4);
      // `handBoxesAt` relies on this order and says so; the split is by it.
      expect(boxes[0]?.z, id).toBeCloseTo(triggerHandAnchor(spec).z, 12);
      expect(boxes[2]?.z, id).toBeCloseTo(supportHandAnchor(spec).z, 12);
    }
  });

  it('tuck the support arm in beside the first when there is no handguard to hold', () => {
    const pistol = modelSpecFor('pistol_talon');
    const rifle = modelSpecFor('ar_carbine');
    expect(pistol.handguardLength).toBeLessThanOrEqual(0);
    const tucked = handBoxes(pistol)[3];
    const reaching = handBoxes(rifle)[3];
    // The rifle's support forearm reaches forward past the receiver; the pistol's does not.
    expect(reaching?.z, 'rifle').toBeLessThan(0);
    expect(tucked?.z, 'pistol').toBeGreaterThan(0);
    // And the tucked one is rolled in toward the grip.
    expect(tucked?.rz).toBeDefined();
  });

  it('are the same four boxes at a file’s own sockets, moved rather than re-authored', () => {
    const spec = modelSpecFor('ar_carbine');
    const grip = { x: 0.01, y: -0.2, z: 0.05 };
    const support = { x: -0.02, y: -0.05, z: -0.3 };
    const moved = handBoxesAt(spec, grip, support);
    const original = handBoxes(spec);
    expect(moved.length).toBe(original.length);
    for (let i = 0; i < moved.length; i++) {
      // Same glove, same size; only the place changes.
      expect(moved[i]?.surface).toBe('glove');
      expect(moved[i]?.w).toBe(original[i]?.w);
      expect(moved[i]?.h).toBe(original[i]?.h);
      expect(moved[i]?.d).toBe(original[i]?.d);
    }
    // The trigger pair follows the grip socket and the support pair the support socket.
    expect(moved[0]?.z).toBeCloseTo(grip.z, 12);
    expect(moved[2]?.z).toBeCloseTo(support.z, 12);
  });
});

describe('the magazine', () => {
  it('gives a tube magazine no box, because it lives under the barrel', () => {
    for (const [id, spec] of SPECS) {
      if (spec.magazine !== 'tube') continue;
      expect(magazineBoxes(spec), id).toEqual([]);
      // It is a tube instead, and it is there.
      expect(magazineTubes(spec).length, id).toBeGreaterThan(0);
    }
  });

  it('gives every other magazine a box and only a drum a tube', () => {
    for (const [id, spec] of SPECS) {
      if (spec.magazine === 'tube') continue;
      expect(magazineBoxes(spec).length, id).toBeGreaterThan(0);
      expect(magazineTubes(spec).length, id).toBe(spec.magazine === 'drum' ? 1 : 0);
    }
  });

  it('hangs a pistol’s magazine in the grip rather than in front of it', () => {
    const pistol = modelSpecFor('pistol_talon');
    const rifle = modelSpecFor('ar_carbine');
    expect(pistol.magazine).toBe('grip');
    // The grip is behind the receiver's middle; a rifle's well is in front of it.
    expect(magazineBoxes(pistol)[0]?.z).toBeGreaterThan(0);
    expect(magazineBoxes(rifle)[0]?.z).toBeLessThan(0);
  });

  it('puts every magazine below the bore', () => {
    for (const [id, spec] of SPECS) {
      for (const part of magazineBoxes(spec)) expect(part.y, id).toBeLessThan(barrelY(spec));
      for (const part of magazineTubes(spec)) expect(part.y, id).toBeLessThan(barrelY(spec));
    }
  });
});

describe('the tubes', () => {
  it('runs a barrel and a muzzle along the bore on every weapon', () => {
    for (const [id, spec] of SPECS) {
      const tubes = bodyTubes(spec);
      const onBore = tubes.filter((t) => Math.abs(t.y - barrelY(spec)) < EPS);
      expect(onBore.length, id).toBe(spec.barrelLength > 0 ? 2 : 1);
      const muzzle = onBore[onBore.length - 1];
      expect(muzzle?.z, id).toBeCloseTo(muzzleZ(spec), 12);
      expect(muzzle?.radius, id).toBe(spec.muzzleRadius);
    }
  });

  it('gives a scope a tube and an objective bell, and nothing else one', () => {
    for (const [id, spec] of SPECS) {
      const onSightLine = bodyTubes(spec).filter((t) => Math.abs(t.y - spec.sightHeight) < EPS);
      if (spec.optic !== 'scope') {
        expect(onSightLine.length, id).toBe(0);
        continue;
      }
      expect(onSightLine.length, id).toBe(2);
      // The bell is the wider of the two, and further forward.
      expect(onSightLine[1]?.radius, id).toBeGreaterThan(onSightLine[0]?.radius ?? 0);
      expect(onSightLine[1]?.z, id).toBeLessThan(onSightLine[0]?.z ?? 0);
    }
  });

  it('builds every tube out of something', () => {
    for (const [id, spec] of SPECS) {
      for (const t of allTubes(spec)) {
        expect(t.radius, id).toBeGreaterThan(0);
        expect(t.length, id).toBeGreaterThan(0);
        expect(t.sides ?? 12, id).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe('the charging handle', () => {
  it('is a pump on a pump gun and a handle on everything else', () => {
    for (const [id, spec] of SPECS) {
      const boxes = chargingBoxes(spec);
      expect(boxes.length, id).toBeGreaterThan(0);
      // A pump wraps the magazine tube under the barrel; a handle sits up on the receiver.
      if (spec.pump) expect(boxes[0]?.y, id).toBeLessThan(barrelY(spec));
      else expect(boxes[0]?.y, id).toBeGreaterThan(0);
    }
  });
});

describe('every part is built from the spec and nothing else', () => {
  it('is a pure function: the same spec twice gives the same numbers', () => {
    for (const [id, spec] of SPECS) {
      expect(JSON.stringify(allBoxes(spec)), id).toBe(JSON.stringify(allBoxes(spec)));
      expect(JSON.stringify(allTubes(spec)), id).toBe(JSON.stringify(allTubes(spec)));
      expect(JSON.stringify(handBoxes(spec)), id).toBe(JSON.stringify(handBoxes(spec)));
    }
  });

  it('scales with the spec rather than carrying absolute sizes', () => {
    // The M7 bug in one assertion: boxes authored against the AR's receiver did not shrink
    // for the pistol. Double a receiver and the receiver box doubles with it.
    const spec = modelSpecFor('ar_carbine');
    const bigger = { ...spec, receiverHeight: spec.receiverHeight * 2, sightHeight: spec.sightHeight * 2 };
    expect(bodyBoxes(bigger)[0]?.h).toBeCloseTo(spec.receiverHeight * 2, 12);
    expect(barrelY(bigger)).toBeCloseTo(barrelY(spec) * 2, 12);
  });
});
