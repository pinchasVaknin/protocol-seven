import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { ViewmodelMotion, easeInOutQuad, easeOutBack, easeOutCubic } from './ViewmodelMotion';
import { makeViewmodelPose } from './WeaponBasePose';
import { makeViewmodelDrive, type ViewmodelDrive } from './ViewmodelDrive';
import { DEFAULT_VIEWMODEL_CONFIG, type ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';

/**
 * The four channels that belong to the player rather than to what the player is holding.
 *
 * Tested directly here, which is the point of the class existing: before it, every one of
 * these could only be reached through a weapon, a config and a frame, and the two held items
 * each carried their own copy of the bob-and-drift arithmetic.
 */

const DEG2RAD = Math.PI / 180;

function config(overrides: Partial<ViewmodelConfig> = {}): ViewmodelConfig {
  return { ...DEFAULT_VIEWMODEL_CONFIG, ...overrides };
}

function drive(overrides: Partial<ViewmodelDrive> = {}): ViewmodelDrive {
  return { ...makeViewmodelDrive(), ...overrides };
}

/** Advance a motion to rest at a given ADS fraction, so a channel can be read on its own. */
function settled(fraction: number, cfg = config()): ViewmodelMotion {
  const motion = new ViewmodelMotion();
  motion.reset(0, 0);
  for (let i = 0; i < 600; i++) motion.advance(drive({ adsFraction: fraction }), cfg, 1 / 120);
  return motion;
}

describe('the easings', () => {
  it('are each pinned at both ends', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBe(0.5);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    // Not exactly 0: the cubic form lands two ulps under it, which is nothing on a pose.
    expect(easeOutBack(0, 0.14)).toBeCloseTo(0, 15);
    expect(easeOutBack(1, 0.14)).toBeCloseTo(1, 12);
  });

  it('overshoot only where the overshooting one is asked to', () => {
    // `easeOutBack` peaks a little above 1 before coming back to it; the other two never do.
    let peak = 0;
    for (let i = 0; i <= 100; i++) peak = Math.max(peak, easeOutBack(i / 100, 0.14));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.14);
    for (let i = 0; i <= 100; i++) {
      expect(easeInOutQuad(i / 100)).toBeLessThanOrEqual(1);
      expect(easeOutCubic(i / 100)).toBeLessThanOrEqual(1);
    }
  });

  it('treats a negative overshoot as none, rather than undershooting', () => {
    for (let i = 0; i <= 10; i++) expect(easeOutBack(i / 10, -5)).toBeCloseTo(easeOutBack(i / 10, 0), 12);
  });
});

describe('the ADS curve', () => {
  it('starts at nothing and settles on the sight picture', () => {
    expect(new ViewmodelMotion().ads).toBe(0);
    expect(settled(1).ads).toBeCloseTo(1, 6);
    expect(settled(0).ads).toBeCloseTo(0, 6);
  });

  it('overshoots on the way in and not on the way out', () => {
    const cfg = config();
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    let peakIn = 0;
    for (let i = 1; i <= 120; i++) {
      motion.advance(drive({ adsFraction: Math.min(1, i / 40) }), cfg, 1 / 120);
      peakIn = Math.max(peakIn, motion.ads);
    }
    expect(peakIn).toBeGreaterThan(1);

    let lowestOut = 9;
    for (let i = 120; i >= 0; i--) {
      motion.advance(drive({ adsFraction: Math.max(0, i / 40) }), cfg, 1 / 120);
      lowestOut = Math.min(lowestOut, motion.ads);
    }
    expect(lowestOut).toBeGreaterThanOrEqual(0);
  });

  it('never runs further past 1 than the config allows, whatever the input does', () => {
    const cfg = config({ adsOvershoot: 0.14 });
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    for (let i = 0; i < 400; i++) {
      // A fraction that keeps rising: the clamp is the only thing between this and a pose
      // somewhere behind the player's head.
      motion.advance(drive({ adsFraction: 9 }), cfg, 1 / 120);
      expect(motion.ads).toBeLessThanOrEqual(1 + cfg.adsOvershoot);
    }
  });

  it('switches off the overshoot the moment the player starts letting go', () => {
    const cfg = config();
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    for (let i = 1; i <= 25; i++) motion.advance(drive({ adsFraction: i / 25 }), cfg, 1 / 120);
    const atRelease = motion.ads;
    // One frame of falling: the target becomes the plain curve, so the pose stops climbing.
    motion.advance(drive({ adsFraction: 0.99 }), cfg, 1 / 120);
    expect(motion.ads).toBeLessThan(atRelease + 1e-9);
  });
});

describe('the sway', () => {
  const cfg = config({ swayRate: 1e6, idleAmplitude: 0 });

  /** The sway alone: an empty pose, one turn, and nothing else running. */
  function swayFor(yaw: number, pitch: number, adsFraction = 0): ReturnType<typeof makeViewmodelPose> {
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    motion.advance(drive({ yaw, pitch, adsFraction }), cfg, 1 / 120);
    const pose = makeViewmodelPose();
    motion.applyWeapon(pose, drive({ adsFraction }), cfg, adsFraction);
    return pose;
  }

  it('is zero for a hand that is not moving', () => {
    expect(swayFor(0, 0)).toEqual(makeViewmodelPose());
  });

  it('lags the view: the weapon trails the direction the player turns', () => {
    const right = swayFor(0.004, 0);
    const left = swayFor(-0.004, 0);
    expect(Math.sign(right.x)).toBe(-Math.sign(left.x));
    expect(Math.sign(right.yaw)).toBe(-Math.sign(left.yaw));
    // The position lags the way the view went and the rotation the other way, which is what
    // reads as a weapon being carried rather than welded to the camera.
    expect(Math.sign(right.x)).toBe(-Math.sign(right.yaw));
  });

  it('answers pitch on its own axes', () => {
    const up = swayFor(0, 0.004);
    expect(up.x).toBe(0);
    expect(up.yaw).toBe(0);
    expect(up.y).not.toBe(0);
    expect(up.pitch).not.toBe(0);
  });

  it('caps the position at swayMax and the rotation at four times swayRotation', () => {
    const wild = swayFor(2.9, 1.4);
    expect(Math.abs(wild.x)).toBeLessThanOrEqual(cfg.swayMax + 1e-12);
    expect(Math.abs(wild.y)).toBeLessThanOrEqual(cfg.swayMax + 1e-12);
    expect(Math.abs(wild.yaw)).toBeLessThanOrEqual(cfg.swayRotation * 4 + 1e-12);
    expect(Math.abs(wild.pitch)).toBeLessThanOrEqual(cfg.swayRotation * 4 + 1e-12);
  });

  it('is quieter at ADS by exactly the configured scale', () => {
    const hip = swayFor(0.004, 0, 0);
    const aimed = swayFor(0.004, 0, 1);
    expect(aimed.x).toBeCloseTo(hip.x * cfg.swayAdsScale, 12);
  });

  it('measures the yaw the short way round', () => {
    const motion = new ViewmodelMotion();
    motion.reset(Math.PI - 0.002, 0);
    motion.advance(drive({ yaw: -Math.PI + 0.002 }), cfg, 1 / 120);
    const across = makeViewmodelPose();
    motion.applyWeapon(across, drive(), cfg, 0);
    expect(Math.abs(across.x)).toBeLessThan(cfg.swayMax);
  });

  it('does not divide by a frame that took no time', () => {
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    motion.advance(drive({ yaw: 1 }), cfg, 0);
    const pose = makeViewmodelPose();
    motion.applyWeapon(pose, drive(), cfg, 0);
    expect(Number.isFinite(pose.x)).toBe(true);
  });
});

describe('the bob and the idle drift', () => {
  it('scale the bob by speed against the speed that counts as full', () => {
    const cfg = config({ idleAmplitude: 0 });
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    const at = (speed: number): number => {
      const pose = makeViewmodelPose();
      motion.applyWeapon(pose, drive({ speed, bobPhase: Math.PI / 2 }), cfg, 0);
      return pose.x;
    };
    expect(at(6.9)).toBeCloseTo(at(3.45) * 2, 12);
    expect(at(0)).toBe(0);
    // And a speed past the reference is still full bob, not more.
    expect(at(99)).toBeCloseTo(at(6.9), 12);
  });

  it('stop the bob in the air', () => {
    const cfg = config({ idleAmplitude: 0 });
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    const pose = makeViewmodelPose();
    motion.applyWeapon(pose, drive({ speed: 9, grounded: false, bobPhase: 1 }), cfg, 0);
    expect(pose).toEqual(makeViewmodelPose());
  });

  it('bob the roll on the footfall and the lift at twice it', () => {
    const cfg = config({ idleAmplitude: 0 });
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    const pose = makeViewmodelPose();
    motion.applyWeapon(pose, drive({ speed: 6.9, bobPhase: Math.PI / 2 }), cfg, 0);
    // At a quarter phase the lateral and the roll are at their peak and the lift is through
    // zero, which is the two-to-one that makes a walk read as a walk.
    expect(pose.x).toBeCloseTo(cfg.bobLateral, 12);
    expect(pose.roll).toBeCloseTo(cfg.bobRoll, 12);
    expect(pose.y).toBeCloseTo(0, 12);
  });

  it('quieten both at ADS, by their own two scales', () => {
    const cfg = config();
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    const hip = makeViewmodelPose();
    const aimed = makeViewmodelPose();
    motion.applyWeapon(hip, drive({ speed: 6.9, bobPhase: Math.PI / 2 }), cfg, 0);
    motion.applyWeapon(aimed, drive({ speed: 6.9, bobPhase: Math.PI / 2 }), cfg, 1);
    // The bob takes `bobAdsScale`; the drift takes a quarter, which is written into the code
    // rather than the config because there is nothing to tune about "a little".
    const bobHip = cfg.bobLateral;
    const driftHip = hip.x - bobHip;
    expect(aimed.x).toBeCloseTo(bobHip * cfg.bobAdsScale + driftHip * 0.25, 12);
  });

  it('advance the drift at the configured rate and never stop it', () => {
    const cfg = config();
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      motion.advance(drive(), cfg, 1 / 120);
      const pose = makeViewmodelPose();
      motion.applyWeapon(pose, drive(), cfg, 0);
      seen.add(Math.round(pose.x * 1e12));
    }
    expect(seen.size).toBe(40);
  });
});

describe('placeHeldItem', () => {
  const cfg = config();

  it('writes the blended pose straight through when the player is still', () => {
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    const node = new Object3D();
    const blended = { x: 0.1, y: -0.2, z: -0.3, pitch: 10, yaw: -20, roll: 30 };
    motion.placeHeldItem(node, blended, drive(), config({ idleAmplitude: 0 }));
    expect(node.position.toArray()).toEqual([0.1, -0.2, -0.3]);
    expect(node.rotation.x).toBeCloseTo(10 * DEG2RAD, 12);
    expect(node.rotation.y).toBeCloseTo(-20 * DEG2RAD, 12);
    expect(node.rotation.z).toBeCloseTo(30 * DEG2RAD, 12);
  });

  it('adds the bob and the drift to X and Y and to neither Z nor the roll', () => {
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    motion.advance(drive(), cfg, 1 / 60);
    const still = new Object3D();
    const moving = new Object3D();
    const blended = { x: 0, y: 0, z: -0.4, pitch: 0, yaw: 0, roll: 25 };
    motion.placeHeldItem(still, blended, drive(), cfg);
    motion.placeHeldItem(moving, blended, drive({ speed: 6.9, bobPhase: 1.1 }), cfg);
    expect(moving.position.x).not.toBeCloseTo(still.position.x, 6);
    expect(moving.position.y).not.toBeCloseTo(still.position.y, 6);
    expect(moving.position.z).toBe(-0.4);
    expect(moving.rotation.z).toBeCloseTo(25 * DEG2RAD, 12);
  });

  it('takes the bob unscaled, because there is no ADS while a held item is out', () => {
    const cfg2 = config({ idleAmplitude: 0 });
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    // Even settled at full ADS — which cannot happen with a grenade out, and is the point —
    // the held item's bob is the hip's.
    for (let i = 0; i < 600; i++) motion.advance(drive({ adsFraction: 1 }), cfg2, 1 / 120);
    const node = new Object3D();
    const blended = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
    motion.placeHeldItem(node, blended, drive({ speed: 6.9, bobPhase: Math.PI / 2 }), cfg2);
    expect(node.position.x).toBeCloseTo(cfg2.bobLateral, 12);
  });

  it('carries the sway the weapon has, so the two cannot drift apart', () => {
    const cfg2 = config({ idleAmplitude: 0, swayRate: 1e6 });
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    motion.advance(drive({ yaw: 0.004 }), cfg2, 1 / 120);
    const weapon = makeViewmodelPose();
    motion.applyWeapon(weapon, drive(), cfg2, 0);
    const node = new Object3D();
    motion.placeHeldItem(node, { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }, drive(), cfg2);
    expect(node.position.x).toBeCloseTo(weapon.x, 12);
    expect(node.rotation.y).toBeCloseTo(weapon.yaw * DEG2RAD, 12);
  });
});

describe('reset', () => {
  it('empties every channel and seats the angles, so a respawn starts still', () => {
    const cfg = config();
    const motion = new ViewmodelMotion();
    motion.reset(0, 0);
    for (let i = 0; i < 50; i++) motion.advance(drive({ yaw: i * 0.1, adsFraction: 1, pitch: 0.3 }), cfg, 1 / 120);
    motion.reset(2.5, -0.4);
    expect(motion.ads).toBe(0);
    const pose = makeViewmodelPose();
    motion.applyWeapon(pose, drive(), cfg, 0);
    expect(pose).toEqual(makeViewmodelPose());
    // Seated, so the first frame at those angles is not a flick.
    motion.advance(drive({ yaw: 2.5, pitch: -0.4 }), cfg, 1 / 120);
    const after = makeViewmodelPose();
    motion.applyWeapon(after, drive(), config({ idleAmplitude: 0 }), 0);
    expect(after).toEqual(makeViewmodelPose());
  });
});
