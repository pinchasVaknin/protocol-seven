import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Object3D, Vector3 } from 'three';
import {
  GRENADE_PIN_OUT,
  GRENADE_PULL_AT,
  GRENADE_THROW,
  GRENADE_WINDUP_AT,
  KNIFE_SWING,
  grenadeDriveAt,
  grenadeThrowFor,
  grenadeThrowSource,
  knifeSwingSource,
  makeViewmodelDrive,
  ViewmodelAnim,
  type ViewmodelDrive,
} from './ViewmodelAnim';
import { DEFAULT_VIEWMODEL_CONFIG, type ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { WeaponModel } from './WeaponMesh';
import type { GrenadeModel } from './GrenadeMesh';
import type { ShieldModel } from './ShieldMesh';
import type { ViewmodelHands } from './ViewmodelHands';

/**
 * What `ViewmodelAnim` does, pinned through the surface `ClientMatch` and the hand tuner use.
 *
 * Everything here goes through `update`, because that is the only thing a frame calls and the
 * only place the stages are composed in order. The doubles are real `Object3D`s — the
 * animation talks to a weapon through transforms and eleven plain fields, so a real
 * `Object3D` with three.js's own transform maths behind it *is* the production surface, and
 * nothing below re-implements anything it is testing.
 *
 * The one recorded double is the hands rig: solving an arm onto a base matrix is
 * `ViewmodelHands`'s subject, and what this unit owes it is one base matrix per frame and a
 * `magazineHold` between 0 and 1. So the double keeps those and poses nothing.
 */

const DEG2RAD = Math.PI / 180;

/** Where a sight point ends up under a pose, in the viewmodel camera's space. */
function place(sight: Vector3, position: Vector3, rx: number, ry: number, rz: number): Vector3 {
  return sight
    .clone()
    .applyEuler(new Euler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD))
    .add(position);
}

interface RecordingHands {
  magazineHold: number;
  readonly bases: number[][];
  update(base: Matrix4): void;
}

function recordingHands(): RecordingHands {
  return {
    magazineHold: 0,
    bases: [],
    update(base: Matrix4): void {
      this.bases.push([...base.elements]);
    },
  };
}

interface FakeWeaponOptions {
  readonly source?: 'glb' | 'procedural';
  readonly weaponId?: string;
  readonly sightHeight?: number;
  readonly sightPoint?: Vector3;
  readonly adsSightDistance?: number;
  readonly adsPitch?: number;
  readonly adsOffsetZ?: number;
  readonly magazineExit?: Vector3;
  readonly withSupportHand?: boolean;
  readonly withHands?: boolean;
}

/** The M2 carbine's numbers by default: the weapon `ViewmodelConfig` was tuned against. */
function fakeWeapon(options: FakeWeaponOptions = {}): WeaponModel {
  const hands = options.withHands === true ? recordingHands() : null;
  return {
    root: new Object3D(),
    magazine: new Object3D(),
    chargingHandle: new Object3D(),
    muzzle: new Object3D(),
    sightHeight: options.sightHeight ?? 0.0915,
    sightPoint: options.sightPoint ?? new Vector3(0, 0.0915, 0),
    adsSightDistance: options.adsSightDistance ?? 0.34,
    adsPitch: options.adsPitch ?? 0,
    adsOffsetZ: options.adsOffsetZ ?? 0,
    weaponId: options.weaponId ?? 'ar_carbine',
    source: options.source ?? 'procedural',
    magazineExit: options.magazineExit ?? new Vector3(0, -1, 0),
    supportHand: options.withSupportHand === true ? new Object3D() : null,
    hands: hands as unknown as ViewmodelHands | null,
    dispose(): void {},
  };
}

function fakeGrenade(poseId = 'eq_frag', withHands = false): GrenadeModel & { held: boolean } {
  const hands = withHands ? recordingHands() : null;
  const grenade = {
    equipmentId: poseId.replace(/^eq_/, ''),
    poseId,
    root: new Object3D(),
    hands: hands as unknown as ViewmodelHands | null,
    pinCarrier: new Object3D(),
    lever: new Object3D(),
    held: true,
    setHeld(held: boolean): void {
      grenade.held = held;
    },
    dispose(): void {},
  };
  return grenade as unknown as GrenadeModel & { held: boolean };
}

function fakeShield(withHands = false): ShieldModel {
  const hands = withHands ? recordingHands() : null;
  return {
    root: new Object3D(),
    hands: hands as unknown as ViewmodelHands | null,
    dispose(): void {},
  };
}

function config(overrides: Partial<ViewmodelConfig> = {}): ViewmodelConfig {
  return { ...DEFAULT_VIEWMODEL_CONFIG, ...overrides };
}

/** The root's pose: position in metres, rotation in degrees. */
function poseOf(model: WeaponModel): Record<'x' | 'y' | 'z' | 'pitch' | 'yaw' | 'roll', number> {
  const r = model.root;
  return {
    x: r.position.x,
    y: r.position.y,
    z: r.position.z,
    pitch: r.rotation.x / DEG2RAD,
    yaw: r.rotation.y / DEG2RAD,
    roll: r.rotation.z / DEG2RAD,
  };
}

/**
 * Run `frames` frames with one drive, from a freshly primed animator.
 *
 * `dt` is 1/120 rather than a plausible frame: several channels are damped followers, and a
 * short step keeps the test's expectation about where a follower has reached a statement about
 * the curve rather than about the step size.
 */
function run(
  anim: ViewmodelAnim,
  drive: Partial<ViewmodelDrive>,
  frames = 1,
  cfg: ViewmodelConfig = config(),
  dt = 1 / 120,
): void {
  const full = { ...makeViewmodelDrive(), ...drive };
  for (let i = 0; i < frames; i++) anim.update(full, cfg, dt);
}

/** An animator already primed at the given angles, so the first frame carries no sway. */
function primed(model: WeaponModel, yaw = 0, pitch = 0): ViewmodelAnim {
  const anim = new ViewmodelAnim(model);
  anim.reset(yaw, pitch);
  return anim;
}

describe('makeViewmodelDrive', () => {
  it('is the rest state a weapon is carried in, not a zeroed record', () => {
    const drive = makeViewmodelDrive();
    // Three fields are deliberately not zero: a weapon starts ready, nothing is being cooked,
    // and `speedRef` has to be non-zero or the bob would divide by it.
    expect(drive.raise).toBe(1);
    expect(drive.throwCook).toBe(-1);
    expect(drive.speedRef).toBe(6.9);
    expect(drive.grounded).toBe(true);
    for (const flag of ['reloading', 'reloadEmpty', 'tacSprint', 'slide', 'swapping', 'throwing'] as const) {
      expect(drive[flag]).toBe(false);
    }
    for (const n of ['adsFraction', 'reloadFraction', 'visualPunch', 'visualLateral', 'melee', 'bobPhase', 'speed', 'yaw', 'pitch', 'throwRelease'] as const) {
      expect(drive[n]).toBe(0);
    }
  });

  it('hands out a fresh record each time, since a match mutates the one it holds', () => {
    const a = makeViewmodelDrive();
    const b = makeViewmodelDrive();
    a.raise = 0.5;
    expect(b.raise).toBe(1);
  });
});

describe('priming and reset', () => {
  it('seats the view angles on the first frame, so a match does not open on a sway spike', () => {
    const model = fakeWeapon();
    // No `reset`: the first `update` has to do it, from the drive's own angles.
    const anim = new ViewmodelAnim(model);
    run(anim, { yaw: 2.5, pitch: -0.4 });
    const fresh = poseOf(model);

    const seated = fakeWeapon();
    run(primed(seated, 2.5, -0.4), { yaw: 2.5, pitch: -0.4 });
    expect(fresh).toEqual(poseOf(seated));
  });

  it('puts every channel back, so a respawn does not inherit the last life’s sway', () => {
    const model = fakeWeapon();
    const anim = primed(model);
    run(anim, { yaw: 0.6, speed: 5, bobPhase: 2.1, adsFraction: 1 }, 30);
    anim.reset(0, 0);
    run(anim, {}, 1);

    const clean = fakeWeapon();
    run(primed(clean), {}, 1);
    expect(poseOf(model)).toEqual(poseOf(clean));
  });
});

describe('the frame delta', () => {
  it('is clamped to a twentieth of a second, so a stalled tab does not jump the followers', () => {
    const long = fakeWeapon();
    const animLong = primed(long);
    animLong.update({ ...makeViewmodelDrive(), adsFraction: 1 }, config(), 4);

    const capped = fakeWeapon();
    const animCapped = primed(capped);
    animCapped.update({ ...makeViewmodelDrive(), adsFraction: 1 }, config(), 1 / 20);

    expect(poseOf(long)).toEqual(poseOf(capped));
  });

  it('is clamped below at zero, so a clock that runs backwards poses the rest state', () => {
    const back = fakeWeapon();
    const animBack = primed(back);
    animBack.update({ ...makeViewmodelDrive(), adsFraction: 1 }, config(), -3);

    const still = fakeWeapon();
    const animStill = primed(still);
    animStill.update({ ...makeViewmodelDrive(), adsFraction: 1 }, config(), 0);

    expect(poseOf(back)).toEqual(poseOf(still));
  });
});

describe('the base pose', () => {
  it('is the hip pose plus this weapon’s own offset, standing still', () => {
    const model = fakeWeapon();
    const cfg = config({ idleAmplitude: 0 });
    run(primed(model), {}, 1, cfg);
    const pose = poseOf(model);
    // `ar_carbine` has no row in VIEWMODEL_OFFSETS, so the offset is zero and the pose is
    // exactly the config's. That is the statement: nothing is added to a plain weapon.
    expect(pose.x).toBeCloseTo(cfg.hipX, 12);
    expect(pose.y).toBeCloseTo(cfg.hipY, 12);
    expect(pose.z).toBeCloseTo(cfg.hipZ, 12);
    expect(pose.pitch).toBeCloseTo(cfg.hipPitch, 10);
    expect(pose.yaw).toBeCloseTo(cfg.hipYaw, 10);
    expect(pose.roll).toBeCloseTo(cfg.hipRoll, 10);
  });

  it('lands the sight point on the camera’s own axis at full ADS', () => {
    const sight = new Vector3(0.013, 0.0915, -0.06);
    const model = fakeWeapon({ sightPoint: sight, sightHeight: sight.y });
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0 });
    run(primed(model), { adsFraction: 1 }, 400, cfg);
    const pose = poseOf(model);
    // X is cancelled outright, and Y is `adsY` with the weapon's own sight height taken out
    // against the carbine's 0.0915 reference — here the same, so `adsY` exactly.
    expect(pose.x).toBeCloseTo(-sight.x, 6);
    expect(pose.y).toBeCloseTo(cfg.adsY, 6);
  });

  it('holds a taller sight correspondingly lower, from one tuned number and not twelve', () => {
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0 });
    const tall = fakeWeapon({ sightPoint: new Vector3(0, 0.1415, 0), sightHeight: 0.1415 });
    run(primed(tall), { adsFraction: 1 }, 400, cfg);
    // 5 cm above the reference sight line, so the weapon is held exactly 5 cm lower.
    expect(poseOf(tall).y).toBeCloseTo(cfg.adsY - (0.1415 - 0.0915), 6);
  });

  it('turns the sight point with the weapon when its line is not parallel to the bore', () => {
    const sight = new Vector3(0, 0.09, -0.06);
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0 });
    const straight = fakeWeapon({ sightPoint: sight.clone(), sightHeight: sight.y });
    const pitched = fakeWeapon({ sightPoint: sight.clone(), sightHeight: sight.y, adsPitch: 1.7 });
    run(primed(straight), { adsFraction: 1 }, 400, cfg);
    run(primed(pitched), { adsFraction: 1 }, 400, cfg);
    // The turn is about the root's origin and the sight sits above it, so the point the pose
    // has to land moves — and the pose's own pitch becomes the weapon's.
    expect(poseOf(pitched).pitch).toBeCloseTo(1.7, 6);
    expect(poseOf(pitched).y).not.toBeCloseTo(poseOf(straight).y, 6);
  });

  it('places a file by its sight and a primitive by its tuned Z', () => {
    const sight = new Vector3(0, 0.09, -0.06);
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0 });
    const file = fakeWeapon({ source: 'glb', sightPoint: sight.clone(), sightHeight: sight.y, adsSightDistance: 0.34 });
    const prim = fakeWeapon({ source: 'procedural', sightPoint: sight.clone(), sightHeight: sight.y, adsOffsetZ: 0.02 });
    run(primed(file), { adsFraction: 1 }, 400, cfg);
    run(primed(prim), { adsFraction: 1 }, 400, cfg);
    expect(poseOf(file).z).toBeCloseTo(-0.34 - sight.z, 6);
    expect(poseOf(prim).z).toBeCloseTo(cfg.adsZ + 0.02, 6);
  });

  it('fades the weapon’s own offset out of ADS, because ADS has already placed the sight', () => {
    // `streak_minigun` carries a row in VIEWMODEL_OFFSETS, and it is the weapon that row
    // exists for. It has to be whole at the hip and gone at full ADS, because ADS has already
    // landed the sight point and a constant added there would push it off by that constant.
    const hip = fakeWeapon({ weaponId: 'streak_minigun' });
    const plain = fakeWeapon({ weaponId: 'ar_carbine' });
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0 });
    run(primed(hip), {}, 1, cfg);
    run(primed(plain), {}, 1, cfg);
    const offsetAtHip = poseOf(hip).x - poseOf(plain).x;

    const aimed = fakeWeapon({ weaponId: 'streak_minigun' });
    const aimedPlain = fakeWeapon({ weaponId: 'ar_carbine' });
    run(primed(aimed), { adsFraction: 1 }, 400, cfg);
    run(primed(aimedPlain), { adsFraction: 1 }, 400, cfg);
    expect(poseOf(aimed).x - poseOf(aimedPlain).x).toBeCloseTo(0, 9);
    // And the row really was non-zero at the hip, or the assertion above proves nothing.
    expect(Math.abs(offsetAtHip)).toBeGreaterThan(0);
  });
});

describe('the lowered pose', () => {
  const cfg = config({ idleAmplitude: 0 });

  it('is exactly the base pose at raise 1, so the easing does not bleed into a ready weapon', () => {
    const lowered = fakeWeapon();
    const base = fakeWeapon();
    run(primed(lowered), { raise: 1, tacSprint: true, slide: true, swapping: true }, 1, cfg);
    run(primed(base), {}, 1, cfg);
    expect(poseOf(lowered)).toEqual(poseOf(base));
  });

  it('carries the weapon across the body for a sprint', () => {
    const model = fakeWeapon();
    run(primed(model), { raise: 0 }, 1, cfg);
    const pose = poseOf(model);
    expect(pose.x).toBeCloseTo(cfg.sprintX, 10);
    expect(pose.y).toBeCloseTo(cfg.sprintY, 10);
    expect(pose.z).toBeCloseTo(cfg.sprintZ, 10);
    expect(pose.pitch).toBeCloseTo(cfg.sprintPitch, 10);
    expect(pose.yaw).toBeCloseTo(cfg.sprintYaw, 10);
    expect(pose.roll).toBeCloseTo(cfg.sprintRoll, 10);
  });

  it('drops it further and flatter for a tactical sprint', () => {
    const model = fakeWeapon();
    run(primed(model), { raise: 0, tacSprint: true }, 1, cfg);
    const pose = poseOf(model);
    expect(pose.y).toBeCloseTo(cfg.sprintY + cfg.tacSprintExtraY, 10);
    expect(pose.pitch).toBeCloseTo(cfg.sprintPitch + cfg.tacSprintExtraPitch, 10);
    // Only those two: the roll is the sprint's.
    expect(pose.roll).toBeCloseTo(cfg.sprintRoll, 10);
  });

  it('drops it and rolls it for a slide, and stacks that on a tactical sprint', () => {
    const slide = fakeWeapon();
    run(primed(slide), { raise: 0, slide: true }, 1, cfg);
    expect(poseOf(slide).y).toBeCloseTo(cfg.sprintY + cfg.slideExtraY, 10);
    expect(poseOf(slide).roll).toBeCloseTo(cfg.sprintRoll + cfg.slideExtraRoll, 10);

    const both = fakeWeapon();
    run(primed(both), { raise: 0, slide: true, tacSprint: true }, 1, cfg);
    expect(poseOf(both).y).toBeCloseTo(cfg.sprintY + cfg.tacSprintExtraY + cfg.slideExtraY, 10);
  });

  it('drops it straight down and out of frame for a swap, which outranks the sprint pose', () => {
    const model = fakeWeapon();
    run(primed(model), { raise: 0, swapping: true, tacSprint: true, slide: true }, 1, cfg);
    const pose = poseOf(model);
    expect(pose.x).toBeCloseTo(cfg.swapX, 10);
    expect(pose.y).toBeCloseTo(cfg.swapY, 10);
    expect(pose.z).toBeCloseTo(cfg.swapZ, 10);
    expect(pose.pitch).toBeCloseTo(cfg.swapPitch, 10);
    expect(pose.yaw).toBeCloseTo(0, 10);
    expect(pose.roll).toBeCloseTo(cfg.swapRoll, 10);
  });

  it('takes the swap pose for a throw, through a follower rather than a snap', () => {
    const model = fakeWeapon();
    const anim = primed(model);
    run(anim, { throwing: true }, 1, cfg);
    const firstFrame = poseOf(model);
    // One frame in, the weapon has barely begun to move: this is damped, not switched.
    expect(firstFrame.y).toBeGreaterThan(cfg.swapY + 0.1);
    run(anim, { throwing: true }, 400, cfg);
    expect(poseOf(model).y).toBeCloseTo(cfg.swapY, 4);
  });

  it('comes back up when the throw ends', () => {
    const model = fakeWeapon();
    const anim = primed(model);
    run(anim, { throwing: true }, 400, cfg);
    run(anim, {}, 400, cfg);
    expect(poseOf(model).y).toBeCloseTo(cfg.hipY, 4);
  });
});

describe('the reload', () => {
  const cfg = config({ idleAmplitude: 0 });

  it('puts the magazine, the handle and the support hand home when nothing is reloading', () => {
    const model = fakeWeapon({ withSupportHand: true });
    model.magazine.position.set(1, 2, 3);
    model.magazine.rotation.set(1, 2, 3);
    model.chargingHandle.position.set(4, 5, 6);
    model.supportHand?.position.set(7, 8, 9);
    run(primed(model), {}, 1, cfg);
    expect(model.magazine.position.toArray()).toEqual([0, 0, 0]);
    expect([model.magazine.rotation.x, model.magazine.rotation.y, model.magazine.rotation.z]).toEqual([0, 0, 0]);
    expect(model.chargingHandle.position.toArray()).toEqual([0, 0, 0]);
    expect(model.supportHand?.position.toArray()).toEqual([0, 0, 0]);
  });

  it('runs the magazine out and back over the tactical track', () => {
    const model = fakeWeapon();
    const anim = primed(model);
    const yAt = (f: number): number => {
      run(anim, { reloading: true, reloadFraction: f }, 1, cfg);
      return model.magazine.position.y;
    };
    // Home before `down`, fully out between `magOut` and `magIn`, home again after `magSeated`.
    expect(Math.abs(yAt(0.1))).toBe(0);
    expect(yAt(0.4)).toBeCloseTo(-cfg.magThrow, 10);
    expect(yAt(0.45)).toBeCloseTo(-cfg.magThrow, 10);
    expect(Math.abs(yAt(0.7))).toBe(0);
    // And it is somewhere in between on the way down.
    const half = yAt(0.26);
    expect(half).toBeLessThan(0);
    expect(half).toBeGreaterThan(-cfg.magThrow);
  });

  it('uses the empty track, which is not the tactical one', () => {
    const tactical = fakeWeapon();
    const empty = fakeWeapon();
    run(primed(tactical), { reloading: true, reloadFraction: 0.33 }, 1, cfg);
    run(primed(empty), { reloading: true, reloadEmpty: true, reloadFraction: 0.33 }, 1, cfg);
    expect(empty.magazine.position.y).not.toBeCloseTo(tactical.magazine.position.y, 6);
  });

  it('tumbles a magazine that falls out of the well and slides one that lifts off the top', () => {
    const cfgFile = config({ idleAmplitude: 0 });
    const falls = fakeWeapon({ source: 'glb', magazineExit: new Vector3(0, -1, 0) });
    const lifts = fakeWeapon({ source: 'glb', magazineExit: new Vector3(0, 1, 0) });
    run(primed(falls), { reloading: true, reloadFraction: 0.4 }, 1, cfgFile);
    run(primed(lifts), { reloading: true, reloadFraction: 0.4 }, 1, cfgFile);
    expect(falls.magazine.rotation.x).toBeGreaterThan(0);
    expect(lifts.magazine.rotation.x).toBe(0);
    // And it travels further out of a well than off a receiver.
    expect(Math.abs(falls.magazine.position.y)).toBeGreaterThan(Math.abs(lifts.magazine.position.y));
  });

  it('rolls a file toward whichever side its magazine well is on', () => {
    const cfgFile = config({ idleAmplitude: 0 });
    const under = fakeWeapon({ source: 'glb', magazineExit: new Vector3(0, -1, 0) });
    const onTop = fakeWeapon({ source: 'glb', magazineExit: new Vector3(0, 1, 0) });
    run(primed(under), { reloading: true, reloadFraction: 0.4 }, 1, cfgFile);
    run(primed(onTop), { reloading: true, reloadFraction: 0.4 }, 1, cfgFile);
    expect(Math.sign(poseOf(under).roll - cfgFile.hipRoll)).toBe(-Math.sign(poseOf(onTop).roll - cfgFile.hipRoll));
  });

  it('tips a file up and a primitive down, and sinks a file far less', () => {
    const cfgBoth = config({ idleAmplitude: 0 });
    const file = fakeWeapon({ source: 'glb' });
    const prim = fakeWeapon({ source: 'procedural' });
    run(primed(file), { reloading: true, reloadFraction: 0.4 }, 1, cfgBoth);
    run(primed(prim), { reloading: true, reloadFraction: 0.4 }, 1, cfgBoth);
    expect(poseOf(file).y).toBeGreaterThan(poseOf(prim).y);
    expect(poseOf(file).pitch).toBeGreaterThan(poseOf(prim).pitch);
  });

  it('pulls the charging handle on an empty reload and on no other', () => {
    const model = fakeWeapon();
    const anim = primed(model);
    const pullAt = (f: number, emptyReload: boolean): number => {
      run(anim, { reloading: true, reloadEmpty: emptyReload, reloadFraction: f }, 1, cfg);
      return model.chargingHandle.position.z;
    };
    expect(pullAt(0.72, false)).toBe(0);
    expect(pullAt(0.6, true)).toBe(0);
    const drawn = pullAt(0.72, true);
    expect(drawn).toBeGreaterThan(0);
    expect(pullAt(0.75, true)).toBeCloseTo(cfg.chargeThrow, 10);
    // Released rather than eased back: already most of the way home a third into the return.
    expect(pullAt(0.79, true)).toBeLessThan(cfg.chargeThrow * 0.4);
    expect(pullAt(0.85, true)).toBe(0);
  });

  it('rides the support hand out with the magazine when there is a hands rig', () => {
    const model = fakeWeapon({ withHands: true });
    const rig = model.hands as unknown as RecordingHands;
    const anim = primed(model);
    const holdAt = (f: number): number => {
      run(anim, { reloading: true, reloadFraction: f }, 1, cfg);
      return rig.magazineHold;
    };
    expect(holdAt(0)).toBe(0);
    expect(holdAt(0.4)).toBe(1);
    expect(holdAt(0.9)).toBe(0);
  });

  it('moves a box glove by the magazine’s own displacement instead', () => {
    const model = fakeWeapon({ withSupportHand: true });
    run(primed(model), { reloading: true, reloadFraction: 0.4 }, 1, cfg);
    const hand = model.supportHand as Object3D;
    // The hand is the magazine's travel plus the grip offset, scaled by the blend — which is
    // 1 here, so it is exactly that sum.
    expect(hand.position.x).toBeCloseTo(model.magazine.position.x + 0.02, 10);
    expect(hand.position.y).toBeCloseTo(model.magazine.position.y - 0.055, 10);
    expect(hand.position.z).toBeCloseTo(model.magazine.position.z + 0.02, 10);
  });
});

describe('bob, idle drift and sway', () => {
  it('scales the bob by how fast the player is going, against the speed that counts as full', () => {
    const cfg = config({ idleAmplitude: 0 });
    const slow = fakeWeapon();
    const fast = fakeWeapon();
    run(primed(slow), { speed: 3.45, speedRef: 6.9, bobPhase: Math.PI / 2 }, 1, cfg);
    run(primed(fast), { speed: 6.9, speedRef: 6.9, bobPhase: Math.PI / 2 }, 1, cfg);
    expect(poseOf(fast).x - cfg.hipX).toBeCloseTo((poseOf(slow).x - cfg.hipX) * 2, 10);
  });

  it('stops the bob outright in the air, however fast the player is moving', () => {
    const cfg = config({ idleAmplitude: 0 });
    const air = fakeWeapon();
    const still = fakeWeapon();
    run(primed(air), { speed: 9, grounded: false, bobPhase: Math.PI / 2 }, 1, cfg);
    run(primed(still), {}, 1, cfg);
    expect(poseOf(air)).toEqual(poseOf(still));
  });

  it('quiets the bob at ADS, where the sight picture is what the player is reading', () => {
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0 });
    const hip = fakeWeapon();
    const aimed = fakeWeapon();
    run(primed(hip), { speed: 6.9, bobPhase: Math.PI / 2 }, 1, cfg);
    const anim = primed(aimed);
    run(anim, { adsFraction: 1 }, 400, cfg);
    const settled = poseOf(aimed).x;
    run(anim, { adsFraction: 1, speed: 6.9, bobPhase: Math.PI / 2 }, 1, cfg);
    const bobbed = poseOf(aimed).x - settled;
    expect(bobbed).toBeCloseTo((poseOf(hip).x - cfg.hipX) * cfg.bobAdsScale, 4);
  });

  it('never lets the gun be perfectly still, even standing', () => {
    const model = fakeWeapon();
    const anim = primed(model);
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      run(anim, {}, 1);
      seen.add(Math.round(model.root.position.x * 1e9));
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it('drives sway from how fast the view is turning, not from where it points', () => {
    const cfg = config({ idleAmplitude: 0 });
    const fast = fakeWeapon();
    const slow = fakeWeapon();
    const animFast = primed(fast, 0, 0);
    const animSlow = primed(slow, 0, 0);
    // Both under `swayMax`, or this would compare two capped values and prove nothing.
    animFast.update({ ...makeViewmodelDrive(), yaw: 0.008 }, cfg, 1 / 120);
    animSlow.update({ ...makeViewmodelDrive(), yaw: 0.002 }, cfg, 1 / 120);
    expect(Math.abs(poseOf(fast).x - cfg.hipX)).toBeGreaterThan(Math.abs(poseOf(slow).x - cfg.hipX));
  });

  it('caps the sway, so a flick does not throw the weapon off screen', () => {
    const cfg = config({ idleAmplitude: 0 });
    const model = fakeWeapon();
    const anim = primed(model, 0, 0);
    // A turn no hand could make: the cap is what stands between this and the weapon leaving.
    for (let i = 0; i < 200; i++) anim.update({ ...makeViewmodelDrive(), yaw: i * 0.9 }, cfg, 1 / 120);
    expect(Math.abs(poseOf(model).x - cfg.hipX)).toBeLessThanOrEqual(cfg.swayMax + 1e-9);
  });

  it('quiets the sway at ADS', () => {
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0, swayRate: 1e6 });
    const hip = fakeWeapon();
    const aimed = fakeWeapon();
    const animHip = primed(hip, 0, 0);
    const animAimed = primed(aimed, 0, 0);
    run(animAimed, { adsFraction: 1 }, 400, cfg);
    const settled = poseOf(aimed).x;
    // Under the cap at the hip, so scaling it down at ADS stays under it too.
    animHip.update({ ...makeViewmodelDrive(), yaw: 0.008 }, cfg, 1 / 120);
    animAimed.update({ ...makeViewmodelDrive(), adsFraction: 1, yaw: 0.008 }, cfg, 1 / 120);
    expect(poseOf(aimed).x - settled).toBeCloseTo((poseOf(hip).x - cfg.hipX) * cfg.swayAdsScale, 6);
  });

  it('measures the yaw the short way round, so crossing the wrap is not a flick', () => {
    const cfg = config({ idleAmplitude: 0 });
    const across = fakeWeapon();
    const plain = fakeWeapon();
    // The same 0.1 rad turn, once across the ±pi seam and once in open ground.
    const animAcross = primed(across, Math.PI - 0.05, 0);
    const animPlain = primed(plain, 0, 0);
    animAcross.update({ ...makeViewmodelDrive(), yaw: -Math.PI + 0.05 }, cfg, 1 / 120);
    animPlain.update({ ...makeViewmodelDrive(), yaw: 0.1 }, cfg, 1 / 120);
    expect(poseOf(across).x).toBeCloseTo(poseOf(plain).x, 12);
  });
});

describe('the recoil kick', () => {
  it('moves the weapon back, up and sideways at the hip', () => {
    const cfg = config({ idleAmplitude: 0 });
    const model = fakeWeapon();
    run(primed(model), { visualPunch: 1, visualLateral: 1 }, 1, cfg);
    const pose = poseOf(model);
    expect(pose.z).toBeCloseTo(cfg.hipZ + cfg.kickBack, 10);
    expect(pose.y).toBeCloseTo(cfg.hipY + cfg.kickUp, 10);
    expect(pose.x).toBeCloseTo(cfg.hipX + cfg.kickLateral, 10);
    expect(pose.pitch).toBeCloseTo(cfg.hipPitch + cfg.kickPitch, 10);
    expect(pose.roll).toBeCloseTo(cfg.hipRoll - cfg.kickRoll, 10);
  });

  it('scales the kick’s translation out as the sights come up', () => {
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0, kickAdsScale: 0 });
    const model = fakeWeapon();
    const anim = primed(model);
    run(anim, { adsFraction: 1 }, 400, cfg);
    const settled = poseOf(model);
    run(anim, { adsFraction: 1, visualPunch: 1, visualLateral: 1 }, 1, cfg);
    const kicked = poseOf(model);
    // `kickAdsScale` is 0 in the shipped config, so the translation is gone — what is left of
    // the kick is the rotation and the shift that keeps the sight point still.
    expect(kicked.pitch - settled.pitch).toBeCloseTo(cfg.kickPitch, 6);
    expect(kicked.roll - settled.roll).toBeCloseTo(-cfg.kickRoll, 6);
  });

  it('holds the sight point on the camera axis through a kick, which is the whole point', () => {
    const sight = new Vector3(0, 0.0915, -0.06);
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0 });
    const model = fakeWeapon({ sightPoint: sight, sightHeight: sight.y });
    const anim = primed(model);
    run(anim, { adsFraction: 1 }, 400, cfg);
    const before = place(sight, model.root.position.clone(), poseOf(model).pitch, poseOf(model).yaw, poseOf(model).roll);
    run(anim, { adsFraction: 1, visualPunch: 1, visualLateral: 1 }, 1, cfg);
    const after = place(sight, model.root.position.clone(), poseOf(model).pitch, poseOf(model).yaw, poseOf(model).roll);
    expect(after.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('leaves the hip kick uncorrected, because the crosshair is painted on the screen there', () => {
    const sight = new Vector3(0, 0.0915, -0.06);
    const cfg = config({ idleAmplitude: 0 });
    const model = fakeWeapon({ sightPoint: sight, sightHeight: sight.y });
    const anim = primed(model);
    run(anim, {}, 1, cfg);
    const before = place(sight, model.root.position.clone(), poseOf(model).pitch, poseOf(model).yaw, poseOf(model).roll);
    run(anim, { visualPunch: 1, visualLateral: 1 }, 1, cfg);
    const after = place(sight, model.root.position.clone(), poseOf(model).pitch, poseOf(model).yaw, poseOf(model).roll);
    expect(after.distanceTo(before)).toBeGreaterThan(1e-3);
  });
});

describe('the ADS curve', () => {
  it('overshoots on the way in and does not on the way out', () => {
    const cfg = config({ idleAmplitude: 0 });
    const rising = fakeWeapon();
    const anim = primed(rising);
    let past = false;
    for (let i = 1; i <= 60; i++) {
      run(anim, { adsFraction: i / 60 }, 1, cfg);
      // `adsY` is *above* `hipY`, so overshooting the sight picture reads as higher still.
      if (poseOf(rising).y > cfg.adsY + 1e-6) past = true;
    }
    expect(past).toBe(true);

    const falling = fakeWeapon();
    const animFall = primed(falling);
    run(animFall, { adsFraction: 1 }, 400, cfg);
    let overshotOut = false;
    for (let i = 60; i >= 0; i--) {
      run(animFall, { adsFraction: i / 60 }, 1, cfg);
      if (poseOf(falling).y < cfg.hipY - 1e-6) overshotOut = true;
    }
    expect(overshotOut).toBe(false);
  });

  it('is the same shape at any frame rate, because it is a function of the fraction', () => {
    const cfg = config({ idleAmplitude: 0, adsOvershoot: 0 });
    const slow = fakeWeapon();
    const fast = fakeWeapon();
    const animSlow = primed(slow);
    const animFast = primed(fast);
    run(animSlow, { adsFraction: 1 }, 600, cfg, 1 / 240);
    run(animFast, { adsFraction: 1 }, 600, cfg, 1 / 60);
    expect(poseOf(slow).y).toBeCloseTo(poseOf(fast).y, 9);
  });
});

describe('the knife', () => {
  it('poses nothing when this match built no blade', () => {
    const model = fakeWeapon();
    const anim = primed(model);
    expect(() => run(anim, { melee: 0.5 }, 1)).not.toThrow();
  });

  it('is exactly the ready pose at melee 0, since the first tick of a wind-up reports 0', () => {
    const cfg = config({ idleAmplitude: 0 });
    const knife = new Object3D();
    const anim = primed(fakeWeapon());
    anim.setKnife(knife);
    run(anim, { melee: 0 }, 1, cfg);
    expect(knife.position.x).toBeCloseTo(KNIFE_SWING.ready.x, 10);
    expect(knife.position.y).toBeCloseTo(KNIFE_SWING.ready.y, 10);
    expect(knife.position.z).toBeCloseTo(KNIFE_SWING.ready.z, 10);
    expect(knife.rotation.z / DEG2RAD).toBeCloseTo(KNIFE_SWING.ready.roll, 10);
  });

  it('returns to the ready pose at the end, so a swing cut short leaves nothing stranded', () => {
    const cfg = config({ idleAmplitude: 0 });
    const knife = new Object3D();
    const anim = primed(fakeWeapon());
    anim.setKnife(knife);
    run(anim, { melee: 1 }, 1, cfg);
    expect(knife.position.x).toBeCloseTo(KNIFE_SWING.ready.x, 10);
    expect(knife.position.z).toBeCloseTo(KNIFE_SWING.ready.z, 10);
  });

  it('reaches the strike pose on the frame the hitbox test runs', () => {
    const cfg = config({ idleAmplitude: 0 });
    const knife = new Object3D();
    const anim = primed(fakeWeapon());
    anim.setKnife(knife);
    // `Melee` runs a 0.12 s wind-up over a 0.54 s swing, so the strike tick is at 0.222.
    run(anim, { melee: 0.222 }, 1, cfg);
    expect(knife.position.x).toBeCloseTo(KNIFE_SWING.strike.x, 10);
    expect(knife.position.y).toBeCloseTo(KNIFE_SWING.strike.y, 10);
    expect(knife.position.z).toBeCloseTo(KNIFE_SWING.strike.z, 10);
  });

  it('passes through the wind-up on the way, out of frame and back', () => {
    const cfg = config({ idleAmplitude: 0 });
    const knife = new Object3D();
    const anim = primed(fakeWeapon());
    anim.setKnife(knife);
    run(anim, { melee: 0.13 }, 1, cfg);
    expect(knife.position.y).toBeCloseTo(KNIFE_SWING.windup.y, 10);
  });

  it('spans the forearm from a fixed shoulder to the fist, stretching Z alone', () => {
    const cfg = config({ idleAmplitude: 0 });
    const knife = new Object3D();
    const arm = new Object3D();
    const anim = primed(fakeWeapon());
    anim.setKnife(knife, arm);
    run(anim, { melee: 0.222 }, 1, cfg);
    // The shoulder is behind the camera, low and right, so the elbow is never on screen.
    expect(arm.position.toArray()).toEqual([0.3, -0.45, 0.28]);
    expect(arm.scale.x).toBe(1);
    expect(arm.scale.y).toBe(1);
    expect(arm.scale.z).toBeCloseTo(knife.position.distanceTo(arm.position), 10);
    // -Z rotated onto the shoulder-to-fist direction lands the sleeve's far end on the fist.
    const tip = new Vector3(0, 0, -1).applyQuaternion(arm.quaternion).multiplyScalar(arm.scale.z).add(arm.position);
    expect(tip.distanceTo(knife.position)).toBeLessThan(1e-9);
  });

  it('borrows the player’s own motion but none of the weapon’s poses', () => {
    const cfg = config();
    const still = new Object3D();
    const moving = new Object3D();
    const animStill = primed(fakeWeapon());
    const animMoving = primed(fakeWeapon());
    animStill.setKnife(still);
    animMoving.setKnife(moving);
    // ADS, a reload and a sprint are all the weapon's; the blade does not inherit them.
    run(animStill, { melee: 0.5 }, 1, cfg);
    run(animMoving, { melee: 0.5, adsFraction: 1, reloading: true, reloadFraction: 0.4, raise: 0 }, 1, cfg);
    expect(moving.position.x).toBeCloseTo(still.position.x, 12);
    expect(moving.position.z).toBeCloseTo(still.position.z, 12);

    // The bob is the player's, so it does reach the blade.
    const bobbed = new Object3D();
    const animBob = primed(fakeWeapon());
    animBob.setKnife(bobbed);
    run(animBob, { melee: 0.5, speed: 6.9, bobPhase: Math.PI / 2 }, 1, cfg);
    expect(bobbed.position.x).not.toBeCloseTo(still.position.x, 6);
  });

  it('hands the arm rig the blade’s own pose, and skips the cylinder when it has one', () => {
    const cfg = config({ idleAmplitude: 0 });
    const knife = new Object3D();
    const arm = new Object3D();
    const rig = recordingHands();
    const anim = primed(fakeWeapon());
    anim.setKnife(knife, arm, rig as unknown as ViewmodelHands);
    run(anim, { melee: 0.5 }, 1, cfg);
    expect(rig.bases).toHaveLength(1);
    // The rig took the frame, so the forearm cylinder was left alone.
    expect(arm.scale.z).toBe(1);
    const composed = new Matrix4().compose(knife.position, knife.quaternion, knife.scale);
    expect(rig.bases[0]).toEqual([...composed.elements]);
  });

  it('poses from a copy of the shipped swing, which the hand tuner may edit', () => {
    const anim = primed(fakeWeapon());
    expect(anim.knifeSwing).not.toBe(KNIFE_SWING);
    expect(anim.knifeSwing.ready).toEqual(KNIFE_SWING.ready);
    anim.knifeSwing.ready.x = 99;
    expect(KNIFE_SWING.ready.x).not.toBe(99);
  });
});

describe('the grenade throw', () => {
  it('maps the simulation’s two numbers onto one line', () => {
    // A cook runs from 0 to the wind-up; the release carries the rest.
    expect(ViewmodelAnim.throwFraction(-1, 0)).toBe(0);
    expect(ViewmodelAnim.throwFraction(0, 0)).toBe(0);
    expect(ViewmodelAnim.throwFraction(0.17, 0)).toBeCloseTo(GRENADE_WINDUP_AT / 2, 10);
    expect(ViewmodelAnim.throwFraction(0.34, 0)).toBeCloseTo(GRENADE_WINDUP_AT, 10);
    // A cook longer than the arm takes is still the held pose, not past it.
    expect(ViewmodelAnim.throwFraction(9, 0)).toBeCloseTo(GRENADE_WINDUP_AT, 10);
    expect(ViewmodelAnim.throwFraction(-1, 0.5)).toBeCloseTo(GRENADE_WINDUP_AT + (1 - GRENADE_WINDUP_AT) * 0.5, 10);
    expect(ViewmodelAnim.throwFraction(-1, 1)).toBe(1);
    // The release outranks the cook: once it is running, the cook is over.
    expect(ViewmodelAnim.throwFraction(0.2, 1)).toBe(1);
  });

  it('is what grenadeDriveAt inverts, so the tuner drives the match’s own path', () => {
    for (const t of [0, 0.1, 0.26, 0.5, 0.74, 1]) {
      const drive = grenadeDriveAt(t);
      expect(ViewmodelAnim.throwFraction(drive.cook, drive.release)).toBeCloseTo(t, 12);
    }
  });

  it('poses nothing when no grenade is in the hand', () => {
    const anim = primed(fakeWeapon());
    expect(() => run(anim, { throwing: true, throwCook: 0.2 }, 1)).not.toThrow();
  });

  it('blends the four keyframes in order', () => {
    const cfg = config({ idleAmplitude: 0 });
    const at = (t: number): Vector3 => {
      const grenade = fakeGrenade('nothing_has_this_id');
      const anim = primed(fakeWeapon());
      anim.setGrenade(grenade);
      const drive = grenadeDriveAt(t);
      run(anim, { throwing: true, throwCook: drive.cook, throwRelease: drive.release }, 1, cfg);
      return grenade.root.position.clone();
    };
    for (const [t, pose] of [
      [0, GRENADE_THROW.ready],
      [GRENADE_PULL_AT, GRENADE_THROW.pull],
      [GRENADE_WINDUP_AT, GRENADE_THROW.windup],
      [1, GRENADE_THROW.release],
    ] as const) {
      const p = at(t);
      expect(p.x).toBeCloseTo(pose.x, 9);
      expect(p.y).toBeCloseTo(pose.y, 9);
      expect(p.z).toBeCloseTo(pose.z, 9);
    }
  });

  it('pulls the pin clear by the wind-up and leaves it there', () => {
    const cfg = config({ idleAmplitude: 0 });
    const grenade = fakeGrenade('nothing_has_this_id');
    const anim = primed(fakeWeapon());
    anim.setGrenade(grenade);
    const pinAt = (t: number): Vector3 => {
      const drive = grenadeDriveAt(t);
      run(anim, { throwing: true, throwCook: drive.cook, throwRelease: drive.release }, 1, cfg);
      return grenade.pinCarrier.position.clone();
    };
    expect(pinAt(0).length()).toBe(0);
    expect(pinAt(0.3).length()).toBeGreaterThan(0);
    expect(pinAt(GRENADE_WINDUP_AT).x).toBeCloseTo(GRENADE_PIN_OUT.x, 9);
    expect(pinAt(1).x).toBeCloseTo(GRENADE_PIN_OUT.x, 9);
  });

  it('keeps the grenade in the hand for the whole release and lets it go on the last frame', () => {
    const cfg = config({ idleAmplitude: 0 });
    const grenade = fakeGrenade('nothing_has_this_id');
    const anim = primed(fakeWeapon());
    anim.setGrenade(grenade);
    const seen: boolean[] = [];
    for (let i = 0; i <= 40; i++) {
      const drive = grenadeDriveAt(i / 40);
      run(anim, { throwing: true, throwCook: drive.cook, throwRelease: drive.release }, 1, cfg);
      seen.push(grenade.held);
    }
    expect(seen.filter((held, i) => i > 0 && held !== seen[i - 1])).toHaveLength(1);
    expect(seen[seen.length - 1]).toBe(false);
    expect(seen[seen.length - 2]).toBe(true);
    expect(grenade.lever?.visible).toBe(false);
  });

  it('gives each piece of equipment its own throw, and the shipped one to anything without', () => {
    expect(grenadeThrowFor('nothing_has_this_id').table).toBe(GRENADE_THROW);
    expect(grenadeThrowFor('nothing_has_this_id').pinOut).toBe(GRENADE_PIN_OUT);
    for (const id of ['eq_frag', 'eq_semtex', 'eq_flashbang', 'eq_smoke', 'eq_claymore']) {
      expect(grenadeThrowFor(id).table).not.toBe(GRENADE_THROW);
    }
    // The claymore is a carry, not a lob, and has no pin: it keeps the default travel.
    expect(grenadeThrowFor('eq_claymore').pinOut).toBe(GRENADE_PIN_OUT);
    expect(grenadeThrowFor('eq_frag').pinOut).not.toBe(GRENADE_PIN_OUT);
  });

  it('copies the row for the grenade now in the hand rather than aliasing the table', () => {
    const anim = primed(fakeWeapon());
    anim.setGrenade(fakeGrenade('eq_frag'));
    const shipped = grenadeThrowFor('eq_frag');
    expect(anim.grenadeThrow.ready).toEqual(shipped.table.ready);
    expect(anim.grenadeThrow.ready).not.toBe(shipped.table.ready);
    anim.grenadeThrow.ready.x = 99;
    expect(shipped.table.ready.x).not.toBe(99);
  });

  it('re-reads the table when a different grenade comes into the hand', () => {
    const anim = primed(fakeWeapon());
    anim.setGrenade(fakeGrenade('eq_frag'));
    const frag = { ...anim.grenadeThrow.windup };
    anim.setGrenade(fakeGrenade('eq_claymore'));
    expect(anim.grenadeThrow.windup).not.toEqual(frag);
    expect(anim.grenadeThrow.windup).toEqual(grenadeThrowFor('eq_claymore').table.windup);
  });

  it('borrows the player’s motion the way the blade does', () => {
    const cfg = config();
    const still = fakeGrenade('nothing_has_this_id');
    const bobbed = fakeGrenade('nothing_has_this_id');
    const animStill = primed(fakeWeapon());
    const animBob = primed(fakeWeapon());
    animStill.setGrenade(still);
    animBob.setGrenade(bobbed);
    run(animStill, { throwing: true, throwCook: 0.17 }, 1, cfg);
    run(animBob, { throwing: true, throwCook: 0.17, speed: 6.9, bobPhase: Math.PI / 2 }, 1, cfg);
    expect(bobbed.root.position.x).not.toBeCloseTo(still.root.position.x, 6);
    // Z carries no bob on a held item, exactly as it carries none on the weapon.
    expect(bobbed.root.position.z).toBeCloseTo(still.root.position.z, 12);
  });
});

describe('the sources the hand tuner prints', () => {
  it('writes the three knife keyframes as the declarations they are', () => {
    const text = knifeSwingSource(KNIFE_SWING);
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toContain('const KNIFE_READY: KnifePose = { x: 0.28,');
    expect(text).toContain('const KNIFE_STRIKE: KnifePose = {');
    expect(text).toContain('roll: 48 };');
  });

  it('writes one row of the throws table, keyed and indented to drop into the file', () => {
    const { table, pinOut } = grenadeThrowFor('eq_frag');
    const text = grenadeThrowSource('eq_frag', table, pinOut);
    expect(text.startsWith('  eq_frag: {')).toBe(true);
    expect(text).toContain('    table: {');
    for (const key of ['ready', 'pull', 'windup', 'release']) expect(text).toContain(`      ${key}: {`);
    expect(text).toContain('    pinOut: {');
    expect(text.endsWith('  },')).toBe(true);
  });

  it('rounds to four places, because a slider produces more than anybody wants to read', () => {
    const text = knifeSwingSource({
      ready: { x: 0.123456789, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 },
      windup: KNIFE_SWING.windup,
      strike: KNIFE_SWING.strike,
    });
    expect(text).toContain('x: 0.1235,');
  });
});

describe('the shield', () => {
  it('poses nothing when the animator is not carrying one', () => {
    const anim = primed(fakeWeapon());
    expect(() => run(anim, {}, 1)).not.toThrow();
  });

  it('takes the weapon’s pose, with the plate’s own offset instead of the weapon’s', () => {
    const cfg = config({ idleAmplitude: 0 });
    // The carrier is a weapon with no offset row, so what separates the plate from it is
    // exactly the plate's own row — which is the bug this arrangement fixed.
    const model = fakeWeapon({ weaponId: 'ar_carbine' });
    const shield = fakeShield();
    const anim = primed(model);
    anim.setShield(shield);
    run(anim, {}, 1, cfg);
    const o = anim.shieldOffset;
    expect(shield.root.position.x).toBeCloseTo(model.root.position.x + o.position[0], 10);
    expect(shield.root.position.y).toBeCloseTo(model.root.position.y + o.position[1], 10);
    expect(shield.root.position.z).toBeCloseTo(model.root.position.z + o.position[2], 10);
  });

  it('reads its own row and not the weapon under it', () => {
    const anim = primed(fakeWeapon({ weaponId: 'pistol_talon' }));
    const before = [...anim.offset.position];
    anim.setShield(fakeShield());
    // Setting the shield must not disturb the carrier's own placement.
    expect([...anim.offset.position]).toEqual(before);
    expect(anim.shieldOffset.position).not.toEqual([0, 0, 0]);
  });


  /**
   * **A defect, pinned rather than fixed (C6, BACKLOG #57).**
   *
   * The base matrix the arms are solved against is one shared scratch, and `base` inside
   * `update` is a *reference* to it. A knife or a grenade posed later in the same frame
   * composes its own pose into that same object, so by the time the plate is posed the matrix
   * it is handed is the held item's and not the weapon's — the glove on the shield is solved
   * against wherever the grenade is. Carrying the riot shield and throwing a grenade is the
   * reachable case, because the streak gives you a sidearm and a throw is still allowed.
   *
   * R1 says a refactor unit may not change what this draws, so the sharing is kept exactly as
   * it is and this test is the record of it. See #57 for the fix and the decision it needs.
   */
  it('solves the plate’s glove against the grenade’s pose, not the weapon’s — see #57', () => {
    const cfg = config({ idleAmplitude: 0 });
    const model = fakeWeapon({ withHands: true });
    const shield = fakeShield(true);
    const grenade = fakeGrenade('eq_frag', true);
    const weaponRig = model.hands as unknown as RecordingHands;
    const plateRig = shield.hands as unknown as RecordingHands;
    const grenadeRig = grenade.hands as unknown as RecordingHands;
    const anim = primed(model);
    anim.setShield(shield);
    anim.setGrenade(grenade);
    run(anim, { throwing: true, throwCook: 0.17 }, 1, cfg);
    expect(plateRig.bases[0]).toEqual(grenadeRig.bases[0]);
    expect(plateRig.bases[0]).not.toEqual(weaponRig.bases[0]);
  });

  it('hands the plate’s glove the same base the weapon’s would have had', () => {
    const cfg = config({ idleAmplitude: 0 });
    const model = fakeWeapon({ withHands: true });
    const shield = fakeShield(true);
    const weaponRig = model.hands as unknown as RecordingHands;
    const plateRig = shield.hands as unknown as RecordingHands;
    const anim = primed(model);
    anim.setShield(shield);
    run(anim, {}, 1, cfg);
    expect(plateRig.bases).toEqual(weaponRig.bases);
  });
});

describe('the frame as a whole', () => {
  it('solves the arms against the pose before bob, sway, idle drift and the kick', () => {
    const cfg = config({ idleAmplitude: 0 });
    const quiet = fakeWeapon({ withHands: true });
    const busy = fakeWeapon({ withHands: true });
    const quietRig = quiet.hands as unknown as RecordingHands;
    const busyRig = busy.hands as unknown as RecordingHands;
    run(primed(quiet), {}, 1, cfg);
    run(primed(busy), { speed: 6.9, bobPhase: Math.PI / 2, visualPunch: 1, visualLateral: 1 }, 1, cfg);
    // The gun has moved; the pose the arms were solved against has not.
    expect(poseOf(busy).x).not.toBeCloseTo(poseOf(quiet).x, 6);
    expect(busyRig.bases[0]).toEqual(quietRig.bases[0]);
  });

  it('does carry the reload and the sprint into that pose, since the arms follow the weapon there', () => {
    const cfg = config({ idleAmplitude: 0 });
    const plain = fakeWeapon({ withHands: true });
    const sprinting = fakeWeapon({ withHands: true });
    const plainRig = plain.hands as unknown as RecordingHands;
    const sprintRig = sprinting.hands as unknown as RecordingHands;
    run(primed(plain), {}, 1, cfg);
    run(primed(sprinting), { raise: 0 }, 1, cfg);
    expect(sprintRig.bases[0]).not.toEqual(plainRig.bases[0]);
  });

  it('gives the arms exactly one base per frame', () => {
    const model = fakeWeapon({ withHands: true });
    const rig = model.hands as unknown as RecordingHands;
    run(primed(model), {}, 7);
    expect(rig.bases).toHaveLength(7);
  });
});
