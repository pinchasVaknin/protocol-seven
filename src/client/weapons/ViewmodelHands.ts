import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { handPoseFor, type HandPose, type HandSide } from './HandPoses';

/**
 * The first-person arms (M19, stage 4): *Hand With Gloves*, posed on the weapon every frame.
 *
 * The grey boxes were a trigger hand and a support hand merged into the weapon's mesh at its
 * two hand sockets. This is the artist's rig — two gloved forearms on a skeleton with every
 * finger — and it is **posed, not animated**: each arm is a two-bone chain whose hand is put on
 * a target and whose elbow falls where the upper arm's length and a bend direction put it,
 * and each hand closes into a grip from the bind pose's straight fingers. The targets are the
 * same two points the boxes stood on, so nothing about where a weapon is held changes: the
 * trigger hand on `socket_grip`, the support hand on `socket_support` — carried by the node
 * `ViewmodelAnim` already moves during a reload, so the glove still rides the magazine out and
 * back.
 *
 * **Where the rig lives.** Under the weapon's root, so it is hidden, swapped and disposed with
 * the weapon and nothing in `ClientMatch` learns about it. Its frame is the inverse of the
 * weapon's **base pose** — hip to ADS, sprint, swap and reload, before bob, idle drift, sway
 * and recoil (`ViewmodelAnim`) — so the rig stands in camera space as the base pose sees it, the
 * eye at the origin where the build put the rig's own camera bone. The arms are solved there,
 * from shoulders (`SHOULDERS`) that do not move, and the rest of the frame's motion carries gun
 * and arms together. Solving against the final pose instead, from the same shoulders, swung the
 * elbows 9–15 cm across the gun whenever the view turned or the player walked (the first
 * playtest of the arms): the gloves stayed on the grips and the sleeves went through the gun.
 *
 * The upper arms are not drawn — the sleeves stop at the elbow — so their length and the
 * shoulder they hang from only decide the angle the forearm comes into the picture at. A hand
 * further than the arm can reach slides its shoulder toward it rather than stopping short: a
 * glove that leaves the grip is the one thing this must not do.
 */

/** How the support hand holds the weapon: under a handguard, or wrapped round the trigger hand. */
export type SupportPose = 'handguard' | 'wrap';

/**
 * A hand's correction on this weapon, live (`HandPoses`): metres added to the socket in weapon
 * space, degrees turning the hold about the socket (pitch x, yaw y, roll z, in that order), and a
 * multiplier on the fingers' bend. The hand tuner writes these; the next `update` shows them.
 */
export interface HandAdjust {
  readonly position: THREE.Vector3;
  /** Degrees. */
  readonly rotation: THREE.Vector3;
  curl: number;
}

/** A pose from the table as a live adjustment. */
export function adjustFrom(pose: HandPose): HandAdjust {
  return { position: new THREE.Vector3(...pose.position), rotation: new THREE.Vector3(...pose.rotation), curl: pose.curl };
}

/** The two points a weapon is held by, as nodes under the weapon's root. */
export interface HandTargets {
  readonly grip: THREE.Object3D;
  readonly support: THREE.Object3D;
  readonly supportPose: SupportPose;
}

type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pink';
const FINGERS: readonly FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pink'];

/**
 * A hand's hold, in weapon space: `fingers` the direction from the wrist to the knuckles, `palm`
 * the direction out of the palm (toward what it holds), and `knuckles` where the middle
 * finger's knuckle goes, metres from the target. The knuckles are the datum because they are
 * what has to sit **on the edge** the fingers wrap round: with the palm's centre on the target
 * instead, they stood 3–5 cm past the edge and the fingers curled up out of the air. `curl` is
 * degrees per finger segment, knuckle first, from straight.
 */
interface Hold {
  readonly fingers: readonly [number, number, number];
  readonly palm: readonly [number, number, number];
  readonly knuckles: readonly [number, number, number];
  readonly curl: Readonly<Record<FingerName, readonly [number, number, number]>>;
}

const HOLDS: Readonly<Record<'grip' | SupportPose, Hold>> = {
  /**
   * The trigger hand on a pistol grip: the palm against the grip's right-hand side, the
   * knuckles forward and a little down, three fingers wrapped round the front strap and the
   * index lying along the frame toward the trigger.
   */
  grip: {
    fingers: [0, -0.2, -1],
    palm: [-1, 0, 0],
    knuckles: [0.028, 0, -0.015],
    curl: { thumb: [10, 30, 20], index: [15, 20, 10], middle: [75, 85, 45], ring: [80, 85, 45], pink: [85, 85, 45] },
  },
  /**
   * The support hand on a handguard, thumb over the bore: the palm on the guard's left face,
   * the knuckles along its bottom-left edge, the fingers wrapped under it and up its right
   * side, and the thumb lying forward along the top. The glove's fingers are 11 cm from the
   * knuckle and a handguard is 4–5 cm on a side, so they wrap more than half way round
   * whichever way the hand goes. Cupped from below, palm up, they came over the top beside the
   * front post and stood in the sight picture at ADS; this way they end at the right-hand top
   * edge, low and to the right of it. `socket_support` is where the box glove's centre stood,
   * about 1.8 cm under the guard, so the knuckles go 1.8 cm above it and 3 cm to its left.
   */
  handguard: {
    fingers: [0, -0.35, -0.94],
    palm: [1, 0, 0],
    knuckles: [-0.03, 0.018, 0],
    curl: { thumb: [0, 0, 0], index: [50, 60, 40], middle: [50, 60, 40], ring: [55, 60, 40], pink: [60, 60, 40] },
  },
  /** The support hand on a pistol: the palm against the grip's left side, over the trigger hand's fingers. */
  wrap: {
    fingers: [0, -0.4, -1],
    palm: [1, 0, 0],
    knuckles: [-0.042, -0.006, -0.014],
    curl: { thumb: [10, 25, 20], index: [60, 70, 40], middle: [70, 80, 40], ring: [75, 80, 40], pink: [80, 80, 40] },
  },
};

/** The elbows bend outward and down, the way a shouldered weapon's do. Camera space. */
const BEND: Readonly<Record<'R' | 'L', THREE.Vector3>> = {
  R: new THREE.Vector3(1, -1.2, 0).normalize(),
  L: new THREE.Vector3(-0.35, -1, 0.35).normalize(),
};

/**
 * Where each arm hangs from, camera space, metres. The artist's shoulders are 15 cm under the
 * eye, which is right for the gesture the file is posed in and wrong for a rifle held out in
 * front: a support arm that nearly straightens runs from there across the bottom of the frame
 * a hand's width from the lens, all sleeve. The upper arm is never drawn, so the shoulder is
 * a free choice, and low is the one that brings each forearm up into the picture from below.
 */
const SHOULDERS: Readonly<Record<'R' | 'L', THREE.Vector3>> = {
  R: new THREE.Vector3(0.24, -0.3, 0.08),
  L: new THREE.Vector3(-0.2, -0.42, -0.02),
};

/** How much of the arm's full length a solved arm uses at most; past it the shoulder slides. */
export const ARM_REACH_USED = 0.92;

const Y = new THREE.Vector3(0, 1, 0);

/**
 * The elbow of a two-bone arm (pure; exported for the tests).
 *
 * `shoulder` is moved toward `wrist` when the wrist is beyond `ARM_REACH_USED` of the arm's
 * length, and away from it when the wrist is closer than the two bones can fold — the wrist is
 * always reached. The elbow is on the side of `bend` (only its part square to the arm counts).
 */
export function solveArm(
  shoulder: THREE.Vector3,
  wrist: THREE.Vector3,
  bend: THREE.Vector3,
  upper: number,
  lower: number,
  elbow: THREE.Vector3,
): THREE.Vector3 {
  const u = new THREE.Vector3().subVectors(wrist, shoulder);
  let dist = u.length();
  if (dist < 1e-9) {
    u.set(0, 0, -1);
    dist = 0;
  } else {
    u.divideScalar(dist);
  }
  const far = (upper + lower) * ARM_REACH_USED;
  const near = Math.abs(upper - lower) + 1e-3;
  const reach = Math.min(Math.max(dist, near), far);
  if (reach !== dist) {
    shoulder.copy(wrist).addScaledVector(u, -reach);
    dist = reach;
  }
  const a = (upper * upper - lower * lower + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  // The bend's part square to the arm; any square direction when the bend lies along it.
  const side = bend.clone().addScaledVector(u, -bend.dot(u));
  if (side.lengthSq() < 1e-12) side.set(1, 0, 0).addScaledVector(u, -u.x);
  if (side.lengthSq() < 1e-12) side.set(0, 1, 0).addScaledVector(u, -u.y);
  side.normalize();
  return elbow.copy(shoulder).addScaledVector(u, a).addScaledVector(side, h);
}

/** Turn `q` by the least rotation that points its local +Y along `dir`. */
function aim(q: THREE.Quaternion, dir: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const axis = Y.clone().applyQuaternion(q);
  const swing = new THREE.Quaternion().setFromUnitVectors(axis, dir.clone().normalize());
  return out.copy(swing).multiply(q);
}

interface FingerBone {
  readonly bone: THREE.Bone;
  /** The bone's rotation from its parent in the bind pose, where every finger is straight. */
  readonly straight: THREE.Quaternion;
  /** The axis, in the bone's own frame, that curls it toward the palm. */
  readonly curlAxis: THREE.Vector3;
}

interface Arm {
  readonly side: 'R' | 'L';
  readonly upper: THREE.Bone;
  readonly lower: THREE.Bone;
  readonly hand: THREE.Bone;
  /** Rest, in the frame: the upper arm's rotation and scale. */
  readonly upperRest: THREE.Quaternion;
  readonly upperScale: number;
  /** The upper arm's parent's frame matrix, inverted: the shoulders are never moved. */
  readonly parentFrameInverse: THREE.Matrix4;
  readonly upperLength: number;
  readonly lowerLength: number;
  /** Wrist to the middle finger's knuckle, metres. */
  readonly handLength: number;
  /** The hand's rotation from the forearm in the bind pose: a straight wrist. */
  readonly wristStraight: THREE.Quaternion;
  /** The hand's own axes — knuckles, palm, and their cross — as the columns of a basis. */
  readonly handBasis: THREE.Matrix4;
  readonly fingers: ReadonlyMap<FingerName, readonly FingerBone[]>;
}

export class ViewmodelHands {
  /** Added under the weapon's root; its matrix is written every frame (see the header). */
  readonly frame = new THREE.Group();
  /** This weapon's corrections to each hand, from `HAND_POSES`; the hand tuner edits them live. */
  readonly adjust: Record<HandSide, HandAdjust>;
  private readonly rig: THREE.Object3D;
  private readonly arms: Record<'R' | 'L', Arm>;

  constructor(
    template: THREE.Object3D,
    private readonly weaponRoot: THREE.Object3D,
    private readonly targets: HandTargets,
    weaponId: string,
  ) {
    this.adjust = { grip: adjustFrom(handPoseFor(weaponId, 'grip')), support: adjustFrom(handPoseFor(weaponId, 'support')) };
    this.rig = cloneSkinned(template);
    this.rig.name = 'viewmodel:hands';
    this.frame.name = 'viewmodel:hands-frame';
    this.frame.matrixAutoUpdate = false;
    this.frame.add(this.rig);
    let skeleton: THREE.Skeleton | null = null;
    this.rig.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      // The arms move every frame, and their bounds are the bind pose's, metres away.
      mesh.frustumCulled = false;
      skeleton ??= mesh.skeleton;
    });
    if (skeleton === null) throw new Error('Hands file has no skinned mesh.');
    this.frame.updateMatrixWorld(true);
    this.arms = { R: this.readArm('R', skeleton), L: this.readArm('L', skeleton) };
  }

  /**
   * Pose both arms on the weapon's targets, after the weapon's root has its pose for the frame.
   *
   * `base` is the weapon's pose before bob, idle drift, sway and recoil (`ViewmodelAnim`): the
   * arms are solved against it, in a frame whose matrix is its inverse, so the frame stands in
   * camera space *as the base pose sees it* and the difference between the base and the final
   * pose carries gun and arms together. With `base` the root's own matrix the arms would be
   * solved against every sway and bob, from shoulders that do not sway.
   */
  update(base: THREE.Matrix4): void {
    const root = this.weaponRoot;
    this.frame.matrix.copy(base).invert();
    root.updateMatrixWorld(true);
    base.decompose(this.basePosition, this.baseTurn, this.baseScale);
    this.poseArm(this.arms.R, this.targets.grip, HOLDS.grip, this.adjust.grip, base);
    this.poseArm(this.arms.L, this.targets.support, HOLDS[this.targets.supportPose], this.adjust.support, base);
  }

  private readonly basePosition = new THREE.Vector3();
  private readonly baseTurn = new THREE.Quaternion();
  private readonly baseScale = new THREE.Vector3();

  dispose(): void {
    this.frame.removeFromParent();
    this.frame.clear();
  }

  private readArm(side: 'R' | 'L', skeleton: THREE.Skeleton): Arm {
    const bone = (name: string): THREE.Bone => {
      const found = this.rig.getObjectByName(name) as THREE.Bone | undefined;
      if (found === undefined || !found.isBone) throw new Error(`Hands file has no bone "${name}".`);
      return found;
    };
    const upper = bone(`upperarm_${side}`);
    const lower = bone(`lowerarm_${side}`);
    const hand = bone(`hand_${side}`);
    const frameInverse = this.frame.matrixWorld.clone().invert();
    const inFrame = (node: THREE.Object3D): THREE.Matrix4 => frameInverse.clone().multiply(node.matrixWorld);
    const position = (node: THREE.Object3D): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(inFrame(node));

    const upperFrame = inFrame(upper);
    const shoulder = new THREE.Vector3();
    const upperRest = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    upperFrame.decompose(shoulder, upperRest, scale);
    const parent = upper.parent;
    if (parent === null) throw new Error(`Hands bone "upperarm_${side}" has no parent.`);

    // The bind pose, from the skeleton's inverse bind matrices: every finger straight, the wrist
    // in line with the forearm. The rest pose the file carries is a hand gesture.
    const bindWorld = (b: THREE.Bone): THREE.Matrix4 => {
      const index = skeleton.bones.indexOf(b);
      if (index < 0) throw new Error(`Hands bone "${b.name}" is not in the skeleton.`);
      return skeleton.boneInverses[index]!.clone().invert();
    };
    const bindLocal = (b: THREE.Bone): THREE.Quaternion => {
      const local = bindWorld(b.parent as THREE.Bone).invert().multiply(bindWorld(b));
      const q = new THREE.Quaternion();
      local.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      return q;
    };

    const chainOf = (finger: FingerName): THREE.Bone[] => {
      const start = hand.children.find((c) => c.name === `${finger}_${side}`) as THREE.Bone | undefined;
      if (start === undefined) throw new Error(`Hands bone "${finger}_${side}" is missing under hand_${side}.`);
      const chain: THREE.Bone[] = [];
      for (let b: THREE.Object3D | undefined = start; b !== undefined && (b as THREE.Bone).isBone; b = b.children.find((c) => (c as THREE.Bone).isBone)) {
        chain.push(b as THREE.Bone);
      }
      return chain;
    };
    const chains = new Map(FINGERS.map((f) => [f, chainOf(f)] as const));

    // The hand's own axes, from where its fingers start (the same at rest and in the bind pose):
    // knuckles along the middle finger, the knuckle line from little finger to index, and the
    // palm square to both — `t × f` on a right hand, `f × t` on a left.
    const start = (f: FingerName): THREE.Vector3 => chains.get(f)![0]!.position.clone();
    const knuckles = start('middle').normalize();
    const across = start('index').sub(start('pink'));
    const palm = side === 'R' ? across.clone().cross(knuckles) : knuckles.clone().cross(across);
    palm.addScaledVector(knuckles, -palm.dot(knuckles)).normalize();
    const handBasis = new THREE.Matrix4().makeBasis(knuckles, palm, knuckles.clone().cross(palm));

    // Each finger bone's curl axis: square to the bone and to the palm, in the bind pose.
    const handBind = bindWorld(hand);
    const bindPos = (b: THREE.Bone): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(bindWorld(b));
    const palmWorld = palm.clone().transformDirection(handBind);
    const fingers = new Map<FingerName, FingerBone[]>();
    for (const [name, chain] of chains) {
      const bones: FingerBone[] = [];
      chain.forEach((b, i) => {
        const next = chain[i + 1];
        const from = i > 0 ? chain[i - 1]! : null;
        const dir = next !== undefined ? bindPos(next).sub(bindPos(b)) : bindPos(b).sub(bindPos(from ?? hand));
        const axisWorld = dir.normalize().cross(palmWorld).normalize();
        const bindRotation = new THREE.Quaternion();
        bindWorld(b).decompose(new THREE.Vector3(), bindRotation, new THREE.Vector3());
        bones.push({ bone: b, straight: bindLocal(b), curlAxis: axisWorld.applyQuaternion(bindRotation.invert()).normalize() });
      });
      fingers.set(name, bones);
    }

    return {
      side,
      upper,
      lower,
      hand,
      upperRest,
      upperScale: scale.x,
      parentFrameInverse: inFrame(parent).invert(),
      upperLength: position(lower).distanceTo(shoulder),
      lowerLength: position(hand).distanceTo(position(lower)),
      handLength: position(chains.get('middle')![0]!).distanceTo(position(hand)),
      wristStraight: bindLocal(hand),
      handBasis,
      fingers,
    };
  }

  private poseArm(arm: Arm, target: THREE.Object3D, hold: Hold, adjust: HandAdjust, base: THREE.Matrix4): void {
    // The target and the hold's turn in the frame: the socket moved by this weapon's
    // correction, then placed where the base pose puts it; the hold turned by the correction
    // in weapon space, then by the base pose.
    const at = this.weaponRoot.worldToLocal(target.getWorldPosition(new THREE.Vector3())).add(adjust.position).applyMatrix4(base);
    const r = adjust.rotation;
    const correction = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(r.x), THREE.MathUtils.degToRad(r.y), THREE.MathUtils.degToRad(r.z), 'XYZ'),
    );
    const turn = this.baseTurn.clone().multiply(correction);
    const knuckles = new THREE.Vector3(...hold.fingers).normalize().applyQuaternion(turn);
    const palm = new THREE.Vector3(...hold.palm).applyQuaternion(turn);
    palm.addScaledVector(knuckles, -palm.dot(knuckles)).normalize();
    const wanted = new THREE.Matrix4().makeBasis(knuckles, palm, knuckles.clone().cross(palm));
    const handTurn = new THREE.Quaternion().setFromRotationMatrix(wanted.multiply(arm.handBasis.clone().transpose()));

    const wrist = at
      .clone()
      .add(new THREE.Vector3(...hold.knuckles).applyQuaternion(turn))
      .addScaledVector(knuckles, -arm.handLength);
    const shoulder = SHOULDERS[arm.side].clone();
    const elbow = solveArm(shoulder, wrist, BEND[arm.side], arm.upperLength, arm.lowerLength, new THREE.Vector3());

    const upperTurn = aim(arm.upperRest, elbow.clone().sub(shoulder), new THREE.Quaternion());
    const local = arm.parentFrameInverse
      .clone()
      .multiply(new THREE.Matrix4().compose(shoulder, upperTurn, new THREE.Vector3().setScalar(arm.upperScale)));
    local.decompose(arm.upper.position, arm.upper.quaternion, arm.upper.scale);

    // The forearm takes the roll the hand needs, so the wrist bends and does not wring.
    const natural = handTurn.clone().multiply(arm.wristStraight.clone().invert());
    const lowerTurn = aim(natural, wrist.clone().sub(elbow), new THREE.Quaternion());
    arm.lower.quaternion.copy(upperTurn).invert().multiply(lowerTurn);
    arm.hand.quaternion.copy(lowerTurn).invert().multiply(handTurn);

    const curl = new THREE.Quaternion();
    for (const [name, bones] of arm.fingers) {
      const angles = hold.curl[name];
      bones.forEach((f, i) => {
        const deg = (angles[i] ?? 0) * adjust.curl;
        f.bone.quaternion.copy(f.straight).multiply(curl.setFromAxisAngle(f.curlAxis, THREE.MathUtils.degToRad(deg)));
      });
    }
    arm.upper.updateMatrixWorld(true);
  }
}
