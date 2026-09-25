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

/**
 * The speed a **standing** body has to drop below before its run loop is given up, once it has
 * one. The other side of `RUN_SPEED`, and the reason it is here rather than in `Stance`.
 *
 * A dead zone stops a *standing* body from moonwalking and the run threshold sits above the walk
 * cap, but neither protects the run/walk edge from the thing that actually crosses it: sprint.
 * `sprinting` is an authoritative flag and it is *allowed* to flicker — a bot's comes from
 * `moveZ > 0.72` against a path it is steering along, so a corner makes it stutter at about 3 Hz,
 * and a human's arrives over a wire. With one threshold the loop follows it: measured in a live
 * six-bot match, `runRelaxed` and `walkWeaponReady` traded places 55 times in ten seconds, each
 * swap a clip restarting at frame 0 under a cross-fade. That is the hitch the playtest saw in a
 * walking body.
 *
 * 5.0 m/s is the midpoint of the walk cap (4.6, which a body that is not sprinting cannot
 * exceed) and the entry (5.4). So a walking body can never hold the run loop by speed, a
 * sprinting one that drops the flag for a corner keeps it, and a body that genuinely stops
 * sprinting falls out of it within a step.
 *
 * **Standing only.** A crouching body's run threshold is shared with `rigLayoutFor` — the clip
 * and the hitbox layout change pose together (M13 C2) — and widening the clip's half of that
 * would draw a body in a pose its boxes disagree with, which is the defect the layout table
 * exists to prevent. A standing body has one layout at every speed, so its clip choice has no
 * hitbox consequence and this is free.
 */
const RUN_RELEASE_SPEED = 5;

/**
 * Whether a standing body is drawn in a run, from what it is actually doing.
 *
 * **Motion decides, and the sprint flag only breaks a tie inside the band.** It used to be
 * `input.sprinting || planarSpeed >= RUN_SPEED`, an *or* that let the flag name the loop on its
 * own, and over a real wire that is wrong twice: measured in a nine-body networked match, a body
 * moving at **2.11 m/s** was drawn at a full run because its sprint bit was set — a bot leaning
 * into a corner, a human who pressed the key against a wall — and when the bit dropped two
 * tenths of a second later the clip restarted back into a walk. Fourteen of the eighty loop
 * changes in that ten seconds were run loops entered or left below 5 m/s.
 *
 * A sprint that is not moving is not a sprint. So: above `RUN_SPEED` the body runs whatever the
 * flag says; below `RUN_RELEASE_SPEED` it does not, whatever the flag says; and between the two
 * the flag — or the fact that it is already running — decides, which is where a body accelerating
 * into a sprint and a body leaning out of one both live.
 */
function isRunning(input: ActorAnimationInput, planarSpeed: number, drawnRunning: boolean): boolean {
  if (planarSpeed >= RUN_SPEED) return true;
  if (planarSpeed < RUN_RELEASE_SPEED) return false;
  return drawnRunning || input.sprinting;
}

/** The loops that read as a run, for `selectLocomotion`'s own hysteresis. */
const RUN_LOOPS: ReadonlySet<CharacterAnimationId> = new Set<CharacterAnimationId>([
  'runRelaxed',
  'runWeaponReadyPistol',
  'crouchRunAiming',
]);

/** Whether the loop a body is already drawn in is a run. See `RUN_RELEASE_SPEED`. */
export function isRunLoop(id: CharacterAnimationId | null): boolean {
  return id !== null && RUN_LOOPS.has(id);
}

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
  /**
   * Whether this body is already drawn in a run loop — the one input here that is an answer
   * rather than a fact, and it is what makes the run edge a band instead of a line. Still a pure
   * function: the previous answer is passed in, the way `pickSpectatorTarget` is handed the
   * target it is deciding whether to keep. See `RUN_RELEASE_SPEED`.
   */
  drawnRunning = false,
): CharacterAnimationId {
  const low = isLowStance(input);

  if (low) {
    // The pistol family has no crouched walk and no crouched run, so above the dead zone a
    // sidearm is drawn in the rifle's — and wears the rifle's hitbox layout with it, which is
    // the whole reason an incomplete family is admissible. See `rigLayoutFor`.
    // The crouched threshold is exactly the simulation's, with no band and no flag: it is shared
    // with `rigLayoutFor`, and the clip and the boxes have to change pose on the same number.
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
  if (isRunning(input, planarSpeed, drawnRunning)) return pistol ? 'runWeaponReadyPistol' : 'runRelaxed';
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
