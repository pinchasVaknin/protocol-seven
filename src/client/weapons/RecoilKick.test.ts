import { describe, expect, it } from 'vitest';
import { Euler, Object3D, Vector3 } from 'three';
import { RecoilKick, sightPivotShift } from './RecoilKick';
import { makeViewmodelPose } from './WeaponBasePose';
import { makeViewmodelDrive } from './ViewmodelDrive';
import { DEFAULT_VIEWMODEL_CONFIG } from '../../shared/weapons/ViewmodelConfig';
import type { WeaponModel } from './WeaponMesh';

/**
 * The kick, and the one invariant it exists to protect.
 *
 * `sightPivotShift`'s tests are the older half and came with the fix (playtest, 2026-09-23):
 * aimed, the player's mark is *on the weapon*, so the recoil must not move the sight point
 * relative to the camera — the rounds leave along the camera's axis, and anything that carries
 * the sight off it is the reticle and the hits disagreeing. Measured in the running game
 * before the fix, mid-burst on the carbine at full ADS: 1.54° high, 0.49° right — 56 cm at
 * 20 m. After: 0.013°, half a centimetre.
 */

const DEG2RAD = Math.PI / 180;

/** Where a sight point ends up under a pose, in the viewmodel camera's space. */
function place(sight: Vector3, position: Vector3, rx: number, ry: number, rz: number): Vector3 {
  return sight
    .clone()
    .applyEuler(new Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD))
    .add(position);
}

/** Only the three facts the kick reads off a weapon. */
function weaponWithSight(sight: Vector3): WeaponModel {
  return { sightPoint: sight, root: new Object3D() } as unknown as WeaponModel;
}

describe('RecoilKick.apply', () => {
  const cfg = DEFAULT_VIEWMODEL_CONFIG;

  it('does nothing at all when the weapon is not kicking', () => {
    const pose = makeViewmodelPose();
    new RecoilKick().apply(pose, weaponWithSight(new Vector3(0, 0.09, -0.06)), makeViewmodelDrive(), cfg);
    expect(pose).toEqual(makeViewmodelPose());
  });

  it('takes the translation at full strength at the hip', () => {
    const pose = makeViewmodelPose();
    const drive = { ...makeViewmodelDrive(), visualPunch: 1, visualLateral: 1 };
    new RecoilKick().apply(pose, weaponWithSight(new Vector3(0, 0.09, -0.06)), drive, cfg);
    expect(pose.z).toBeCloseTo(cfg.kickBack, 12);
    expect(pose.y).toBeCloseTo(cfg.kickUp, 12);
    expect(pose.x).toBeCloseTo(cfg.kickLateral, 12);
    expect(pose.pitch).toBeCloseTo(cfg.kickPitch, 12);
    expect(pose.roll).toBeCloseTo(-cfg.kickRoll, 12);
  });

  it('keeps the rotation whole as the sights come up, and scales only the translation', () => {
    const sight = new Vector3(0, 0.09, -0.06);
    const aimed = makeViewmodelPose();
    const drive = { ...makeViewmodelDrive(), adsFraction: 1, visualPunch: 1, visualLateral: 1 };
    new RecoilKick().apply(aimed, weaponWithSight(sight), drive, { ...cfg, kickAdsScale: 0 });
    // The rotation is the hip's, to the degree.
    expect(aimed.pitch).toBeCloseTo(cfg.kickPitch, 12);
    expect(aimed.roll).toBeCloseTo(-cfg.kickRoll, 12);
    // And the sight point has not moved, which is the whole point of the pivot shift.
    const before = place(sight, new Vector3(), 0, 0, 0);
    const after = place(sight, new Vector3(aimed.x, aimed.y, aimed.z), aimed.pitch, aimed.yaw, aimed.roll);
    expect(after.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('applies the pivot correction only once the player is actually aiming', () => {
    const sight = new Vector3(0, 0.09, -0.06);
    const flat = { ...DEFAULT_VIEWMODEL_CONFIG, kickBack: 0, kickUp: 0, kickLateral: 0 };
    const measure = (adsFraction: number): number => {
      const pose = makeViewmodelPose();
      new RecoilKick().apply(pose, weaponWithSight(sight), { ...makeViewmodelDrive(), adsFraction, visualPunch: 1 }, flat);
      // With no translation in the config, whatever is left is the correction alone.
      return Math.hypot(pose.x, pose.y, pose.z);
    };
    // Below the gate there is no correction at all; a hip-fired weapon may do what it likes.
    expect(measure(0)).toBe(0);
    expect(measure(1e-4)).toBe(0);
    // Past it, it grows with how far the sights are up.
    const quarter = measure(0.25);
    const whole = measure(1);
    expect(quarter).toBeGreaterThan(0);
    expect(whole).toBeGreaterThan(quarter);
    expect(quarter / whole).toBeCloseTo(0.25, 9);
  });

  it('leaves the hip kick alone, because the crosshair is painted on the screen there', () => {
    const sight = new Vector3(0, 0.09, -0.06);
    const pose = makeViewmodelPose();
    new RecoilKick().apply(pose, weaponWithSight(sight), { ...makeViewmodelDrive(), visualPunch: 1 }, { ...cfg, kickBack: 0, kickUp: 0, kickLateral: 0 });
    // No translation in the config and none added: the pitch turned the sight and nothing took
    // it back.
    expect(pose.x).toBe(0);
    expect(pose.y).toBe(0);
    expect(pose.z).toBe(0);
    expect(pose.pitch).toBeCloseTo(cfg.kickPitch, 12);
  });

  it('reuses one scratch vector, since this runs on every frame of every burst', () => {
    const kick = new RecoilKick();
    const sight = new Vector3(0, 0.09, -0.06);
    const drive = { ...makeViewmodelDrive(), adsFraction: 1, visualPunch: 1 };
    const first = makeViewmodelPose();
    const second = makeViewmodelPose();
    kick.apply(first, weaponWithSight(sight), drive, cfg);
    kick.apply(second, weaponWithSight(sight), drive, cfg);
    expect(second).toEqual(first);
  });
});

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
