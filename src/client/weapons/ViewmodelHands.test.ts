import { describe, expect, it } from 'vitest';
import {
  Bone,
  BoxGeometry,
  Group,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import {
  adjustFrom,
  ARM_REACH_USED,
  FINGERS,
  GRENADE_HOLD_CURL,
  holdCurlSource,
  KNIFE_HOLD_CURL,
  PINCH_HOLD_CURL,
  solveArm,
  ViewmodelHands,
  type FingerName,
  type HandTargets,
} from './ViewmodelHands';
import { NEUTRAL_HAND_POSE } from './HandPoses';

/**
 * The arms rig: what it reads out of the file, and where it puts a hand.
 *
 * Everything below `solveArm` was unreachable before this file, because every path through the
 * class starts at a constructor that wants a skinned GLB. So the suite builds one — a bone
 * tree with the names the reader looks for, bound into a real `THREE.Skeleton`, which computes
 * its own inverse bind matrices from the pose the bones are built in. That is not a stand-in
 * for the file: it is the same object three.js hands the loader, with proportions a test can
 * state in a sentence.
 *
 * The arm is built straight down -Z from the shoulder, which makes every length and direction
 * below a number anyone can check against the picture: a 0.30 m upper arm, a 0.25 m forearm,
 * a 0.09 m hand, and five fingers of three bones each.
 */

const UPPER = 0.34;
const LOWER = 0.26;

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

const ARM_UPPER = 0.3;
const ARM_LOWER = 0.25;
const HAND_LENGTH = 0.09;

/** One finger: three bones along +Y, starting at the knuckle the hand's axes are read from. */
function finger(name: FingerName, side: 'R' | 'L', at: Vector3, bones: Bone[]): Bone {
  const start = new Bone();
  start.name = `${name}_${side}`;
  start.position.copy(at);
  bones.push(start);
  let parent = start;
  for (let i = 1; i < 3; i++) {
    const next = new Bone();
    next.name = `${name}_${side}_${i}`;
    next.position.set(0, 0.03, 0);
    parent.add(next);
    bones.push(next);
    parent = next;
  }
  return start;
}

/**
 * The hands file, as the loader would hand it over: a skinned mesh over a bone tree.
 *
 * The knuckles sit where a hand's do — the middle finger ahead of the wrist, the index and the
 * little finger either side of it — because the reader derives the hand's own axes from
 * exactly those three positions, and a tidy row of five would make the palm direction
 * undefined.
 */
function fakeRig(): Object3D {
  const root = new Group();
  root.name = 'hands-file';
  const bones: Bone[] = [];

  for (const side of ['R', 'L'] as const) {
    const sign = side === 'R' ? 1 : -1;
    const upper = new Bone();
    upper.name = `upperarm_${side}`;
    upper.position.set(sign * 0.18, -0.1, 0.1);
    bones.push(upper);

    const lower = new Bone();
    lower.name = `lowerarm_${side}`;
    // Along +Y, which is the axis `aim` points a bone down and the axis a rigged arm is
    // authored on. A chain built on any other axis is posed by the solver and lands somewhere
    // else, which is a fact about the file's contract rather than about this test.
    lower.position.set(0, ARM_UPPER, 0);
    upper.add(lower);
    bones.push(lower);

    const hand = new Bone();
    hand.name = `hand_${side}`;
    hand.position.set(0, ARM_LOWER, 0);
    lower.add(hand);
    bones.push(hand);

    // Knuckles: middle straight ahead, index and little finger out to either side, thumb low.
    hand.add(finger('middle', side, new Vector3(0, HAND_LENGTH, 0), bones));
    hand.add(finger('index', side, new Vector3(sign * 0.02, HAND_LENGTH * 0.95, 0.004), bones));
    hand.add(finger('ring', side, new Vector3(-sign * 0.02, HAND_LENGTH * 0.95, -0.002), bones));
    hand.add(finger('pink', side, new Vector3(-sign * 0.038, HAND_LENGTH * 0.85, -0.006), bones));
    hand.add(finger('thumb', side, new Vector3(sign * 0.03, HAND_LENGTH * 0.5, -0.02), bones));

    root.add(upper);
  }

  root.updateMatrixWorld(true);
  // `Skeleton` takes the bind pose from where the bones are now, which is why the tree is
  // built before this line and posed after it.
  const skeleton = new Skeleton(bones);
  const mesh = new SkinnedMesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial());
  mesh.name = 'hands-skin';
  mesh.bind(skeleton);
  root.add(mesh);
  return root;
}

/** A weapon to hold: a root, and the three nodes a hold is placed on. */
function fakeWeapon(withMagazine = true): { root: Object3D; targets: HandTargets } {
  const root = new Object3D();
  root.name = 'weapon';
  const node = (name: string, at: Vector3): Object3D => {
    const made = new Object3D();
    made.name = name;
    made.position.copy(at);
    root.add(made);
    return made;
  };
  const grip = node('socket_grip', new Vector3(0.01, -0.06, 0.04));
  const support = node('socket_support', new Vector3(-0.01, -0.02, -0.2));
  const magazine = withMagazine ? node('socket_mag_grip', new Vector3(0, -0.12, -0.02)) : null;
  return { root, targets: { grip, support, supportPose: 'handguard', magazine } };
}

function hands(weaponId = 'ar_carbine', withMagazine = true): { rig: ViewmodelHands; weapon: ReturnType<typeof fakeWeapon> } {
  const weapon = fakeWeapon(withMagazine);
  const rig = new ViewmodelHands(fakeRig(), weapon.root, weapon.targets, weaponId);
  weapon.root.add(rig.frame);
  return { rig, weapon };
}

/** Where a bone ends up, in the world the weapon is in. */
function worldOf(rig: ViewmodelHands, name: string): Vector3 {
  rig.frame.updateMatrixWorld(true);
  const node = rig.frame.getObjectByName(name) as Object3D;
  return new Vector3().setFromMatrixPosition(node.matrixWorld);
}

/** Every bone under the frame, by name, as position + quaternion. */
function pose(rig: ViewmodelHands): Map<string, { at: Vector3; turn: Quaternion; scale: Vector3 }> {
  const out = new Map<string, { at: Vector3; turn: Quaternion; scale: Vector3 }>();
  rig.frame.traverse((node) => {
    out.set(node.name, { at: node.position.clone(), turn: node.quaternion.clone(), scale: node.scale.clone() });
  });
  return out;
}

const BASE = new Object3D();
BASE.position.set(0.15, -0.13, -0.33);
BASE.updateMatrix();

// ---------------------------------------------------------------------------

describe('solveArm', () => {
  it('puts the elbow an upper arm from the shoulder and a forearm from the wrist', () => {
    const shoulder = new Vector3(0.25, -0.15, 0.05);
    const wrist = new Vector3(0.15, -0.2, -0.25);
    const elbow = solveArm(shoulder, wrist, new Vector3(1, -1, 0), UPPER, LOWER, new Vector3());
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(UPPER, 6);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(LOWER, 6);
  });

  it('bends the elbow toward the bend direction', () => {
    const shoulder = new Vector3(0, 0, 0);
    const wrist = new Vector3(0, 0, -0.4);
    const elbow = solveArm(shoulder, wrist, new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(elbow.y).toBeLessThan(0);
    expect(Math.abs(elbow.x)).toBeLessThan(1e-9);
  });

  it('slides the shoulder toward a wrist beyond reach, so the wrist is still reached', () => {
    const shoulder = new Vector3(0, 0, 0);
    const wrist = new Vector3(0, 0, -2);
    const elbow = solveArm(shoulder, wrist, new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(shoulder.distanceTo(wrist)).toBeCloseTo((UPPER + LOWER) * ARM_REACH_USED, 6);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(LOWER, 6);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(UPPER, 6);
  });

  it('pushes the shoulder back from a wrist closer than the arm can fold', () => {
    const shoulder = new Vector3(0, 0, 0);
    const wrist = new Vector3(0, 0, -0.01);
    solveArm(shoulder, wrist, new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(shoulder.distanceTo(wrist)).toBeGreaterThanOrEqual(UPPER - LOWER);
  });

  it('still finds an elbow when the bend lies along the arm', () => {
    const shoulder = new Vector3(0, 0, 0);
    const wrist = new Vector3(0, -0.4, 0);
    const elbow = solveArm(shoulder, wrist, new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(Number.isFinite(elbow.x) && Number.isFinite(elbow.y) && Number.isFinite(elbow.z)).toBe(true);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(LOWER, 6);
  });

  it('writes into the shoulder it was given, which is why the caller passes a scratch', () => {
    // Not a side effect to be tidied away: `poseArm` wants the slid shoulder, and the two
    // callers both hand in a vector they own. Pinned so a tidy-up has to be deliberate.
    const shoulder = new Vector3(0, 0, 0);
    const before = shoulder.clone();
    solveArm(shoulder, new Vector3(0, 0, -2), new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(shoulder.equals(before)).toBe(false);
  });

  it('leaves a reachable shoulder exactly where it was', () => {
    const shoulder = new Vector3(0.25, -0.15, 0.05);
    const before = shoulder.clone();
    solveArm(shoulder, new Vector3(0.15, -0.2, -0.25), new Vector3(1, -1, 0), UPPER, LOWER, new Vector3());
    expect(shoulder.equals(before)).toBe(true);
  });

  it('survives a wrist on the shoulder, rather than dividing by nothing', () => {
    const shoulder = new Vector3(0.1, 0.2, 0.3);
    const elbow = solveArm(shoulder, shoulder.clone(), new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(Number.isFinite(elbow.x) && Number.isFinite(elbow.y) && Number.isFinite(elbow.z)).toBe(true);
  });
});

describe('the holds the tuner is handed', () => {
  it('names three of them, each a full hand', () => {
    for (const [name, curl] of [
      ['knife', KNIFE_HOLD_CURL],
      ['grenade', GRENADE_HOLD_CURL],
      ['pinch', PINCH_HOLD_CURL],
    ] as const) {
      for (const f of FINGERS) {
        expect(curl[f], `${name}.${f}`).toHaveLength(3);
        for (const deg of curl[f]) expect(Number.isFinite(deg), `${name}.${f}`).toBe(true);
      }
    }
  });

  it('closes a fist round a knife harder than a pinch closes on a ring', () => {
    const total = (curl: Readonly<Record<FingerName, readonly number[]>>): number =>
      FINGERS.reduce((sum, f) => sum + curl[f].reduce((a, b) => a + Math.abs(b), 0), 0);
    expect(total(KNIFE_HOLD_CURL)).toBeGreaterThan(total(PINCH_HOLD_CURL));
  });

  it('prints a hold as the declaration the file holds', () => {
    const text = holdCurlSource('KNIFE_HOLD_CURL', KNIFE_HOLD_CURL);
    expect(text).toContain('KNIFE_HOLD_CURL');
    for (const f of FINGERS) expect(text).toContain(f);
  });
});

describe('adjustFrom', () => {
  it('turns a table row into the live object the tuner writes into', () => {
    const adjust = adjustFrom({ position: [0.01, -0.02, 0.03], rotation: [4, -5, 6], curl: 0.8 });
    expect(adjust.position.toArray()).toEqual([0.01, -0.02, 0.03]);
    expect(adjust.rotation.toArray()).toEqual([4, -5, 6]);
    expect(adjust.curl).toBe(0.8);
  });

  it('copies rather than aliases, so the shipped table cannot be edited through it', () => {
    const adjust = adjustFrom(NEUTRAL_HAND_POSE);
    adjust.position.x = 99;
    expect(NEUTRAL_HAND_POSE.position[0]).toBe(0);
  });
});

describe('reading the rig', () => {
  it('refuses a file with no skinned mesh, rather than posing nothing', () => {
    const bare = new Group();
    const bone = new Bone();
    bone.name = 'upperarm_R';
    bare.add(bone);
    const weapon = fakeWeapon();
    expect(() => new ViewmodelHands(bare, weapon.root, weapon.targets, 'ar_carbine')).toThrow(/skinned mesh/);
  });

  it('names the bones it needs, so a file that is missing one says which', () => {
    const rig = fakeRig();
    rig.getObjectByName('lowerarm_L')?.removeFromParent();
    const weapon = fakeWeapon();
    expect(() => new ViewmodelHands(rig, weapon.root, weapon.targets, 'ar_carbine')).toThrow(/lowerarm_L/);
  });

  it('says which finger is missing, not just that something is', () => {
    const rig = fakeRig();
    rig.getObjectByName('pink_R')?.removeFromParent();
    const weapon = fakeWeapon();
    expect(() => new ViewmodelHands(rig, weapon.root, weapon.targets, 'ar_carbine')).toThrow(/pink_R/);
  });

  it('clones the file, so two weapons on screen are two rigs', () => {
    const file = fakeRig();
    const a = fakeWeapon();
    const b = fakeWeapon();
    const first = new ViewmodelHands(file, a.root, a.targets, 'ar_carbine');
    const second = new ViewmodelHands(file, b.root, b.targets, 'pistol_talon');
    expect(first.frame).not.toBe(second.frame);
    expect(first.frame.getObjectByName('upperarm_R')).not.toBe(second.frame.getObjectByName('upperarm_R'));
  });

  it('turns off frustum culling, because the bounds are the bind pose’s and the arms move', () => {
    const { rig } = hands();
    let skinned = 0;
    rig.frame.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh) {
        skinned++;
        expect(node.frustumCulled).toBe(false);
      }
    });
    expect(skinned).toBeGreaterThan(0);
  });

  it('takes each hand’s corrections from the table, per weapon', () => {
    const plain = hands('nothing_has_this_id').rig;
    for (const side of ['grip', 'support', 'reload'] as const) {
      expect(plain.adjust[side].position.toArray(), side).toEqual([0, 0, 0]);
      expect(plain.adjust[side].curl, side).toBe(1);
    }
    // A weapon with a row gets its own, and they are not the neutral ones.
    const tuned = hands('ar_longbow').rig;
    const moved = (['grip', 'support', 'reload'] as const).some((s) => tuned.adjust[s].position.lengthSq() > 0);
    expect(moved).toBe(true);
  });

  it('gives each hand its own copy of its hold’s shape', () => {
    const a = hands().rig;
    const b = hands().rig;
    a.curl.grip.index[0] = 123;
    expect(b.curl.grip.index[0]).not.toBe(123);
    // And the three sides are three objects, not one shared.
    expect(a.curl.grip).not.toBe(a.curl.support);
    expect(a.curl.support).not.toBe(a.curl.reload);
  });
});

describe('posing', () => {
  it('carries each hand with the socket it holds, millimetre for millimetre', () => {
    // The place a hand lands is the hold's, the weapon's correction's and the solver's
    // together, and asserting that number would be asserting the arithmetic back at itself.
    // What the contract actually says is that the hand goes where the socket goes.
    for (const [side, which] of [['R', 'grip'], ['L', 'support']] as const) {
      const { rig, weapon } = hands();
      rig.update(BASE.matrix);
      const before = worldOf(rig, `hand_${side}`);
      const moved = new Vector3(0.03, -0.02, 0.04);
      weapon.targets[which].position.add(moved);
      weapon.root.updateMatrixWorld(true);
      rig.update(BASE.matrix);
      const after = worldOf(rig, `hand_${side}`);
      expect(after.clone().sub(before).distanceTo(moved), side).toBeLessThan(1e-6);
    }
  });

  it('leaves the other hand where it was when one socket moves', () => {
    const { rig, weapon } = hands();
    rig.update(BASE.matrix);
    const before = worldOf(rig, 'hand_R');
    weapon.targets.support.position.add(new Vector3(0.05, 0.05, 0.05));
    weapon.root.updateMatrixWorld(true);
    rig.update(BASE.matrix);
    expect(worldOf(rig, 'hand_R').distanceTo(before)).toBeLessThan(1e-9);
  });

  it('reaches a socket the arm would have to stretch for, by sliding the shoulder', () => {
    const { rig, weapon } = hands();
    // Two metres out: past any arm. `solveArm` slides the shoulder rather than leaving the
    // hand short, so the hand still follows the socket exactly.
    weapon.targets.grip.position.set(0, 0, -2);
    weapon.root.updateMatrixWorld(true);
    rig.update(BASE.matrix);
    const far = worldOf(rig, 'hand_R');
    weapon.targets.grip.position.set(0, 0, -2.5);
    weapon.root.updateMatrixWorld(true);
    rig.update(BASE.matrix);
    expect(worldOf(rig, 'hand_R').distanceTo(far)).toBeCloseTo(0.5, 6);
  });

  it('writes the frame’s matrix as the inverse of the base pose', () => {
    const { rig } = hands();
    rig.update(BASE.matrix);
    const product = BASE.matrix.clone().multiply(rig.frame.matrix);
    for (let i = 0; i < 16; i++) expect(product.elements[i] ?? 0).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9);
  });

  it('is a pure function of the frame: the same input twice gives the same bones', () => {
    const { rig } = hands();
    rig.update(BASE.matrix);
    const first = pose(rig);
    rig.update(BASE.matrix);
    const second = pose(rig);
    for (const [name, a] of first) {
      const b = second.get(name);
      expect(b?.at.equals(a.at), name).toBe(true);
      expect(b?.turn.equals(a.turn), name).toBe(true);
    }
  });

  it('bends every finger it was given a curl for', () => {
    const { rig } = hands();
    rig.update(BASE.matrix);
    const straight = pose(rig);
    for (const f of FINGERS) rig.curl.grip[f] = [40, 40, 40];
    rig.update(BASE.matrix);
    const curled = pose(rig);
    for (const f of FINGERS) {
      const name = `${f}_R`;
      expect(curled.get(name)?.turn.equals(straight.get(name)?.turn ?? new Quaternion()), name).toBe(false);
    }
  });

  it('scales the curl by the weapon’s own multiplier', () => {
    const { rig } = hands();
    for (const f of FINGERS) rig.curl.grip[f] = [40, 0, 0];
    rig.adjust.grip.curl = 0;
    rig.update(BASE.matrix);
    const none = pose(rig).get('index_R')?.turn.clone() as Quaternion;
    rig.adjust.grip.curl = 1;
    rig.update(BASE.matrix);
    const full = pose(rig).get('index_R')?.turn as Quaternion;
    expect(full.equals(none)).toBe(false);
  });
});

describe('the magazine hold', () => {
  /** The support hand's place, after a frame at the given hold. */
  function supportAt(rig: ViewmodelHands, hold: number): Vector3 {
    rig.magazineHold = hold;
    rig.update(BASE.matrix);
    return worldOf(rig, 'hand_L');
  }

  it('carries the support hand from its socket to the magazine', () => {
    const { rig } = hands();
    const onSocket = supportAt(rig, 0);
    const onMagazine = supportAt(rig, 1);
    // The two nodes are 18 cm apart in the fake weapon, so the hand has to have moved.
    expect(onMagazine.distanceTo(onSocket)).toBeGreaterThan(0.05);
  });

  it('is part way there part way through, and never past either end', () => {
    const { rig } = hands();
    const onSocket = supportAt(rig, 0);
    const onMagazine = supportAt(rig, 1);
    const span = onMagazine.distanceTo(onSocket);
    let previous = 0;
    for (let i = 1; i <= 10; i++) {
      const travelled = supportAt(rig, i / 10).distanceTo(onSocket);
      expect(travelled, String(i)).toBeGreaterThan(previous - 1e-9);
      expect(travelled, String(i)).toBeLessThanOrEqual(span + 1e-9);
      previous = travelled;
    }
  });

  it('stays on its socket when the weapon has no magazine to go to', () => {
    const { rig } = hands('ar_carbine', false);
    const onSocket = supportAt(rig, 0);
    expect(supportAt(rig, 1).distanceTo(onSocket)).toBeCloseTo(0, 12);
  });

  it('leaves the trigger hand alone through the whole of it', () => {
    const { rig } = hands();
    supportAt(rig, 0);
    const before = worldOf(rig, 'hand_R');
    supportAt(rig, 1);
    expect(worldOf(rig, 'hand_R').distanceTo(before)).toBeCloseTo(0, 12);
  });
});

describe('hiding an arm', () => {
  it('folds the side into its own shoulder rather than hiding a mesh', () => {
    const { rig } = hands();
    rig.update(BASE.matrix);
    const drawn = pose(rig).get('upperarm_L')?.scale.x as number;
    rig.showArm('L', false);
    rig.update(BASE.matrix);
    const folded = pose(rig).get('upperarm_L')?.scale.x as number;
    expect(drawn).toBeGreaterThan(0.1);
    expect(folded).toBeLessThan(1e-3);
    // Never zero: a singular matrix through `decompose` hands NaNs to the next question.
    expect(folded).toBeGreaterThan(0);
  });

  it('leaves the other arm posed, because a side is a bone chain and not a mesh', () => {
    const { rig } = hands();
    rig.update(BASE.matrix);
    const before = pose(rig).get('hand_R')?.at.clone() as Vector3;
    rig.showArm('L', false);
    rig.update(BASE.matrix);
    expect(pose(rig).get('hand_R')?.at.distanceTo(before)).toBeCloseTo(0, 12);
    expect(pose(rig).get('upperarm_R')?.scale.x).toBeGreaterThan(0.1);
  });

  it('brings it back', () => {
    const { rig } = hands();
    rig.showArm('L', false);
    rig.update(BASE.matrix);
    rig.showArm('L', true);
    rig.update(BASE.matrix);
    expect(pose(rig).get('upperarm_L')?.scale.x).toBeGreaterThan(0.1);
  });

  it('folds the trigger arm too, which is what the shield asks for', () => {
    const { rig } = hands();
    rig.showArm('R', false);
    rig.update(BASE.matrix);
    expect(pose(rig).get('upperarm_R')?.scale.x).toBeLessThan(1e-3);
    expect(pose(rig).get('upperarm_L')?.scale.x).toBeGreaterThan(0.1);
  });
});

describe('dispose', () => {
  it('takes the frame off the weapon and empties it', () => {
    const { rig, weapon } = hands();
    expect(weapon.root.children).toContain(rig.frame);
    rig.dispose();
    expect(weapon.root.children).not.toContain(rig.frame);
    expect(rig.frame.children).toHaveLength(0);
  });
});

