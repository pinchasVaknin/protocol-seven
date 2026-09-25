import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';
import {
  isLowStance as isLowStanceId,
  LOCOMOTION_IDLE_SPEED,
  LOCOMOTION_RUN_SPEED,
} from '../../shared/player/Stance';
import type { CharacterAnimationId } from './CharacterCatalog';

/**
 * The walk and run thresholds are the simulation's (`shared/player/Stance`), because the
 * hitbox rig picks a crouching body's layout by the same speeds (`rigLayoutFor`, M13 C2):
 * the clip and the boxes must change pose together. A dead zone stops interpolation noise
 * from making a standing actor moonwalk; the run threshold sits above the walk cap so speed
 * from rendered pose deltas cannot flicker on the boundary. An authoritative sprint flag
 * still chooses run immediately.
 */
const IDLE_SPEED = LOCOMOTION_IDLE_SPEED;
const RUN_SPEED = LOCOMOTION_RUN_SPEED;

export function isLowStance(input: Pick<ActorAnimationInput, 'stance'>): boolean {
  return isLowStanceId(input.stance);
}

/**
 * Whether this body has left the ground.
 *
 * Read off the replicated stance rather than off a new flag, because `AIRBORNE` has been a
 * `StanceId` since S5.3 and has been on the wire since `EntitySnapshot` carried a stance at all.
 * The jump pair therefore cost the protocol nothing — the fact was already there, and for two
 * milestones nothing looked at it. `isLowStance` is false for it, so an airborne body keeps the
 * standing hitbox layout, which is what the launch and landing clips were measured against.
 */
export function isAirborne(input: Pick<ActorAnimationInput, 'stance'>): boolean {
  return input.stance === 'AIRBORNE';
}

/**
 * Pure policy: semantic game state in, semantic slot id out.
 *
 * Files, Three.js actions, and cross-fades intentionally do not appear here — a slot is a
 * pose, and how many clips stand behind it is the catalogue's business (M13 Phase D). Missing
 * authored states (fire/slide/mantle) use the closest safe locomotion pose rather than
 * inventing a new branch in the renderer.
 */
export function selectLocomotion(
  input: ActorAnimationInput,
  planarSpeed: number,
  armed: boolean,
  pistol: boolean,
): CharacterAnimationId {
  const low = isLowStance(input);

  if (low) {
    // The pistol family has no crouched walk and no crouched run, so above the dead zone a
    // sidearm is drawn in the rifle's — and wears the rifle's hitbox layout with it, which is
    // the whole reason an incomplete family is admissible. See `rigLayoutFor`.
    if (planarSpeed >= RUN_SPEED) return 'crouchRunAiming';
    if (planarSpeed > IDLE_SPEED) return 'crouchWalkAiming';
    return pistol ? 'crouchIdleAimingPistol' : 'crouchIdleAiming';
  }

  // The current asset pack has no hip-ready loops. Its "Relaxed" standing/walking clips do
  // not hold a firearm, so an armed actor must use the reviewed weapon-ready clips even when
  // gameplay has not set ADS/firing. This is a source-asset adapter, not gameplay policy.
  //
  // A pistol has all four of its standing loops, so `armed` never decides anything for one:
  // `pistol` implies `armed` (an empty-handed body has no weapon class) and the sidearm clips
  // are weapon-ready by construction.
  if (planarSpeed <= IDLE_SPEED) {
    if (pistol) return 'idleWeaponReadyPistol';
    return armed ? 'idleWeaponReady' : 'idleRelaxed';
  }
  if (input.sprinting || planarSpeed >= RUN_SPEED) return pistol ? 'runWeaponReadyPistol' : 'runRelaxed';
  if (pistol) return 'walkWeaponReadyPistol';
  return armed ? 'walkWeaponReady' : 'walkRelaxed';
}

/**
 * The stance transition across the crouch edge, in the clips the held weapon has (M13 decision
 * 11, settled 2026-09-25).
 *
 * The pistol family brought both of its own, which matters more than it looks: the kneel and the
 * half-squat are 10.9 cm apart at the crown, so a body that went down in the rifle's transition
 * and settled into the sidearm's loop would jump that distance on the last frame.
 */
export function selectStanceTransition(low: boolean, pistol: boolean): CharacterAnimationId {
  if (low) return pistol ? 'standToCrouchPistol' : 'standToCrouch';
  return pistol ? 'crouchToStandPistol' : 'crouchToStand';
}

/**
 * The one-shot that **owns** the body for its whole length, or null. Distinct from
 * `selectAction`, and the distinction is what the clip does when the input stops saying so.
 *
 * A reload that is cancelled is over, and abandoning its clip is correct. A throw is the
 * opposite: the flag clearing is the sim saying *the grenade has left the hand*, which is the
 * moment the second half of the clip exists to show. So a gesture is handed to the animator's
 * transition channel, which holds the body until the clip finishes, and the throw additionally
 * pauses partway — see `THROW_HOLD_FRACTION`.
 *
 * Priority is the simulation's own: `ClientMatch` blocks a swing while the thrower is busy and
 * cancels a reload on either, so throw outranks melee outranks reload.
 */
export function selectGesture(input: ActorAnimationInput, planarSpeed: number): CharacterAnimationId | null {
  if (input.throwing) {
    if (isLowStance(input)) return planarSpeed <= IDLE_SPEED ? 'throwCrouch' : null;
    return planarSpeed <= IDLE_SPEED ? 'throwStand' : 'throwWalk';
  }
  // No crouched knife clip, and none while airborne: the body keeps its loop, exactly as it
  // does for a reload the library cannot draw.
  if (input.meleeing && !isLowStance(input) && !isAirborne(input)) return 'meleeStand';
  return null;
}

/**
 * The launch or the landing, on the frame the body crosses the ground.
 *
 * Two clips and not one because the air is as long as the physics says: the launch clamps on its
 * last frame and that frame *is* the air pose, whether the body is up for a hop or falling down
 * a lift shaft.
 */
export function selectGroundTransition(airborne: boolean): CharacterAnimationId {
  return airborne ? 'jumpLaunch' : 'jumpLand';
}

export function selectDeath(input: Pick<ActorAnimationInput, 'stance'>): CharacterAnimationId {
  return isLowStance(input) ? 'deathCrouch' : 'deathStand';
}

/**
 * The one-shot that overrides locomotion while the actor is doing something, or null when it
 * is not (M13 Phase D). Today that is the reload — *"a remote player mid-reload must look
 * mid-reload"* (S6.5) — in the pose the body is in: kneeling and still, standing and still,
 * or walking. A reload while running, sliding or crouch-walking has no clip and is not drawn;
 * the body keeps its locomotion loop, as it did before the slot existed.
 *
 * The throw and the melee got their bits with protocol 20 and are **not** here: they outlive the
 * input that starts them, which an action does not. See `selectGesture`.
 */
export function selectAction(input: ActorAnimationInput, planarSpeed: number): CharacterAnimationId | null {
  if (!input.reloading) return null;
  if (isLowStance(input)) return planarSpeed <= IDLE_SPEED ? 'reloadCrouch' : null;
  if (planarSpeed <= IDLE_SPEED) return 'reloadStand';
  if (!input.sprinting && planarSpeed < RUN_SPEED) return 'reloadWalk';
  return null;
}
