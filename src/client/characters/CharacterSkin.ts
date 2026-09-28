import * as THREE from 'three';
import {
  stockShift,
  type ActorIndicatorAnchor,
  type ActorIndicatorFrameAnchor,
  type HeldEquipmentAsset,
  type HeldWeaponAsset,
} from './ActorAvatar';
import type { CharacterIndicatorPadProfile, CharacterRigProfile } from './CharacterCatalog';
import { WeaponSupportHandConstraint } from './WeaponSupportHandConstraint';

/**
 * How far from the wrist to the middle knuckle a grenade sits: a little past halfway, which is the
 * middle of the palm rather than the heel of it. See `CharacterSkin.configureGrenadeSocket`.
 */
const PALM_ALONG = 0.55;
/**
 * Metres from the hand bone's axis to the grenade's middle, out of the palm: the half-thickness
 * of a hand and the half-width of a frag's body, so the one rests on the other.
 */
const GRENADE_OFF_PALM_M = 0.035;

/**
 * One cloned skin and its cosmetic attachments.
 *
 * Geometry, textures, materials, and skeleton source data are shared by the repository. The
 * skin has no viewer-relative material mutation: its authored textures are the same for every
 * team, while the renderer owns separate IFF markers and nameplates.
 */
export class CharacterSkin {
  readonly root = new THREE.Group();

  private readonly weaponSocket = new THREE.Group();
  /** Where a grenade sits in the same hand: on the palm, measured from its bones. See `configureGrenadeSocket`. */
  private readonly grenadeSocket = new THREE.Group();
  private readonly supportGripTarget = new THREE.Object3D();
  private readonly supportHandConstraint: WeaponSupportHandConstraint;
  private readonly headBone: THREE.Object3D;
  /** One calibrated node per shoulder, parented to its upper-arm bone; the pads' frames. */
  private readonly shoulderFrames: Readonly<Record<ActorIndicatorFrameAnchor, THREE.Object3D>>;
  private weapon: THREE.Object3D | null = null;
  private heldAsset: HeldWeaponAsset | null = null;
  private hasSupportGrip = false;
  /** A throw has the hand: the weapon is hidden and the support hand left alone. See `setThrow`. */
  private weaponAway = false;
  private grenade: THREE.Object3D | null = null;
  private grenadeAsset: HeldEquipmentAsset | null = null;

  constructor(instance: THREE.Object3D, rig: CharacterRigProfile) {
    this.root.name = `character-skin:${rig.id}`;
    this.root.rotation.y = rig.modelYaw;
    this.root.scale.setScalar(rig.modelScale);
    this.prepareMeshes(instance);

    const hand = instance.getObjectByName(rig.weaponBone);
    if (hand === undefined) {
      throw new Error(`Character skin is missing weapon bone "${rig.weaponBone}".`);
    }
    this.weaponSocket.name = 'weapon-socket';
    this.weaponSocket.rotation.set(...rig.weaponRotation);
    hand.add(this.weaponSocket);
    this.supportGripTarget.name = 'weapon-support-grip';
    this.supportGripTarget.visible = false;
    this.weaponSocket.add(this.supportGripTarget);
    this.root.add(instance);
    this.supportHandConstraint = new WeaponSupportHandConstraint(this.root, this.supportGripTarget, rig.supportHand);
    this.headBone = requiredBone(instance, rig.indicators.headBone, rig.id);
    this.shoulderFrames = {
      leftShoulder: padNode(instance, rig.indicators.leftShoulder, 'left', rig.id),
      rightShoulder: padNode(instance, rig.indicators.rightShoulder, 'right', rig.id),
    };
    const compensation = this.configureWeaponSocketUnits(hand, rig);
    this.grenadeSocket.name = 'grenade-socket';
    hand.add(this.grenadeSocket);
    this.configureGrenadeSocket(hand, compensation);
  }

  setWeapon(asset: HeldWeaponAsset | null): void {
    // The asset, not its id: the same weapon in a new finish is a new asset (playtest round 3, R4.4).
    if (asset === this.heldAsset) return;
    this.heldAsset = asset;
    if (this.weapon !== null) {
      this.weapon.removeFromParent();
      this.weapon = null;
    }
    this.hasSupportGrip = false;
    this.supportGripTarget.visible = false;
    if (asset === null) return;

    const weapon = asset.template !== null ? asset.template.clone(true) : new THREE.Mesh(asset.geometry, asset.material);
    weapon.name = `held-weapon:${asset.weaponId}`;
    weapon.traverse((node) => {
      node.castShadow = true;
    });
    // `weaponSocket` sits at the hand. Move the mesh so its trigger grip — rather than the
    // centre of its receiver — occupies that point, less what keeps a long stock at the
    // shoulder (`stockShift`). The socket rotation remains rig-owned.
    const shift = stockShift(weapon, asset.gripAnchor);
    weapon.position.copy(asset.gripAnchor).multiplyScalar(-1);
    weapon.position.z -= shift;
    // The target is a sibling of the mesh under the same calibrated socket. Subtracting the
    // trigger anchor maps the semantic weapon-local support grip into that socket space.
    this.supportGripTarget.position.copy(asset.supportAnchor).sub(asset.gripAnchor);
    this.supportGripTarget.position.z -= shift;
    this.supportGripTarget.visible = true;
    this.hasSupportGrip = true;
    // A weapon that arrives mid-throw (its file landing, a respawn) arrives put away.
    weapon.visible = !this.weaponAway;
    this.weaponSocket.add(weapon);
    this.weapon = weapon;
  }

  /**
   * The hand off the weapon for a throw (2026-09-28), and the grenade in it.
   *
   * The report was a body throwing its rifle: the throw clip swung the right arm and the weapon
   * socket on its hand went with it, rifle and all. The weapon is hidden rather than removed, so
   * the throw ending gives back the same object and a support grip that was never torn down.
   *
   * The grenade hangs from its own socket on the palm (`configureGrenadeSocket`), moved so its grip
   * point — the file's `socket_grip`, where the viewmodel's glove closes, the middle of the body —
   * sits there. Life size, not the viewmodel's 1.6: an exaggeration is for the corner of the
   * screen, as the knife's is.
   */
  setThrow(weaponAway: boolean, asset: HeldEquipmentAsset | null): void {
    if (weaponAway !== this.weaponAway) {
      this.weaponAway = weaponAway;
      if (this.weapon !== null) this.weapon.visible = !weaponAway;
    }
    if (asset === this.grenadeAsset) return;
    this.grenadeAsset = asset;
    if (this.grenade !== null) {
      this.grenade.removeFromParent();
      this.grenade = null;
    }
    if (asset === null) return;
    const grenade = asset.template.clone(true);
    grenade.name = `held-grenade:${asset.equipmentId}`;
    grenade.traverse((node) => {
      node.castShadow = true;
    });
    grenade.position.copy(asset.gripAnchor).multiplyScalar(-1);
    this.grenadeSocket.add(grenade);
    this.grenade = grenade;
  }

  /**
   * Constrain the animated support palm only while this skin currently has a held weapon — and
   * not while a throw has put it away, when the palm would be pulled to a rifle nobody can see.
   */
  solveSupportHand(): void {
    if (!this.hasSupportGrip || this.weaponAway) return;
    this.supportHandConstraint.solve();
  }

  /** Resolve an animated semantic landmark for the renderer's separate IFF layer. */
  getIndicatorAnchor(anchor: ActorIndicatorAnchor, target: THREE.Vector3): boolean {
    switch (anchor) {
      case 'head':
        this.headBone.getWorldPosition(target);
        return true;
      case 'leftShoulder':
      case 'rightShoulder':
        return false;
    }
  }

  /** The calibrated pad node's world frame: scale-free, so the pad's metres stay metres. */
  getIndicatorFrame(
    anchor: ActorIndicatorFrameAnchor,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): boolean {
    const node = this.shoulderFrames[anchor];
    node.getWorldPosition(position);
    node.getWorldQuaternion(quaternion);
    return true;
  }

  dispose(): void {
    if (this.weapon !== null) this.weapon.removeFromParent();
    this.weapon = null;
    this.heldAsset = null;
    // A clone of the equipment template, sharing its geometry and materials: nothing to free.
    if (this.grenade !== null) this.grenade.removeFromParent();
    this.grenade = null;
    this.grenadeAsset = null;
    this.hasSupportGrip = false;
    /**
     * The skeletons are this clone's, and each holds a bone texture on the GPU (M15, B1 —
     * found by the stage's show/hide cycle: two textures per body, never freed).
     *
     * `SkeletonUtils.clone` gives every skinned mesh a new `Skeleton` over the cloned bones —
     * that is the whole reason it is used instead of `Object3D.clone` — and a `Skeleton`
     * uploads its bone matrices as a `DataTexture` the first time it is drawn. Geometry and
     * materials are the template's and stay; the skeletons are ours and go. Every body a match
     * retired left its two behind until this line.
     */
    this.root.traverse((node) => {
      const skinned = node as THREE.Object3D & { isSkinnedMesh?: boolean; skeleton?: THREE.Skeleton };
      if (skinned.isSkinnedMesh === true && skinned.skeleton !== undefined) skinned.skeleton.dispose();
    });
    this.root.clear();
  }

  private prepareMeshes(instance: THREE.Object3D): void {
    instance.traverse((node) => {
      if ((node as THREE.Object3D & { isMesh?: boolean }).isMesh !== true) return;
      const mesh = node as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }

  /**
   * The imported Armature is scaled to centimetres (0.01), while held-weapon geometry is made
   * in game metres. Cancel only that inherited unit scale at the hand socket; keep the skin
   * root's deliberate model calibration intact.
   */
  private configureWeaponSocketUnits(hand: THREE.Object3D, rig: CharacterRigProfile): number {
    this.root.updateWorldMatrix(true, true);
    const rootScale = this.root.getWorldScale(new THREE.Vector3());
    const handScale = hand.getWorldScale(new THREE.Vector3());
    const compensation = relativeUniformScale(rootScale, handScale, rig.id);

    this.weaponSocket.scale.setScalar(compensation);
    this.weaponSocket.position.set(
      rig.weaponOffset[0] * compensation,
      rig.weaponOffset[1] * compensation,
      rig.weaponOffset[2] * compensation,
    );
    return compensation;
  }

  /**
   * A grenade's place in the throwing hand, measured off the hand's own bones (2026-09-28).
   *
   * The weapon socket is the wrong place for it: a rifle is held by a grip at the heel of the hand,
   * so that socket sits on the wrist joint — and a grenade hung there was inside the forearm, which
   * is where the first version put it and why nobody could see it. A grenade sits on the palm.
   *
   * The palm is measured rather than typed, from the four knuckle bones every rig in the catalogue
   * carries (a Mixamo hand): its long axis is the wrist to the middle knuckle, its width index to
   * little finger, and its face is the cross of the two, turned to the thumb's side. The socket goes
   * `PALM_ALONG` of the way to the knuckles and `GRENADE_OFF_PALM_M` off the face, with the file's
   * fuze (+Y) toward the index and its spoon (−Z) against the palm, which is how one is held. A hand
   * without those bones keeps the weapon socket's place: a grenade at the wrist is still a grenade,
   * where a thrown exception would be no body at all.
   */
  private configureGrenadeSocket(hand: THREE.Object3D, compensation: number): void {
    this.grenadeSocket.scale.setScalar(compensation);
    const knuckle = (finger: string): THREE.Object3D | undefined =>
      hand.children.find((child) => child.name.endsWith(`${finger}1`));
    const index = knuckle('Index');
    const middle = knuckle('Middle');
    const pinky = knuckle('Pinky');
    const thumb = knuckle('Thumb');
    if (index === undefined || middle === undefined || pinky === undefined || thumb === undefined) {
      this.grenadeSocket.position.copy(this.weaponSocket.position);
      this.grenadeSocket.quaternion.copy(this.weaponSocket.quaternion);
      return;
    }
    const along = middle.position.clone().normalize();
    const across = index.position.clone().sub(pinky.position).normalize();
    const face = new THREE.Vector3().crossVectors(across, along).normalize();
    if (face.dot(thumb.position) < 0) face.negate();
    // `face` is square to `across` by construction, so the three are a frame: fuze toward the
    // index, spoon down onto the palm.
    const x = new THREE.Vector3().crossVectors(across, face);
    this.grenadeSocket.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, across, face));
    this.grenadeSocket.position
      .copy(middle.position)
      .multiplyScalar(PALM_ALONG)
      .addScaledVector(face, GRENADE_OFF_PALM_M * compensation);
  }
}

/**
 * The node a shoulder pad hangs from, under its bone at the profile's offset and rotation —
 * the same construction as the support hand's palm marker, and in the same bone-local units.
 */
function padNode(
  instance: THREE.Object3D,
  profile: CharacterIndicatorPadProfile,
  side: 'left' | 'right',
  rigId: string,
): THREE.Object3D {
  const bone = requiredBone(instance, profile.bone, rigId);
  const node = new THREE.Object3D();
  node.name = `indicator-frame:${side}-shoulder`;
  node.position.set(...profile.offset);
  node.rotation.set(...profile.rotation);
  bone.add(node);
  return node;
}

function requiredBone(instance: THREE.Object3D, name: string, rigId: string): THREE.Object3D {
  const bone = instance.getObjectByName(name);
  if (bone === undefined) {
    throw new Error(`Character rig "${rigId}" is missing indicator bone "${name}".`);
  }
  return bone;
}

function relativeUniformScale(root: THREE.Vector3, child: THREE.Vector3, rigId: string): number {
  const rootAverage = (Math.abs(root.x) + Math.abs(root.y) + Math.abs(root.z)) / 3;
  const childAverage = (Math.abs(child.x) + Math.abs(child.y) + Math.abs(child.z)) / 3;
  if (rootAverage < 1e-6 || childAverage < 1e-6) {
    throw new Error(`Character rig "${rigId}" has a zero-scale weapon attachment.`);
  }
  return rootAverage / childAverage;
}
