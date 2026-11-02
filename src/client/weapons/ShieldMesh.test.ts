import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { buildShieldModel } from './ShieldMesh';

/**
 * The riot shield: a plate, a pane of glass cut out of it, and one arm.
 *
 * The **left** arm. This killstreak gives you a shield *and a pistol*, and the pistol's own
 * viewmodel draws the right one, so a right arm here would put two right hands in one frame.
 *
 * The glass is the half with a trap in it: the file's viewport is a separate node but carries
 * the one material the whole shield shares, so making it transparent in place would turn the
 * plate, the light board and the handle to glass with it. The tests below are that
 * distinction — the pane is a clone, and nothing else moves.
 *
 * `ViewmodelHands` is mocked, as it is for the knife and the grenade, for the same reason.
 */

const built: Array<{ root: Object3D; targets: Record<string, unknown>; weaponId: string; hidden: string[] }> = [];

vi.mock('./ViewmodelHands', () => ({
  ViewmodelHands: class {
    readonly frame = new Group();
    constructor(_template: Object3D, root: Object3D, targets: Record<string, unknown>, weaponId: string) {
      this.frame.name = 'viewmodel:hands-frame';
      built.push({ root, targets, weaponId, hidden: [] });
    }
    showArm(side: string, visible: boolean): void {
      if (!visible) built[built.length - 1]?.hidden.push(side);
    }
    dispose(): void {}
  },
}));

/** The shield's file: a plate, a light board, a handle and a viewport, all on one material. */
function fakeTemplate(options: { withGlass?: boolean; withSocket?: boolean } = {}): never {
  const scene = new Group();
  scene.name = 'shield-file';
  const shared = new MeshStandardMaterial({ name: 'M_shield', roughness: 0.7, metalness: 0.4 });
  const part = (name: string, parent: Object3D): Mesh => {
    const mesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.01), shared);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };
  part('plate', scene);
  part('board', scene);
  if (options.withGlass !== false) {
    const glass = new Object3D();
    glass.name = 'glass';
    scene.add(glass);
    part('pane', glass);
  }
  const sockets: Record<string, Vector3> = {};
  if (options.withSocket !== false) sockets.socket_support = new Vector3(0, -0.05, 0.06);
  return { scene, sockets } as never;
}

function fakeRig(): Object3D {
  const rig = new Object3D();
  rig.name = 'hands-file';
  return rig;
}

beforeEach(() => {
  built.length = 0;
});

describe('the plate', () => {
  it('is one named group with the file cloned under it', () => {
    const shield = buildShieldModel(fakeTemplate());
    expect(shield.root.name).toBe('viewmodel:shield');
    expect(shield.root.getObjectByName('viewmodel:shield:file')).toBeDefined();
    shield.dispose();
  });

  it('draws nothing at all until the file arrives', () => {
    const shield = buildShieldModel(null);
    // Not a box: the procedural slab is the *world* shield and is already on the body, so a
    // second one in the viewmodel would be the same object twice.
    expect(shield.root.children).toHaveLength(0);
    expect(shield.hands).toBeNull();
    shield.dispose();
  });

  it('clones the template, so two shields are two plates', () => {
    const template = fakeTemplate();
    const a = buildShieldModel(template);
    const b = buildShieldModel(template);
    expect(a.root.getObjectByName('plate')).not.toBe(b.root.getObjectByName('plate'));
    a.dispose();
    b.dispose();
  });
});

describe('the glass', () => {
  it('makes the viewport see-through without touching the rest of the shield', () => {
    const shield = buildShieldModel(fakeTemplate());
    const pane = shield.root.getObjectByName('pane') as Mesh;
    const plate = shield.root.getObjectByName('plate') as Mesh;
    const paneMaterial = pane.material as MeshStandardMaterial;
    const plateMaterial = plate.material as MeshStandardMaterial;
    expect(paneMaterial.transparent).toBe(true);
    expect(paneMaterial.opacity).toBeCloseTo(0.34, 12);
    // The file's viewport carries the one material the whole shield shares; editing it in
    // place would turn the plate and the handle to glass with it.
    expect(plateMaterial.transparent).toBe(false);
    expect(paneMaterial).not.toBe(plateMaterial);
    shield.dispose();
  });

  it('keeps the pane out of the depth buffer and draws it last', () => {
    const shield = buildShieldModel(fakeTemplate());
    const pane = shield.root.getObjectByName('pane') as Mesh;
    // The pane sits in a hole in an object drawn in one pass: writing depth would let its
    // near face hide its far one, and the hole would read as a mirror.
    expect((pane.material as MeshStandardMaterial).depthWrite).toBe(false);
    expect((pane.material as MeshStandardMaterial).side).toBe(DoubleSide);
    expect(pane.renderOrder).toBe(1);
    shield.dispose();
  });

  it('polishes it, whatever the plate around it is', () => {
    const shield = buildShieldModel(fakeTemplate());
    const pane = (shield.root.getObjectByName('pane') as Mesh).material as MeshStandardMaterial;
    // Laminated armour glass is polished and not a metal.
    expect(pane.roughness).toBeLessThan(0.2);
    expect(pane.metalness).toBe(0);
    shield.dispose();
  });

  it('does nothing at all on a file with no viewport', () => {
    const shield = buildShieldModel(fakeTemplate({ withGlass: false }));
    const plate = (shield.root.getObjectByName('plate') as Mesh).material as MeshStandardMaterial;
    expect(plate.transparent).toBe(false);
    shield.dispose();
  });
});

describe('the one arm', () => {
  it('puts the hand on the file’s own cuff socket', () => {
    const shield = buildShieldModel(fakeTemplate(), fakeRig());
    const cuff = built[0]?.targets.support as Object3D;
    expect(cuff.name).toBe('viewmodel:hand-target:support');
    expect(cuff.position.toArray()).toEqual([0, -0.05, 0.06]);
    expect(cuff.parent).toBe(shield.root);
    shield.dispose();
  });

  it('puts it at the plate’s origin when the recipe left no socket, visibly wrong', () => {
    buildShieldModel(fakeTemplate({ withSocket: false }), fakeRig());
    // A shield with no `socket_support` is one the recipe built wrong, and it should read as
    // a bug rather than as a pose that needs another nudge.
    expect((built[0]?.targets.support as Object3D).position.toArray()).toEqual([0, 0, 0]);
  });

  it('hides the right arm, because the pistol’s own viewmodel draws it', () => {
    buildShieldModel(fakeTemplate(), fakeRig());
    expect(built[0]?.hidden).toEqual(['R']);
  });

  it('asks for a wrap, and for the shield’s own row in the pose table', () => {
    buildShieldModel(fakeTemplate(), fakeRig());
    expect(built[0]?.targets.supportPose).toBe('wrap');
    expect(built[0]?.targets.magazine).toBeNull();
    expect(built[0]?.weaponId).toBe('streak_shield');
  });

  it('hands the same node to both hands, since one of them is collapsed', () => {
    buildShieldModel(fakeTemplate(), fakeRig());
    expect(built[0]?.targets.grip).toBe(built[0]?.targets.support);
  });

  it('draws the plate bare when the arms file has not arrived', () => {
    const shield = buildShieldModel(fakeTemplate(), null);
    expect(shield.hands).toBeNull();
    expect(built).toHaveLength(0);
    expect(shield.root.getObjectByName('viewmodel:shield:file')).toBeDefined();
    shield.dispose();
  });
});

describe('dispose', () => {
  it('releases the panes it cloned and empties the root', () => {
    const shield = buildShieldModel(fakeTemplate(), fakeRig());
    const pane = (shield.root.getObjectByName('pane') as Mesh).material as MeshStandardMaterial;
    let disposed = false;
    pane.addEventListener('dispose', () => {
      disposed = true;
    });
    shield.dispose();
    // The cloned pane is the one thing this file owns; the rest belongs to the template.
    expect(disposed).toBe(true);
    expect(shield.root.children).toHaveLength(0);
  });
});
