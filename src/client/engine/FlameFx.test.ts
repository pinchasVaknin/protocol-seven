import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FlameFx } from './FlameFx';

/**
 * The flamethrower's jet, pinned before unit C4's refactor.
 *
 * The jet's whole design is that one tick of fuel becomes a *continuous* stream: twelve
 * particles are born at once and then each is advanced by a random slice of the tick it stands
 * for, so the metre after the nozzle is populated on every frame rather than every tenth of a
 * second. That spreading, the drag that bleeds the launch speed, and the splash where the jet
 * meets a wall are the three behaviours worth holding — none of them is visible in a screenshot
 * and all of them are arithmetic.
 *
 * Only the canvas behind the puff texture is faked; the instanced mesh is the real one.
 */

// ========================================== the fake ==========================================

function fakeCanvas(): Record<string, unknown> {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop: (): void => {} }),
      fillStyle: '',
      fillRect: (): void => {},
    }),
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).document = { createElement: () => fakeCanvas() };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
});

const camera = new THREE.PerspectiveCamera();

/** Where instance `i` sits, read off the real mesh. */
function positionAt(flame: FlameFx, index: number): THREE.Vector3 {
  const mesh = flame.group.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

function run(flame: FlameFx, seconds: number, step = 0.05): void {
  for (let i = 0; i < Math.ceil(seconds / step); i++) flame.update(step, camera);
}

// ======================================== the test cases ======================================

describe('FlameFx: what it builds', () => {
  it('is one group with one instanced mesh, like Fx', () => {
    const flame = new FlameFx();
    expect(flame.group.name).toBe('fx:flame');
    const meshes = flame.group.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes.length).toBe(1);
    expect((meshes[0] as THREE.InstancedMesh).frustumCulled).toBe(false);
  });

  it('starts with nothing alight', () => {
    expect(new FlameFx().activeParticles).toBe(0);
  });
});

describe('FlameFx: one tick of fuel', () => {
  it('is twelve particles', () => {
    const flame = new FlameFx();
    flame.emit(0, 2, 0, 0, 2, -8, false);
    expect(flame.activeParticles).toBe(12);
  });

  it('refuses a jet with nowhere to go', () => {
    const flame = new FlameFx();
    flame.emit(0, 2, 0, 0, 2, -0.01, false);
    expect(flame.activeParticles).toBe(0);
  });

  it('stacks ticks into a continuous stream', () => {
    const flame = new FlameFx();
    for (let i = 0; i < 8; i++) flame.emit(0, 2, 0, 0, 2, -8, false);
    expect(flame.activeParticles).toBe(96);
  });

  it('fills its pool and then stops', () => {
    const flame = new FlameFx();
    for (let i = 0; i < 80; i++) flame.emit(0, 2, 0, 0, 2, -8, false);
    expect(flame.activeParticles).toBe(720);
  });

  it('spreads the tick’s particles back across the interval it covers', () => {
    const flame = new FlameFx();
    flame.emit(0, 2, 0, 0, 2, -8, false);
    flame.update(0.001, camera);
    // Born together and advanced by their own slice of the tick, so no two are in one place.
    const along = new Set<string>();
    for (let i = 0; i < 12; i++) along.add(positionAt(flame, i).z.toFixed(4));
    expect(along.size).toBeGreaterThan(8);
  });

  it('starts every particle at the muzzle it was given', () => {
    const flame = new FlameFx();
    flame.emit(5, 3, 1, 5, 3, -7, false);
    flame.update(0.001, camera);
    // A tenth of a second at ten metres a second: still within a metre and a bit of the nozzle.
    for (let i = 0; i < 12; i++) {
      const p = positionAt(flame, i);
      expect(Math.hypot(p.x - 5, p.y - 3, p.z - 1)).toBeLessThan(2);
    }
  });
});

describe('FlameFx: how a particle travels', () => {
  it('runs out of fuel and goes out', () => {
    const flame = new FlameFx();
    flame.emit(0, 2, 0, 0, 2, -8, false);
    expect(flame.activeParticles).toBe(12);
    run(flame, 1.2);
    expect(flame.activeParticles).toBe(0);
  });

  it('travels down the jet', () => {
    const flame = new FlameFx();
    flame.emit(0, 2, 0, 0, 2, -8, false);
    flame.update(0.001, camera);
    const before = positionAt(flame, 0).z;
    run(flame, 0.25);
    expect(positionAt(flame, 0).z).toBeLessThan(before);
  });

  it('rises as it goes, because hot gas does', () => {
    const flame = new FlameFx();
    flame.emit(0, 2, 0, 0, 2, -8, false);
    flame.update(0.001, camera);
    const start = positionAt(flame, 0).y;
    run(flame, 0.4);
    expect(positionAt(flame, 0).y).toBeGreaterThan(start);
  });

  it('stops where the jet stopped rather than running through the wall', () => {
    const flame = new FlameFx();
    // A wall two metres out.
    flame.emit(0, 2, 0, 0, 2, -2, false);
    run(flame, 0.5);
    for (let i = 0; i < 12; i++) {
      // Nothing is further down the jet than the wall, give or take the splash's spread.
      expect(positionAt(flame, i).z).toBeGreaterThan(-3.2);
    }
  });

  it('burns out quickly once it has splashed', () => {
    const near = new FlameFx();
    const far = new FlameFx();
    near.emit(0, 2, 0, 0, 2, -1, false);
    far.emit(0, 2, 0, 0, 2, -9, false);
    run(near, 0.45);
    run(far, 0.45);
    // The jet that hit a wall a metre out is gone; the one with nine metres to run is not.
    expect(near.activeParticles).toBeLessThan(far.activeParticles);
  });
});

describe('FlameFx: the local player’s nozzle', () => {
  it('uses the event’s muzzle when the shot is somebody else’s', () => {
    const flame = new FlameFx();
    flame.emit(9, 1, 1, 9, 1, -7, false);
    flame.update(0.001, camera);
    expect(positionAt(flame, 0).x).toBeCloseTo(9, 0);
  });

  it('leaves the muzzle alone when no viewmodel has been handed over', () => {
    const flame = new FlameFx();
    flame.setLocalMuzzle(null, null);
    flame.emit(9, 1, 1, 9, 1, -7, false);
    flame.update(0.001, camera);
    // `localMuzzle` returns without touching the point when anything it needs is missing.
    expect(positionAt(flame, 0).x).toBeCloseTo(9, 0);
  });
});

describe('FlameFx: teardown', () => {
  it('empties the group', () => {
    const flame = new FlameFx();
    flame.emit(0, 2, 0, 0, 2, -8, false);
    flame.dispose();
    expect(flame.group.children.length).toBe(0);
  });
});
