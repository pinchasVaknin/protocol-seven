import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA_CONFIG, type CameraConfig } from '../player/CameraConfig';
import type { PlayerSnapshot } from '../../shared/player/PlayerState';
import type { ViewmodelLayer } from '../player/Viewmodel';
import { CameraRig, type CameraDrive } from './CameraRig';
import { ACTOR_INDICATOR_LAYER, SKY_LAYER } from './Renderer';

/**
 * The camera rig, pinned before unit C2's refactor.
 *
 * Nothing here needs a GL context: a `PerspectiveCamera` is maths and a few matrices, so the
 * whole class is reachable from `environment: 'node'` through its public surface — the camera it
 * owns, the `fov` it publishes, the `shake` channel, and the viewmodel it writes to.
 *
 * Every expected value is a literal rather than the formula recomputed in the test, because a
 * test that re-derives `damp` and `nearFor` would agree with any refactor of them. The numbers
 * below were taken off the unmodified code and are exact doubles: a reordered expression shows up
 * as a failure in the last digits, which is the only way a behaviour-preserving refactor of
 * floating-point composition can be checked at all.
 *
 * BACKLOG #34 is the reason the composition cases are this specific. The entry suspects a camera
 * that trembles while walking, and the one defect a refactor can silently *fix* by reordering two
 * assignments is a trembling camera — so what each additive layer contributes, and which clock it
 * is integrated against, is pinned here rather than eyeballed in the browser.
 */

// ====================================== the fixtures ==========================================

const RADIUS = 0.4;
const WIDE = 16 / 9;
const DT = 1 / 60;

function config(over: Partial<CameraConfig> = {}): CameraConfig {
  return { ...DEFAULT_CAMERA_CONFIG, ...over };
}

function snapshot(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    x: 0,
    y: 0,
    z: 0,
    eyeHeight: 0,
    bobPhase: 0,
    speed: 0,
    vy: 0,
    stance: 'STAND',
    grounded: true,
    slideRoll: 0,
    strafe: 0,
    ...over,
  };
}

function drive(over: Partial<CameraDrive> = {}): CameraDrive {
  return {
    sprint: false,
    tacSprint: false,
    slide: false,
    adsFraction: 0,
    adsFovScale: 1,
    adsViewmodelFovScale: 1,
    ...over,
  };
}

interface FakeViewmodel {
  readonly layer: ViewmodelLayer;
  readonly camera: THREE.PerspectiveCamera;
  /** Every FOV the rig asked for, in order. */
  readonly fovs: number[];
}

/** Enough of a `ViewmodelLayer` for the rig: a camera to copy onto and an FOV setter. */
function fakeViewmodel(): FakeViewmodel {
  const camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA_CONFIG.viewmodelFov, 1, 0.008, 6);
  const fovs: number[] = [];
  const layer = {
    camera,
    setFov: (fov: number): void => void fovs.push(fov),
  } as unknown as ViewmodelLayer;
  return { layer, camera, fovs };
}

/**
 * One update of a rig at rest, with everything the test does not care about held still.
 *
 * `prev` defaults to `curr`, so unless a case asks for interpolation there is nothing to
 * interpolate and the position is exactly the snapshot's.
 */
function step(
  rig: CameraRig,
  options: {
    cfg?: CameraConfig;
    prev?: PlayerSnapshot;
    curr?: PlayerSnapshot;
    alpha?: number;
    yaw?: number;
    pitch?: number;
    drive?: CameraDrive;
    dt?: number;
    viewmodel?: ViewmodelLayer | null;
  } = {},
): void {
  const curr = options.curr ?? snapshot();
  rig.update(
    options.prev ?? curr,
    curr,
    options.alpha ?? 0,
    options.yaw ?? 0,
    options.pitch ?? 0,
    options.drive ?? drive(),
    options.cfg ?? config(),
    options.dt ?? DT,
    options.viewmodel ?? null,
  );
}

// ================================= construction and the near plane ============================

describe('CameraRig: construction', () => {
  it('starts at the configured FOV, in the rotation order the view angles need', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    expect(rig.fov).toBe(90);
    expect(rig.camera.fov).toBe(90);
    expect(rig.camera.aspect).toBe(WIDE);
    expect(rig.camera.far).toBe(400);
    expect(rig.camera.rotation.order).toBe('YXZ');
  });

  it('is the one camera that sees the sky and the actor indicators', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    expect(rig.camera.layers.isEnabled(0)).toBe(true);
    expect(rig.camera.layers.isEnabled(SKY_LAYER)).toBe(true);
    expect(rig.camera.layers.isEnabled(ACTOR_INDICATOR_LAYER)).toBe(true);
    expect(rig.camera.layers.isEnabled(3)).toBe(false);
  });

  it('starts the shake channel at rest', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    expect(rig.shake.trauma).toBe(0);
  });
});

describe('CameraRig: the derived near plane', () => {
  it('caps the derived plane at the authored 0.12 at the default FOV', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    expect(rig.camera.near).toBe(0.12);
  });

  it('pulls the plane in at a wide FOV on a wide screen', () => {
    const rig = new CameraRig(config({ fov: 120 }), 21 / 9, RADIUS);
    expect(rig.camera.near).toBe(0.0672538245981366);
  });

  it('floors the plane rather than letting it reach zero', () => {
    const rig = new CameraRig(config({ fov: 179 }), 1, RADIUS);
    expect(rig.camera.near).toBe(0.01);
  });

  it('scales the plane with the capsule it was handed', () => {
    const rig = new CameraRig(config({ fov: 120 }), 21 / 9, 0.2);
    expect(rig.camera.near).toBe(0.028823067684915687);
  });

  it('moves the aspect and the plane together on a resize', () => {
    const rig = new CameraRig(config({ fov: 120 }), WIDE, RADIUS);
    expect(rig.camera.near).toBe(0.08648617610487715);
    rig.resize(21 / 9);
    expect(rig.camera.aspect).toBe(21 / 9);
    expect(rig.camera.near).toBe(0.0672538245981366);
  });

  it('treats a degenerate aspect as the 0.1 floor', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    rig.resize(0.1);
    const floored = rig.camera.near;
    rig.resize(0.000001);
    expect(rig.camera.near).toBe(floored);
  });
});

// ===================================== position and bob =======================================

describe('CameraRig: position', () => {
  it('interpolates position and eye height with alpha, and takes the angles raw', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, {
      prev: snapshot({ x: 0, y: 0, z: 0, eyeHeight: 1.4 }),
      curr: snapshot({ x: 2, y: 1, z: 4, eyeHeight: 1.6 }),
      alpha: 0.5,
      yaw: 0.3,
      pitch: -0.2,
    });
    expect(rig.camera.position.x).toBe(1);
    expect(rig.camera.position.y).toBe(2);
    expect(rig.camera.position.z).toBe(2);
    // The view angles are the one thing that is never interpolated — see the class JSDoc.
    expect(rig.camera.rotation.x).toBe(-0.2);
    expect(rig.camera.rotation.y).toBe(0.3);
  });

  it('adds both bob offsets at the reference walking speed', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    const walking = snapshot({ bobPhase: Math.PI / 4, speed: 6.9, eyeHeight: 1.6 });
    step(rig, { curr: walking });
    expect(rig.camera.position.y).toBe(1.6 + 0.032);
    expect(rig.camera.position.x).toBe(0.01470782104868019);
    expect(rig.camera.position.z).toBe(0);
  });

  it('swings the lateral bob around with the yaw', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { curr: snapshot({ bobPhase: Math.PI / 4, speed: 6.9 }), yaw: 0.7 });
    expect(rig.camera.position.x).toBe(0.011249162021061396);
    expect(rig.camera.position.z).toBe(-0.009475038460286583);
  });

  it('scales the bob with the speed ratio', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { curr: snapshot({ bobPhase: Math.PI / 4, speed: 3.45 }) });
    expect(rig.camera.position.y).toBe(0.016);
    expect(rig.camera.position.x).toBe(0.007353910524340095);
  });

  it('caps the bob at the reference speed rather than growing past it', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { curr: snapshot({ bobPhase: Math.PI / 4, speed: 13.8 }) });
    expect(rig.camera.position.y).toBe(0.032);
  });

  it('stops the bob the frame the player leaves the ground', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { curr: snapshot({ bobPhase: Math.PI / 4, speed: 6.9, eyeHeight: 1.6, grounded: false }) });
    expect(rig.camera.position.y).toBe(1.6);
    expect(rig.camera.position.x).toBe(0);
  });

  it('stops the bob while mantling, even though the feet are on something', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { curr: snapshot({ bobPhase: Math.PI / 4, speed: 6.9, eyeHeight: 1.6, stance: 'MANTLE' }) });
    expect(rig.camera.position.y).toBe(1.6);
  });
});

describe('CameraRig: the bob phase wrap', () => {
  it('interpolates the short way around when the phase has wrapped forwards', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, {
      prev: snapshot({ bobPhase: 0.2, speed: 6.9 }),
      curr: snapshot({ bobPhase: Math.PI * 2 - 0.2, speed: 6.9 }),
      alpha: 0.25,
    });
    // The short way lands on 0.1; a plain lerp would land on 1.67 and the bob would jump.
    expect(rig.camera.position.y).toBe(0.006357418585441954);
    expect(rig.camera.position.x).toBe(0.002076535066254024);
  });

  it('interpolates the short way around when the phase has wrapped backwards', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, {
      prev: snapshot({ bobPhase: Math.PI * 2 - 0.1, speed: 6.9 }),
      curr: snapshot({ bobPhase: 0.1, speed: 6.9 }),
      alpha: 0.25,
    });
    expect(rig.camera.position.y).toBe(-0.003194669332698505);
    expect(rig.camera.position.x).toBe(-0.0010395667208301107);
  });

  it('is a plain interpolation when the phase has not wrapped', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, {
      prev: snapshot({ bobPhase: 1, speed: 6.9 }),
      curr: snapshot({ bobPhase: 2, speed: 6.9 }),
      alpha: 0.25,
    });
    expect(rig.camera.position.y).toBe(0.019151108611326607);
    expect(rig.camera.position.x).toBe(0.019738880082596194);
  });
});

// ========================================== the FOV ===========================================

describe('CameraRig: the field of view', () => {
  it('sits still at the configured default', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig);
    expect(rig.fov).toBe(90);
    expect(rig.camera.fov).toBe(90);
  });

  it('widens for a sprint', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { drive: drive({ sprint: true }) });
    expect(rig.fov).toBe(90.69646011787471);
    expect(rig.camera.fov).toBe(90.69646011787471);
  });

  it('prefers the tac-sprint widening over the sprint one', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { drive: drive({ sprint: true, tacSprint: true }) });
    expect(rig.fov).toBe(91.53221225932437);
  });

  it('adds the slide widening on top of a tac sprint', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { drive: drive({ tacSprint: true, slide: true }) });
    expect(rig.fov).toBe(93.34300856579861);
  });

  it('scales the whole target by the weapon ADS scale', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { drive: drive({ adsFraction: 1, adsFovScale: 0.74 }) });
    expect(rig.fov).toBe(86.74056664834634);
  });

  it('clamps an ADS fraction above one', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { drive: drive({ adsFraction: 1.5, adsFovScale: 0.74 }) });
    expect(rig.fov).toBe(86.74056664834634);
  });

  it('clamps an ADS fraction below zero', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { drive: drive({ adsFraction: -0.5, adsFovScale: 0.74 }) });
    expect(rig.fov).toBe(90);
  });

  it('clamps a stalled frame to a thirtieth of a second', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { drive: drive({ sprint: true, tacSprint: true }), dt: 1 });
    expect(rig.fov).toBe(92.85099957250111);
  });

  it('follows the near plane along as the lens widens', () => {
    const rig = new CameraRig(config({ fov: 120 }), 21 / 9, RADIUS);
    expect(rig.camera.near).toBe(0.0672538245981366);
    step(rig, { cfg: config({ fov: 120 }), drive: drive({ tacSprint: true, slide: true }) });
    expect(rig.fov).toBe(123.34300856579861);
    expect(rig.camera.near).toBe(0.06303000592361127);
  });

  it('leaves the projection alone while the FOV has not moved', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    const near = rig.camera.near;
    step(rig);
    step(rig);
    expect(rig.camera.fov).toBe(90);
    expect(rig.camera.near).toBe(near);
  });

  it('pulls the viewmodel FOV in with the world FOV', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    const vm = fakeViewmodel();
    step(rig, { drive: drive({ adsFraction: 1, adsViewmodelFovScale: 0.9 }), viewmodel: vm.layer });
    step(rig, { drive: drive({ adsFraction: 0, adsViewmodelFovScale: 0.9 }), viewmodel: vm.layer });
    expect(vm.fovs).toEqual([58.5, 65]);
  });
});

// ======================================= roll and shake =======================================

describe('CameraRig: roll', () => {
  it('rolls against the strafe input, with the bob roll on top', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, { curr: snapshot({ bobPhase: Math.PI / 4, speed: 6.9, strafe: -1 }) });
    expect(rig.camera.rotation.z).toBe(0.002961566683536803);
  });

  it('uses the bigger slide roll while sliding', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, {
      curr: snapshot({ bobPhase: Math.PI / 4, speed: 6.9, strafe: -1 }),
      drive: drive({ slide: true }),
    });
    expect(rig.camera.rotation.z).toBe(0.011713542642870696);
  });

  it('interpolates the strafe authority with alpha', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    step(rig, {
      prev: snapshot({ strafe: -1 }),
      curr: snapshot({ strafe: 1 }),
      alpha: 0.5,
    });
    expect(rig.camera.rotation.z).toBe(0);
  });
});

describe('CameraRig: the shake channel', () => {
  it('adds the shake to all three angles rather than replacing them', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    rig.shake.add(1);
    step(rig, { yaw: 0.4, pitch: -0.1 });
    expect(rig.shake.trauma).toBeGreaterThan(0);
    expect(rig.camera.rotation.x).toBe(-0.1 + rig.shake.pitch);
    expect(rig.camera.rotation.y).toBe(0.4 + rig.shake.yaw);
    expect(rig.camera.rotation.z).toBe(rig.shake.roll);
    expect(rig.shake.pitch).not.toBe(0);
  });

  it('decays the shake on the same clamped clock as the rest of the rig', () => {
    const slow = new CameraRig(config(), WIDE, RADIUS);
    const fast = new CameraRig(config(), WIDE, RADIUS);
    slow.shake.add(1);
    fast.shake.add(1);
    // A whole second of stall is worth a thirtieth to the rig, so both lose the same trauma.
    step(slow, { dt: 1 });
    step(fast, { dt: 1 / 30 });
    expect(slow.shake.trauma).toBe(fast.shake.trauma);
  });
});

// ================================== the landing dip spring =====================================

describe('CameraRig: the landing dip', () => {
  it('ignores a step too soft to register', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    rig.applyLanding(config(), 0.24);
    step(rig);
    expect(rig.camera.position.y).toBe(0);
    expect(rig.shake.trauma).toBe(0);
  });

  it('dips the camera after a landing', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    rig.applyLanding(config(), 3);
    step(rig);
    expect(rig.camera.position.y).toBe(-0.0027906249999999997);
  });

  it('earns no shake from a step off a kerb', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    rig.applyLanding(config(), 3);
    expect(rig.shake.trauma).toBe(0);
  });

  it('earns shake from a hard landing, above the threshold only', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    rig.applyLanding(config(), 12);
    expect(rig.shake.trauma).toBe(0.35750000000000004);
  });

  it('caps the impact strength at the reference speed', () => {
    const atRef = new CameraRig(config(), WIDE, RADIUS);
    const beyond = new CameraRig(config(), WIDE, RADIUS);
    atRef.applyLanding(config(), 12);
    beyond.applyLanding(config(), 40);
    step(atRef);
    step(beyond);
    expect(beyond.camera.position.y).toBe(atRef.camera.position.y);
    expect(beyond.shake.trauma).toBe(atRef.shake.trauma);
  });

  it('clamps the dip at its configured maximum and kills the inward velocity', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    for (let i = 0; i < 30; i++) rig.applyLanding(config(), 12);
    step(rig);
    // Unclamped the spring would be a third of a metre down; the clamp is the authored 0.15.
    expect(rig.camera.position.y).toBe(-0.15);
    // Velocity zeroed, so the next frame is the spring pushing back out rather than deeper.
    step(rig);
    expect(rig.camera.position.y).toBe(-0.14604166666666665);
  });

  it('settles back to rest', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    rig.applyLanding(config(), 12);
    for (let i = 0; i < 600; i++) step(rig);
    expect(Math.abs(rig.camera.position.y)).toBeLessThan(1e-6);
  });
});

// ===================================== reset and viewmodel ====================================

describe('CameraRig: reset', () => {
  it('returns the FOV, the dip, the roll and the shake to rest', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    rig.applyLanding(config(), 12);
    step(rig, {
      curr: snapshot({ bobPhase: Math.PI / 4, speed: 6.9, strafe: -1 }),
      drive: drive({ tacSprint: true, slide: true }),
    });
    expect(rig.fov).not.toBe(90);

    rig.reset(config());
    expect(rig.fov).toBe(90);
    expect(rig.shake.trauma).toBe(0);

    step(rig);
    expect(rig.camera.position.y).toBe(0);
    expect(rig.camera.rotation.z).toBe(0);
  });
});

describe('CameraRig: the viewmodel camera', () => {
  it('copies the composed transform onto it', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    const vm = fakeViewmodel();
    step(rig, {
      curr: snapshot({ x: 3, y: 1, z: -2, eyeHeight: 1.6, bobPhase: Math.PI / 4, speed: 6.9, strafe: -1 }),
      yaw: 0.7,
      pitch: -0.3,
      viewmodel: vm.layer,
    });
    expect(vm.camera.position.x).toBe(rig.camera.position.x);
    expect(vm.camera.position.y).toBe(rig.camera.position.y);
    expect(vm.camera.position.z).toBe(rig.camera.position.z);
    expect(vm.camera.rotation.x).toBe(rig.camera.rotation.x);
    expect(vm.camera.rotation.y).toBe(rig.camera.rotation.y);
    expect(vm.camera.rotation.z).toBe(rig.camera.rotation.z);
    expect(vm.camera.rotation.order).toBe('YXZ');
  });

  it('runs a frame with no viewmodel at all', () => {
    const rig = new CameraRig(config(), WIDE, RADIUS);
    expect(() => step(rig, { viewmodel: null })).not.toThrow();
  });
});
