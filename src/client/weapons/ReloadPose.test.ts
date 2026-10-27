import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { ReloadPose } from './ReloadPose';
import { makeViewmodelPose, type ViewmodelPose } from './WeaponBasePose';
import { makeViewmodelDrive, type ViewmodelDrive } from './ViewmodelDrive';
import { DEFAULT_VIEWMODEL_CONFIG, type ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { WeaponModel } from './WeaponMesh';
import type { ViewmodelHands } from './ViewmodelHands';

/**
 * The reload's four moving things, read off a weapon directly rather than through a frame.
 *
 * The magazine's track is the part worth sweeping: it is five windows on one 0..1 line with
 * two different time tables behind it, and every boundary between them is a place a magazine
 * can jump. The sweeps below walk the whole line rather than sampling the middles.
 */

function config(overrides: Partial<ViewmodelConfig> = {}): ViewmodelConfig {
  return { ...DEFAULT_VIEWMODEL_CONFIG, ...overrides };
}

function drive(overrides: Partial<ViewmodelDrive> = {}): ViewmodelDrive {
  return { ...makeViewmodelDrive(), ...overrides };
}

interface Rig {
  magazineHold: number;
}

function weapon(options: { source?: 'glb' | 'procedural'; exit?: Vector3; hand?: boolean; rig?: boolean } = {}): WeaponModel {
  const rig: Rig | null = options.rig === true ? { magazineHold: 0 } : null;
  return {
    magazine: new Object3D(),
    chargingHandle: new Object3D(),
    supportHand: options.hand === true ? new Object3D() : null,
    hands: rig as unknown as ViewmodelHands | null,
    magazineExit: options.exit ?? new Vector3(0, -1, 0),
    source: options.source ?? 'procedural',
  } as unknown as WeaponModel;
}

/** One frame of a reload at `f`, on a fresh pose. */
function at(f: number, model: WeaponModel, empty = false, cfg = config()): ViewmodelPose {
  const pose = makeViewmodelPose();
  new ReloadPose().apply(pose, model, drive({ reloading: true, reloadEmpty: empty, reloadFraction: f }), cfg);
  return pose;
}

describe('the rest state', () => {
  it('puts all four back, because the last frame may have left them anywhere', () => {
    const model = weapon({ hand: true, rig: true });
    model.magazine.position.set(1, 2, 3);
    model.magazine.rotation.set(1, 2, 3);
    model.chargingHandle.position.set(4, 5, 6);
    model.supportHand?.position.set(7, 8, 9);
    (model.hands as unknown as Rig).magazineHold = 1;

    const pose = makeViewmodelPose();
    new ReloadPose().apply(pose, model, drive(), config());
    expect(model.magazine.position.toArray()).toEqual([0, 0, 0]);
    expect(model.chargingHandle.position.toArray()).toEqual([0, 0, 0]);
    expect(model.supportHand?.position.toArray()).toEqual([0, 0, 0]);
    expect((model.hands as unknown as Rig).magazineHold).toBe(0);
    // And it adds nothing to the pose.
    expect(pose).toEqual(makeViewmodelPose());
  });
});

describe('the weapon’s own displacement', () => {
  it('is nothing at both ends of the reload, so it comes on and goes off', () => {
    const model = weapon();
    expect(at(0, model)).toEqual(makeViewmodelPose());
    expect(at(1, model)).toEqual(makeViewmodelPose());
  });

  it('tips a file up and a primitive down — opposite ways, deliberately', () => {
    const prim = at(0.4, weapon({ source: 'procedural' }));
    const file = at(0.4, weapon({ source: 'glb' }));
    // The pitch is the difference that matters: a file turns its muzzle toward the sky and
    // brings the well into the middle of the picture, where a primitive drops out of frame.
    expect(file.pitch).toBeGreaterThan(0);
    expect(prim.pitch).toBeLessThan(0);
    // Both sink a little, but a file sinks a quarter as far, and it draws in toward the eye.
    expect(prim.y).toBeLessThan(file.y);
    expect(file.y).toBeLessThan(0);
    expect(file.z).toBeGreaterThan(0);
  });

  it('rolls a file toward whichever side its well is on', () => {
    const under = at(0.4, weapon({ source: 'glb', exit: new Vector3(0, -1, 0) }));
    const onTop = at(0.4, weapon({ source: 'glb', exit: new Vector3(0, 1, 0) }));
    expect(Math.sign(under.roll)).toBe(-Math.sign(onTop.roll));
    expect(Math.abs(under.roll)).toBeCloseTo(Math.abs(onTop.roll), 12);
  });

  it('never jumps: the whole track is continuous on both time tables', () => {
    for (const empty of [false, true]) {
      for (const source of ['glb', 'procedural'] as const) {
        const model = weapon({ source });
        let previous = at(0, model, empty);
        for (let i = 1; i <= 400; i++) {
          const now = at(i / 400, model, empty);
          for (const key of ['x', 'y', 'z'] as const) expect(Math.abs(now[key] - previous[key])).toBeLessThan(0.01);
          for (const key of ['pitch', 'yaw', 'roll'] as const) expect(Math.abs(now[key] - previous[key])).toBeLessThan(2);
          previous = now;
        }
      }
    }
  });
});

describe('the magazine', () => {
  it('leaves the well, hangs out, comes back and seats, in that order', () => {
    const model = weapon();
    const depth = (f: number): number => {
      at(f, model);
      return -model.magazine.position.y;
    };
    // `TACTICAL_TIMES`: down 0.17, out 0.36, in 0.5, seated 0.66.
    expect(depth(0.1)).toBe(0);
    expect(depth(0.25)).toBeGreaterThan(0);
    expect(depth(0.4)).toBeCloseTo(DEFAULT_VIEWMODEL_CONFIG.magThrow, 12);
    expect(depth(0.45)).toBeCloseTo(DEFAULT_VIEWMODEL_CONFIG.magThrow, 12);
    expect(depth(0.58)).toBeLessThan(DEFAULT_VIEWMODEL_CONFIG.magThrow);
    expect(depth(0.7)).toBe(0);
    // Monotone down and monotone back up, with no wobble on the way.
    let previous = 0;
    for (let i = 0; i <= 36; i++) {
      const now = depth(0.17 + (i / 36) * (0.36 - 0.17));
      expect(now).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = now;
    }
  });

  it('runs on the empty table when the reload is an empty one', () => {
    const model = weapon();
    const tactical = (f: number): number => {
      at(f, model, false);
      return model.magazine.position.y;
    };
    const empty = (f: number): number => {
      at(f, model, true);
      return model.magazine.position.y;
    };
    // The empty track is earlier throughout its first half: `down` 0.15 against 0.17.
    expect(empty(0.16)).toBeLessThan(0);
    expect(Math.abs(tactical(0.16))).toBe(0);
    expect(empty(0.55)).not.toBeCloseTo(tactical(0.55), 6);
  });

  it('tumbles a magazine that falls and slides one that lifts off the receiver', () => {
    const falls = weapon({ source: 'glb', exit: new Vector3(0, -1, 0) });
    const lifts = weapon({ source: 'glb', exit: new Vector3(0, 1, 0) });
    at(0.4, falls);
    at(0.4, lifts);
    expect(falls.magazine.rotation.x).toBeGreaterThan(0);
    expect(falls.magazine.rotation.z).toBeCloseTo(falls.magazine.rotation.x * 0.4, 12);
    expect(lifts.magazine.rotation.x).toBe(0);
    expect(lifts.magazine.rotation.z).toBe(0);
  });

  it('travels a hand’s length on a file and the tuned distance on a primitive', () => {
    const file = weapon({ source: 'glb', exit: new Vector3(0, -1, 0) });
    const slides = weapon({ source: 'glb', exit: new Vector3(0, 1, 0) });
    const prim = weapon({ source: 'procedural' });
    at(0.4, file);
    at(0.4, slides);
    at(0.4, prim);
    expect(Math.abs(file.magazine.position.y)).toBeCloseTo(0.13, 12);
    expect(Math.abs(slides.magazine.position.y)).toBeCloseTo(0.09, 12);
    expect(Math.abs(prim.magazine.position.y)).toBeCloseTo(DEFAULT_VIEWMODEL_CONFIG.magThrow, 12);
  });

  it('leaves along the weapon’s own exit direction, not simply downward', () => {
    const sideways = weapon({ source: 'procedural', exit: new Vector3(1, 0, 0) });
    at(0.4, sideways);
    expect(sideways.magazine.position.x).toBeCloseTo(DEFAULT_VIEWMODEL_CONFIG.magThrow, 12);
    expect(sideways.magazine.position.y).toBe(0);
  });
});

describe('the support hand', () => {
  it('rides out with the magazine and comes back, when there is an arm rig', () => {
    const model = weapon({ rig: true });
    const rig = model.hands as unknown as Rig;
    const hold = (f: number): number => {
      at(f, model);
      return rig.magazineHold;
    };
    expect(hold(0)).toBe(0);
    expect(hold(0.1)).toBeGreaterThan(0);
    expect(hold(0.4)).toBe(1);
    expect(hold(0.72)).toBeGreaterThan(0);
    expect(hold(0.9)).toBe(0);
  });

  it('moves a box glove by the magazine’s own displacement plus the grip offset', () => {
    const model = weapon({ hand: true });
    at(0.4, model);
    const hand = model.supportHand as Object3D;
    expect(hand.position.x).toBeCloseTo(model.magazine.position.x + 0.02, 12);
    expect(hand.position.y).toBeCloseTo(model.magazine.position.y - 0.055, 12);
    expect(hand.position.z).toBeCloseTo(model.magazine.position.z + 0.02, 12);
  });

  it('puts a box glove home rather than at the offset when the blend is nothing', () => {
    const model = weapon({ hand: true });
    at(0, model);
    expect((model.supportHand as Object3D).position.toArray()).toEqual([0, 0, 0]);
  });

  it('leaves the box glove alone when the arm rig is doing the work', () => {
    const model = weapon({ hand: true, rig: true });
    at(0.4, model);
    expect((model.supportHand as Object3D).position.toArray()).toEqual([0, 0, 0]);
    expect((model.hands as unknown as Rig).magazineHold).toBe(1);
  });
});

describe('the charging handle', () => {
  it('stays home for a tactical reload, because there is nothing to chamber', () => {
    const model = weapon();
    for (let i = 0; i <= 100; i++) {
      at(i / 100, model, false);
      expect(model.chargingHandle.position.z).toBe(0);
    }
  });

  it('is drawn and then snaps, rather than being eased back', () => {
    const model = weapon();
    const pull = (f: number): number => {
      at(f, model, true);
      return model.chargingHandle.position.z;
    };
    const throwLength = DEFAULT_VIEWMODEL_CONFIG.chargeThrow;
    expect(pull(0.67)).toBe(0);
    expect(pull(0.72)).toBeGreaterThan(0);
    expect(pull(0.75)).toBeCloseTo(throwLength, 12);
    // A third of the way back it is already most of the way home: that is the snap.
    expect(pull(0.79)).toBeLessThan(throwLength * 0.4);
    expect(pull(0.82)).toBe(0);
    expect(pull(1)).toBe(0);
  });

  it('only ever moves along the receiver', () => {
    const model = weapon();
    at(0.74, model, true);
    expect(model.chargingHandle.position.x).toBe(0);
    expect(model.chargingHandle.position.y).toBe(0);
  });
});
