import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { HandsBase, WeaponBasePose, makeViewmodelPose, type ViewmodelPose } from './WeaponBasePose';
import { makeViewmodelDrive, type ViewmodelDrive } from './ViewmodelDrive';
import { DEFAULT_VIEWMODEL_CONFIG, type ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { WeaponModel } from './WeaponMesh';

/**
 * Where the weapon sits before the player's own motion is added.
 *
 * `aim` is the half worth testing in isolation: it is pure, it has the sight-point arithmetic
 * that twelve weapons share one tuned number through, and reaching it through `update` meant
 * settling a damped follower first just to read a lerp.
 */

const DEG2RAD = Math.PI / 180;

function config(overrides: Partial<ViewmodelConfig> = {}): ViewmodelConfig {
  return { ...DEFAULT_VIEWMODEL_CONFIG, ...overrides };
}

function drive(overrides: Partial<ViewmodelDrive> = {}): ViewmodelDrive {
  return { ...makeViewmodelDrive(), ...overrides };
}

/** Only the six facts `aim` reads off a weapon. */
function weapon(options: Partial<WeaponModel> = {}): WeaponModel {
  return {
    sightPoint: new Vector3(0, 0.0915, 0),
    source: 'procedural',
    adsPitch: 0,
    adsSightDistance: 0.34,
    adsOffsetZ: 0,
    ...options,
  } as unknown as WeaponModel;
}

function aimed(model: WeaponModel, ads: number, cfg = config()): ViewmodelPose {
  const pose = makeViewmodelPose();
  new WeaponBasePose().aim(pose, model, cfg, ads);
  return pose;
}

describe('aim', () => {
  const cfg = config();

  it('is exactly the hip pose at nought', () => {
    expect(aimed(weapon(), 0)).toEqual({
      x: cfg.hipX,
      y: cfg.hipY,
      z: cfg.hipZ,
      pitch: cfg.hipPitch,
      yaw: cfg.hipYaw,
      roll: cfg.hipRoll,
    });
  });

  it('cancels the sight point’s own offset from the centre line', () => {
    const off = aimed(weapon({ sightPoint: new Vector3(0.013, 0.0915, 0) }), 1);
    expect(off.x).toBeCloseTo(-0.013, 12);
    // And the rotation is squared up: an aimed weapon points down the camera's axis.
    expect(off.yaw).toBe(0);
    expect(off.roll).toBe(0);
  });

  it('derives every weapon’s height from one tuned number and its own sight line', () => {
    const reference = aimed(weapon({ sightPoint: new Vector3(0, 0.0915, 0) }), 1);
    const tall = aimed(weapon({ sightPoint: new Vector3(0, 0.1415, 0) }), 1);
    const low = aimed(weapon({ sightPoint: new Vector3(0, 0.0415, 0) }), 1);
    expect(reference.y).toBeCloseTo(cfg.adsY, 12);
    expect(tall.y).toBeCloseTo(cfg.adsY - 0.05, 12);
    expect(low.y).toBeCloseTo(cfg.adsY + 0.05, 12);
  });

  it('carries the sight point through the weapon’s own cant before landing it', () => {
    const sight = new Vector3(0, 0.09, -0.06);
    const straight = aimed(weapon({ sightPoint: sight.clone() }), 1);
    const canted = aimed(weapon({ sightPoint: sight.clone(), adsPitch: 2 }), 1);
    // The turn is about the root's origin, so a sight above it moves in both Y and Z.
    const cos = Math.cos(2 * DEG2RAD);
    const sin = Math.sin(2 * DEG2RAD);
    expect(canted.y).toBeCloseTo(cfg.adsY - (sight.y * cos - sight.z * sin - 0.0915), 12);
    expect(canted.pitch).toBeCloseTo(2, 12);
    expect(canted.y).not.toBeCloseTo(straight.y, 9);
  });

  it('places a file by its sight distance and a primitive by its tuned Z', () => {
    const sight = new Vector3(0, 0.09, -0.06);
    const file = aimed(weapon({ source: 'glb', sightPoint: sight.clone(), adsSightDistance: 0.34 }), 1);
    const prim = aimed(weapon({ source: 'procedural', sightPoint: sight.clone(), adsOffsetZ: 0.02 }), 1);
    expect(file.z).toBeCloseTo(-0.34 - sight.z, 12);
    expect(prim.z).toBeCloseTo(cfg.adsZ + 0.02, 12);
  });

  it('is a straight blend between the two, so half way is half way', () => {
    const half = aimed(weapon(), 0.5);
    const hip = aimed(weapon(), 0);
    const full = aimed(weapon(), 1);
    for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll'] as const) {
      expect(half[key]).toBeCloseTo((hip[key] + full[key]) / 2, 12);
    }
  });

  it('follows the overshoot past 1, which is where the sight picture snaps up', () => {
    const over = aimed(weapon(), 1.14);
    const full = aimed(weapon(), 1);
    const hip = aimed(weapon(), 0);
    // Past the ADS pose, on the far side from the hip.
    expect(Math.sign(over.y - full.y)).toBe(Math.sign(full.y - hip.y));
  });
});

describe('lower', () => {
  const cfg = config();

  function lowered(d: Partial<ViewmodelDrive>, frames = 1): ViewmodelPose {
    const base = new WeaponBasePose();
    const pose = makeViewmodelPose();
    for (let i = 0; i < frames; i++) {
      base.aim(pose, weapon(), cfg, 0);
      base.lower(pose, drive(d), cfg, 1 / 120);
    }
    return pose;
  }

  it('leaves a ready weapon exactly where aim put it', () => {
    expect(lowered({ raise: 1, swapping: true, tacSprint: true, slide: true })).toEqual(aimed(weapon(), 0));
  });

  it('reaches the sprint pose at raise nought', () => {
    const pose = lowered({ raise: 0 });
    expect(pose.x).toBeCloseTo(cfg.sprintX, 12);
    expect(pose.yaw).toBeCloseTo(cfg.sprintYaw, 12);
  });

  it('stacks the tactical sprint and the slide onto the sprint pose, not onto each other', () => {
    const plain = lowered({ raise: 0 });
    const tac = lowered({ raise: 0, tacSprint: true });
    const slide = lowered({ raise: 0, slide: true });
    const both = lowered({ raise: 0, tacSprint: true, slide: true });
    expect(tac.y - plain.y).toBeCloseTo(cfg.tacSprintExtraY, 12);
    expect(slide.roll - plain.roll).toBeCloseTo(cfg.slideExtraRoll, 12);
    expect(both.y - plain.y).toBeCloseTo(cfg.tacSprintExtraY + cfg.slideExtraY, 12);
    // Each adds on its own axes and leaves the other's alone.
    expect(tac.roll).toBeCloseTo(plain.roll, 12);
    expect(slide.pitch).toBeCloseTo(plain.pitch, 12);
  });

  it('eases rather than slides, so the gun swings on its way down', () => {
    const half = lowered({ raise: 0.5 });
    const plain = lowered({ raise: 0 });
    const ready = lowered({ raise: 1 });
    // At half way the eased blend is exactly half, which is what `easeInOutQuad` is pinned at.
    expect(half.x).toBeCloseTo((ready.x + plain.x) / 2, 12);
  });

  it('prefers the swap pose to the sprint pose, whatever else the drive says', () => {
    const pose = lowered({ raise: 0, swapping: true, tacSprint: true, slide: true });
    expect(pose.x).toBeCloseTo(cfg.swapX, 12);
    expect(pose.y).toBeCloseTo(cfg.swapY, 12);
    expect(pose.yaw).toBeCloseTo(0, 12);
    expect(pose.roll).toBeCloseTo(cfg.swapRoll, 12);
  });

  it('lowers a throw through a follower, and takes the swap pose once it is under way', () => {
    const one = lowered({ throwing: true }, 1);
    const many = lowered({ throwing: true }, 400);
    expect(one.y).toBeGreaterThan(many.y);
    expect(many.y).toBeCloseTo(cfg.swapY, 4);
  });

  it('does not take the swap pose on the first frame of a throw, when the follower is nothing', () => {
    // Under the 0.01 threshold the throw is still a sprint-shaped lowering; this is the frame
    // the two poses would otherwise fight over.
    const base = new WeaponBasePose();
    const pose = makeViewmodelPose();
    base.aim(pose, weapon(), cfg, 0);
    base.lower(pose, drive({ throwing: true, raise: 0 }), cfg, 1 / 100000);
    expect(pose.x).toBeCloseTo(cfg.sprintX, 6);
  });

  it('comes back when the throw is over, and reset puts it back at once', () => {
    const base = new WeaponBasePose();
    const pose = makeViewmodelPose();
    for (let i = 0; i < 400; i++) {
      base.aim(pose, weapon(), cfg, 0);
      base.lower(pose, drive({ throwing: true }), cfg, 1 / 120);
    }
    base.reset();
    base.aim(pose, weapon(), cfg, 0);
    base.lower(pose, drive(), cfg, 1 / 120);
    expect(pose).toEqual(aimed(weapon(), 0));
  });
});

describe('HandsBase', () => {
  it('composes a pose into the matrix the arms are solved against', () => {
    const base = new HandsBase();
    const pose: ViewmodelPose = { x: 0.1, y: -0.2, z: -0.3, pitch: 0, yaw: 0, roll: 0 };
    const matrix = base.fromPose(pose, new Vector3(1, 1, 1));
    expect([matrix.elements[12], matrix.elements[13], matrix.elements[14]]).toEqual([0.1, -0.2, -0.3]);
  });

  it('hands back the same object every time, which is what makes the sharing visible', () => {
    const base = new HandsBase();
    const first = base.fromPose(makeViewmodelPose(), new Vector3(1, 1, 1));
    const node = new Object3D();
    node.position.set(5, 6, 7);
    const second = base.fromObject(node);
    expect(second).toBe(first);
    expect(second).toBe(base.matrix);
    // The second write overwrote the first, which is the shipped behaviour BACKLOG #57 is about.
    expect([second.elements[12], second.elements[13], second.elements[14]]).toEqual([5, 6, 7]);
  });

  it('carries the node’s own scale, so a frame’s inverse takes a knife’s scale back out', () => {
    const base = new HandsBase();
    const node = new Object3D();
    node.scale.set(2, 2, 2);
    const matrix = base.fromObject(node);
    expect(matrix.elements[0]).toBeCloseTo(2, 12);
  });
});
