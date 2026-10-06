import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import {
  accumulatePattern,
  aimWithOffset,
  makeAimSample,
  pelletOffset,
  Recoil,
  type SpreadContext,
} from './Recoil';
import { AR_DEFAULT } from './WeaponDefs';

/**
 * Recoil, spread, and the pellet pattern — the arithmetic between a trigger pull and a
 * direction.
 *
 * Two different kinds of thing live here and the difference is the point. The **pattern** is
 * authored and deterministic in `shotIndex`: it is what a player memorises, and S4.14 says so
 * explicitly. The **spread** is the random component on top, drawn from an `Rng` the caller
 * seeds per event. A change that leaked one into the other would make the gun either
 * unlearnable or unfair, and neither would fail anywhere else.
 *
 * `npm run accuracy` measures the shapes these produce on real maps. These pin the numbers it
 * measures, so a drift is a red test rather than a changed read-out.
 */

const HIP: SpreadContext = { moveFraction: 0, adsFraction: 0, crouched: false, airborne: false };

describe('spread', () => {
  it('is the weapon hip spread when the player is standing still', () => {
    expect(new Recoil().spreadDegrees(AR_DEFAULT, HIP)).toBe(1.9);
  });

  it('collapses toward the aimed cone with the sights', () => {
    const r = new Recoil();
    expect(r.spreadDegrees(AR_DEFAULT, { ...HIP, adsFraction: 1 })).toBe(0.17999999999999994);
    // Monotonic between the two, so the cone follows the sight picture rather than snapping.
    const half = r.spreadDegrees(AR_DEFAULT, { ...HIP, adsFraction: 0.5 });
    expect(half).toBeLessThan(1.9);
    expect(half).toBeGreaterThan(0.18);
  });

  it('opens with movement, with the air, and closes with a crouch', () => {
    const r = new Recoil();
    expect(r.spreadDegrees(AR_DEFAULT, { ...HIP, moveFraction: 1 })).toBe(3.4);
    expect(r.spreadDegrees(AR_DEFAULT, { ...HIP, airborne: true })).toBe(3.9899999999999998);
    expect(r.spreadDegrees(AR_DEFAULT, { ...HIP, crouched: true })).toBe(1.406);
    // A crouch is worth less than standing still is worth over sprinting, and the air is the
    // worst of the four — which is the whole ordering the spread table encodes.
    expect(r.spreadDegrees(AR_DEFAULT, { ...HIP, crouched: true })).toBeLessThan(1.9);
    expect(r.spreadDegrees(AR_DEFAULT, { ...HIP, airborne: true })).toBeGreaterThan(3.4);
  });
});

describe('the aim sample', () => {
  it('is the exact look direction when there is no spread to draw', () => {
    const aim = makeAimSample();
    new Recoil().sampleAim(0, 0, 0, new Rng(1234), aim);
    // A yaw and pitch of zero looks down -z, and a cone of zero degrees has no jitter in it.
    // `dx` is a negative zero because it is `-simSin(0) * cos(0)`, which is the sign the whole
    // simulation shares.
    expect(aim.dx).toBe(-0);
    expect(aim.dy).toBe(0);
    expect(aim.dz).toBe(-1);
    expect([aim.ax, aim.ay]).toEqual([0, 0]);
  });

  it('draws the same jitter from the same seed, every time', () => {
    const a = makeAimSample();
    const b = makeAimSample();
    new Recoil().sampleAim(0, 0, 2, new Rng(1234), a);
    new Recoil().sampleAim(0, 0, 2, new Rng(1234), b);
    expect(a).toEqual(b);
    // And it is this jitter, to the bit: `npm run hashrun` depends on it.
    expect(a.dx).toBe(-0.020921103251456272);
    expect(a.dy).toBe(-0.024912306134719876);
    expect(a.dz).toBe(-0.9994707021427852);
    // The angular offsets the pellet loop adds to, in radians.
    expect(a.ax).toBe(-0.020932182610859027);
    expect(a.ay).toBe(-0.024925499148008925);
  });

  it('keeps the direction a unit vector, whatever the cone', () => {
    const aim = makeAimSample();
    const rng = new Rng(7);
    for (const spread of [0, 0.5, 2, 9]) {
      new Recoil().sampleAim(0.4, -0.2, spread, rng, aim);
      expect(Math.hypot(aim.dx, aim.dy, aim.dz)).toBeCloseTo(1, 12);
    }
  });
});

describe('the authored pattern', () => {
  it('kicks up, walks the pattern, and counts the shots', () => {
    const r = new Recoil();
    expect(r.shotIndex).toBe(0);
    const kicks: string[] = [];
    for (let i = 0; i < 5; i++) {
      r.onShot(AR_DEFAULT, 0);
      kicks.push(`${r.aimPitch.toFixed(5)}/${r.aimYaw.toFixed(5)}/${r.shotIndex}`);
      r.step(AR_DEFAULT);
    }
    // The first shot is the big one (`firstShotScale`), and the climb is monotonic in pitch
    // while the yaw wanders either side of the line.
    expect(kicks).toEqual([
      '0.58466/0.00000/1',
      '1.06026/-0.04100/2',
      '1.51126/0.00820/3',
      '1.93766/-0.05740/4',
      '2.33126/-0.01640/5',
    ]);
  });

  it('leaves a view residual for the controller to take', () => {
    const r = new Recoil();
    for (let i = 0; i < 5; i++) {
      r.onShot(AR_DEFAULT, 0);
      r.step(AR_DEFAULT);
    }
    // The unrecovered part of the kick, which has to reach the same place mouse movement does.
    expect(r.residualYaw).toBe(0.009000000000000003);
    expect(r.residualPitch).toBe(0.08640000000000002);
    expect(r.visualPunch).toBe(1.5830952822087059);
    expect(r.visualLateral).toBe(0.01887695364823735);
  });

  it('starts the pattern over when the trigger is released', () => {
    const r = new Recoil();
    for (let i = 0; i < 3; i++) r.onShot(AR_DEFAULT, 0);
    expect(r.shotIndex).toBe(3);
    r.resetPattern();
    expect(r.shotIndex).toBe(0);
    // Which is what makes the pattern learnable rather than a running total over a match.
    r.onShot(AR_DEFAULT, 0);
    expect(r.shotIndex).toBe(1);
  });

  it('accumulates the ideal trace the debug plot draws', () => {
    const x = new Float32Array(6);
    const y = new Float32Array(6);
    expect(accumulatePattern(AR_DEFAULT, 6, x, y)).toBe(6);
    // Pattern only: no spread and no recovery, which is what a player is memorising.
    expect(Array.from(x)).toEqual([
      0, 0.05000000074505806, -0.009999999776482582, 0.07000000029802322, 0.019999999552965164,
      0.1599999964237213,
    ]);
    expect(Array.from(y)).toEqual([
      0.7129999995231628, 1.2929999828338623, 1.843000054359436, 2.36299991607666,
      2.8429999351501465, 3.263000011444092,
    ]);
    // Deterministic in the shot index, so the plot and the gun agree.
    const x2 = new Float32Array(6);
    const y2 = new Float32Array(6);
    accumulatePattern(AR_DEFAULT, 6, x2, y2);
    expect(Array.from(x2)).toEqual(Array.from(x));
  });

  it('writes no more than the arrays it was given', () => {
    expect(accumulatePattern(AR_DEFAULT, 10, new Float32Array(3), new Float32Array(3))).toBe(3);
    expect(accumulatePattern(AR_DEFAULT, 0, new Float32Array(3), new Float32Array(3))).toBe(0);
  });

  it('resets to a rested weapon', () => {
    const r = new Recoil();
    for (let i = 0; i < 4; i++) {
      r.onShot(AR_DEFAULT, 0);
      r.step(AR_DEFAULT);
    }
    r.reset();
    expect(r.shotIndex).toBe(0);
    expect(r.aimPitch).toBe(0);
    expect(r.aimYaw).toBe(0);
    expect(r.visualPunch).toBe(0);
    expect(r.visualLateral).toBe(0);
    expect(r.residualYaw).toBe(0);
    expect(r.residualPitch).toBe(0);
  });
});

describe('the pellet pattern', () => {
  it('lays the pellets out on the golden angle, and the same seed lays them the same way', () => {
    const off = { ax: 0, ay: 0 };
    const rng = new Rng(99);
    const offsets: string[] = [];
    for (let i = 1; i < 5; i++) {
      pelletOffset(i, 8, 2.5, 0.3, rng.range(0.86, 1.08), off);
      offsets.push(`${off.ax.toFixed(5)}/${off.ay.toFixed(5)}`);
    }
    expect(offsets).toEqual([
      '-0.01309/0.00619',
      '0.00923/-0.02262',
      '0.00865/0.02341',
      '-0.03014/-0.01550',
    ]);
  });

  it('spaces the pellets rather than clumping them', () => {
    // The whole reason for a lattice instead of a dice roll: no two pellets land on top of
    // each other, so a shotgun's pattern is a pattern.
    const off = { ax: 0, ay: 0 };
    const seen: Array<[number, number]> = [];
    for (let i = 1; i < 8; i++) {
      pelletOffset(i, 8, 2.5, 0, 1, off);
      seen.push([off.ax, off.ay]);
    }
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        const a = seen[i];
        const b = seen[j];
        expect(Math.hypot((a?.[0] ?? 0) - (b?.[0] ?? 0), (a?.[1] ?? 0) - (b?.[1] ?? 0))).toBeGreaterThan(1e-3);
      }
    }
  });

  it('rotates the whole pattern, so two shots are never identical', () => {
    const a = { ax: 0, ay: 0 };
    const b = { ax: 0, ay: 0 };
    pelletOffset(3, 8, 2.5, 0, 1, a);
    pelletOffset(3, 8, 2.5, 1.7, 1, b);
    expect(a.ax).not.toBe(b.ax);
    // A rotation, so the distance from the centre is unchanged — to the precision of the
    // simulation's own sine table, which is what every angle in the game is turned with.
    expect(Math.hypot(a.ax, a.ay)).toBeCloseTo(Math.hypot(b.ax, b.ay), 5);
  });

  it('turns an angular offset into a unit direction about the aim', () => {
    const aim = makeAimSample();
    aimWithOffset(0.2, -0.1, 0.01, 0.02, aim);
    expect(aim.dx).toBe(-0.18822577207476227);
    expect(aim.dy).toBe(-0.07991335749856128);
    expect(aim.dz).toBe(-0.9788692016915062);
    expect(Math.hypot(aim.dx, aim.dy, aim.dz)).toBeCloseTo(1, 12);
    // A zero offset is the aim itself.
    const plain = makeAimSample();
    aimWithOffset(0.2, -0.1, 0, 0, plain);
    const direct = makeAimSample();
    new Recoil().sampleAim(0.2, -0.1, 0, new Rng(1), direct);
    expect(plain.dx).toBeCloseTo(direct.dx, 12);
    expect(plain.dz).toBeCloseTo(direct.dz, 12);
  });
});
