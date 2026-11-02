import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Group, Mesh, Object3D } from 'three';
import { MeshStandardMaterial } from 'three';
import { buildKnifeModel } from './KnifeMesh';
import { sharedWeaponSurfaces } from './WeaponMesh';

/**
 * The knife viewmodel: four builds out of two flags.
 *
 * `template` is the knife's own GLB and `rig` is the arms' file, and each is independently
 * absent until its file lands — so a match can draw any of the four, and three of them are
 * what it draws while the files are still in flight. Every test below names which.
 *
 * Two collaborators are mocked, each for the same reason: this file's subject is what it
 * builds, not what they do. `ViewmodelHands` is handed a target node, a hold and which arm to
 * hide, and those four lines are what is checked — posing an arm is `ViewmodelHands.test.ts`'s
 * subject. `sharedWeaponSurfaces` paints three canvases, which belongs to `WeaponSurfaces` and
 * would drag a 2D context in here for materials this file only passes through.
 */

const SURFACES = new Map(
  (['gunmetal', 'polymer', 'glove', 'lens', 'reticle'] as const).map((key) => [
    key,
    new MeshStandardMaterial({ name: `surface:${key}` }),
  ]),
);

vi.mock('./WeaponMesh', () => ({ sharedWeaponSurfaces: (): unknown => SURFACES }));

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

/** The knife's file, as the build carves one: a handle at the origin and a blade in front. */
function fakeTemplate(): Object3D {
  const scene = new Group();
  scene.name = 'knife-file';
  const blade = new Mesh(new BufferGeometry());
  blade.name = 'file-blade';
  scene.add(blade);
  return scene;
}

function fakeRig(): Object3D {
  const rig = new Object3D();
  rig.name = 'hands-file';
  return rig;
}

function meshNames(root: Object3D): string[] {
  const names: string[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh) names.push(node.name);
  });
  return names;
}

function vertexCount(root: Object3D): number {
  let total = 0;
  root.traverse((node) => {
    const g = (node as Mesh).geometry;
    if (g instanceof BufferGeometry) total += g.attributes.position?.count ?? 0;
  });
  return total;
}

beforeEach(() => {
  built.length = 0;
});

describe('the root', () => {
  it('is one group, named and exaggerated', () => {
    const knife = buildKnifeModel(8);
    expect(knife.root.name).toBe('viewmodel:knife');
    // Life size is the wrong size for the lower corner of a screen: 1.3 puts a 168 mm blade
    // at 218 mm, which reads as a weapon at arm's length without becoming a machete.
    expect(knife.root.scale.x).toBeCloseTo(1.3, 12);
    expect(knife.root.scale.y).toBe(knife.root.scale.x);
    expect(knife.root.scale.z).toBe(knife.root.scale.x);
    knife.dispose();
  });

  it('shares the weapon surfaces rather than building its own', () => {
    const knife = buildKnifeModel(8);
    const materials = new Set<unknown>();
    knife.root.traverse((node) => {
      if (node instanceof Mesh) materials.add(node.material);
    });
    // A blade lit differently from the rifle it replaces would read as a different game, and
    // three more canvases for three images that already exist is three more uploads.
    expect(materials.size).toBeGreaterThan(0);
    for (const material of materials) expect([...SURFACES.values()]).toContain(material);
    knife.dispose();
  });
});

describe('the blade', () => {
  it('is built out of boxes when the file has not arrived', () => {
    const knife = buildKnifeModel(8, null);
    // Grip, guard, ricasso and two lengths of blade, merged by surface.
    expect(meshNames(knife.root)).toContain('viewmodel:knife:gunmetal');
    expect(meshNames(knife.root)).toContain('viewmodel:knife:polymer');
    expect(vertexCount(knife.root)).toBeGreaterThan(50);
    knife.dispose();
  });

  it('is the file when there is one, and then no boxes are built for it', () => {
    const withFile = buildKnifeModel(8, fakeTemplate());
    const withoutFile = buildKnifeModel(8, null);
    expect(withFile.root.getObjectByName('viewmodel:knife:file')).toBeDefined();
    // The file replaces the grip, the guard and the blade; what is left is the fist.
    expect(meshNames(withFile.root)).not.toContain('viewmodel:knife:polymer');
    expect(meshNames(withoutFile.root)).toContain('viewmodel:knife:polymer');
    withFile.dispose();
    withoutFile.dispose();
  });

  it('holds the file by the rear of its handle, not by its middle', () => {
    const knife = buildKnifeModel(8, fakeTemplate());
    const file = knife.root.getObjectByName('viewmodel:knife:file') as Object3D;
    // Forward of the fist (playtest 3, finding 12): the fist covered the guard and most of
    // the blade, and a knife you cannot see is a punch.
    expect(file.position.z).toBeLessThan(0);
    expect(file.position.x).toBe(0);
    knife.dispose();
  });
});

describe('the hand', () => {
  it('is three boxes when the arms file has not arrived', () => {
    const knife = buildKnifeModel(8, fakeTemplate(), null);
    expect(meshNames(knife.root)).toContain('viewmodel:knife:glove');
    expect(knife.hands).toBeNull();
    expect(built).toHaveLength(0);
    knife.dispose();
  });

  it('is the rig when it has, and then the boxes are not built at all', () => {
    const knife = buildKnifeModel(8, fakeTemplate(), fakeRig());
    // One hand on the knife reads as a hand; three boxes read as a mitten.
    expect(meshNames(knife.root)).not.toContain('viewmodel:knife:glove');
    expect(knife.hands).not.toBeNull();
    expect(built).toHaveLength(1);
    knife.dispose();
  });

  it('puts the rig’s hand on the root itself, because the file’s origin is the handle', () => {
    const knife = buildKnifeModel(8, fakeTemplate(), fakeRig());
    const call = built[0];
    expect(call?.root).toBe(knife.root);
    expect(call?.weaponId).toBe('knife');
    // The grip target is a node under the root, and the support target is the same node —
    // it is never posed, because the left arm is hidden.
    expect(call?.targets.grip).toBe(call?.targets.support);
    expect((call?.targets.grip as Object3D).name).toBe('viewmodel:hand-target:grip');
    expect((call?.targets.grip as Object3D).parent).toBe(knife.root);
    knife.dispose();
  });

  it('asks for the knife’s own hold, not a weapon’s trigger hand', () => {
    buildKnifeModel(8, fakeTemplate(), fakeRig());
    // A trigger hand lies its index along a frame and stands its thumb off; a knife is held
    // in a closed fist.
    expect(built[0]?.targets.gripPose).toBe('knife');
    expect(built[0]?.targets.magazine).toBeNull();
  });

  it('hides the left arm, because a knife is held in one hand', () => {
    buildKnifeModel(8, fakeTemplate(), fakeRig());
    expect(built[0]?.hidden).toEqual(['L']);
  });

  it('adds the rig’s frame under the root, so it rides the swing', () => {
    const knife = buildKnifeModel(8, fakeTemplate(), fakeRig());
    expect(knife.root.getObjectByName('viewmodel:hands-frame')?.parent).toBe(knife.root);
    knife.dispose();
  });
});

describe('the forearm', () => {
  it('is built without the rig and not with it', () => {
    const boxes = buildKnifeModel(8, fakeTemplate(), null);
    const rigged = buildKnifeModel(8, fakeTemplate(), fakeRig());
    expect(boxes.arm).not.toBeNull();
    expect(rigged.arm).toBeNull();
    boxes.dispose();
    rigged.dispose();
  });

  it('is not a child of the root, because the root yaws through the swing', () => {
    const knife = buildKnifeModel(8, fakeTemplate(), null);
    // An arm connects a shoulder that does not move to a fist that does; attached rigidly it
    // would swing with the blade and point at the ceiling.
    expect(knife.arm?.parent).toBeNull();
    expect(knife.arm?.name).toBe('viewmodel:knife:arm');
    knife.dispose();
  });

  it('is one unit long down -Z, so aiming it and scaling Z spans any two points', () => {
    const knife = buildKnifeModel(8, fakeTemplate(), null);
    const sleeve = knife.arm?.children[0] as Mesh;
    const geometry = sleeve.geometry as BufferGeometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    expect(box?.max.z ?? 0).toBeCloseTo(0, 6);
    expect(box?.min.z ?? 0).toBeCloseTo(-1, 6);
    knife.dispose();
  });

  it('tapers from the elbow to the wrist, and is not scaled with the blade', () => {
    const knife = buildKnifeModel(8, fakeTemplate(), null);
    const geometry = (knife.arm?.children[0] as Mesh).geometry as BufferGeometry & {
      parameters: { radiusTop: number; radiusBottom: number };
    };
    const { radiusTop, radiusBottom } = geometry.parameters;
    // Both ends are the authored radii, un-exaggerated: a forearm scaled with the knife would
    // be thicker than the fist on the end of it. The knife is read at a glance; an arm is
    // exaggerated by being long.
    expect(radiusTop).toBeCloseTo(0.048, 12);
    expect(radiusBottom).toBeCloseTo(0.062, 12);
    expect(radiusTop).toBeLessThan(radiusBottom);
    knife.dispose();
  });
});

describe('dispose', () => {
  it('releases the geometry it built and empties both groups', () => {
    const knife = buildKnifeModel(8, null, null);
    const disposed: string[] = [];
    knife.root.traverse((node) => {
      const g = (node as Mesh).geometry;
      if (g instanceof BufferGeometry) g.addEventListener('dispose', () => void disposed.push(node.name));
    });
    knife.dispose();
    expect(disposed.length).toBeGreaterThan(0);
    expect(knife.root.children).toHaveLength(0);
    expect(knife.arm?.children ?? []).toHaveLength(0);
  });

  it('leaves the shared surfaces alone', () => {
    const gunmetal = (sharedWeaponSurfaces(8) as Map<string, unknown>).get('gunmetal');
    buildKnifeModel(8, null, null).dispose();
    expect((sharedWeaponSurfaces(8) as Map<string, unknown>).get('gunmetal')).toBe(gunmetal);
  });
});
