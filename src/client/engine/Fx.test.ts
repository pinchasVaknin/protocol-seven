import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fx } from './Fx';

/**
 * Shot feedback, pinned before unit C4's refactor.
 *
 * Everything here is a fixed pool, so the behaviour worth holding is what happens at the edges
 * of those pools and which of the four effects a given call produces. The meshes are the real
 * `InstancedMesh`, so the counters are the real ones; only the canvas behind the decal texture
 * is faked.
 *
 * The decal veto gets its own group. It is the one rule in this file that refuses to draw
 * something, and its JSDoc is explicit that it refuses the hole *and nothing else* — a test is
 * the only thing that keeps the sparks from being swept up with it later.
 */

// ========================================== the fake ==========================================

function fakeCanvas(): Record<string, unknown> {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop: (): void => {} }),
      fillStyle: '',
      beginPath: (): void => {},
      arc: (): void => {},
      fill: (): void => {},
      fillRect: (): void => {},
      save: (): void => {},
      restore: (): void => {},
      translate: (): void => {},
      rotate: (): void => {},
      globalCompositeOperation: '',
    }),
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).document = { createElement: () => fakeCanvas() };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
});

/** Age everything out: `update` clamps a step to a twentieth of a second. */
function settle(fx: Fx, seconds = 2): void {
  for (let i = 0; i < Math.ceil(seconds / 0.05); i++) fx.update(0.05);
}

// ======================================== the test cases ======================================

describe('Fx: what it builds', () => {
  it('is one group with an instanced mesh per effect class and one reused light', () => {
    const fx = new Fx(4);
    expect(fx.group.name).toBe('fx');
    const instanced = fx.group.children.filter((c) => c instanceof THREE.InstancedMesh);
    const lights = fx.group.children.filter((c) => c instanceof THREE.PointLight);
    expect(instanced.length).toBe(4);
    expect(lights.length).toBe(1);
    for (const mesh of instanced) expect(mesh.frustumCulled).toBe(false);
  });

  it('starts every pool empty', () => {
    const fx = new Fx(4);
    expect(fx.activeTracers).toBe(0);
    expect(fx.activeParticles).toBe(0);
    expect(fx.decals).toBe(0);
  });

  it('carries the decal field’s derived capacity', () => {
    expect(new Fx(4).decalCapacity).toBe(376);
  });
});

describe('Fx: tracers', () => {
  it('draws one for a shot worth drawing', () => {
    const fx = new Fx(4);
    fx.spawnTracer(0, 2, 0, 0, 2, -40);
    expect(fx.activeTracers).toBe(1);
  });

  it('refuses a shot too short to read as a streak', () => {
    const fx = new Fx(4);
    fx.spawnTracer(0, 2, 0, 0, 2, -0.1);
    expect(fx.activeTracers).toBe(0);
  });

  it('fills its pool and then quietly drops the rest', () => {
    const fx = new Fx(4);
    for (let i = 0; i < 24; i++) fx.spawnTracer(0, 2, 0, 0, 2, -40);
    expect(fx.activeTracers).toBe(24);
    fx.spawnTracer(0, 2, 0, 0, 2, -40);
    expect(fx.activeTracers).toBe(24);
  });

  it('retires a tracer once it has run past its target', () => {
    const fx = new Fx(4);
    fx.spawnTracer(0, 2, 0, 0, 2, -5);
    expect(fx.activeTracers).toBe(1);
    settle(fx);
    expect(fx.activeTracers).toBe(0);
  });
});

describe('Fx: impacts', () => {
  it('throws debris and leaves one hole', () => {
    const fx = new Fx(4);
    fx.spawnImpact(1, 2, -3, 0, 0, 1, 0, false);
    expect(fx.activeParticles).toBe(8);
    expect(fx.decals).toBe(1);
  });

  it('throws less of everything through a penetration', () => {
    const full = new Fx(4);
    const through = new Fx(4);
    full.spawnImpact(0, 0, 0, 0, 0, 1, 0, false);
    through.spawnImpact(0, 0, 0, 0, 0, 1, 0, true);
    expect(through.activeParticles).toBeLessThan(full.activeParticles);
    // The hole is still placed; it is only weaker.
    expect(through.decals).toBe(1);
  });

  it('colours the burst by the surface it hit', () => {
    const a = new Fx(4);
    const b = new Fx(4);
    a.spawnImpact(0, 0, 0, 0, 0, 1, 0, false);
    b.spawnImpact(0, 0, 0, 0, 0, 1, 3, false);
    // Different materials throw different numbers of sparks against dust.
    expect(a.activeParticles).not.toBe(b.activeParticles);
  });

  it('ages the debris out and leaves the hole behind', () => {
    const fx = new Fx(4);
    fx.spawnImpact(0, 0, 0, 0, 0, 1, 0, false);
    settle(fx);
    expect(fx.activeParticles).toBe(0);
    expect(fx.decals).toBe(1);
  });

  it('recycles decal slots rather than growing past the cap', () => {
    const fx = new Fx(4);
    for (let i = 0; i < fx.decalCapacity + 40; i++) fx.spawnImpact(i, 0, 0, 0, 0, 1, 0, false);
    expect(fx.decals).toBe(fx.decalCapacity);
  });
});

describe('Fx: a hit on a body', () => {
  it('is a short puff and never a hole', () => {
    const fx = new Fx(4);
    fx.spawnHitPuff(1, 2, -3, 0, 0, 1);
    expect(fx.activeParticles).toBe(5);
    expect(fx.decals).toBe(0);
  });
});

describe('Fx: the decal veto', () => {
  it('refuses the hole', () => {
    const fx = new Fx(4);
    fx.decalVeto = () => true;
    fx.spawnImpact(1, 2, -3, 0, 0, 1, 0, false);
    expect(fx.decals).toBe(0);
  });

  it('keeps the sparks and the dust, which is the whole point of it', () => {
    const open = new Fx(4);
    const vetoed = new Fx(4);
    open.spawnImpact(1, 2, -3, 0, 0, 1, 0, false);
    vetoed.decalVeto = () => true;
    vetoed.spawnImpact(1, 2, -3, 0, 0, 1, 0, false);
    expect(vetoed.activeParticles).toBe(open.activeParticles);
    expect(vetoed.decals).toBe(0);
    expect(open.decals).toBe(1);
  });

  it('is asked about the point the round stopped at', () => {
    const fx = new Fx(4);
    const asked: number[][] = [];
    fx.decalVeto = (x, y, z) => {
      asked.push([x, y, z]);
      return false;
    };
    fx.spawnImpact(4, 5, 6, 0, 0, 1, 0, false);
    expect(asked).toEqual([[4, 5, 6]]);
    expect(fx.decals).toBe(1);
  });

  it('places the hole again once the veto is taken away', () => {
    const fx = new Fx(4);
    fx.decalVeto = () => true;
    fx.spawnImpact(0, 0, 0, 0, 0, 1, 0, false);
    expect(fx.decals).toBe(0);
    fx.decalVeto = null;
    fx.spawnImpact(0, 0, 0, 0, 0, 1, 0, false);
    expect(fx.decals).toBe(1);
  });
});

describe('Fx: the muzzle flash, which is two things on two timers', () => {
  function light(fx: Fx): THREE.PointLight {
    return fx.group.children.find((c) => c instanceof THREE.PointLight) as THREE.PointLight;
  }

  it('lights the world wherever the shot came from', () => {
    const fx = new Fx(4);
    fx.fireMuzzleFlash(3, 1, -2, 1, false);
    fx.update(0.001);
    expect(light(fx).position.toArray()).toEqual([3, 1, -2]);
    expect(light(fx).intensity).toBeGreaterThan(0);
  });

  it('does not flash the player’s own gun for somebody else’s shot', () => {
    const fx = new Fx(4);
    const parent = new THREE.Object3D();
    fx.attachMuzzle(parent);
    const mesh = parent.children[0] as THREE.Mesh;
    fx.fireMuzzleFlash(3, 1, -2, 1, false);
    fx.update(0.001);
    expect(mesh.visible).toBe(false);
    expect(light(fx).intensity).toBeGreaterThan(0);
  });

  it('flashes the gun for the local player’s own shot', () => {
    const fx = new Fx(4);
    const parent = new THREE.Object3D();
    fx.attachMuzzle(parent);
    const mesh = parent.children[0] as THREE.Mesh;
    fx.fireMuzzleFlash(0, 0, 0, 1, true);
    fx.update(0.001);
    expect(mesh.visible).toBe(true);
  });

  it('scales the light with the weapon', () => {
    const small = new Fx(4);
    const big = new Fx(4);
    small.fireMuzzleFlash(0, 0, 0, 0.5, false);
    big.fireMuzzleFlash(0, 0, 0, 2, false);
    small.update(0.001);
    big.update(0.001);
    expect(big.group.children.filter((c) => c instanceof THREE.PointLight)[0]).toBeDefined();
    expect(light(big).intensity).toBeGreaterThan(light(small).intensity);
  });

  it('puts both out again', () => {
    const fx = new Fx(4);
    const parent = new THREE.Object3D();
    fx.attachMuzzle(parent);
    fx.fireMuzzleFlash(0, 0, 0, 1, true);
    settle(fx, 0.5);
    expect(light(fx).intensity).toBe(0);
    expect((parent.children[0] as THREE.Mesh).visible).toBe(false);
  });
});

describe('Fx: the muzzle mesh', () => {
  it('is built once and re-parented when the weapon model is rebuilt', () => {
    const fx = new Fx(4);
    const first = new THREE.Object3D();
    const second = new THREE.Object3D();
    fx.attachMuzzle(first);
    const mesh = first.children[0];
    fx.attachMuzzle(second);
    expect(second.children[0]).toBe(mesh);
    expect(first.children.length).toBe(0);
  });

  it('does nothing on a second call for the same parent', () => {
    const fx = new Fx(4);
    const parent = new THREE.Object3D();
    fx.attachMuzzle(parent);
    fx.attachMuzzle(parent);
    expect(parent.children.length).toBe(1);
  });

  it('starts hidden', () => {
    const fx = new Fx(4);
    const parent = new THREE.Object3D();
    fx.attachMuzzle(parent);
    expect((parent.children[0] as THREE.Mesh).visible).toBe(false);
  });
});

describe('Fx: teardown', () => {
  it('disposes everything it made and empties the group', () => {
    const fx = new Fx(4);
    fx.attachMuzzle(new THREE.Object3D());
    fx.dispose();
    expect(fx.group.children.length).toBe(0);
  });
});
