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
 * trigger hand on `socket_grip`, the support hand on `socket_support`. On a reload the support
 * hand goes to a third, on the magazine itself (`socket_mag_grip`, `magazineHold`), rides it out
 * and back, and returns.
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
 * What the holding hand is holding: a weapon's grip, or a knife's handle.
 *
 * A trigger hand is not a fist — its index lies along the frame and its thumb stands off, which
 * is what a trigger and a safety need and is wrong for anything without them. A knife is held
 * in a closed fist, so it asks for a hold of its own rather than for the trigger hand with the
 * fingers turned up.
 */
export type GripPose = 'grip' | 'knife';

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

/**
 * The points a weapon is held by, as nodes under the weapon's root: the two hands' sockets,
 * and where the support hand takes the magazine on a reload — a node **under the magazine**,
 * so it goes where the magazine goes and turns as it tumbles (null on a model with nothing to
 * hang it on).
 */
export interface HandTargets {
  readonly grip: THREE.Object3D;
  readonly support: THREE.Object3D;
  readonly supportPose: SupportPose;
  /** Which hold the holding hand uses. Absent is a weapon's trigger hand. */
  readonly gripPose?: GripPose;
  readonly magazine: THREE.Object3D | null;
}

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pink';
export const FINGERS: readonly FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pink'];
/** One finger's three segments, knuckle first, in degrees from straight. */
export type FingerCurl = [number, number, number];

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

const HOLDS: Readonly<Record<'grip' | SupportPose | 'magazine' | 'knife', Hold>> = {
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
  /**
   * The support hand on a magazine during a reload, in the **magazine's** space: the palm on its
   * left face, the knuckles at its front edge and the fingers round the front, as a hand takes a
   * magazine out of a well. `socket_mag_grip` is the magazine's middle, so the knuckles go 2.6 cm
   * to its left and 3.5 cm ahead of it. The tuner's `reload` pose corrects it per weapon.
   */
  magazine: {
    fingers: [0, -0.3, -1],
    palm: [1, 0, 0],
    knuckles: [-0.026, 0, -0.035],
    curl: { thumb: [10, 20, 15], index: [50, 60, 40], middle: [55, 65, 40], ring: [55, 65, 40], pink: [60, 65, 40] },
  },
  /**
   * A knife in a hammer grip, in the knife's own space: the handle runs fore-and-aft through
   * the fist with the blade ahead of it, so the knuckles sit **on top of** the handle a little
   * ahead of its middle, the fingers wrap down the far side and the thumb lies back along the
   * spine. Every finger is curled hard — there is nothing here to keep clear of, unlike a
   * trigger guard — which is what makes it read as a fist round a grip rather than a hand
   * resting on one.
   */
  knife: {
    fingers: [0, -0.25, -1],
    palm: [0, -1, 0],
    knuckles: [0, 0.022, -0.012],
    // Shaped by the human in the hand tuner (2026-09-24). The tips do most of the closing and
    // the knuckles least, which is what a fist round a 3 cm handle is: the fingers reach over
    // it and hook, rather than folding into the palm the way an empty fist does. The thumb
    // barely bends — it lies along the spine of the grip instead of wrapping it.
    curl: { thumb: [20, 9, 20], index: [20, 35, 80], middle: [30, 35, 80], ring: [30, 35, 80], pink: [20, 35, 80] },
  },
};

/** The shipped knife wrap, for the hand tuner's reset. The table above is the source. */
export const KNIFE_HOLD_CURL: Readonly<Record<FingerName, FingerCurl>> = HOLDS.knife.curl as Record<FingerName, FingerCurl>;

/** Where a hand is put this frame, in the frame: its wrist, its turn, and each finger's bend in degrees. */
interface Placement {
  readonly wrist: THREE.Vector3;
  readonly turn: THREE.Quaternion;
  readonly curl: Readonly<Record<FingerName, readonly [number, number, number]>>;
}

/**
 * What a hidden arm's upper bone is scaled to: small enough to vanish, never zero.
 *
 * Zero would put a singular matrix through `decompose` and hand NaNs to whatever asked the
 * skeleton a question next. A ten-thousandth folds a 26 cm forearm into 26 microns, at a
 * shoulder that is behind the camera anyway.
 */
const HIDDEN_ARM_SCALE = 1e-4;

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

/** A hand part way from one placement to another: its wrist, its turn and its fingers. */
function blend(from: Placement, to: Placement, t: number): Placement {
  const curl = {} as Record<FingerName, [number, number, number]>;
  for (const f of FINGERS) curl[f] = from.curl[f].map((deg, i) => THREE.MathUtils.lerp(deg, to.curl[f][i] ?? deg, t)) as [number, number, number];
  return { wrist: from.wrist.clone().lerp(to.wrist, t), turn: from.turn.clone().slerp(to.turn, t), curl };
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

  /**
   * How far each finger closes, per hand, in degrees — this instance's copy of its holds'.
   *
   * The holds above are the shipped shapes; this is what is actually posed, so the hand tuner
   * can open a finger that goes through a handle and close one that floats off it without
   * every weapon in the game changing with it. `adjust[side].curl` still scales the lot, which
   * is the one number a weapon's own entry in `HAND_POSES` carries.
   */
  readonly curl: Record<HandSide, Record<FingerName, FingerCurl>>;
  private readonly rig: THREE.Object3D;
  private readonly arms: Record<'R' | 'L', Arm>;
  /** Sides that are not posed this frame, collapsed instead — see `showArm`. */
  private readonly hidden = new Set<'R' | 'L'>();

  constructor(
    template: THREE.Object3D,
    private readonly weaponRoot: THREE.Object3D,
    private readonly targets: HandTargets,
    weaponId: string,
  ) {
    this.adjust = {
      grip: adjustFrom(handPoseFor(weaponId, 'grip')),
      support: adjustFrom(handPoseFor(weaponId, 'support')),
      reload: adjustFrom(handPoseFor(weaponId, 'reload')),
    };
    const copyCurl = (hold: Hold): Record<FingerName, FingerCurl> => {
      const out = {} as Record<FingerName, FingerCurl>;
      for (const f of FINGERS) out[f] = [...hold.curl[f]] as FingerCurl;
      return out;
    };
    this.curl = {
      grip: copyCurl(HOLDS[targets.gripPose ?? 'grip']),
      support: copyCurl(HOLDS[targets.supportPose]),
      reload: copyCurl(HOLDS.magazine),
    };
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
    this.rootInverse.copy(root.matrixWorld).invert();
    base.decompose(this.basePosition, this.baseTurn, this.baseScale);
    if (this.hidden.has('R')) this.collapse(this.arms.R);
    else {
      const hold = HOLDS[this.targets.gripPose ?? 'grip'];
      this.poseArm(this.arms.R, this.place(this.arms.R, this.targets.grip, hold, this.adjust.grip, base, 'grip'));
    }
    if (this.hidden.has('L')) {
      this.collapse(this.arms.L);
      return;
    }
    let support = this.place(this.arms.L, this.targets.support, HOLDS[this.targets.supportPose], this.adjust.support, base, 'support');
    const onMagazine = this.magazineHold;
    if (onMagazine > 0 && this.targets.magazine !== null) {
      support = blend(support, this.place(this.arms.L, this.targets.magazine, HOLDS.magazine, this.adjust.reload, base, 'reload'), onMagazine);
    }
    this.poseArm(this.arms.L, support);
  }

  /**
   * Draw one arm or not (the knife, 2026-09-23).
   *
   * A knife is held in one hand and the rifle is off screen while it swings, so the other arm
   * has nothing to hold and nowhere to be: drawn, it stands in frame holding air.
   *
   * **Not by hiding a mesh**, which is what this did first and is the shape of the file's trap:
   * its two skinned meshes are split by *material* — `glove_hardknuckle` and
   * `sleeve_st6_generalist` — and each one spans **both** arms. Hiding the one the left bones
   * dominate took away every glove and every finger and left two empty sleeves, which is what
   * the tuner showed. A side is a bone chain, not a mesh, so a hidden side is one whose upper
   * arm is collapsed to nothing and left unposed: its vertices land on its own shoulder, which
   * is behind the camera, and the other arm is untouched.
   */
  showArm(side: 'R' | 'L', visible: boolean): void {
    if (visible) this.hidden.delete(side);
    else {
      this.hidden.add(side);
      this.collapse(this.arms[side]);
    }
  }

  /** A hidden arm, folded into its own shoulder. `poseArm` would write the scale back. */
  private collapse(arm: Arm): void {
    arm.upper.scale.setScalar(HIDDEN_ARM_SCALE);
    arm.upper.updateMatrixWorld(true);
  }

  /**
   * How far the support hand has gone from its grip to the magazine, 0..1 — `ViewmodelAnim`
   * sets it through a reload, leaving over the dip and returning over the raise. The hand's
   * place, turn and fingers are blended between the two holds by it, so the glove travels from
   * the handguard to the magazine, rides it out and back on the magazine's own node, and
   * returns, and neither hold's pose disturbs the other's.
   */
  magazineHold = 0;

  private readonly basePosition = new THREE.Vector3();
  private readonly baseTurn = new THREE.Quaternion();
  private readonly baseScale = new THREE.Vector3();
  private readonly rootInverse = new THREE.Matrix4();

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

  /**
   * Where a hold puts a hand on a target, in the frame. The target's own place and turn under
   * the weapon's root come first — the sockets' turn is none, the magazine's is whatever the
   * reload gives it — then this weapon's correction in the target's space, then the base pose.
   */
  private place(arm: Arm, target: THREE.Object3D, hold: Hold, adjust: HandAdjust, base: THREE.Matrix4, side: HandSide): Placement {
    const inRoot = this.rootInverse.clone().multiply(target.matrixWorld);
    const socket = new THREE.Vector3();
    const socketTurn = new THREE.Quaternion();
    inRoot.decompose(socket, socketTurn, new THREE.Vector3());
    const at = socket.add(adjust.position.clone().applyQuaternion(socketTurn)).applyMatrix4(base);
    const r = adjust.rotation;
    const correction = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(r.x), THREE.MathUtils.degToRad(r.y), THREE.MathUtils.degToRad(r.z), 'XYZ'),
    );
    const turn = this.baseTurn.clone().multiply(socketTurn).multiply(correction);
    const knuckles = new THREE.Vector3(...hold.fingers).normalize().applyQuaternion(turn);
    const palm = new THREE.Vector3(...hold.palm).applyQuaternion(turn);
    palm.addScaledVector(knuckles, -palm.dot(knuckles)).normalize();
    const wanted = new THREE.Matrix4().makeBasis(knuckles, palm, knuckles.clone().cross(palm));
    const handTurn = new THREE.Quaternion().setFromRotationMatrix(wanted.multiply(arm.handBasis.clone().transpose()));
    const wrist = at
      .clone()
      .add(new THREE.Vector3(...hold.knuckles).applyQuaternion(turn))
      .addScaledVector(knuckles, -arm.handLength);
    const curl = {} as Record<FingerName, FingerCurl>;
    const shape = this.curl[side];
    for (const f of FINGERS) curl[f] = shape[f].map((deg) => deg * adjust.curl) as FingerCurl;
    return { wrist, turn: handTurn, curl };
  }

  private poseArm(arm: Arm, placement: Placement): void {
    const { wrist, turn: handTurn } = placement;
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
      const angles = placement.curl[name];
      bones.forEach((f, i) => {
        const deg = angles[i] ?? 0;
        f.bone.quaternion.copy(f.straight).multiply(curl.setFromAxisAngle(f.curlAxis, THREE.MathUtils.degToRad(deg)));
      });
    }
    arm.upper.updateMatrixWorld(true);
  }
}

/**
 * A hold's finger angles as source, in `HOLDS`' own shape — what the hand tuner prints so a
 * wrap shaped by eye can be pasted back into the table it came from.
 */
export function holdCurlSource(name: string, curl: Readonly<Record<FingerName, FingerCurl>>): string {
  const one = (f: FingerName): string => `${f}: [${curl[f].map((v) => Math.round(v)).join(', ')}]`;
  return `    // ${name}
    curl: { ${FINGERS.map(one).join(', ')} },`;
}
