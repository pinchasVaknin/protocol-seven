import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { equipmentDef, type EquipmentId } from '../../shared/equipment/EquipmentDefs';
import { DEFAULT_EQUIPMENT_CONFIG } from '../../shared/equipment/EquipmentConfig';
import { ProjectilePool, type Projectile } from '../../shared/equipment/Projectile';
import { SmokeField } from '../../shared/equipment/SmokeField';
import { EquipmentFx } from './EquipmentFx';

/**
 * Everything here is three.js plus one 64px canvas for the smoke puff, so the only stub needed
 * is a `document` whose context records gradient stops.
 *
 * The projectiles are spawned into a real `ProjectilePool` and then posed by hand: the renderer
 * reads a position, a yaw and two flags off each one, and a real `ProjectilePool.step` would
 * need a `CollisionWorld` that has nothing to do with what is drawn.
 */

function installCanvas(): void {
  const ctx: Record<string, unknown> = {};
  for (const op of ['fillRect', 'clearRect', 'beginPath', 'fill', 'stroke']) {
    ctx[op] = (): undefined => undefined;
  }
  ctx['createRadialGradient'] = (): unknown => ({ addColorStop: (): undefined => undefined });
  (globalThis as Record<string, unknown>)['document'] = {
    createElement: (): unknown => {
      const canvas: Record<string, unknown> = { width: 0, height: 0 };
      ctx['canvas'] = canvas;
      canvas['getContext'] = (): unknown => ctx;
      return canvas;
    },
  };
}

const DT = 1 / 60;

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
  cam.position.set(0, 1.6, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

/** The pool slots the renderer draws into, in the order it fills them. */
function bodies(fx: EquipmentFx): THREE.Object3D[] {
  return fx.group.children.filter((c) => c.name.startsWith('equipment:body:'));
}

/** The smoke clouds: the unnamed groups between the bodies and the blasts. */
function clouds(fx: EquipmentFx): THREE.Object3D[] {
  return fx.group.children.filter((c) => c.type === 'Group' && c.name === '');
}

function blasts(fx: EquipmentFx): THREE.Object3D[] {
  return fx.group.children.filter((c) => c.type === 'Mesh');
}

function light(fx: EquipmentFx): THREE.PointLight {
  return fx.group.children.find((c) => c.type === 'PointLight') as THREE.PointLight;
}

function spawnOne(pool: ProjectilePool, id: EquipmentId): Projectile {
  const p = pool.spawn(equipmentDef(id), 1, 'A', 0, 1, -3, 0, 0, 0, 5);
  if (p === null) throw new Error('the pool refused a spawn');
  return p;
}

beforeAll(() => {
  installCanvas();
});

let fx: EquipmentFx;
let pool: ProjectilePool;
let field: SmokeField;

beforeEach(() => {
  fx = new EquipmentFx(4, 3, null);
  pool = new ProjectilePool(4, equipmentDef('frag'));
  field = new SmokeField(3, DEFAULT_EQUIPMENT_CONFIG);
});

describe('EquipmentFx construction', () => {
  it('names its group and builds one slot per projectile', () => {
    expect(fx.group.name).toBe('equipment-fx');
    expect(bodies(fx)).toHaveLength(4);
    expect(bodies(fx).map((b) => b.name)).toEqual([
      'equipment:body:0',
      'equipment:body:1',
      'equipment:body:2',
      'equipment:body:3',
    ]);
  });

  it('starts every body hidden, each holding one shadow-casting primitive', () => {
    for (const body of bodies(fx)) {
      expect(body.visible).toBe(false);
      expect(body.children).toHaveLength(1);
      expect(body.children[0]?.castShadow).toBe(true);
    }
  });

  it('builds one cloud per smoke volume, each with eleven puffs', () => {
    expect(clouds(fx)).toHaveLength(3);
    for (const cloud of clouds(fx)) {
      expect(cloud.visible).toBe(false);
      expect(cloud.children).toHaveLength(11);
      for (const puff of cloud.children) expect(puff.renderOrder).toBe(3);
    }
  });

  it('gives every puff its own material, so a cloud does not fade as one sheet', () => {
    const materials = clouds(fx).flatMap((c) => c.children.map((p) => (p as THREE.Mesh).material));
    expect(new Set(materials).size).toBe(33);
  });

  it('shares one plane geometry across every puff', () => {
    const geometries = clouds(fx).flatMap((c) => c.children.map((p) => (p as THREE.Mesh).geometry));
    expect(new Set(geometries).size).toBe(1);
  });

  it('builds a fixed pool of six blast shells, hidden and transparent', () => {
    expect(blasts(fx)).toHaveLength(6);
    for (const blast of blasts(fx)) {
      expect(blast.visible).toBe(false);
      const mat = (blast as THREE.Mesh).material as THREE.MeshBasicMaterial;
      expect(mat.opacity).toBe(0);
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
  });

  it('leaves the shared light in the scene at zero intensity, never hidden', () => {
    const point = light(fx);
    expect(point).toBeDefined();
    expect(point.intensity).toBe(0);
    expect(point.visible).toBe(true);
    expect(point.distance).toBe(26);
    expect(point.decay).toBe(2);
  });

  it('seeds the puff spread deterministically: two instances agree', () => {
    const other = new EquipmentFx(4, 3, null);
    fx.update(pool, field, 1, DT, camera(), 0);
    other.update(pool, field, 1, DT, camera(), 0);
    const volume = field.spawn(0, 0, -5, 4, 6, 1);
    expect(volume).not.toBeNull();
    for (let i = 0; i < 60; i++) field.step();
    const cam = camera();
    fx.update(pool, field, 1, DT, cam, 1);
    other.update(pool, field, 1, DT, cam, 1);
    const a = clouds(fx)[0]?.children.map((p) => p.position.toArray().join(','));
    const b = clouds(other)[0]?.children.map((p) => p.position.toArray().join(','));
    expect(b).toEqual(a);
  });

  it('clusters the first third of the puffs nearer the middle', () => {
    const volume = field.spawn(0, 0, -5, 4, 6, 1);
    expect(volume).not.toBeNull();
    for (let i = 0; i < 90; i++) field.step();
    fx.update(pool, field, 1, DT, camera(), 1);
    const puffs = clouds(fx)[0]?.children ?? [];
    const core = puffs.slice(0, 3).map((p) => Math.hypot(p.position.x, p.position.z));
    const shell = puffs.slice(4).map((p) => Math.hypot(p.position.x, p.position.z));
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(core)).toBeLessThan(mean(shell));
  });
});

describe('EquipmentFx bodies', () => {
  it('draws one body per live projectile and hides the rest', () => {
    spawnOne(pool, 'frag');
    spawnOne(pool, 'semtex');
    fx.update(pool, field, 1, DT, camera(), 0);
    const drawn = bodies(fx);
    expect(drawn[0]?.visible).toBe(true);
    expect(drawn[1]?.visible).toBe(true);
    expect(drawn[2]?.visible).toBe(false);
    expect(drawn[3]?.visible).toBe(false);
  });

  it('interpolates between the two sim poses', () => {
    const p = spawnOne(pool, 'frag');
    p.px = 0;
    p.py = 0;
    p.pz = 0;
    p.x = 4;
    p.y = 2;
    p.z = -8;
    for (const [alpha, expected] of [[0, 0], [0.5, 2], [1, 4]] as const) {
      fx.update(pool, field, alpha, DT, camera(), 0);
      expect(bodies(fx)[0]?.position.x).toBeCloseTo(expected, 10);
    }
  });

  it('swaps the primitive geometry and material to match the kind', () => {
    const p = spawnOne(pool, 'frag');
    const seen = new Map<string, string>();
    for (const id of ['frag', 'semtex', 'flashbang', 'smoke', 'claymore'] as EquipmentId[]) {
      p.def = equipmentDef(id);
      fx.update(pool, field, 1, DT, camera(), 0);
      const mesh = bodies(fx)[0]?.children[0] as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      seen.set(id, `${mat.color.getHexString()}/${String(mesh.geometry.attributes['position']?.count)}`);
    }
    expect(seen.get('semtex')).toContain('8a6a2a');
    expect(seen.get('flashbang')).toBe(seen.get('smoke'));
    expect(seen.get('frag')).toContain('4d5a4a');
    expect(seen.get('claymore')).toContain('4d5a4a');
    expect(seen.get('frag')).not.toBe(seen.get('claymore'));
  });

  it('spins a tumbling projectile off the clock and holds a resting one', () => {
    const p = spawnOne(pool, 'frag');
    p.resting = false;
    fx.update(pool, field, 1, DT, camera(), 1);
    const spun = bodies(fx)[0]?.rotation.clone();
    fx.update(pool, field, 1, DT, camera(), 2);
    expect(bodies(fx)[0]?.rotation.y).not.toBeCloseTo(spun?.y ?? 0, 6);

    p.resting = true;
    p.yaw = 0.8;
    fx.update(pool, field, 1, DT, camera(), 3);
    expect(bodies(fx)[0]?.rotation.y).toBeCloseTo(0.8, 10);
    fx.update(pool, field, 1, DT, camera(), 4);
    expect(bodies(fx)[0]?.rotation.y).toBeCloseTo(0.8, 10);
  });

  it('levels a planted claymore and leaves a resting grenade’s pitch alone', () => {
    const p = spawnOne(pool, 'claymore');
    p.resting = false;
    fx.update(pool, field, 1, DT, camera(), 1);
    p.resting = true;
    fx.update(pool, field, 1, DT, camera(), 2);
    expect(bodies(fx)[0]?.rotation.x).toBe(0);
  });

  it('stops drawing a projectile that goes inactive', () => {
    const p = spawnOne(pool, 'frag');
    fx.update(pool, field, 1, DT, camera(), 0);
    expect(bodies(fx)[0]?.visible).toBe(true);
    p.active = false;
    fx.update(pool, field, 1, DT, camera(), 0);
    expect(bodies(fx)[0]?.visible).toBe(false);
  });

  it('never draws more bodies than the pool has slots', () => {
    const small = new EquipmentFx(2, 1, null);
    for (const id of ['frag', 'semtex', 'flashbang', 'smoke'] as EquipmentId[]) spawnOne(pool, id);
    small.update(pool, field, 1, DT, camera(), 0);
    expect(bodies(small).filter((b) => b.visible)).toHaveLength(2);
  });
});

describe('EquipmentFx smoke', () => {
  function bloom(): void {
    const volume = field.spawn(0, 0.5, -6, 4, 8, 1.5);
    expect(volume).not.toBeNull();
    for (let i = 0; i < 120; i++) field.step();
  }

  it('hides a cloud with no volume behind it', () => {
    fx.update(pool, field, 1, DT, camera(), 0);
    for (const cloud of clouds(fx)) expect(cloud.visible).toBe(false);
  });

  it('shows a bloomed cloud at its volume', () => {
    bloom();
    fx.update(pool, field, 1, DT, camera(), 1);
    const cloud = clouds(fx)[0];
    expect(cloud?.visible).toBe(true);
    expect(cloud?.position.toArray()).toEqual([0, 0.5, -6]);
  });

  it('scales and fades every puff with the cloud', () => {
    bloom();
    fx.update(pool, field, 1, DT, camera(), 1);
    for (const puff of clouds(fx)[0]?.children ?? []) {
      expect(puff.scale.x).toBeGreaterThan(0);
      const mat = (puff as THREE.Mesh).material as THREE.MeshBasicMaterial;
      expect(mat.opacity).toBeGreaterThan(0);
      expect(mat.opacity).toBeLessThanOrEqual(0.5);
    }
  });

  it('billboards every puff to the camera', () => {
    bloom();
    const cam = camera();
    cam.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9);
    cam.updateMatrixWorld(true);
    fx.update(pool, field, 1, DT, cam, 1);
    for (const puff of clouds(fx)[0]?.children ?? []) {
      expect(puff.quaternion.angleTo(cam.quaternion)).toBeCloseTo(0, 10);
    }
  });

  it('culls a cloud past the draw distance, and brings it back', () => {
    bloom();
    const cam = camera();
    for (const [distance, drawn] of [[5, true], [37, true], [39, false], [80, false], [10, true]] as const) {
      cam.position.set(0, 0.5, -6 + distance);
      cam.updateMatrixWorld(true);
      fx.update(pool, field, 1, DT, cam, 1);
      expect(clouds(fx)[0]?.visible).toBe(drawn);
    }
  });

  it('hides a cloud whose density has fallen away', () => {
    bloom();
    fx.update(pool, field, 1, DT, camera(), 1);
    expect(clouds(fx)[0]?.visible).toBe(true);
    for (let i = 0; i < 60 * 20; i++) field.step();
    fx.update(pool, field, 1, DT, camera(), 2);
    expect(clouds(fx)[0]?.visible).toBe(false);
  });

  it('drifts the puffs over time without moving the cloud', () => {
    bloom();
    const cam = camera();
    fx.update(pool, field, 1, DT, cam, 1);
    const before = clouds(fx)[0]?.children.map((p) => p.position.y) ?? [];
    fx.update(pool, field, 1, DT, cam, 3);
    const after = clouds(fx)[0]?.children.map((p) => p.position.y) ?? [];
    expect(after).not.toEqual(before);
    expect(clouds(fx)[0]?.position.toArray()).toEqual([0, 0.5, -6]);
  });
});

describe('EquipmentFx blasts', () => {
  it('takes the first free shell and places it', () => {
    fx.spawnBlast(3, 1, -4, 6, false);
    const shell = blasts(fx)[0];
    expect(shell?.visible).toBe(true);
    expect(shell?.position.toArray()).toEqual([3, 1, -4]);
  });

  it('paints a bright blast white and an ordinary one amber', () => {
    fx.spawnBlast(0, 0, 0, 1, true);
    expect(((blasts(fx)[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ffffff');
    fx.spawnBlast(0, 0, 0, 1, false);
    expect(((blasts(fx)[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ffb469');
  });

  it('grows the shell fast and fades it out, then retires it', () => {
    fx.spawnBlast(0, 0, 0, 4, false);
    const shell = blasts(fx)[0] as THREE.Mesh;
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      fx.update(pool, field, 1, DT, camera(), i * DT);
      if (shell.visible) seen.push(shell.scale.x);
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[0] ?? 0);
    expect(shell.visible).toBe(false);
  });

  it('runs six at once and refuses the seventh until one retires', () => {
    for (let i = 0; i < 7; i++) fx.spawnBlast(i, 0, 0, 1, false);
    expect(blasts(fx).filter((b) => b.visible)).toHaveLength(6);
    expect(blasts(fx)[0]?.position.x).toBe(0);
    expect(blasts(fx)[5]?.position.x).toBe(5);
  });

  it('moves the one shared light to the newest blast and dims it to nothing', () => {
    const point = light(fx);
    fx.spawnBlast(2, 3, -1, 5, true);
    expect(point.position.toArray()).toEqual([2, 3, -1]);
    expect(point.color.getHexString()).toBe('ffffff');
    fx.update(pool, field, 1, DT, camera(), 0);
    expect(point.intensity).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) fx.update(pool, field, 1, DT, camera(), i * DT);
    expect(point.intensity).toBe(0);
    // Dimmed, never hidden: hiding it would change the scene's light count.
    expect(point.visible).toBe(true);
  });

  it('gives a bright blast a longer light than a dull one', () => {
    fx.spawnBlast(0, 0, 0, 1, false);
    fx.update(pool, field, 1, DT, camera(), 0);
    const dull = light(fx).intensity;
    const other = new EquipmentFx(1, 1, null);
    other.spawnBlast(0, 0, 0, 1, true);
    other.update(pool, field, 1, DT, camera(), 0);
    expect(light(other).intensity).toBeGreaterThan(dull);
  });
});

describe('EquipmentFx dispose', () => {
  it('empties the group and releases what it owns', () => {
    const geometry = (bodies(fx)[0]?.children[0] as THREE.Mesh).geometry;
    let disposed = false;
    geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    fx.dispose();
    expect(fx.group.children).toHaveLength(0);
    expect(disposed).toBe(true);
  });

  it('is safe to call twice', () => {
    fx.dispose();
    expect(() => fx.dispose()).not.toThrow();
  });
});
