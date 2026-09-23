import { describe, expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { sightPivotShift } from './ViewmodelAnim';

/**
 * The invariant the ADS fix rests on (playtest, 2026-09-23).
 *
 * Aimed, the player's mark is on the weapon, so the recoil kick must not move the sight point
 * relative to the camera — the rounds leave along the camera's axis and anything that carries
 * the sight off it is the reticle and the hits disagreeing. `sightPivotShift` is what makes the
 * kick's rotation a rotation about that point, and the test is the statement: apply the kick
 * *and* the shift, and the sight point is where it was, to the last few digits.
 *
 * Measured in the running game before the fix, mid-burst on the carbine at full ADS: 1.54°
 * high, 0.49° right — 56 cm at 20 m. After: 0.013°, half a centimetre.
 */
const DEG2RAD = Math.PI / 180;

/** Where a sight point ends up under a pose, in the viewmodel camera's space. */
function place(sight: Vector3, position: Vector3, rx: number, ry: number, rz: number): Vector3 {
  return sight
    .clone()
    .applyEuler(new Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD))
    .add(position);
}

describe('sightPivotShift', () => {
  const cases: readonly { readonly name: string; readonly sight: Vector3 }[] = [
    { name: 'the carbine, its rear sight above and ahead of the origin', sight: new Vector3(0, 0.068, -0.055) },
    { name: 'an optic, higher and further forward', sight: new Vector3(0, 0.11, -0.12) },
    { name: 'a sight point off the centre line', sight: new Vector3(0.02, 0.05, -0.2) },
    { name: 'a sight point at the origin', sight: new Vector3(0, 0, 0) },
  ];

  for (const { name, sight } of cases) {
    it(`holds the sight point still through a kick — ${name}`, () => {
      for (const [rx, ry, rz] of [
        [0, 0, 0],
        [2.8, 0, 0],
        [-1.5, 0.6, 3.2],
      ]) {
        for (const [kickPitch, kickRoll] of [
          [0.4, 0],
          [0.73, -0.06],
          [2.03, 0.25],
          [-1.1, 0.9],
        ]) {
          const before = place(sight, new Vector3(0.01, -0.07, -0.145), rx!, ry!, rz!);
          const shift = sightPivotShift(sight, rx!, ry!, rz!, kickPitch!, kickRoll!, new Vector3());
          const after = place(
            sight,
            new Vector3(0.01, -0.07, -0.145).add(shift),
            rx! + kickPitch!,
            ry!,
            rz! + kickRoll!,
          );
          expect(after.distanceTo(before)).toBeLessThan(1e-9);
        }
      }
    });
  }

  it('is zero when the kick is', () => {
    const shift = sightPivotShift(new Vector3(0, 0.068, -0.055), 1.2, 0, -0.4, 0, 0, new Vector3());
    expect(shift.length()).toBeLessThan(1e-12);
  });

  it('moves the weapon by roughly the arc the kick would have swung the sight through', () => {
    // A pitch kick about an origin 5.5 cm behind the sight lifts it by radius x angle; the
    // shift has to take that back, so its size is that arc and its direction is downward.
    const sight = new Vector3(0, 0, -0.2);
    const shift = sightPivotShift(sight, 0, 0, 0, 1, 0, new Vector3());
    expect(shift.length()).toBeCloseTo(0.2 * 1 * DEG2RAD, 5);
    expect(shift.y).toBeLessThan(0);
  });
});
