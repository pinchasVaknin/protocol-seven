import * as THREE from 'three';
import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';
import type { CharacterAssetBundle } from './CharacterAssetRepository';
import { CharacterAnimator } from './CharacterAnimator';
import { CharacterSkin } from './CharacterSkin';
import type { ActorAvatar, ActorIndicatorAnchor, ActorIndicatorFrameAnchor, HeldWeaponAsset } from './ActorAvatar';

const FLINCH_SECONDS = 0.18;
const FLINCH_ANGLE = 0.075;

/**
 * A live GLB-backed actor presentation.
 *
 * The outer `group` is placed only from an authoritative render pose. The mixer animates the
 * cloned skeleton beneath it, so imported root motion can never move either the scene actor or
 * its gameplay hitbox.
 */
export class CharacterAvatar implements ActorAvatar {
  readonly group = new THREE.Group();

  private readonly skin: CharacterSkin;
  private readonly animator: CharacterAnimator;
  private readonly axis = new THREE.Vector3();
  private readonly flinchQuat = new THREE.Quaternion();
  private flinchTime = 0;
  private flinchX = 0;
  private flinchZ = 1;
  private lastX = 0;
  private lastZ = 0;
  private seeded = false;
  /** The last speed that was a measurement rather than a relocation. See `measurePlanarSpeed`. */
  private lastSpeed = 0;
  private armed = false;
  /** Whether the body is holding a sidearm, which has locomotion clips of its own. */
  private pistol = false;

  constructor(instance: THREE.Object3D, assets: CharacterAssetBundle) {
    this.group.name = `character:${assets.definition.id}`;
    this.skin = new CharacterSkin(instance, assets.definition.rig);
    this.animator = new CharacterAnimator(this.skin.root, assets.definition, assets.clips);
    this.group.add(this.skin.root);
  }

  get isDying(): boolean {
    return this.animator.isDying;
  }

  setWeapon(weapon: HeldWeaponAsset | null): void {
    this.skin.setWeapon(weapon);
    this.armed = weapon !== null;
    this.pistol = weapon?.weaponClass === 'PISTOL';
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  setLife(entityId: number, spawnSerial: number): void {
    this.animator.setLife(entityId, spawnSerial);
  }

  getIndicatorAnchor(anchor: ActorIndicatorAnchor, target: THREE.Vector3): boolean {
    return this.skin.getIndicatorAnchor(anchor, target);
  }

  getIndicatorFrame(
    anchor: ActorIndicatorFrameAnchor,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): boolean {
    return this.skin.getIndicatorFrame(anchor, position, quaternion);
  }

  beginDeath(dx: number, dz: number, variant: number, animation: ActorAnimationInput): void {
    // The posture picks the slot and the replicated `variant` picks the clip within it (M13
    // Phase D), so the fall a body takes is the same on every client. The direction only the
    // procedural body uses: a skinned fall is authored.
    void dx;
    void dz;
    this.flinchTime = 0;
    this.animator.beginDeath(animation, variant);
  }

  endDeath(): void {
    this.flinchTime = 0;
    this.seeded = false;
    this.animator.endDeath();
  }

  flinch(dx: number, dz: number): void {
    if (this.isDying) return;
    const length = Math.hypot(dx, dz);
    this.flinchX = length > 1e-4 ? dx / length : 0;
    this.flinchZ = length > 1e-4 ? dz / length : 1;
    this.flinchTime = FLINCH_SECONDS;
  }

  update(
    animation: ActorAnimationInput,
    x: number,
    y: number,
    z: number,
    yaw: number,
    heightScale: number,
    dt: number,
  ): void {
    const planarSpeed = this.measurePlanarSpeed(x, z, dt);
    this.animator.setLocomotion(animation, planarSpeed, this.armed, this.pistol, dt);
    this.animator.update(dt);

    this.group.position.set(x, y, z);
    this.group.quaternion.setFromAxisAngle(UP, yaw);
    // A crouch/slide is selected as an authored pose. Applying the old capsule compression as
    // well would double-compress a skinned crouch. `heightScale` stays in this interface for
    // the procedural fallback and for future rigs whose manifest deliberately opts into it.
    void heightScale;
    this.group.scale.set(1, 1, 1);

    if (this.flinchTime > 0 && !this.isDying) {
      this.flinchTime = Math.max(0, this.flinchTime - Math.max(0, dt));
      const t = this.flinchTime / FLINCH_SECONDS;
      const angle = Math.sin(t * Math.PI) * FLINCH_ANGLE;
      this.axis.set(this.flinchZ, 0, -this.flinchX).normalize();
      this.flinchQuat.setFromAxisAngle(this.axis, angle);
      this.group.quaternion.premultiply(this.flinchQuat);
    }

    // Let the mixer establish the authored pose first, then make only the support arm meet its
    // weapon-local target. The outer group remains the authoritative networked actor pose.
    if (this.animator.supportsWeaponSupportGrip) this.skin.solveSupportHand();
  }

  dispose(): void {
    this.animator.dispose();
    this.skin.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }

  private measurePlanarSpeed(x: number, z: number, dt: number): number {
    if (!this.seeded) {
      this.lastX = x;
      this.lastZ = z;
      this.seeded = true;
      return 0;
    }
    const distance = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    if (dt <= 1e-5) return this.lastSpeed;
    const measured = distance / dt;
    /**
     * A body cannot move this fast, so this is not a body moving.
     *
     * The frame a body is *relocated* — a respawn, a round reset, a client adopting a snapshot
     * after a stall — the distance between where it was drawn and where it is drawn next is the
     * width of the map, and dividing it by a frame is a speed. Sampled over a networked match,
     * two of the nine bodies produced 1,853 m/s and 2,579 m/s on exactly such a frame, and every
     * one of them names a run loop for as long as the reading lasts.
     *
     * Held rather than zeroed: the reading is missing, not zero, and a body that was walking
     * before it was moved is usually walking after.
     */
    if (measured > MAX_PLAUSIBLE_SPEED) return this.lastSpeed;
    this.lastSpeed = measured;
    return measured;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Metres per second a drawn body is allowed to have moved between two frames.
 *
 * Above the fastest thing the simulation can do — a tactical sprint is 8.2 m/s and a slide peaks
 * under it — with room for a frame that arrives late. See `measurePlanarSpeed`.
 */
const MAX_PLAUSIBLE_SPEED = 12;
