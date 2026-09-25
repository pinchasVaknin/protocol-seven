import * as THREE from 'three';
import type { CharacterAnimationDefinition, CharacterAnimationId, CharacterDefinition } from './CharacterCatalog';
import {
  isAirborne,
  isLowStance,
  selectAction,
  selectDeath,
  selectGesture,
  selectGroundTransition,
  selectLocomotion,
  selectStanceTransition,
} from './AnimationSelector';
import { variantFor } from './AnimationVariant';
import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';
import { THROW_FOLLOW_THROUGH, THROW_RELEASE_TIME } from '../../shared/equipment/ThrowController';
import { MELEE_SWING_SECONDS } from '../../shared/weapons/Melee';

const CROSS_FADE_SECONDS = 0.14;

/**
 * How far into a throw clip the arm is cocked — where the clip waits while the grenade is still
 * in the hand.
 *
 * Measured rather than chosen: the right hand is furthest behind the hips at 0.508 of
 * `Idle_Throw`, 0.577 of `Crouch_Idle_Throw` and 0.608 of `Walk_Throw` (Echo, through the real
 * import path, this session). One constant for the three because the spread is 0.10 of a clip
 * around 2.8 s — under two tenths of a second of wind-up, on a pose that is about to be thrown
 * out of anyway — and three numbers in the catalogue would have to be re-measured every time one
 * of the clips was re-exported.
 *
 * The alternative to holding was fitting the whole clip to the throw the way a reload is fitted,
 * and it cannot work: a cook has no length. `ThrowController` runs from the tick the button goes
 * down to the tick it comes up, and *"an animation that decided when the hand opened would be a
 * second authority on a timing the server owns"* (M12, F17). So the clip waits here for as long
 * as the simulation says the hand is closed, and the release is what plays when it opens.
 */
const THROW_HOLD_FRACTION = 0.55;

/** The release and the follow-through: the window the tail of a throw clip is fitted into. */
const THROW_TAIL_SECONDS = THROW_RELEASE_TIME + THROW_FOLLOW_THROUGH;

/** One variant of one slot, resolved: the action and the catalogue entry it came from. */
interface Playing {
  readonly id: CharacterAnimationId;
  readonly definition: CharacterAnimationDefinition;
  readonly action: THREE.AnimationAction;
}

/**
 * Per-avatar animation state. Clips are shared templates, but the mixer and actions in this
 * class are never shared between characters.
 *
 * Four kinds of thing play here, in priority order:
 *
 * 1. a **death**, which ends everything else until `endDeath`;
 * 2. the **ground edge** (`jumpLaunch` / `jumpLand`), which interrupts whatever is playing —
 *    the only thing here that does. See `setLocomotion` for the two reasons;
 * 3. a **transition**: a one-shot that owns the body until its clip finishes, with the requested
 *    loop waiting behind it. The crouch edge drives it (`standToCrouch` / `crouchToStand`, in the
 *    held weapon's version), and so do a knife swing and a grenade throw, which additionally
 *    *pauses* partway;
 * 3b. the **air**: once `jumpLaunch` has finished and the body has not landed, its clamped last
 *    frame is held rather than handed back, because that frame is the pose and the air is as long
 *    as the physics says;
 * 4. an **action** one-shot (a reload) that stands in for the locomotion loop while the input
 *    says the actor is doing it, then hands back to the loop;
 * 5. the **locomotion loop** the selector names.
 *
 * The line between 3 and 4 is what the clip does when the input stops saying so, and it is the
 * reason a throw is not an action: a cancelled reload is over and abandoning its clip is right,
 * while `throwing` going false is the simulation saying the grenade has *gone*, which is the
 * moment the rest of the clip exists for.
 *
 * Which variant of a slot plays is `variantFor`'s answer from `setLife` (M13 Phase D); this
 * class never chooses one itself.
 */
export class CharacterAnimator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private active: Playing | null = null;
  private transition: Playing | null = null;
  private action: Playing | null = null;
  private pendingLocomotion: CharacterAnimationId | null = null;
  private dead = false;
  private wasLow = false;
  /**
   * Clip time the transition waits at while a grenade is in the hand, or null when it is not a
   * held one. The `finished` event cannot fire while the action is paused, so this is also what
   * keeps the body from handing back to its loop mid-throw.
   */
  private holdAt: number | null = null;
  private wasAirborne = false;
  /**
   * The gesture slot the current transition came from, held until its input clears.
   *
   * A knife swing is 0.54 s and its clip, fitted, is 0.54 s, so without this the flag would still
   * be up on the frame the clip ended and the body would swing forever.
   */
  private gestureLatch: CharacterAnimationId | null = null;
  private entityId = 0;
  private spawnSerial = 0;

  private readonly onFinished = (event: { action?: THREE.AnimationAction }): void => {
    const finished = this.transition;
    if (finished === null || event.action !== finished.action) return;
    const wasLaunch = finished.id === 'jumpLaunch';
    this.transition = null;
    this.holdAt = null;
    const next = this.pendingLocomotion;
    this.pendingLocomotion = null;
    /**
     * The launch's last frame **is** the air pose, so a body still off the ground keeps it
     * (`clampWhenFinished`) instead of being handed back to a loop.
     *
     * This is the half of the air hold that `setLocomotion` cannot do. It can decline to ask for
     * a loop on the frames after the clip ends, and it does — but the clip ending is an event, and
     * this handler was already several lines into starting a standing idle by the time the next
     * frame arrived. Measured in a live match: a 0.6 s jump spent its last 30 ms standing upright
     * in mid-air, which on a long fall is the whole descent.
     */
    if (wasLaunch && this.wasAirborne) return;
    if (!this.dead && next !== null) this.playLoop(next);
  };

  constructor(
    private readonly root: THREE.Object3D,
    private readonly definition: CharacterDefinition,
    private readonly clips: ReadonlyMap<CharacterAnimationId, readonly THREE.AnimationClip[]>,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    this.mixer.addEventListener('finished', this.onFinished);
  }

  get isDying(): boolean {
    return this.dead;
  }

  /**
   * Whether the clip playing now holds a firearm, and so may receive the presentation
   * support-hand constraint. The answer is the catalog's — see
   * `CharacterAnimationDefinition.weaponReady` — not a list kept here.
   */
  get supportsWeaponSupportGrip(): boolean {
    const active = this.active;
    return active !== null && active.definition.weaponReady;
  }

  /**
   * Which life this body is on. Locomotion variants are dealt from it, so they are re-dealt
   * at every respawn and identical on every client (see `variantFor`).
   */
  setLife(entityId: number, spawnSerial: number): void {
    this.entityId = entityId;
    this.spawnSerial = spawnSerial;
  }

  /** Select a loop from authoritative presentation state; never moves the actor transform. */
  setLocomotion(input: ActorAnimationInput, planarSpeed: number, armed: boolean, pistol: boolean): void {
    if (this.dead) return;

    const desired = selectLocomotion(input, planarSpeed, armed, pistol);
    const low = isLowStance(input);
    const airborne = isAirborne(input);
    const gesture = selectGesture(input, planarSpeed);
    if (gesture === null) this.gestureLatch = null;

    // The crouch edge has an authored transition in each direction (M13 D; before the
    // library had `standToCrouch`, the way down was `crouchToStand` played backwards, and the
    // trap in that — the cross-fade's time warp divides by the time scale and flips a negative
    // one — is on record in PLAN.md, Phase C3). The loop that was asked for waits until the
    // transition finishes. Every other stance change cross-fades between loops, which is
    // safer than pretending the asset pack covers slide and mantle.
    if (this.wasAirborne !== airborne) {
      // The ground edge is first and it **interrupts**, which none of the others do. Two reasons,
      // and the first was measured rather than reasoned: a jump shorter than the 0.55 s launch
      // clip never showed its landing at all, because the launch still owned the body on the
      // frame the feet touched down — a 330 ms hop played half a launch and went back to idle.
      // The second is the standing rule of this area: leaving or meeting the ground moves the
      // hitbox layout, and a body drawn in a pose its boxes disagree with is the defect M13 C2
      // found on the sliding body. A gesture or a stance transition already playing is dropped
      // here, including a held throw; `begin` clears the hold with it.
      //
      // It also outranks the crouch edge, and `wasLow` is advanced below either way — so a body
      // that jumps out of a kneel does not stand up in mid-air and does not owe a `crouchToStand`
      // on the way down. What it lands in is whatever the simulation says it is doing.
      this.begin(selectGroundTransition(airborne), desired);
    } else if (this.transition !== null) {
      this.pendingLocomotion = desired;
      this.stepHold(input.throwing);
    } else if (gesture !== null && this.gestureLatch !== gesture) {
      this.gestureLatch = gesture;
      const started = this.begin(gesture, desired);
      // A throw waits at its cocked frame; a swing is fitted to the swing, like a reload.
      if (input.throwing) this.holdAt = started.action.getClip().duration * THROW_HOLD_FRACTION;
      else fitToSeconds(started.action, MELEE_SWING_SECONDS);
    } else if (airborne) {
      // Still off the ground with the launch finished: hold its clamped last frame, which is the
      // air pose, and ask for nothing else. Measured in a live match before this branch existed —
      // the 0.55 s launch ended 30 ms before the landing and the body spent that frame in a
      // standing idle, which on a long fall is a man descending a lift shaft at attention. The
      // loop the landing hands back to is still tracked, so the body comes down into whatever the
      // simulation says it is doing.
      this.pendingLocomotion = desired;
      this.action = null;
    } else if (this.wasLow !== low) {
      this.begin(selectStanceTransition(low, pistol), desired);
    } else {
      const action = selectAction(input, planarSpeed);
      if (action !== null) {
        if (this.action?.id !== action) {
          this.action = this.playOneShot(action, 0);
          fitToSeconds(this.action.action, input.reloadSeconds);
        }
      } else {
        this.action = null;
        this.playLoop(desired);
      }
    }

    this.wasLow = low;
    this.wasAirborne = airborne;
  }

  /** Start a one-shot that owns the body, with `resume` waiting behind it. */
  private begin(id: CharacterAnimationId, resume: CharacterAnimationId): Playing {
    this.pendingLocomotion = resume;
    this.action = null;
    this.holdAt = null;
    const started = this.playOneShot(id, 0);
    this.transition = started;
    return started;
  }

  /**
   * Park a throw clip at its cocked frame while the grenade is in the hand, and let it go when
   * the simulation says the hand has opened.
   *
   * The tail is fitted to `THROW_TAIL_SECONDS`, which is the release plus the follow-through —
   * the same 0.42 s the balance was tuned against and the same window the viewmodel spends with
   * the weapon off screen, so the third-person arm comes back as the first-person one does.
   */
  private stepHold(throwing: boolean): void {
    const hold = this.holdAt;
    const playing = this.transition;
    if (hold === null || playing === null) return;
    const action = playing.action;
    if (throwing) {
      if (action.time >= hold) {
        action.time = hold;
        action.paused = true;
      }
      return;
    }
    action.paused = false;
    this.holdAt = null;
    const remaining = action.getClip().duration - action.time;
    if (remaining > 0) fitToSeconds(action, THROW_TAIL_SECONDS, remaining);
  }

  /**
   * `variant` is the simulation's `deathVariant`, already dealt from `(entityId, deathSerial)`
   * and identical on the server, so the slot's clips are indexed by it rather than dealt again
   * here; `DEATH_VARIANTS` stays the simulation's count and the catalogue's is folded into it
   * (`check:animations` keeps the two dividing).
   */
  beginDeath(input: ActorAnimationInput, variant: number): void {
    this.dead = true;
    this.pendingLocomotion = null;
    this.transition = null;
    this.holdAt = null;
    this.gestureLatch = null;
    this.action = null;
    const id = selectDeath(input);
    const count = this.clips.get(id)?.length ?? 0;
    this.playOneShot(id, count > 0 ? ((variant % count) + count) % count : 0);
  }

  endDeath(): void {
    if (!this.dead) return;
    this.dead = false;
    this.transition = null;
    this.holdAt = null;
    this.gestureLatch = null;
    this.action = null;
    this.pendingLocomotion = null;
    this.wasLow = false;
    this.wasAirborne = false;
    this.active = null;
    this.mixer.stopAllAction();
    // Flush property bindings so the respawn starts from its bind pose, not the final death
    // frame. The next `setLocomotion` call starts the correct loop.
    this.mixer.update(0);
  }

  update(dt: number): void {
    if (dt > 0) this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.removeEventListener('finished', this.onFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
    this.active = null;
    this.transition = null;
    this.holdAt = null;
    this.action = null;
  }

  /** The variant of a locomotion slot this life wears. */
  private lifeVariant(id: CharacterAnimationId): number {
    return variantFor(id, this.entityId, this.spawnSerial, this.clips.get(id)?.length ?? 0);
  }

  private resolve(id: CharacterAnimationId, variant: number): Playing {
    const variants = this.clips.get(id);
    const clip = variants?.[variant];
    const definition = this.definition.animations[id][variant];
    if (clip === undefined || definition === undefined) {
      throw new Error(`Character animation "${id}" variant ${variant} was not preloaded.`);
    }
    const key = `${id}/${variant}`;
    let action = this.actions.get(key);
    if (action === undefined) {
      action = this.mixer.clipAction(clip);
      action.setLoop(definition.loop ? THREE.LoopRepeat : THREE.LoopOnce, definition.loop ? Infinity : 1);
      action.clampWhenFinished = !definition.loop;
      this.actions.set(key, action);
    }
    return { id, definition, action };
  }

  private playLoop(id: CharacterAnimationId): void {
    if (this.active?.id === id && this.transition === null) return;
    const next = this.resolve(id, this.lifeVariant(id));
    const previous = this.active?.action ?? null;
    next.action.reset();
    next.action.enabled = true;
    next.action.setEffectiveWeight(1);
    next.action.setEffectiveTimeScale(1);
    next.action.play();
    if (previous !== null && previous !== next.action) next.action.crossFadeFrom(previous, CROSS_FADE_SECONDS, true);
    this.active = next;
  }

  private playOneShot(id: CharacterAnimationId, variant: number): Playing {
    const next = this.resolve(id, variant);
    const previous = this.active?.action ?? null;
    next.action.reset();
    next.action.enabled = true;
    next.action.setEffectiveWeight(1);
    next.action.setEffectiveTimeScale(1);
    next.action.play();
    if (previous !== null && previous !== next.action) next.action.crossFadeFrom(previous, CROSS_FADE_SECONDS, true);
    this.active = next;
    return next;
  }
}

/**
 * Play a one-shot so it ends when the thing it depicts does. A 3.3 s reload clip on a 1.7 s
 * SMG plays at ×1.95 and is over when the magazine is; on a 4.4 s LMG it plays at ×0.75. Left
 * alone when the duration is unknown (0), and never made absurd: a clip is not stretched past
 * three times its length or squeezed under a third.
 *
 * `span` is how much clip there is left to fit, for the one caller that is partway through: a
 * released throw has to get its remaining 45 % into the 0.42 s the simulation gives the arm, and
 * fitting the whole clip into that would put the tail at ×7 and hit the clamp instead.
 */
function fitToSeconds(action: THREE.AnimationAction, seconds: number, span?: number): void {
  if (!(seconds > 0)) return;
  const duration = span ?? action.getClip().duration;
  if (!(duration > 0)) return;
  const scale = THREE.MathUtils.clamp(duration / seconds, 1 / 3, 3);
  action.setEffectiveTimeScale(scale);
}
