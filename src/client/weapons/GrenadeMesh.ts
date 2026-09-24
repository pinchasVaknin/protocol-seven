import * as THREE from 'three';
import { equipmentAssetId } from './WeaponAssetCatalog';
import type { EquipmentAssetTemplate } from './WeaponAssetService';
import { ViewmodelHands } from './ViewmodelHands';

/**
 * The grenade in the hand (2026-09-24), and the pin that comes out of it.
 *
 * Until now a throw was the rifle going off screen and a projectile appearing beside the
 * player — `ViewmodelDrive.throwing` lowering the weapon, and nothing in the hand at all. This
 * is the other half: the equipment's own file, held in the right glove, with the left hand on
 * the ring of its pin and the pin coming away as it pulls.
 *
 * ## Why the pin is re-parented
 *
 * The file carries `body`, `lever` and `pin` as three groups under one root, and `socket_pin`
 * on the ring. A pull has to move the pin *and* the hand that holds it as one thing, so the
 * `pin` group and a hand target for it are moved under a carrier of this file's own making:
 * `ViewmodelAnim` writes one transform on the carrier and the ring, the split pin and the
 * glove all travel together, away from a `body` that does not move. The alternative — moving
 * the pin and animating the hand target to match — is two numbers that have to agree, which
 * is the class of bug `socket_mag_grip` was built to end on the reload.
 *
 * ## What is hidden, and when
 *
 * The grenade is held for the whole of the throw — the draw, the pull, the wind-up and the
 * release — and leaves on the frame the arm reaches its RELEASE pose, which is the frame
 * `ThrowController` spawns the projectile on. The `lever` — the spoon — goes with it, because
 * a thrown grenade has no spoon: it flies off as the hand opens. The hands keep being posed
 * through the follow-through, so the player sees an empty hand come back rather than a grenade
 * that teleported.
 *
 * Local space is the file's: metres, the fuze up +Y, the spoon on -Z, the origin at the body's
 * middle. Everything about where it sits in frame is `ViewmodelAnim`'s.
 */

/**
 * Viewmodel exaggeration, as `KNIFE_SCALE` is for the blade — and for the same reason the
 * knife needed one (playtest, 2026-09-24: *"it looks really small in his hand"*).
 *
 * A grenade is the worst case for life size in a viewmodel, worse than the knife: an M26's body
 * is **5.7 cm across** and the rig's hand is **10.3 cm** long, so at 1 the whole object fits
 * inside the fist holding it and the player sees a glove with a fuze poking out of it. A knife
 * at least has a blade sticking out.
 *
 * 1.6 puts the body at 9.1 cm across and 15 cm tall — about the hand's own width, which is what
 * the human asked for, and what every shooter does with a grenade for the same reason. The arms
 * stay life size: `ViewmodelAnim` hands the rig the grenade's own pose including this scale, and
 * the frame's inverse takes it back out.
 *
 * **The world's grenade is not scaled by this.** `EquipmentFx` draws the file at life size,
 * exactly as the bodies carry a life-size knife while the viewmodel's is at 1.3: an exaggeration
 * is for the corner of the screen, not for an object lying on the floor four metres away.
 */
const GRENADE_SCALE = 1.6;

export interface GrenadeModel {
  readonly equipmentId: string;
  /**
   * The **file's** id (`eq_frag`), which is what `HAND_POSES`, `HAND_WRAPS` and the throw
   * tables key on. The equipment id (`frag`) is the simulation's; the two differ only here,
   * and a pose belongs to the model rather than to the thing it represents.
   */
  readonly poseId: string;
  /** The grenade itself. Posed in viewmodel space by `ViewmodelAnim.poseGrenade`. */
  readonly root: THREE.Group;
  /** The two gloves: the right on the body, the left on the ring. Null without the rig file. */
  readonly hands: ViewmodelHands | null;
  /** The pin, its ring and the hand target on it. Moved as one thing by the pull. */
  readonly pinCarrier: THREE.Object3D;
  /** The spoon, or null on a file that has none (the claymore). Hidden at the release. */
  readonly lever: THREE.Object3D | null;
  /** The parts that leave with the throw: everything but the hands. */
  setHeld(held: boolean): void;
  dispose(): void;
}

/**
 * Build the held model for one piece of equipment.
 *
 * `template` is the file (`WeaponAssetService.equipment`); there is no primitive fallback and
 * none is wanted — with no file there is simply no grenade in the hand, which is exactly what
 * the game did before this existed. `rig` is the arms' file; without it the grenade is drawn
 * with no hands, the same way the knife falls back.
 */
export function buildGrenadeModel(
  template: EquipmentAssetTemplate,
  rig: THREE.Object3D | null = null,
): GrenadeModel {
  const root = new THREE.Group();
  root.name = `viewmodel:grenade:${template.equipmentId}`;
  root.scale.setScalar(GRENADE_SCALE);

  const model = template.scene.clone(true);
  model.name = 'viewmodel:grenade:file';
  root.add(model);

  /**
   * The carrier the pull moves: the pin group, and the hand target sitting on its ring.
   *
   * It is added at the root rather than replacing the pin's own node so the pin keeps the
   * place the build measured; the carrier starts at the identity and the pull writes it.
   */
  const pinCarrier = new THREE.Group();
  pinCarrier.name = 'viewmodel:grenade:pin-carrier';
  root.add(pinCarrier);
  const pin = model.getObjectByName('pin');
  if (pin !== undefined) pinCarrier.add(pin);

  const lever = model.getObjectByName('lever') ?? null;

  const grip = new THREE.Object3D();
  grip.name = 'viewmodel:hand-target:grip';
  grip.position.copy(template.sockets.socket_grip ?? new THREE.Vector3());
  root.add(grip);

  /**
   * The pulling hand's target, **inside the carrier**: it is where the ring is, and it goes
   * where the ring goes. A claymore has no `socket_pin`, so it falls back to the grip's point
   * and the left arm is hidden — there is nothing to pull.
   */
  const pinTarget = new THREE.Object3D();
  pinTarget.name = 'viewmodel:hand-target:pin';
  pinTarget.position.copy(template.sockets.socket_pin ?? grip.position);
  pinCarrier.add(pinTarget);

  // `HAND_POSES` keys on the **file's** id, as it does for every weapon and for the knife:
  // `eq_frag`, not `frag`. The two differ only for equipment, and the file is what a pose
  // belongs to — swap the model and the pose is the thing that has to be redone.
  const poseId = equipmentAssetId(template.equipmentId) ?? template.equipmentId;

  let hands: ViewmodelHands | null = null;
  if (rig !== null) {
    hands = new ViewmodelHands(
      rig,
      root,
      { grip, support: pinTarget, supportPose: 'pinch', gripPose: 'grenade', magazine: null },
      poseId,
    );
    if (template.sockets.socket_pin === undefined) hands.showArm('L', false);
    root.add(hands.frame);
  }

  return {
    equipmentId: template.equipmentId,
    poseId,
    root,
    hands,
    pinCarrier,
    lever,
    setHeld(held: boolean): void {
      model.visible = held;
    },
    dispose(): void {
      // Geometry and materials belong to the template, which the asset service owns for the
      // life of the page; a clone shares them and has nothing of its own to release.
      hands?.dispose();
      root.clear();
    },
  };
}
