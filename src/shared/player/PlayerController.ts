/**
 * Consumes exactly one InputCommand per tick and advances the player.
 *
 * Everything that decides *what* the player is doing lives here; Movement.ts, Slide.ts
 * and Mantle.ts own *how*. Edge detection is computed from the command bitfield, in the
 * sim, never in a DOM handler (brief S4.2).
 *
 * Allocation free: every event payload is a module-level singleton, and the brief's
 * "payloads are transient" contract is what makes that safe. The same argument covers
 * `press` and `wish` below, which carry a tick's decoded input between the steps of
 * `step()` without a record per tick.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { logger } from '../core/Log';
import { EV, type GameBus, type SlideEndReason } from '../core/Events';
import { Btn, isDown, justPressed, type InputCommand } from '../core/InputCommand';
import { DT } from '../core/Loop';
import { clamp01, damp, lerp, TAU } from '../core/MathUtil';
import type { CollisionWorld } from '../world/CollisionWorld';
import { beginMantle, detectMantle, makeMantleTarget, stepMantle } from './Mantle';
import {
  accelerate,
  applyFriction,
  capsuleFits,
  clampHorizontalSpeed,
  integrateMotion,
  jumpVelocity,
} from './Movement';
import type { MovementConfig } from './MovementConfig';
import { copySnapshot, makeSnapshot, PlayerSim, type PlayerSnapshot } from './PlayerState';
import { beginSlide, canStartSlide, endSlide, stepSlide } from './Slide';
import { capsuleHeightFor, eyeHeightFor, isLegalStanceTransition, type StanceId } from './Stance';
import { simCos, simSin } from '../core/SimMath';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const log = logger('PlayerController');

const evSpawned = { entityId: 0, x: 0, y: 0, z: 0, yaw: 0 };
const evStance = { entityId: 0, from: 'STAND' as StanceId, to: 'STAND' as StanceId, tick: 0 };
const evJump = { entityId: 0, x: 0, y: 0, z: 0, horizontalSpeed: 0 };
const evLand = { entityId: 0, x: 0, y: 0, z: 0, impactSpeed: 0, stance: 'STAND' as StanceId, material: 0 };
const evStep = { entityId: 0, x: 0, y: 0, z: 0, speed: 0, heavy: false, quiet: false, material: 0 };
const evSlideStart = { entityId: 0, x: 0, y: 0, z: 0, entrySpeed: 0 };
const evSlideEnd = { entityId: 0, reason: 'expired' as SlideEndReason, exitSpeed: 0, tick: 0 };
const evMantleStart = { entityId: 0, x: 0, y: 0, z: 0, ledgeHeight: 0 };
const evMantleEnd = { entityId: 0, x: 0, y: 0, z: 0, endStance: 'STAND' as StanceId };

const mantleTarget = makeMantleTarget();

/**
 * This tick's button edges, decoded once at the top of `step` and read by the steps after it.
 *
 * A module singleton for the same reason the event payloads above are: `step` runs for the
 * local player, for every bot and on the server, sixty times a second, and S4.7 asks the
 * per-tick path to allocate nothing. It is written at the start of a `step` and read only
 * within that same synchronous call, so the fact that every controller shares one is not
 * observable — exactly the contract the payloads rely on.
 */
const press = {
  jumpPressed: false,
  crouchPressed: false,
  crouchHeld: false,
  sprintHeld: false,
  sprintPressed: false,
  adsHeld: false,
  fireHeld: false,
};

/**
 * This tick's wish direction in world space, unit length or zero, and its magnitude.
 *
 * Same singleton argument as `press`. `movingForward` rides along because it is a reading of
 * the command rather than of the direction, and the two are wanted together everywhere.
 */
const wish = {
  x: 0,
  z: 0,
  /** 0..1, the clamped input magnitude. Scales the speed cap, never the direction. */
  mag: 0,
  movingForward: false,
};

/** How quickly the eye height chases the stance target, per second. */
const EYE_DAMP_RATE = 16;

/**
 * Free-cam flight speeds, m/s (post-M8 QA tool).
 *
 * 10 m/s crosses Foundry in about eight seconds — quick enough to get somewhere, slow enough
 * to read a navmesh on the way. Sprint quadruples it for crossing Dunes; ADS quarters it for
 * easing up to a collider seam, which is the case the tool exists for.
 */
const NOCLIP_SPEED = 10;
const NOCLIP_BOOST = 4;
const NOCLIP_PRECISE = 0.25;
//#endregion

// =================================== CLASS PlayerController =================================== \\
//#region Class PlayerController
export class PlayerController {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly sim = new PlayerSim();
  readonly prev: PlayerSnapshot = makeSnapshot();
  readonly curr: PlayerSnapshot = makeSnapshot();

  /** Effective horizontal speed cap this tick. Surfaced by the debug overlay. */
  currentSpeedCap = 0;

  /**
   * Multiplier on every ground speed cap (M6: the Lightweight perk).
   *
   * A field on the controller rather than a change to `MovementConfig`, because the config
   * is a single shared object that the tuning panel writes into and that every bot's
   * controller reads — scaling it for a perk would give the enemy team the perk too. One
   * multiplier per controller, defaulting to 1, leaves every M1 measurement describing the
   * same movement code.
   *
   * Airborne speed is deliberately not scaled: `airSpeedCap` latches whatever the player
   * left the ground with, so a faster run already carries into a faster jump, and scaling
   * the cap again on top would compound.
   */
  speedScale = 1;

  /**
   * Multiplier from the weapon in the hands, for the tick about to be stepped (2026-09-28).
   *
   * A second field rather than a second writer of `speedScale`: that one is the perks', set once
   * a life by both runtimes, and this changes on a swap and on a trigger. Whoever steps the
   * controller sets it first, from `heldMoveScale(def, cmd.buttons)` — `NetPlayer`, `Bot`, the solo
   * loop and `NetClient` — and `Prediction` records it beside each command and puts it back for a
   * replay, because a replay has the command and not the weapon. 1 for a body with no weapon.
   * Multiplied, never added: a Lightweight SMG is 1.07 × 1.05.
   */
  weaponSpeedScale = 1;

  /**
   * Held down by something other than the crouch key (post-M8).
   *
   * Planting and defusing use it: S6.3 asks for a visible indicator that somebody is working
   * on the bomb, and the honest one is the operator kneeling over it — a posture other
   * players can read from across the site with no HUD element involved. Folded into
   * `crouchHeld` rather than written straight onto the stance, so every rule that already
   * governs crouching still applies: the capsule shrinks, the speed cap drops, the eye
   * height damps down, and standing back up is still refused under a low ceiling.
   *
   * It cannot start a slide, because a slide needs the crouch *press* edge and this never
   * produces one — which is right: an interaction is not a movement input.
   */
  forceCrouch = false;

  /**
   * Free-cam: fly through the world, ignoring gravity and geometry (post-M8 QA tool).
   *
   * Deliberately a mode of *this* class rather than a separate camera. The debug camera it
   * replaces would have needed its own view integration, its own interpolation snapshots and
   * its own relationship with the render pass — three things that already exist here and
   * would have had to be kept in step. Flying is a different way of turning a command into a
   * position, and turning a command into a position is what this class is.
   *
   * The consequence worth stating: everything downstream — the camera rig, the viewmodel, the
   * audio listener, the minimap — keeps working with no knowledge that it is happening,
   * because all of them read `sim`, and `sim` is still being written every tick.
   */
  noclip = false;

  private strafeInput = 0;
  private crouchHeldThisTick = false;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  /**
   * `entityId` stamps every event this controller emits. It defaults to the local player
   * because M1 and M2 only ever had one of these; from M3 each bot owns one too, and the
   * id is how a subscriber tells "the player landed" from "something landed over there".
   */
  constructor(
    private cfg: MovementConfig,
    private readonly world: CollisionWorld,
    private readonly bus: GameBus,
    readonly entityId: number = 0,
  ) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  setConfig(cfg: MovementConfig): void {
    this.cfg = cfg;
    this.world.configure(cfg.maxSlopeDeg, cfg.collisionSkin);
    this.sim.capsuleHeight = capsuleHeightFor(cfg, this.sim.stance);
  }

  spawn(x: number, y: number, z: number, yaw: number): void {
    const cfg = this.cfg;
    this.sim.reset(x, y, z, yaw, cfg.standHeight, cfg.standEye);
    this.sim.writeSnapshot(this.curr, 0);
    copySnapshot(this.curr, this.prev);
    this.emitSpawned(x, y, z, yaw);
  }

  step(cmd: InputCommand): void {
    const sim = this.sim;
    copySnapshot(this.curr, this.prev);

    sim.tick = cmd.tickIndex;
    sim.yaw = cmd.yaw;
    sim.pitch = cmd.pitch;
    this.strafeInput = cmd.moveX;

    if (this.noclip) {
      this.stepNoclip(cmd);
      return;
    }

    this.readInputEdges(cmd);
    this.tickTimers(press.jumpPressed);

    if (sim.mantleActive) {
      this.continueMantle(cmd.buttons);
      return;
    }

    this.writeWishDirection(cmd);
    this.updateSprint(
      press.sprintHeld,
      press.sprintPressed,
      wish.movingForward,
      press.crouchHeld,
      press.adsHeld || press.fireHeld,
    );
    this.updateSlide();

    // ---- jump. This is also the slide jump-cancel route (S5.2). ----------
    if (sim.jumpBuffer > 0 && (sim.grounded || sim.coyote > 0)) this.performJump();

    // ---- crouch / stand --------------------------------------------------
    if (!sim.slideActive) this.updateCrouchStance(press.crouchHeld);

    // ---- velocity --------------------------------------------------------
    const wasGroundedForCap = sim.grounded;
    this.applyVelocity(press.adsHeld);
    this.applyGravity();

    // ---- collision -------------------------------------------------------
    integrateMotion(sim, this.cfg, this.world);

    if (wasGroundedForCap && !sim.grounded && !sim.jumpedThisTick) {
      sim.airSpeedCap = Math.max(sim.speed, this.airSprintFloor());
    }

    this.updatePostMoveStance(press.crouchHeld);
    if (sim.justLanded) this.emitLanded();
    this.tryMantle(press.jumpPressed, wish.movingForward);

    this.finishTick(cmd.buttons);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * One tick of free-cam flight (post-M8 QA tool).
   *
   * WASD flies along the *look* direction, including pitch, so the camera goes where it is
   * pointing — which is what makes inspecting a navmesh from above or a collider from
   * underneath a single movement rather than a puzzle. Jump rises and crouch sinks on the
   * world vertical regardless of pitch, because "straight up" is the one direction you cannot
   * express by looking.
   *
   * Velocity is written as well as position even though nothing integrates it here: the
   * speedometer, the debug overlay and the audio listener all read `sim.speed`, and a
   * free-cam that reported 0 m/s while crossing the map would make the overlay lie during
   * exactly the session it is there to support.
   *
   * No collision, no gravity, no stance machine and no footsteps — a spectator makes no
   * noise, which is half of what "observe natural bot AI behaviour up close" requires.
   */
  private stepNoclip(cmd: InputCommand): void {
    const sim = this.sim;
    const buttons = cmd.buttons;

    const speed =
      NOCLIP_SPEED *
      (isDown(buttons, Btn.Sprint) ? NOCLIP_BOOST : 1) *
      (isDown(buttons, Btn.Ads) ? NOCLIP_PRECISE : 1);

    const cp = simCos(sim.pitch);
    const fx = -simSin(sim.yaw) * cp;
    const fy = simSin(sim.pitch);
    const fz = -simCos(sim.yaw) * cp;
    const rx = simCos(sim.yaw);
    const rz = -simSin(sim.yaw);

    let vx = rx * cmd.moveX + fx * cmd.moveZ;
    let vy = fy * cmd.moveZ;
    let vz = rz * cmd.moveX + fz * cmd.moveZ;
    if (isDown(buttons, Btn.Jump)) vy += 1;
    if (isDown(buttons, Btn.Crouch)) vy -= 1;

    const len = Math.hypot(vx, vy, vz);
    if (len > 1e-4) {
      const scale = speed / len;
      vx *= scale;
      vy *= scale;
      vz *= scale;
    } else {
      vx = 0;
      vy = 0;
      vz = 0;
    }

    sim.x += vx * DT;
    sim.y += vy * DT;
    sim.z += vz * DT;
    sim.vx = vx;
    sim.vy = vy;
    sim.vz = vz;

    // A flying capsule is not standing on anything, and nothing may believe otherwise:
    // `grounded` false keeps the footstep, landing and slide paths inert for free.
    sim.grounded = false;
    sim.justLanded = false;
    sim.blockedHorizontally = false;
    sim.steppedUp = false;
    sim.eyeHeight = this.cfg.standEye;
    sim.prevButtons = buttons;
    sim.writeSnapshot(this.curr, this.strafeInput);
  }

  /** Decode this tick's button edges into `press`, which every step below reads. */
  private readInputEdges(cmd: InputCommand): void {
    const buttons = cmd.buttons;
    const prevButtons = this.sim.prevButtons;
    press.jumpPressed = justPressed(buttons, prevButtons, Btn.Jump);
    press.crouchPressed = justPressed(buttons, prevButtons, Btn.Crouch);
    // `forceCrouch` joins the *held* test and deliberately not the pressed one: see the field.
    press.crouchHeld = isDown(buttons, Btn.Crouch) || this.forceCrouch;
    press.sprintHeld = isDown(buttons, Btn.Sprint);
    press.sprintPressed = justPressed(buttons, prevButtons, Btn.Sprint);
    press.adsHeld = isDown(buttons, Btn.Ads);
    // Pulling the trigger stops a sprint, which is what starts the sprint-to-fire timer
    // in the weapon. Holding shift into a gunfight must not be free (brief S6.6).
    press.fireHeld = isDown(buttons, Btn.Fire);
  }

  private tickTimers(jumpPressed: boolean): void {
    const sim = this.sim;
    const cfg = this.cfg;
    sim.mantleCooldown = Math.max(0, sim.mantleCooldown - DT);
    sim.slideCooldown = Math.max(0, sim.slideCooldown - DT);
    sim.tacSprintCooldown = Math.max(0, sim.tacSprintCooldown - DT);
    sim.tacLockout = Math.max(0, sim.tacLockout - DT);
    sim.jumpBuffer = Math.max(0, sim.jumpBuffer - DT);
    sim.coyote = sim.grounded ? cfg.coyoteTime : Math.max(0, sim.coyote - DT);
    sim.jumpedThisTick = false;
    if (jumpPressed) sim.jumpBuffer = cfg.jumpBufferTime;
  }

  /**
   * A vault owns the tick it is on: the pose is interpolated, nothing else reads the command.
   */
  private continueMantle(buttons: number): void {
    const sim = this.sim;
    const finished = stepMantle(sim, this.cfg);
    sim.capsuleHeight = capsuleHeightFor(this.cfg, sim.stance);
    if (finished) this.emitMantleEnded();
    this.finishTick(buttons);
  }

  /** This tick's wish direction in world space, into `wish`. */
  private writeWishDirection(cmd: InputCommand): void {
    const sim = this.sim;
    const fx = -simSin(sim.yaw);
    const fz = -simCos(sim.yaw);
    const rx = simCos(sim.yaw);
    const rz = -simSin(sim.yaw);
    let wishX = rx * cmd.moveX + fx * cmd.moveZ;
    let wishZ = rz * cmd.moveX + fz * cmd.moveZ;
    // Direction and magnitude are separated deliberately. Normalising by the *clamped*
    // magnitude leaves an over-length direction vector whenever a command arrives with
    // |move| > 1, and every downstream consumer (accelerate, friction, slide steering)
    // assumes unit length — the result is a speed cap quietly scaled by |move|.
    const wishLen = Math.hypot(wishX, wishZ);
    wish.mag = Math.min(1, wishLen);
    if (wishLen > 1e-4) {
      wishX /= wishLen;
      wishZ /= wishLen;
    } else {
      wishX = 0;
      wishZ = 0;
    }
    wish.x = wishX;
    wish.z = wishZ;
    wish.movingForward = cmd.moveZ > 0.5;
  }

  /** `weaponBusy` is ADS or the trigger: either one ends a sprint. */
  private updateSprint(
    sprintHeld: boolean,
    sprintPressed: boolean,
    movingForward: boolean,
    crouchHeld: boolean,
    weaponBusy: boolean,
  ): void {
    const sim = this.sim;
    const cfg = this.cfg;

    // The hold timer must NOT care about crouch: pressing crouch is how a slide is
    // requested, and zeroing the timer on that same tick would make the S5.2 entry
    // gate ("sprint held >= 0.3 s") impossible to ever satisfy.
    const holdingSprint = sprintHeld && movingForward;
    if (holdingSprint && sim.grounded && !sim.slideActive) sim.sprintHeldTime += DT;
    else if (!holdingSprint) sim.sprintHeldTime = 0;
    sim.sprintActive = holdingSprint && !crouchHeld && !weaponBusy;

    if (sprintPressed && movingForward && !crouchHeld && !weaponBusy) {
      const elapsed = (sim.tick - sim.lastSprintPressTick) * DT;
      const eligible =
        elapsed <= cfg.tacSprintDoubleTapWindow &&
        sim.tacSprintCooldown <= 0 &&
        sim.tacLockout <= 0 &&
        !sim.slideActive;
      if (eligible) {
        sim.tacSprintActive = true;
        sim.tacSprintElapsed = 0;
      }
      sim.lastSprintPressTick = sim.tick;
    }

    if (!sim.tacSprintActive) return;
    if (!sim.sprintActive || sim.slideActive) {
      this.endTacSprint();
      return;
    }
    sim.tacSprintElapsed += DT;
    if (sim.tacSprintElapsed > cfg.tacSprintDuration + cfg.tacSprintDecay) this.endTacSprint();
  }

  private endTacSprint(): void {
    const sim = this.sim;
    if (!sim.tacSprintActive) return;
    sim.tacSprintActive = false;
    sim.tacSprintElapsed = 0;
    sim.tacSprintCooldown = this.cfg.tacSprintCooldown;
  }

  /** Continue a slide, end it, or start one on the crouch press out of a sprint. */
  private updateSlide(): void {
    const sim = this.sim;
    const cfg = this.cfg;
    this.crouchHeldThisTick = press.crouchHeld;

    if (sim.slideActive) {
      const reason = this.slideExitReason(cfg);
      if (reason !== null) this.exitSlide(reason);
      else stepSlide(sim, cfg, wish.x, wish.z);
      return;
    }
    if (press.crouchPressed && press.sprintHeld && canStartSlide(sim, cfg)) {
      const entry = beginSlide(sim, cfg, wish.x, wish.z);
      this.setStance('SLIDE');
      this.emitSlideStarted(entry);
    }
  }

  /**
   * Why the slide ends this tick, or null.
   *
   * **The crouch key is not one of the reasons** (2026-09-28). A slide used to last exactly as
   * long as the key was held, so a tap made a 50 ms slide that read as a dropped input and still
   * paid the full cooldown and tac-sprint lockout. It is committed now: the press starts all of
   * it, `slideDuration` long, and only the world or a jump ends it early — which is also what
   * lets the third-person clip be fitted to it, since a slide has a length the clip can know.
   *
   * That makes the wall a reason. `slideSpeed` is the curve, not the body: into a wall head on,
   * `integrateMotion` projects the velocity away and `stepSlide` writes the curve's speed back
   * next tick, so a held key used to be the only way out of pressing into the wall for the rest
   * of the slide. `sim.speed` is the velocity collision left, so the body stopping ends the slide
   * the way the curve running down does. Along a wall at an angle it keeps the tangential part and
   * carries on, which is a slide.
   */
  private slideExitReason(cfg: MovementConfig): SlideEndReason | null {
    const sim = this.sim;
    if (sim.slideElapsed >= cfg.slideDuration) return 'expired';
    if (sim.slideSpeed < cfg.slideMinSpeed) return 'tooSlow';
    if (sim.slideAirTime > 0.1) return 'blocked';
    if (sim.speed < cfg.slideMinSpeed) return 'blocked';
    return null;
  }

  /**
   * The single exit from a slide. Both LOCKED penalties are applied inside
   * `endSlide`, so no route out of a slide can skip the tac-sprint lockout.
   * Horizontal velocity is left untouched, which is what carries a jump-cancel.
   */
  private exitSlide(reason: SlideEndReason): void {
    const sim = this.sim;
    const exitSpeed = sim.speed;
    endSlide(sim, this.cfg);

    if (reason === 'jumpCancel') {
      this.setStance('AIRBORNE');
    } else if (this.crouchHeldThisTick || !this.fitsHere(this.cfg.standHeight)) {
      this.setStance('CROUCH');
    } else {
      this.setStance('STAND');
    }

    this.emitSlideEnded(reason, exitSpeed);
  }

  private performJump(): void {
    const sim = this.sim;
    const cfg = this.cfg;
    if (sim.slideActive) this.exitSlide('jumpCancel');

    // Jumping out of a crouch is only allowed where the taller capsule fits, which is
    // what stops a jump from launching the player through a low ceiling.
    if (sim.stance === 'CROUCH' && !this.fitsHere(cfg.standHeight)) return;

    sim.vy = jumpVelocity(cfg);
    sim.grounded = false;
    sim.coyote = 0;
    sim.jumpBuffer = 0;
    sim.jumpedThisTick = true;
    sim.airSpeedCap = Math.max(sim.speed, this.airSprintFloor());
    this.setStance('AIRBORNE');

    this.emitJumped();
  }

  /**
   * The least an airborne body may accelerate to: sprint speed, in the weapon's hands.
   *
   * Air control can reach this from a standstill, so left at the config's sprint speed a jump
   * would be the way out from under a heavy weapon — a minigun walks at 3.7 m/s and a hop could
   * take it to 6.9 in a fifth of a second. The perks' `speedScale` is deliberately not in it: the
   * air has never been scaled by Lightweight, and every M1 jump number was measured that way.
   */
  private airSprintFloor(): number {
    return this.cfg.sprintSpeed * this.weaponSpeedScale;
  }

  /** Horizontal speed cap for the current state, before the input magnitude scale. */
  private speedCap(adsHeld: boolean): number {
    const sim = this.sim;
    const cfg = this.cfg;
    if (!sim.grounded) return Math.max(sim.airSpeedCap, this.airSprintFloor());
    const scale = this.speedScale * this.weaponSpeedScale;
    if (sim.stance === 'CROUCH') return cfg.crouchSpeed * scale;
    if (adsHeld) return cfg.adsSpeed * scale;
    if (sim.tacSprintActive) {
      const held = cfg.tacSprintDuration;
      if (sim.tacSprintElapsed <= held) return cfg.tacSprintSpeed * scale;
      const t = clamp01((sim.tacSprintElapsed - held) / Math.max(cfg.tacSprintDecay, 1e-3));
      return lerp(cfg.tacSprintSpeed, cfg.sprintSpeed, t) * scale;
    }
    if (sim.sprintActive) return cfg.sprintSpeed * scale;
    return cfg.walkSpeed * scale;
  }

  /** Friction, acceleration and the cap — or, in a slide, the curve `stepSlide` already wrote. */
  private applyVelocity(adsHeld: boolean): void {
    const sim = this.sim;
    const cfg = this.cfg;
    if (sim.slideActive) {
      // stepSlide already wrote the horizontal velocity.
      this.currentSpeedCap = sim.slideSpeed;
      return;
    }

    this.currentSpeedCap = this.speedCap(adsHeld);
    const wishSpeed = this.currentSpeedCap * wish.mag;
    if (sim.grounded) applyFriction(sim, cfg, wish.x, wish.z, wishSpeed);
    const speedBefore = sim.speed;
    const accel = sim.grounded ? cfg.groundAccel : cfg.groundAccel * cfg.airControl;
    accelerate(sim, wish.x, wish.z, wishSpeed, accel);
    // Acceleration may never push past the cap; existing momentum above it is left
    // to friction. This is what bounds wall-hugging and mid-air strafing alike.
    const limit = Math.max(sim.grounded ? this.currentSpeedCap : sim.airSpeedCap, speedBefore);
    clampHorizontalSpeed(sim, limit);
  }

  /**
   * Gravity, which does not press into ground already underfoot (round 4).
   *
   * This used to run unconditionally, and standing still was therefore never *still*. The
   * measured symptom, on flat ground, with no input at all:
   *
   * ```
   *   y: 5.00  0.00  5.00  0.00  0.00  0.00  5.00  0.00   mm
   * ```
   *
   * a 5 mm vertical limit cycle — exactly `collisionSkin` — running at twenty-odd hertz
   * forever. Gravity drives the capsule 2.7 mm into the floor each tick; `resolve` pushes
   * it back out by `depth + skin`, which overshoots to 5 mm *above* the floor; from there
   * it is no longer touching anything, so the next tick has no contact, `groundSnap` pulls
   * it back down, and the cycle repeats. Five millimetres is nothing at arm's length and
   * 0.82° of pitch against a wall 0.35 m away — about ten pixels of judder at this FOV,
   * which is why the report is specifically *"when the player gets right up close"*. It is
   * visible only when there is something near enough to reference it against.
   *
   * That is the jitter. It was never the depth buffer and never the step-up, and rounds 2
   * and 3 spent themselves on both.
   *
   * The same accumulation is the ice-slide on ramps. `projectVelocity` removes the
   * component of velocity going *into* the surface and correctly leaves the tangential
   * part — so on a slope, gravity's downhill component builds up every tick until friction
   * balances it, which is a steady creep downhill with no input. Measured before this:
   * 292 mm in three seconds on 18°, 766 mm on 44°.
   *
   * Both are the same wrong assumption: that a player standing on the floor is falling. A
   * grounded player is *supported*. Gravity resumes the moment the ground stops being
   * there, and `groundSnapDist` — 0.4 m — is what keeps the player attached walking over a
   * crest or down a slope, which is the job it already had.
   *
   * The two guards are exactly the two ways `vy` can legitimately be non-falling on a
   * grounded tick: a jump was just issued, or a mantle/slide wrote an upward velocity.
   */
  private applyGravity(): void {
    const sim = this.sim;
    const cfg = this.cfg;
    if (sim.grounded && !sim.jumpedThisTick && sim.vy <= 0) {
      sim.vy = 0;
      return;
    }
    sim.vy -= cfg.gravity * DT;
    if (sim.vy < -cfg.maxFallSpeed) sim.vy = -cfg.maxFallSpeed;
  }

  private updateCrouchStance(crouchHeld: boolean): void {
    const sim = this.sim;
    if (!sim.grounded || sim.stance === 'AIRBORNE' || sim.stance === 'MANTLE') return;
    if (crouchHeld) {
      if (sim.stance !== 'CROUCH') this.setStance('CROUCH');
      return;
    }
    // No standing up inside a vent (S5.3): blocked, not clipped.
    if (sim.stance === 'CROUCH' && this.fitsHere(this.cfg.standHeight)) this.setStance('STAND');
  }

  /** Leaving the ground, or arriving on it: the stance the collision pass implies. */
  private updatePostMoveStance(crouchHeld: boolean): void {
    const sim = this.sim;
    if (!sim.grounded && !sim.slideActive && sim.stance !== 'AIRBORNE') {
      this.setStance('AIRBORNE');
      return;
    }
    if (sim.grounded && sim.stance === 'AIRBORNE') {
      const wantCrouch = crouchHeld || !this.fitsHere(this.cfg.standHeight);
      this.setStance(wantCrouch ? 'CROUCH' : 'STAND');
    }
  }

  /** A jump press, or a sprint into something low enough to vault without asking. */
  private tryMantle(jumpPressed: boolean, movingForward: boolean): void {
    const sim = this.sim;
    const cfg = this.cfg;
    const autoVault = sim.grounded && sim.sprintActive && movingForward && sim.blockedHorizontally;
    if (!jumpPressed && !autoVault) return;
    if (!detectMantle(sim, cfg, this.world, mantleTarget)) return;
    // An auto-vault only clears low obstacles; anything taller waits for a jump press.
    const autoVaultTooTall =
      autoVault && !jumpPressed && mantleTarget.ledgeHeight > cfg.autoVaultMaxHeight;
    if (autoVaultTooTall) return;

    if (sim.slideActive) this.exitSlide('blocked');
    beginMantle(sim, mantleTarget);
    this.setStance('MANTLE');
    sim.capsuleHeight = capsuleHeightFor(cfg, 'MANTLE');
    sim.jumpBuffer = 0;
    this.emitMantleStarted();
  }

  private fitsHere(height: number): boolean {
    return capsuleFits(this.world, this.cfg, this.sim.x, this.sim.y, this.sim.z, height);
  }

  private setStance(next: StanceId): void {
    const sim = this.sim;
    if (sim.stance === next) return;
    if (!isLegalStanceTransition(sim.stance, next)) {
      log.warn(`illegal stance transition ${sim.stance} -> ${next}`);
      return;
    }
    const from = sim.stance;
    sim.stance = next;
    sim.capsuleHeight = capsuleHeightFor(this.cfg, next);
    this.emitStanceChanged(from, next);
  }

  /** Eye smoothing, head bob and footstep cadence. Runs on every path out of step(). */
  private finishTick(buttons: number): void {
    const sim = this.sim;
    const cfg = this.cfg;

    const targetEye = eyeHeightFor(cfg, sim.stance);
    sim.eyeHeight = damp(sim.eyeHeight, targetEye, EYE_DAMP_RATE, DT);

    const speed = sim.speed;
    if (sim.grounded && speed > 0.4 && sim.stance !== 'MANTLE') {
      // Bob phase advances with distance travelled, not time, so cadence tracks speed.
      const stride = Math.max(cfg.footstepStride, 0.2);
      sim.bobPhase = (sim.bobPhase + (speed * DT * TAU) / stride) % TAU;
      sim.distanceSinceStep += speed * DT;
      const strideForStance = sim.stance === 'CROUCH' ? stride * 1.35 : stride;
      if (sim.distanceSinceStep >= strideForStance * 0.5) {
        sim.distanceSinceStep = 0;
        this.emitFootstep(speed);
      }
    } else if (!sim.grounded) {
      sim.distanceSinceStep = 0;
    }

    sim.prevButtons = buttons;
    sim.writeSnapshot(this.curr, this.strafeInput);
  }

  // Nine events, nine fillers. One method per payload rather than one generic stamper: the
  // payloads are nine different shapes, and a helper over all of them would make every one of
  // these call sites polymorphic on the per-tick path, which is what R7 is about.

  private emitSpawned(x: number, y: number, z: number, yaw: number): void {
    evSpawned.entityId = this.entityId;
    evSpawned.x = x;
    evSpawned.y = y;
    evSpawned.z = z;
    evSpawned.yaw = yaw;
    this.bus.emit(EV.PlayerSpawned, evSpawned);
  }

  private emitStanceChanged(from: StanceId, to: StanceId): void {
    evStance.entityId = this.entityId;
    evStance.from = from;
    evStance.to = to;
    evStance.tick = this.sim.tick;
    this.bus.emit(EV.PlayerStanceChanged, evStance);
  }

  private emitJumped(): void {
    const sim = this.sim;
    evJump.entityId = this.entityId;
    evJump.x = sim.x;
    evJump.y = sim.y;
    evJump.z = sim.z;
    evJump.horizontalSpeed = sim.speed;
    this.bus.emit(EV.PlayerJumped, evJump);
  }

  private emitLanded(): void {
    const sim = this.sim;
    evLand.entityId = this.entityId;
    evLand.x = sim.x;
    evLand.y = sim.y;
    evLand.z = sim.z;
    evLand.impactSpeed = sim.landImpact;
    evLand.stance = sim.stance;
    evLand.material = sim.groundMaterial;
    this.bus.emit(EV.PlayerLanded, evLand);
  }

  private emitFootstep(speed: number): void {
    const sim = this.sim;
    evStep.entityId = this.entityId;
    evStep.x = sim.x;
    evStep.y = sim.y;
    evStep.z = sim.z;
    evStep.speed = speed;
    evStep.heavy = sim.tacSprintActive || sim.sprintActive;
    evStep.quiet = sim.stance === 'CROUCH' || sim.stance === 'SLIDE';
    evStep.material = sim.groundMaterial;
    this.bus.emit(EV.PlayerFootstep, evStep);
  }

  private emitSlideStarted(entrySpeed: number): void {
    const sim = this.sim;
    evSlideStart.entityId = this.entityId;
    evSlideStart.x = sim.x;
    evSlideStart.y = sim.y;
    evSlideStart.z = sim.z;
    evSlideStart.entrySpeed = entrySpeed;
    this.bus.emit(EV.PlayerSlideStarted, evSlideStart);
  }

  private emitSlideEnded(reason: SlideEndReason, exitSpeed: number): void {
    evSlideEnd.entityId = this.entityId;
    evSlideEnd.reason = reason;
    evSlideEnd.exitSpeed = exitSpeed;
    evSlideEnd.tick = this.sim.tick;
    this.bus.emit(EV.PlayerSlideEnded, evSlideEnd);
  }

  private emitMantleStarted(): void {
    const sim = this.sim;
    evMantleStart.entityId = this.entityId;
    evMantleStart.x = sim.x;
    evMantleStart.y = sim.y;
    evMantleStart.z = sim.z;
    evMantleStart.ledgeHeight = mantleTarget.ledgeHeight;
    this.bus.emit(EV.PlayerMantleStarted, evMantleStart);
  }

  private emitMantleEnded(): void {
    const sim = this.sim;
    evMantleEnd.entityId = this.entityId;
    evMantleEnd.x = sim.x;
    evMantleEnd.y = sim.y;
    evMantleEnd.z = sim.z;
    evMantleEnd.endStance = sim.stance;
    this.bus.emit(EV.PlayerMantleEnded, evMantleEnd);
  }
  //#endregion
}
//#endregion
