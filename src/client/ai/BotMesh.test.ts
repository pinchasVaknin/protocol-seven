import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEATH_VARIANTS, type ActorAnimationInput } from '../../shared/ai/BotVisualState';
import { ARM_PITCH, LEG_PIVOT_Y } from '../../shared/ai/Gait';
import { HUMANOID_RIG } from '../../shared/combat/HitboxRig';
import type { HeldWeaponAsset } from '../characters/ActorAvatar';
import { BotMesh, buildBotAssets, type BotAssets } from './BotMesh';

/**
 * `BotMesh` is the one file in C11 that never reaches `document`: it is three.js geometry and
 * arithmetic all the way down, so the whole class runs in Vitest's node environment with no
 * stubbing at all.
 */

const DT = 1 / 60;

const ANIM: ActorAnimationInput = {
  stance: 'STAND',
  aiming: false,
  sprinting: false,
  reloading: false,
  reloadSeconds: 0,
  firing: false,
  throwing: false,
  throwPhase: 'IDLE',
  meleeing: false,
};

function weaponAsset(id: string, template: THREE.Object3D | null): HeldWeaponAsset {
  return {
    weaponId: id,
    weaponClass: null,
    geometry: new THREE.BoxGeometry(0.1, 0.1, 0.8),
    material: new THREE.MeshBasicMaterial(),
    template,
    gripAnchor: new THREE.Vector3(0, 0, 0.1),
    supportAnchor: new THREE.Vector3(0, 0, -0.2),
  };
}

/** The node the weapon is added to is always the last child, because `setWeapon` appends. */
function heldNode(mesh: BotMesh): THREE.Object3D | undefined {
  return mesh.group.children[mesh.group.children.length - 1];
}

describe('buildBotAssets', () => {
  it('builds four geometries and three materials, and disposes all seven', () => {
    const assets = buildBotAssets();
    const geometries = [assets.bodyGeometry, assets.headGeometry, assets.gearGeometry, assets.legGeometry];
    for (const g of geometries) expect(g.getAttribute('position').count).toBeGreaterThan(0);

    const disposed: string[] = [];
    for (const g of geometries) g.addEventListener('dispose', () => disposed.push('geometry'));
    for (const m of [assets.body, assets.head, assets.gear]) {
      m.addEventListener('dispose', () => disposed.push('material'));
    }
    assets.dispose();
    expect(disposed.filter((d) => d === 'geometry')).toHaveLength(4);
    expect(disposed.filter((d) => d === 'material')).toHaveLength(3);
  });

  it('gives the fallback neutral colours rather than a team tint', () => {
    const assets = buildBotAssets();
    expect((assets.body as THREE.MeshLambertMaterial).color.getHex()).toBe(0x59616e);
    expect((assets.head as THREE.MeshLambertMaterial).color.getHex()).toBe(0x8a6a3c);
    expect((assets.gear as THREE.MeshLambertMaterial).color.getHex()).toBe(0x1d2026);
    assets.dispose();
  });

  it('builds the head geometry from every box in the head zone, and nothing else', () => {
    const assets = buildBotAssets();
    const zone = HUMANOID_RIG.boxes.filter((b) => b.zone === 'head');
    expect(zone.length).toBeGreaterThan(0);
    assets.headGeometry.computeBoundingBox();
    const box = assets.headGeometry.boundingBox;
    expect(box).not.toBeNull();
    // Float32 attribute buffers, so six places is the honest precision here.
    expect(box?.min.y).toBeCloseTo(Math.min(...zone.map((b) => b.oy - b.sy * 0.5)), 6);
    expect(box?.max.y).toBeCloseTo(Math.max(...zone.map((b) => b.oy + b.sy * 0.5)), 6);
    assets.dispose();
  });

  it('hangs the leg below its own origin so the node rotation is a hip rotation', () => {
    const assets = buildBotAssets();
    const leg = HUMANOID_RIG.boxes.find((b) => b.name === 'legL');
    assets.legGeometry.computeBoundingBox();
    const box = assets.legGeometry.boundingBox;
    expect(box?.max.y).toBeCloseTo(0, 6);
    expect(box?.min.y).toBeCloseTo(-(leg?.sy ?? 0), 6);
    assets.dispose();
  });

  it('pitches the arms forward in the body geometry while the rig keeps them upright', () => {
    const assets = buildBotAssets();
    const arm = HUMANOID_RIG.boxes.find((b) => b.name === 'armL');
    expect(arm).toBeDefined();
    assets.bodyGeometry.computeBoundingBox();
    const box = assets.bodyGeometry.boundingBox;
    // A forward pitch pushes the arm's far end toward -Z, past where the upright box reached.
    const uprightMinZ = Math.min(...HUMANOID_RIG.boxes.filter((b) => b.zone === 'torso' || b.zone === 'arm').map((b) => b.oz - b.sz * 0.5));
    expect(ARM_PITCH).toBeGreaterThan(0);
    expect(box?.min.z ?? 0).toBeLessThan(uprightMinZ);
    assets.dispose();
  });
});

describe('BotMesh construction', () => {
  let assets: BotAssets;
  beforeEach(() => {
    assets = buildBotAssets();
  });

  it('adds the body, head, gear, two legs, the head anchor and two shoulder frames', () => {
    const mesh = new BotMesh(assets);
    expect(mesh.group.children).toHaveLength(8);
    expect(mesh.group.children.map((c) => c.name)).toEqual([
      '',
      '',
      '',
      '',
      '',
      'indicator-anchor:head',
      'indicator-frame:left-shoulder',
      'indicator-frame:right-shoulder',
    ]);
  });

  it('casts shadows from the body, the head, the gear and both legs', () => {
    const mesh = new BotMesh(assets);
    for (const index of [0, 1, 2]) expect(mesh.group.children[index]?.castShadow).toBe(true);
    for (const index of [3, 4]) expect(mesh.group.children[index]?.children[0]?.castShadow).toBe(true);
  });

  it('puts both hips at the rig pivot height and at the leg box offsets', () => {
    const mesh = new BotMesh(assets);
    const legL = mesh.group.children[3];
    const legR = mesh.group.children[4];
    const offset = Math.abs(HUMANOID_RIG.boxes.find((b) => b.name === 'legL')?.ox ?? 0.11);
    expect(legL?.position.y).toBe(LEG_PIVOT_Y);
    expect(legR?.position.y).toBe(LEG_PIVOT_Y);
    expect(legL?.position.x).toBe(-offset);
    expect(legR?.position.x).toBe(offset);
  });

  it('starts alive, visible and with both legs straight', () => {
    const mesh = new BotMesh(assets);
    expect(mesh.isDying).toBe(false);
    expect(mesh.group.visible).toBe(true);
    expect(mesh.group.children[3]?.rotation.x).toBe(0);
    expect(mesh.group.children[4]?.rotation.x).toBe(0);
  });
});

describe('BotMesh indicator landmarks', () => {
  let assets: BotAssets;
  beforeEach(() => {
    assets = buildBotAssets();
  });

  it('answers the head anchor at the top face of the head box', () => {
    const mesh = new BotMesh(assets);
    mesh.group.updateMatrixWorld(true);
    const out = new THREE.Vector3();
    expect(mesh.getIndicatorAnchor('head', out)).toBe(true);
    const head = HUMANOID_RIG.boxes.find((b) => b.name === 'head');
    expect(out.y).toBeCloseTo((head?.oy ?? 0) + (head?.sy ?? 0) * 0.5, 10);
  });

  it('refuses the shoulder anchors, which are frames rather than points', () => {
    const mesh = new BotMesh(assets);
    const out = new THREE.Vector3(9, 9, 9);
    expect(mesh.getIndicatorAnchor('leftShoulder', out)).toBe(false);
    expect(mesh.getIndicatorAnchor('rightShoulder', out)).toBe(false);
    expect(out.toArray()).toEqual([9, 9, 9]);
  });

  it('answers both shoulder frames, mirrored across X', () => {
    const mesh = new BotMesh(assets);
    mesh.group.updateMatrixWorld(true);
    const left = new THREE.Vector3();
    const right = new THREE.Vector3();
    const q = new THREE.Quaternion();
    expect(mesh.getIndicatorFrame('leftShoulder', left, q)).toBe(true);
    expect(mesh.getIndicatorFrame('rightShoulder', right, q)).toBe(true);
    expect(left.x).toBeCloseTo(-right.x, 10);
    expect(left.y).toBeCloseTo(right.y, 10);
    expect(left.z).toBeCloseTo(right.z, 10);
  });

  it('gives a shoulder frame whose +Z points out of the arm', () => {
    const mesh = new BotMesh(assets);
    mesh.group.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    mesh.getIndicatorFrame('rightShoulder', p, q);
    const outward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(outward.x).toBeCloseTo(1, 6);
    expect(outward.y).toBeCloseTo(0, 6);
    expect(outward.z).toBeCloseTo(0, 6);
  });

  it('tracks the group when the body moves', () => {
    const mesh = new BotMesh(assets);
    mesh.update(ANIM, 4, 1.5, -3, 0, 1, DT);
    mesh.group.updateMatrixWorld(true);
    const out = new THREE.Vector3();
    mesh.getIndicatorAnchor('head', out);
    expect(out.x).toBeCloseTo(4, 10);
    expect(out.z).toBeCloseTo(-3, 10);
    expect(out.y).toBeGreaterThan(1.5);
  });
});

describe('BotMesh pose', () => {
  let assets: BotAssets;
  beforeEach(() => {
    assets = buildBotAssets();
  });

  it('places the feet and yaws about +Y while alive', () => {
    const mesh = new BotMesh(assets);
    mesh.update(ANIM, 2, 0.25, -7, 0.8, 1, DT);
    expect(mesh.group.position.toArray()).toEqual([2, 0.25, -7]);
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8);
    expect(mesh.group.quaternion.x).toBeCloseTo(expected.x, 12);
    expect(mesh.group.quaternion.y).toBeCloseTo(expected.y, 12);
    expect(mesh.group.quaternion.z).toBeCloseTo(expected.z, 12);
    expect(mesh.group.quaternion.w).toBeCloseTo(expected.w, 12);
  });

  it('ignores the height scale: a placeholder stands at its own height', () => {
    const mesh = new BotMesh(assets);
    mesh.update(ANIM, 0, 0, 0, 0, 0.4, DT);
    expect(mesh.group.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('swings the legs out of phase once the body has covered ground', () => {
    const mesh = new BotMesh(assets);
    for (let i = 1; i <= 60; i++) mesh.update(ANIM, i * DT * 3, 0, 0, 0, 1, DT);
    const left = mesh.group.children[3]?.rotation.x ?? 0;
    const right = mesh.group.children[4]?.rotation.x ?? 0;
    expect(Math.abs(left)).toBeGreaterThan(0);
    expect(Math.sign(left)).not.toBe(Math.sign(right));
  });

  it('drops the first position delta after a teleport rather than reading it as a sprint', () => {
    const near = new BotMesh(assets);
    const far = new BotMesh(assets);
    near.update(ANIM, 0, 0, 0, 0, 1, DT);
    far.update(ANIM, 500, 0, 500, 0, 1, DT);
    expect(near.group.children[3]?.rotation.x).toBe(far.group.children[3]?.rotation.x);
  });

  it('eases the swing back toward standing when the body stops', () => {
    const mesh = new BotMesh(assets);
    for (let i = 1; i <= 90; i++) mesh.update(ANIM, i * DT * 4, 0, 0, 0, 1, DT);
    const moving = Math.abs(mesh.group.children[3]?.rotation.x ?? 0);
    const held = 90 * DT * 4;
    for (let i = 0; i < 120; i++) mesh.update(ANIM, held, 0, 0, 0, 1, DT);
    const stopped = Math.abs(mesh.group.children[3]?.rotation.x ?? 0);
    expect(stopped).toBeLessThan(moving);
  });

  it('re-seeds the gait on endDeath, so a respawn is a cut rather than a stride', () => {
    const mesh = new BotMesh(assets);
    for (let i = 1; i <= 30; i++) mesh.update(ANIM, i * DT * 3, 0, 0, 0, 1, DT);
    mesh.beginDeath(1, 0, 0, ANIM);
    mesh.endDeath();
    const fresh = new BotMesh(assets);
    mesh.update(ANIM, 400, 0, 400, 0, 1, DT);
    fresh.update(ANIM, 400, 0, 400, 0, 1, DT);
    // The amplitude carried over, but the distance delta did not: neither reads the jump.
    expect(Number.isFinite(mesh.group.children[3]?.rotation.x ?? NaN)).toBe(true);
    expect(Math.abs(mesh.group.children[3]?.rotation.x ?? 0)).toBeLessThan(1);
    expect(fresh.group.children[3]?.rotation.x).toBe(0);
  });

  it('does not divide by a zero frame time', () => {
    const mesh = new BotMesh(assets);
    mesh.update(ANIM, 0, 0, 0, 0, 1, 0);
    mesh.update(ANIM, 5, 0, 0, 0, 1, 0);
    expect(Number.isFinite(mesh.group.children[3]?.rotation.x ?? NaN)).toBe(true);
  });
});

describe('BotMesh death', () => {
  let assets: BotAssets;
  beforeEach(() => {
    assets = buildBotAssets();
  });

  it('reports isDying from beginDeath until endDeath', () => {
    const mesh = new BotMesh(assets);
    expect(mesh.isDying).toBe(false);
    mesh.beginDeath(1, 0, 0, ANIM);
    expect(mesh.isDying).toBe(true);
    mesh.endDeath();
    expect(mesh.isDying).toBe(false);
  });

  it('clears the rotation and the scale on endDeath', () => {
    const mesh = new BotMesh(assets);
    mesh.beginDeath(1, 0, 0, ANIM);
    for (let i = 0; i < 40; i++) mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    expect(mesh.group.quaternion.w).not.toBe(1);
    mesh.endDeath();
    expect(mesh.group.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(mesh.group.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('tips the body over about an axis perpendicular to the fall direction', () => {
    const mesh = new BotMesh(assets);
    mesh.beginDeath(0, -1, 0, ANIM);
    for (let i = 0; i < 90; i++) mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.group.quaternion);
    // A body rotated about 90 degrees off vertical is lying down.
    expect(up.y).toBeLessThan(0.3);
  });

  it('folds a variant into range in both directions', () => {
    const forward = new BotMesh(assets);
    const wrapped = new BotMesh(assets);
    forward.beginDeath(1, 0, 2, ANIM);
    wrapped.beginDeath(1, 0, 2 + DEATH_VARIANTS * 3, ANIM);
    for (let i = 0; i < 30; i++) {
      forward.update(ANIM, 0, 0, 0, 0, 1, DT);
      wrapped.update(ANIM, 0, 0, 0, 0, 1, DT);
    }
    expect(wrapped.group.quaternion.toArray()).toEqual(forward.group.quaternion.toArray());
    expect(wrapped.group.position.toArray()).toEqual(forward.group.position.toArray());

    const negative = new BotMesh(assets);
    negative.beginDeath(1, 0, 2 - DEATH_VARIANTS, ANIM);
    for (let i = 0; i < 30; i++) negative.update(ANIM, 0, 0, 0, 0, 1, DT);
    expect(negative.group.quaternion.toArray()).toEqual(forward.group.quaternion.toArray());
  });

  it('pitches variant 1 the opposite way from variant 0', () => {
    const back = new BotMesh(assets);
    const face = new BotMesh(assets);
    back.beginDeath(0, -1, 0, ANIM);
    face.beginDeath(0, -1, 1, ANIM);
    for (let i = 0; i < 60; i++) {
      back.update(ANIM, 0, 0, 0, 0, 1, DT);
      face.update(ANIM, 0, 0, 0, 0, 1, DT);
    }
    const backForward = new THREE.Vector3(0, 0, -1).applyQuaternion(back.group.quaternion);
    const faceForward = new THREE.Vector3(0, 0, -1).applyQuaternion(face.group.quaternion);
    expect(Math.sign(backForward.y)).not.toBe(Math.sign(faceForward.y));
  });

  it('sinks variant 2 further than the others and rotates it less', () => {
    const crumple = new BotMesh(assets);
    const plain = new BotMesh(assets);
    crumple.beginDeath(1, 0, 2, ANIM);
    plain.beginDeath(1, 0, 0, ANIM);
    for (let i = 0; i < 90; i++) {
      crumple.update(ANIM, 0, 3, 0, 0, 1, DT);
      plain.update(ANIM, 0, 3, 0, 0, 1, DT);
    }
    expect(crumple.group.position.y).toBeLessThan(plain.group.position.y);
  });

  it('shoves variant 3 the furthest along the fall direction', () => {
    const hard = new BotMesh(assets);
    const soft = new BotMesh(assets);
    hard.beginDeath(1, 0, 3, ANIM);
    soft.beginDeath(1, 0, 0, ANIM);
    for (let i = 0; i < 90; i++) {
      hard.update(ANIM, 0, 0, 0, 0, 1, DT);
      soft.update(ANIM, 0, 0, 0, 0, 1, DT);
    }
    expect(hard.group.position.x).toBeGreaterThan(soft.group.position.x);
  });

  it('falls along +Z when the killing direction is degenerate', () => {
    const mesh = new BotMesh(assets);
    mesh.beginDeath(0, 0, 0, ANIM);
    for (let i = 0; i < 90; i++) mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    expect(mesh.group.position.z).toBeGreaterThan(0);
    expect(mesh.group.position.x).toBe(0);
  });

  it('settles: the pose stops moving once the fall is over', () => {
    const mesh = new BotMesh(assets);
    mesh.beginDeath(1, 0, 0, ANIM);
    for (let i = 0; i < 120; i++) mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    const settled = mesh.group.quaternion.toArray();
    for (let i = 0; i < 60; i++) mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    expect(mesh.group.quaternion.toArray()).toEqual(settled);
  });

  it('stops the legs swinging while dying', () => {
    const mesh = new BotMesh(assets);
    for (let i = 1; i <= 60; i++) mesh.update(ANIM, i * DT * 4, 0, 0, 0, 1, DT);
    const walking = Math.abs(mesh.group.children[3]?.rotation.x ?? 0);
    mesh.beginDeath(1, 0, 0, ANIM);
    for (let i = 1; i <= 60; i++) mesh.update(ANIM, 60 * DT * 4, 0, 0, 0, 1, DT);
    expect(Math.abs(mesh.group.children[3]?.rotation.x ?? 0)).toBeLessThan(walking);
  });
});

describe('BotMesh flinch', () => {
  let assets: BotAssets;
  beforeEach(() => {
    assets = buildBotAssets();
  });

  it('leans the body and returns it', () => {
    const mesh = new BotMesh(assets);
    mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    const upright = mesh.group.quaternion.clone();
    mesh.flinch(1, 0);
    mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    expect(mesh.group.quaternion.angleTo(upright)).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    expect(mesh.group.quaternion.angleTo(upright)).toBeCloseTo(0, 12);
  });

  it('is refused while the body is dying', () => {
    const mesh = new BotMesh(assets);
    mesh.beginDeath(1, 0, 0, ANIM);
    for (let i = 0; i < 10; i++) mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    const dying = mesh.group.quaternion.clone();
    const flinched = new BotMesh(assets);
    flinched.beginDeath(1, 0, 0, ANIM);
    flinched.flinch(0, 1);
    for (let i = 0; i < 10; i++) flinched.update(ANIM, 0, 0, 0, 0, 1, DT);
    expect(flinched.group.quaternion.toArray()).toEqual(dying.toArray());
  });

  it('leans about +Z for a degenerate hit direction', () => {
    const mesh = new BotMesh(assets);
    mesh.flinch(0, 0);
    mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
    expect(Number.isFinite(mesh.group.quaternion.x)).toBe(true);
    expect(mesh.group.quaternion.w).not.toBe(1);
  });

  it('is cleared by a death that starts after it', () => {
    const mesh = new BotMesh(assets);
    mesh.flinch(1, 0);
    mesh.beginDeath(1, 0, 0, ANIM);
    const fresh = new BotMesh(assets);
    fresh.beginDeath(1, 0, 0, ANIM);
    for (let i = 0; i < 20; i++) {
      mesh.update(ANIM, 0, 0, 0, 0, 1, DT);
      fresh.update(ANIM, 0, 0, 0, 0, 1, DT);
    }
    expect(mesh.group.quaternion.toArray()).toEqual(fresh.group.quaternion.toArray());
  });
});

describe('BotMesh visibility and life', () => {
  let assets: BotAssets;
  beforeEach(() => {
    assets = buildBotAssets();
  });

  it('toggles the group and short-circuits an unchanged value', () => {
    const mesh = new BotMesh(assets);
    mesh.setVisible(true);
    expect(mesh.group.visible).toBe(true);
    mesh.setVisible(false);
    expect(mesh.group.visible).toBe(false);
    mesh.setVisible(false);
    expect(mesh.group.visible).toBe(false);
    mesh.setVisible(true);
    expect(mesh.group.visible).toBe(true);
  });

  it('ignores setLife: a placeholder has one of everything', () => {
    const mesh = new BotMesh(assets);
    const before = mesh.group.children.map((c) => c.name);
    mesh.setLife(42, 7);
    expect(mesh.group.children.map((c) => c.name)).toEqual(before);
  });
});

describe('BotMesh weapon', () => {
  let assets: BotAssets;
  beforeEach(() => {
    assets = buildBotAssets();
  });

  it('adds a primitive mesh when the asset carries no template', () => {
    const mesh = new BotMesh(assets);
    const before = mesh.group.children.length;
    mesh.setWeapon(weaponAsset('w1', null));
    expect(mesh.group.children).toHaveLength(before + 1);
    expect(heldNode(mesh)).toBeInstanceOf(THREE.Mesh);
  });

  it('clones the template when the asset carries one', () => {
    const template = new THREE.Group();
    template.name = 'glb';
    template.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5), new THREE.MeshBasicMaterial()));
    const mesh = new BotMesh(assets);
    mesh.setWeapon(weaponAsset('w2', template));
    const held = heldNode(mesh);
    expect(held?.name).toBe('glb');
    expect(held).not.toBe(template);
    expect(held?.children).toHaveLength(1);
  });

  it('makes every node of the held weapon cast a shadow', () => {
    const template = new THREE.Group();
    const child = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5), new THREE.MeshBasicMaterial());
    template.add(child);
    const mesh = new BotMesh(assets);
    mesh.setWeapon(weaponAsset('w2', template));
    const held = heldNode(mesh);
    let all = true;
    held?.traverse((n) => {
      if (!n.castShadow) all = false;
    });
    expect(all).toBe(true);
  });

  it('is idempotent for the same asset object', () => {
    const mesh = new BotMesh(assets);
    const asset = weaponAsset('w1', null);
    mesh.setWeapon(asset);
    const held = heldNode(mesh);
    mesh.setWeapon(asset);
    expect(heldNode(mesh)).toBe(held);
  });

  it('swaps the mesh for a new asset carrying the same id', () => {
    const mesh = new BotMesh(assets);
    mesh.setWeapon(weaponAsset('w1', null));
    const first = heldNode(mesh);
    mesh.setWeapon(weaponAsset('w1', null));
    expect(heldNode(mesh)).not.toBe(first);
    expect(mesh.group.children.filter((c) => c instanceof THREE.Mesh && c.name === '')).toHaveLength(4);
  });

  it('empties the hands for a null asset, and stays empty', () => {
    const mesh = new BotMesh(assets);
    const bare = mesh.group.children.length;
    mesh.setWeapon(weaponAsset('w1', null));
    mesh.setWeapon(null);
    expect(mesh.group.children).toHaveLength(bare);
    mesh.setWeapon(null);
    expect(mesh.group.children).toHaveLength(bare);
  });

  it('places the weapon at the authored offset, shifted by the stock', () => {
    const mesh = new BotMesh(assets);
    mesh.setWeapon(weaponAsset('w1', null));
    const held = heldNode(mesh);
    expect(held?.position.x).toBeCloseTo(0.04, 10);
    expect(held?.position.y).toBeCloseTo(1.02, 10);
    expect(held?.position.z).toBeLessThanOrEqual(-0.3);
  });
});

describe('BotMesh throw', () => {
  let assets: BotAssets;
  beforeEach(() => {
    assets = buildBotAssets();
  });

  it('hides the weapon while the hand is busy and gives it back', () => {
    const mesh = new BotMesh(assets);
    mesh.setWeapon(weaponAsset('w1', null));
    mesh.setThrow(true, null);
    expect(heldNode(mesh)?.visible).toBe(false);
    mesh.setThrow(false, null);
    expect(heldNode(mesh)?.visible).toBe(true);
  });

  it('gives back the very object it took', () => {
    const mesh = new BotMesh(assets);
    mesh.setWeapon(weaponAsset('w1', null));
    const held = heldNode(mesh);
    mesh.setThrow(true, null);
    mesh.setThrow(false, null);
    expect(heldNode(mesh)).toBe(held);
  });

  it('is idempotent and survives an empty hand', () => {
    const mesh = new BotMesh(assets);
    mesh.setThrow(true, null);
    mesh.setThrow(true, null);
    mesh.setWeapon(weaponAsset('w1', null));
    // A weapon drawn while the hand is busy arrives hidden.
    expect(heldNode(mesh)?.visible).toBe(false);
    mesh.setThrow(false, null);
    expect(heldNode(mesh)?.visible).toBe(true);
  });
});

describe('BotMesh dispose', () => {
  it('clears the group without disposing the shared geometry', () => {
    const assets = buildBotAssets();
    const mesh = new BotMesh(assets);
    let disposed = false;
    assets.bodyGeometry.addEventListener('dispose', () => {
      disposed = true;
    });
    mesh.dispose();
    expect(mesh.group.children).toHaveLength(0);
    expect(disposed).toBe(false);
    // The second body on the map is unharmed.
    expect(new BotMesh(assets).group.children).toHaveLength(8);
  });
});
