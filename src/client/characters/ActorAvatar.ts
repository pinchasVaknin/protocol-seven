import * as THREE from 'three';
import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';

/**
 * Semantic landmarks used by the client-only world identification layer.
 *
 * The head is a **point** (the nameplate hangs off it). A shoulder is a **frame** (M13 C3): a
 * pad that lies flush on a sleeve needs a position *and* an orientation, so the shoulders are
 * answered by `getIndicatorFrame`, and `getIndicatorAnchor` returns false for them. The knee
 * anchors went with the emissive spheres they placed.
 */
export type ActorIndicatorAnchor = 'head' | 'leftShoulder' | 'rightShoulder';

/** The anchors that are frames rather than points. */
export const INDICATOR_FRAME_ANCHORS = ['leftShoulder', 'rightShoulder'] as const satisfies readonly ActorIndicatorAnchor[];
export type ActorIndicatorFrameAnchor = (typeof INDICATOR_FRAME_ANCHORS)[number];

/**
 * A third-person weapon, ready to be put in a hand.
 *
 * Built by the weapon module and handed over whole, so an avatar never resolves anything by
 * weapon id itself: the geometry, the material and the two grip points arrive together and
 * cannot disagree about which weapon they describe. Both anchors are in the geometry's own
 * space, with the model scale already baked in — the same space the vertices are in.
 */
/**
 * How far a held weapon may reach behind the hand, metres (M19, playtest 3). A body holds a
 * weapon by its trigger grip, and a bullpup's grip is far forward — the Tavor's stock reached
 * half a metre behind the hand, through the shoulder and out the back. Past this a weapon is
 * carried forward by the excess: the hand sits a little behind the grip and the stock stops at
 * the shoulder, which is the better of the two lies. 30 cm left every rifle's stock in the
 * shoulder (playtest 4); at 22 even the M4's 25 cm comes forward a little.
 */
export const STOCK_BEHIND_HAND_MAX = 0.22;

const stockBox = new THREE.Box3();

/**
 * The forward shift that keeps `weapon`'s stock at the shoulder: zero for most weapons, the
 * excess over `STOCK_BEHIND_HAND_MAX` for a bullpup. Measured on the object at identity, in
 * weapon space, where +Z is the stock's way.
 */
export function stockShift(weapon: THREE.Object3D, gripAnchor: THREE.Vector3): number {
  stockBox.setFromObject(weapon);
  if (stockBox.isEmpty()) return 0;
  return Math.max(0, stockBox.max.z - gripAnchor.z - STOCK_BEHIND_HAND_MAX);
}

export interface HeldWeaponAsset {
  readonly weaponId: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  /**
   * The weapon's own file for the bodies (M19, stage 3), cloned in place of the geometry and
   * the material when present: a rifle from its LOD wears its own materials, and the
   * primitives' single gunmetal is the fallback it stands beside.
   */
  readonly template: THREE.Object3D | null;
  /** The trigger grip. This is the point that sits at the hand socket. */
  readonly gripAnchor: THREE.Vector3;
  /** The support palm. This is where the other hand is pulled to. */
  readonly supportAnchor: THREE.Vector3;
}

/**
 * The narrow scene-object contract consumed by `BotRenderer`.
 *
 * `BotMesh` implements it as the procedural fallback; `CharacterAvatar` implements it for a
 * skinned GLB.  The roster reconciler therefore never cares how a body was constructed.
 */
export interface ActorAvatar {
  readonly group: THREE.Group;
  readonly isDying: boolean;

  /** Put this in the body's hands, or empty them. Idempotent for an unchanged weapon id. */
  setWeapon(weapon: HeldWeaponAsset | null): void;
  setVisible(on: boolean): void;
  /**
   * Which life this body is on (M13 Phase D): the entity and its replicated spawn serial.
   * A skinned body deals the variants of its locomotion slots from the pair, so every client
   * draws the same variant for the same life and a respawn re-deals it; the procedural body
   * has no variants and ignores it. Called when the avatar is made and whenever the spawn
   * serial moves.
   */
  setLife(entityId: number, spawnSerial: number): void;
  /**
   * Write an animated, world-space landmark to `target`.
   *
   * The renderer owns the viewer-relative IFF policy. Avatars expose only geometry landmarks,
   * which keeps a future skin free to use a different skeleton without teaching the renderer
   * about its bone names.
   */
  getIndicatorAnchor(anchor: ActorIndicatorAnchor, target: THREE.Vector3): boolean;
  /**
   * Write an animated, world-space **frame** — where a pad sits and which way it faces — for
   * one of the frame anchors. The convention is the pad's: local +Z is the outward normal of
   * the surface, +X runs along the limb toward its far end, +Y across it. `CharacterSkin`
   * answers from a calibrated node under the upper-arm bone (`CharacterIndicatorProfile`);
   * `BotMesh` from the outer face of its arm box. The renderer still learns no bone names.
   */
  getIndicatorFrame(anchor: ActorIndicatorFrameAnchor, position: THREE.Vector3, quaternion: THREE.Quaternion): boolean;
  beginDeath(dx: number, dz: number, variant: number, animation: ActorAnimationInput): void;
  endDeath(): void;
  flinch(dx: number, dz: number): void;
  /** Apply one authoritative render pose and advance local-only visual effects. */
  update(
    animation: ActorAnimationInput,
    x: number,
    y: number,
    z: number,
    yaw: number,
    heightScale: number,
    dt: number,
  ): void;
  dispose(): void;
}
