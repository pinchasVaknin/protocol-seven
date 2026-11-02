import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Object3D, Vector3 } from 'three';
import { buildGrenadeModel } from './GrenadeMesh';

/**
 * The grenade in the hand: a file, a pin that comes out of it, and two hands on both.
 *
 * There is no primitive fallback and none is wanted — with no file there is simply no grenade,
 * which is what the game did before this existed. So every test here starts from a template,
 * and what varies is which sockets the recipe put in it: a lethal has a pin to pull, a
 * claymore does not, and that one absence decides whether the left arm is drawn at all.
 *
 * `ViewmodelHands` is mocked: what this file owes it is two target nodes, a hold and which arm
 * to hide. Posing an arm is `ViewmodelHands.test.ts`'s subject.
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

interface FakeOptions {
  readonly equipmentId?: string;
  readonly withPin?: boolean;
  readonly withLever?: boolean;
  readonly pinSocket?: boolean;
}

/** An equipment file as the build carves one: a body, a pin, a lever and two sockets. */
function fakeTemplate(options: FakeOptions = {}): never {
  const scene = new Group();
  scene.name = 'equipment-file';
  const body = new Object3D();
  body.name = 'body';
  scene.add(body);
  if (options.withPin !== false) {
    const pin = new Object3D();
    pin.name = 'pin';
    pin.position.set(0.01, 0.02, 0.0);
    scene.add(pin);
  }
  if (options.withLever !== false) {
    const lever = new Object3D();
    lever.name = 'lever';
    scene.add(lever);
  }
  const sockets: Record<string, Vector3> = { socket_grip: new Vector3(0, -0.02, 0.01) };
  if (options.pinSocket !== false) sockets.socket_pin = new Vector3(0.015, 0.03, 0);
  return { equipmentId: options.equipmentId ?? 'frag', scene, sockets } as never;
}

function fakeRig(): Object3D {
  const rig = new Object3D();
  rig.name = 'hands-file';
  return rig;
}

beforeEach(() => {
  built.length = 0;
});

describe('the root', () => {
  it('is one group, named for what is in the hand and exaggerated', () => {
    const grenade = buildGrenadeModel(fakeTemplate({ equipmentId: 'semtex' }));
    expect(grenade.root.name).toBe('viewmodel:grenade:semtex');
    expect(grenade.root.scale.x).toBeGreaterThan(1);
    expect(grenade.root.scale.y).toBe(grenade.root.scale.x);
    grenade.dispose();
  });

  it('clones the file rather than posing the template every match shares', () => {
    const template = fakeTemplate();
    const a = buildGrenadeModel(template);
    const b = buildGrenadeModel(template);
    expect(a.root.getObjectByName('viewmodel:grenade:file')).not.toBe(
      b.root.getObjectByName('viewmodel:grenade:file'),
    );
    a.dispose();
    b.dispose();
  });

  it('keys the pose on the file’s id, not the simulation’s', () => {
    const grenade = buildGrenadeModel(fakeTemplate({ equipmentId: 'frag' }));
    // `HAND_POSES` keys on `eq_frag`, as it does for every weapon: a pose belongs to a file,
    // so swapping the model is what makes the pose need redoing.
    expect(grenade.equipmentId).toBe('frag');
    expect(grenade.poseId).toBe('eq_frag');
    grenade.dispose();
  });
});

describe('the pin', () => {
  it('goes into a carrier of its own, keeping the place the build measured', () => {
    const grenade = buildGrenadeModel(fakeTemplate());
    const carrier = grenade.pinCarrier;
    expect(carrier.name).toBe('viewmodel:grenade:pin-carrier');
    // The carrier starts at the identity and the pull writes it; the pin keeps its own offset.
    expect(carrier.position.toArray()).toEqual([0, 0, 0]);
    const pin = carrier.getObjectByName('pin');
    expect(pin).toBeDefined();
    expect(pin?.position.x).toBeCloseTo(0.01, 12);
    grenade.dispose();
  });

  it('leaves the carrier empty on a file with no pin, rather than failing', () => {
    const grenade = buildGrenadeModel(fakeTemplate({ withPin: false }));
    expect(grenade.pinCarrier.getObjectByName('pin')).toBeUndefined();
    grenade.dispose();
  });

  it('hands back the lever, or null where there is none', () => {
    expect(buildGrenadeModel(fakeTemplate()).lever).not.toBeNull();
    expect(buildGrenadeModel(fakeTemplate({ withLever: false })).lever).toBeNull();
  });
});

describe('the two hands', () => {
  it('puts the holding hand on the file’s own grip socket', () => {
    const grenade = buildGrenadeModel(fakeTemplate(), fakeRig());
    const grip = built[0]?.targets.grip as Object3D;
    expect(grip.name).toBe('viewmodel:hand-target:grip');
    expect(grip.position.toArray()).toEqual([0, -0.02, 0.01]);
    expect(grip.parent).toBe(grenade.root);
    grenade.dispose();
  });

  it('puts the pulling hand inside the carrier, so it goes where the ring goes', () => {
    const grenade = buildGrenadeModel(fakeTemplate(), fakeRig());
    const support = built[0]?.targets.support as Object3D;
    expect(support.name).toBe('viewmodel:hand-target:pin');
    expect(support.parent).toBe(grenade.pinCarrier);
    expect(support.position.x).toBeCloseTo(0.015, 12);
    grenade.dispose();
  });

  it('asks for the grenade’s own hold and a pinch on the ring', () => {
    buildGrenadeModel(fakeTemplate(), fakeRig());
    // A hand closed round a body 6 cm across with the spoon trapped under the fingers, and a
    // pinch rather than a wrap on the other.
    expect(built[0]?.targets.gripPose).toBe('grenade');
    expect(built[0]?.targets.supportPose).toBe('pinch');
    expect(built[0]?.targets.magazine).toBeNull();
    expect(built[0]?.weaponId).toBe('eq_frag');
  });

  it('hides the pulling arm on a thing with no pin to pull', () => {
    buildGrenadeModel(fakeTemplate({ equipmentId: 'claymore', pinSocket: false }), fakeRig());
    expect(built[0]?.hidden).toEqual(['L']);
  });

  it('draws both arms on a thing that has one', () => {
    buildGrenadeModel(fakeTemplate(), fakeRig());
    expect(built[0]?.hidden).toEqual([]);
  });

  it('falls the pulling hand back to the grip when there is no pin socket', () => {
    const grenade = buildGrenadeModel(fakeTemplate({ pinSocket: false }), fakeRig());
    const grip = built[0]?.targets.grip as Object3D;
    const support = built[0]?.targets.support as Object3D;
    expect(support.position.toArray()).toEqual(grip.position.toArray());
    grenade.dispose();
  });

  it('draws no hands at all when the arms file has not arrived', () => {
    const grenade = buildGrenadeModel(fakeTemplate(), null);
    expect(grenade.hands).toBeNull();
    expect(built).toHaveLength(0);
    grenade.dispose();
  });
});

describe('setHeld', () => {
  it('shows and hides the grenade without touching the pin or the hands', () => {
    const grenade = buildGrenadeModel(fakeTemplate(), fakeRig());
    const file = grenade.root.getObjectByName('viewmodel:grenade:file') as Object3D;
    expect(file.visible).toBe(true);
    grenade.setHeld(false);
    expect(file.visible).toBe(false);
    // The pin and its carrier are the throw's own; `poseGrenade` decides what they do.
    expect(grenade.pinCarrier.visible).toBe(true);
    grenade.setHeld(true);
    expect(file.visible).toBe(true);
    grenade.dispose();
  });
});

describe('dispose', () => {
  it('empties the root and releases nothing, because it owns nothing', () => {
    const grenade = buildGrenadeModel(fakeTemplate(), fakeRig());
    grenade.dispose();
    // Geometry and materials belong to the template, which the asset service owns for the
    // life of the page; a clone shares them and has nothing of its own to release.
    expect(grenade.root.children).toHaveLength(0);
  });
});
