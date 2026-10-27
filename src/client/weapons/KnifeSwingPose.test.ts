import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D, Vector3 } from 'three';
import { KNIFE_SWING, KnifeSwingPose, knifeSwingSource } from './KnifeSwingPose';
import { HandsBase } from './WeaponBasePose';
import { ViewmodelMotion } from './ViewmodelMotion';
import { makeViewmodelDrive, type ViewmodelDrive } from './ViewmodelDrive';
import { DEFAULT_VIEWMODEL_CONFIG, type ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { ViewmodelHands } from './ViewmodelHands';

/**
 * The blade's three keyframes, and the forearm that has to end up holding it.
 *
 * The arm is the half that is easy to get silently wrong — the first attempt used
 * `Object3D.lookAt` and aimed it at exactly 180° from the fist — so the test for it asks the
 * question directly: span the sleeve, and check its far end lands on the handle.
 */

const DEG2RAD = Math.PI / 180;

function config(overrides: Partial<ViewmodelConfig> = {}): ViewmodelConfig {
  return { ...DEFAULT_VIEWMODEL_CONFIG, ...overrides };
}

function drive(overrides: Partial<ViewmodelDrive> = {}): ViewmodelDrive {
  return { ...makeViewmodelDrive(), ...overrides };
}

/** A motion with every channel at rest, so only the keyframes reach the blade. */
function quietMotion(): ViewmodelMotion {
  const motion = new ViewmodelMotion();
  motion.reset(0, 0);
  return motion;
}

interface Built {
  readonly swing: KnifeSwingPose;
  readonly knife: Object3D;
  readonly arm: Object3D;
  readonly base: HandsBase;
  readonly motion: ViewmodelMotion;
  pose(melee: number, cfg?: ViewmodelConfig, d?: Partial<ViewmodelDrive>): void;
}

function built(hands: ViewmodelHands | null = null): Built {
  const swing = new KnifeSwingPose();
  const knife = new Object3D();
  const arm = new Object3D();
  const base = new HandsBase();
  const motion = quietMotion();
  swing.set(knife, arm, hands);
  return {
    swing,
    knife,
    arm,
    base,
    motion,
    pose(melee, cfg = config({ idleAmplitude: 0 }), d = {}): void {
      swing.pose(base, motion, drive({ melee, ...d }), cfg);
    },
  };
}

describe('the swing', () => {
  it('poses nothing at all when this match built no blade', () => {
    const swing = new KnifeSwingPose();
    const base = new HandsBase();
    expect(() => swing.pose(base, quietMotion(), drive({ melee: 0.5 }), config())).not.toThrow();
  });

  it('is exactly READY at nought, because the first tick of a wind-up reports nought', () => {
    const k = built();
    k.pose(0);
    expect(k.knife.position.x).toBeCloseTo(KNIFE_SWING.ready.x, 12);
    expect(k.knife.position.y).toBeCloseTo(KNIFE_SWING.ready.y, 12);
    expect(k.knife.position.z).toBeCloseTo(KNIFE_SWING.ready.z, 12);
    expect(k.knife.rotation.x).toBeCloseTo(KNIFE_SWING.ready.pitch * DEG2RAD, 12);
    expect(k.knife.rotation.y).toBeCloseTo(KNIFE_SWING.ready.yaw * DEG2RAD, 12);
    expect(k.knife.rotation.z).toBeCloseTo(KNIFE_SWING.ready.roll * DEG2RAD, 12);
  });

  it('is READY again at one, so a swing cut short leaves nothing on screen', () => {
    const k = built();
    k.pose(1);
    expect(k.knife.position.x).toBeCloseTo(KNIFE_SWING.ready.x, 12);
    expect(k.knife.position.z).toBeCloseTo(KNIFE_SWING.ready.z, 12);
  });

  it('hits WIND-UP and STRIKE at the two fractions `Melee`’s own timings put them at', () => {
    const k = built();
    // 0.12 s of wind-up over a 0.54 s swing: the strike tick is 0.222 and the hitbox test
    // runs on it, so the blade has to be extended on exactly that frame.
    k.pose(0.13);
    expect(k.knife.position.y).toBeCloseTo(KNIFE_SWING.windup.y, 12);
    k.pose(0.222);
    expect(k.knife.position.x).toBeCloseTo(KNIFE_SWING.strike.x, 12);
    expect(k.knife.position.z).toBeCloseTo(KNIFE_SWING.strike.z, 12);
  });

  it('accelerates into the strike and eases everywhere else', () => {
    const k = built();
    const zAt = (t: number): number => {
      k.pose(t);
      return k.knife.position.z;
    };
    // The 0.05 s between wind-up and strike is linear on purpose — a slash accelerates into
    // the target — so the midpoint there is the arithmetic mean of the two keyframes.
    const mid = (0.13 + 0.222) / 2;
    expect(zAt(mid)).toBeCloseTo((KNIFE_SWING.windup.z + KNIFE_SWING.strike.z) / 2, 12);
    // The opening leg is smoothed, which a midpoint cannot show — smoothstep's midpoint is
    // the linear one — so the quarter point is where the two curves part company.
    const quarterLinear = KNIFE_SWING.ready.z + (KNIFE_SWING.windup.z - KNIFE_SWING.ready.z) * 0.25;
    expect(zAt(0.13 * 0.25)).not.toBeCloseTo(quarterLinear, 4);
  });

  it('never jumps across the whole swing', () => {
    const k = built();
    let previous = new Vector3();
    k.pose(0);
    previous = k.knife.position.clone();
    for (let i = 1; i <= 400; i++) {
      k.pose(i / 400);
      expect(k.knife.position.distanceTo(previous)).toBeLessThan(0.05);
      previous = k.knife.position.clone();
    }
  });

  it('clamps a fraction outside the swing rather than extrapolating a pose', () => {
    const k = built();
    k.pose(-5);
    const under = k.knife.position.clone();
    k.pose(9);
    const over = k.knife.position.clone();
    expect(under.x).toBeCloseTo(KNIFE_SWING.ready.x, 12);
    expect(over.x).toBeCloseTo(KNIFE_SWING.ready.x, 12);
  });

  it('poses from a copy, so the hand tuner may edit a live swing', () => {
    const swing = new KnifeSwingPose();
    expect(swing.swing).not.toBe(KNIFE_SWING);
    expect(swing.swing.ready).toEqual(KNIFE_SWING.ready);
    swing.swing.ready.x = 99;
    expect(KNIFE_SWING.ready.x).not.toBe(99);
  });

  it('poses from the edited copy and not from the shipped table', () => {
    const k = built();
    k.swing.swing.ready.x = 1.25;
    k.pose(0);
    expect(k.knife.position.x).toBeCloseTo(1.25, 12);
  });
});

describe('the forearm', () => {
  it('spans the shoulder to the fist, stretching Z alone', () => {
    const k = built();
    k.pose(0.222);
    expect(k.arm.position.toArray()).toEqual([0.3, -0.45, 0.28]);
    expect(k.arm.scale.x).toBe(1);
    expect(k.arm.scale.y).toBe(1);
    expect(k.arm.scale.z).toBeCloseTo(k.knife.position.distanceTo(k.arm.position), 12);
    // The sleeve is built one unit down -Z; its far end has to land on the handle.
    const tip = new Vector3(0, 0, -1).applyQuaternion(k.arm.quaternion).multiplyScalar(k.arm.scale.z).add(k.arm.position);
    expect(tip.distanceTo(k.knife.position)).toBeLessThan(1e-9);
  });

  it('comes from behind the camera, so the elbow end is never on screen', () => {
    const k = built();
    k.pose(0.5);
    expect(k.arm.position.z).toBeGreaterThan(0);
  });

  it('keeps a floor under the stretch, so a fist at the shoulder does not collapse it', () => {
    const k = built();
    k.swing.swing.ready.x = 0.3;
    k.swing.swing.ready.y = -0.45;
    k.swing.swing.ready.z = 0.28;
    k.pose(0);
    expect(k.arm.scale.z).toBe(0.05);
    expect(Number.isFinite(k.arm.quaternion.x)).toBe(true);
  });

  it('is left alone when an arm rig is doing the solving instead', () => {
    const bases: number[][] = [];
    const rig = { update: (m: Matrix4): void => void bases.push([...m.elements]) };
    const k = built(rig as unknown as ViewmodelHands);
    k.pose(0.5);
    expect(k.arm.scale.z).toBe(1);
    expect(bases).toHaveLength(1);
    const composed = new Matrix4().compose(k.knife.position, k.knife.quaternion, k.knife.scale);
    expect(bases[0]).toEqual([...composed.elements]);
  });
});

describe('what the blade borrows from the player', () => {
  it('takes the bob, the sway and the drift', () => {
    const still = built();
    const moving = built();
    still.pose(0.5, config());
    moving.pose(0.5, config(), { speed: 6.9, bobPhase: Math.PI / 2 });
    expect(moving.knife.position.x).not.toBeCloseTo(still.knife.position.x, 6);
  });

  it('and takes nothing from the weapon, which is off screen while it is out', () => {
    const plain = built();
    const loaded = built();
    plain.pose(0.5);
    loaded.pose(0.5, config({ idleAmplitude: 0 }), { adsFraction: 1, reloading: true, reloadFraction: 0.4, raise: 0 });
    expect(loaded.knife.position.x).toBeCloseTo(plain.knife.position.x, 12);
    expect(loaded.knife.position.z).toBeCloseTo(plain.knife.position.z, 12);
  });
});

describe('knifeSwingSource', () => {
  it('prints the three keyframes as the declarations the file holds', () => {
    const text = knifeSwingSource(KNIFE_SWING);
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('const KNIFE_READY: KnifePose = {');
    expect(lines[1]).toContain('const KNIFE_WINDUP: KnifePose = {');
    expect(lines[2]).toContain('const KNIFE_STRIKE: KnifePose = {');
    for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll']) expect(lines[0]).toContain(`${key}: `);
  });

  it('rounds to four places, because a slider produces more than anyone wants to read', () => {
    const text = knifeSwingSource({
      ready: { x: 0.123456789, y: -0.98765, z: 0, pitch: 0, yaw: 0, roll: 0 },
      windup: KNIFE_SWING.windup,
      strike: KNIFE_SWING.strike,
    });
    expect(text).toContain('x: 0.1235,');
    // `Math.round` goes toward +infinity on a half, so a negative half rounds the short way.
    expect(text).toContain('y: -0.9876,');
  });
});
