/**
 * Everything that *presents* a shot, in one place.
 *
 * `Match.ts` is the composition root and was doing this too, until it passed 700 lines and
 * broke S3's size guidance. The seam is a real one rather than a filing convenience: nothing
 * here is gameplay. The round has already landed and the damage has already been applied; this
 * turns the events that fact produced into a flash, a bang, a hitmarker, a chevron and a
 * number on screen.
 *
 * Which is why it is all subscriptions:
 *
 *   weapon.fired  --> muzzle flash, tracer, gunshot, camera shake, latency probe
 *   bullet.impact --> debris, decal, impact report
 *   damage.dealt  --> hitmarker, flesh impact, damage number, hurt vignette, hit direction
 *   entity.killed --> the sound of a body arriving, and the player's own death
 *
 * Nothing downstream of the sim is required for the sim to run, which is what lets the headless
 * harnesses fire a full magazine and play whole matches with no renderer, no audio context and
 * no DOM: none of this is constructed in those runs.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { makeScreenPoint, projectToScreen } from '../shared/ui/ScreenProjection';
import * as THREE from 'three';
import type { BotDirector } from '../shared/ai/BotDirector';
import type { LocalIdentity } from '../shared/combat/LocalIdentity';
import type { HitZone } from '../shared/combat/HitboxRig';
import { EV, type GameBus } from '../shared/core/Events';
import type { Input } from './input/Input';
import { MIX } from './engine/AudioMix';
import type { CameraRig } from './engine/CameraRig';
import type { FlameFx } from './engine/FlameFx';
import type { Fx } from './engine/Fx';
import type { ProceduralAudio } from './engine/ProceduralAudio';
import type { CameraConfig } from './player/CameraConfig';
import type { Health } from '../shared/player/Health';
import type { PlayerController } from '../shared/player/PlayerController';
import type { LatencyProbe } from './debug/LatencyProbe';
import type { Hud } from './ui/Hud';
import { viewport } from './ui/Viewport';
import type { WeaponAudio } from './weapons/WeaponAudio';
import { anyWeaponDef } from '../shared/weapons/AnyWeapon';
import { Disposable } from '../shared/core/Disposable';
import { WakeWait } from './net/WakeWait';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface FeedbackDeps {
  readonly bus: GameBus;
  readonly cameraRig: CameraRig;
  /** For the landing dip; the rig takes its numbers from the live config. */
  readonly cameraConfig: CameraConfig;
  readonly audio: ProceduralAudio;
  readonly input: Input;
  readonly player: PlayerController;
  readonly playerHealth: Health;
  readonly weaponAudio: WeaponAudio;
  readonly fx: Fx;
  /** The flamethrower's jet, which replaces the flash and tracer for a weapon with `flame`. */
  readonly flame: FlameFx;
  readonly hud: Hud;
  readonly bots: BotDirector;
  readonly latency: LatencyProbe;
  /**
   * Which entity is the player at this keyboard (M10, playtest round 2).
   *
   * **This is the file the missing hit feedback was in.** Every handler below asks "was that
   * me?" and every one of them used to ask it by comparing against `PLAYER_ENTITY_ID`, which
   * is 0. On a dedicated server the local player is entity 1 or above and entity 0 is the
   * server's unoccupied spectator seat, so the answer was always no: no hitmarker, no
   * hitmarker sound, no damage numbers, no hit puff, no hurt vignette, no hit-direction
   * chevron, no camera shake on firing, no own-weapon audio mix, no death handoff.
   *
   * None of it failed loudly. The events arrived, the subscriptions fired, and each handler
   * returned one line in — which is why it presented as "no feedback bridges to the UI" and
   * was going to be looked for in the bridge.
   */
  readonly identity: LocalIdentity;

  /**
   * Where a given entity's body is right now, or null if nobody here knows (M10).
   *
   * `bots.get(id)` was the only lookup, which is correct in single-player and empty on a
   * dedicated server — the bots are in the server process and the other players are
   * `RemoteActor`s drawn from snapshots. So the death sound, the hit-direction chevron and
   * every positional reload and dry-fire fell back to silence or to the origin of the world.
   * This asks the match, which knows about both kinds of body.
   */
  readonly bodyAt: (entityId: number) => Readonly<BodyPose> | null;

  /** Called when the local player dies, so `Match` can start its respawn timer. */
  readonly onPlayerKilled: () => void;
  /** Where the audio listener is this frame, for sounds with no located source. */
  readonly listener: () => Readonly<{ x: number; y: number; z: number }>;
}

/** Enough of a body to put a sound on it or point a chevron at it. */
export interface BodyPose {
  x: number;
  y: number;
  z: number;
  eyeHeight: number;
}

interface PendingNumber {
  x: number;
  y: number;
  z: number;
  amount: number;
  zone: HitZone;
}

/** Where a sound is: an entity's eye, a body's, or the listener when nobody owns it. */
type SoundAt = Readonly<{ x: number; y: number; z: number }>;
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Reused; a damage event must not allocate in the middle of a firefight. */
const hitScreenScratch = makeScreenPoint();

const NUMBER_QUEUE = 8;

/** Chevrons waiting for their shooter's body — as many as the HUD shows at once. */
const CHEVRON_WAIT = 4;

/** Reusable position record for "where did that sound come from". Zero allocation. */
const sourceAt = { x: 0, y: 0, z: 0 };

/** How far down the jet a flamethrower's world light is thrown, metres, at most. */
const JET_LIGHT_REACH = 1.5;

/** The shake a connecting knife and a missed one each add. */
const MELEE_SHAKE_HIT = 0.16;
const MELEE_SHAKE_MISS = 0.06;

/**
 * The jolt a round gives, and the fraction of maximum health it is measured against.
 *
 * Capped well below the landing shake: being shot has to register in the body without taking
 * the aim away from the player.
 */
const HURT_SHAKE_BASE = 0.08;
const HURT_SHAKE_RANGE = 0.16;
const HURT_SHAKE_SPAN = 0.3;
//#endregion

// ==================================== CLASS MatchFeedback ===================================== \\
//#region Class MatchFeedback
export class MatchFeedback extends Disposable {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Set on the tick a local shot resolves; consumed by the latency probe on render. */
  private shotSinceRender = false;

  private readonly deps: FeedbackDeps;
  private readonly numberQueue: PendingNumber[] = [];
  private readonly projectScratch = new THREE.Vector3();
  private numberCount = 0;
  /** Shooters the chevron is waiting on: dormant when their round landed. See `WakeWait`. */
  private readonly chevronWait = new WakeWait(CHEVRON_WAIT);
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: FeedbackDeps) {
    super();
    this.deps = deps;
    for (let i = 0; i < NUMBER_QUEUE; i++) {
      this.numberQueue.push({ x: 0, y: 0, z: 0, amount: 0, zone: 'torso' });
    }
    this.subscribe();
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Render pass. Damage numbers need the camera to project, and the camera only exists here.
   */
  render(camera: THREE.PerspectiveCamera): void {
    if (this.chevronWait.size > 0) this.chevronWait.poll(performance.now(), this.pointChevron);
    this.flushDamageNumbers(camera);
    if (!this.shotSinceRender) return;
    this.shotSinceRender = false;
    this.deps.latency.notePresented(performance.now());
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  // -- wiring ----------------------------------------------------------------

  /**
   * The ten events this screen presents, each on a handler of its own.
   *
   * Every handler is a field rather than a closure made here, so the ten arrow functions are
   * allocated once with the object and not once per subscription — and `WeaponFired` and
   * `DamageDealt` arrive on every round of every firefight.
   */
  private subscribe(): void {
    const { bus } = this.deps;
    this.own(bus.on(EV.WeaponFired, this.onWeaponFired));
    this.own(bus.on(EV.BulletImpact, this.onBulletImpact));
    this.own(bus.on(EV.MeleeSwing, this.onMeleeSwing));
    this.own(bus.on(EV.DamageDealt, this.onDamageDealt));
    this.own(bus.on(EV.EntityKilled, this.onEntityKilled));
    this.own(bus.on(EV.WeaponDryFired, this.onDryFired));
    this.own(bus.on(EV.WeaponReloadStep, this.onReloadStep));
    this.own(bus.on(EV.WeaponAdsChanged, this.onAdsChanged));
    this.own(bus.on(EV.PlayerLanded, this.onLanded));
    this.own(bus.on(EV.PlayerFootstep, this.onFootstep));
  }

  // -- the handlers ------------------------------------------------------------

  /**
   * The weapon is the *shooter's*, off the event, not the local player's off the
   * inventory. Every emitter — a bot's `WeaponSystem`, the local one, `NetSession` for a
   * remote player — writes the firing def's id here, and this handler used to read
   * `weapons.definition` instead, so every shot in the match sounded like, and flashed
   * like, whatever the viewer happened to be holding: hold a sniper and the whole lobby
   * fires snipers; swap, and it swaps with you. An id nothing catalogues cannot arrive
   * (each emitter takes it from a def), so a miss here is a programming error and not a
   * case to fall back from — falling back to the viewer's weapon is the bug.
   *
   * `anyWeaponDef` rather than `WEAPON_DEFS`, since a killstreak weapon reached a player's
   * hands (2026-09-26): a minigun's shots are emitted by this same `WeaponSystem` and its
   * def is not in the loadout table, so the throw below fired on every round — inside
   * `EventBus.emit`, which took the rest of the tick with it.
   */
  private readonly onWeaponFired = (p: {
    weaponId: string;
    sourceId: number;
    x: number;
    y: number;
    z: number;
    dx: number;
    dy: number;
    dz: number;
    endX: number;
    endY: number;
    endZ: number;
    distance: number;
    tracer: boolean;
  }): void => {
    const def = anyWeaponDef(p.weaponId);
    if (def === undefined) throw new Error(`WeaponFired names an unknown weapon "${p.weaponId}".`);
    // The muzzle *light* belongs to whoever fired, wherever they are standing; the flash
    // mesh hangs off the local player's own viewmodel and belongs only to them (M3 bug).
    const local = this.deps.identity.is(p.sourceId);
    if (def.flame !== undefined) this.fireJet(p, def.muzzleFlashScale, local);
    else this.fireShot(p, def.muzzleFlashScale, local);
    // M8 mix: your own rifle sits below everyone else's so an enemy at thirty metres
    // has somewhere to be heard. See `engine/AudioMix.ts` for the arithmetic.
    this.deps.weaponAudio.playGunshot(p.x, p.y, p.z, def.voice, local ? MIX.ownWeapon : MIX.otherWeapon);
    // Everything below is about the local player's own hands and must not fire for a bot:
    // a bot shooting across the room shaking your camera is the classic tell.
    if (!local) return;
    this.deps.cameraRig.shake.add(def.shakePerShot);
    this.deps.latency.armFromPress(this.deps.input.takeFirePress());
    this.shotSinceRender = true;
  };

  private readonly onBulletImpact = (p: {
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    material: number;
    penetrated: boolean;
  }): void => {
    this.deps.fx.spawnImpact(p.x, p.y, p.z, p.nx, p.ny, p.nz, p.material, p.penetrated);
    this.deps.weaponAudio.playImpact(p.x, p.y, p.z, p.material, p.penetrated);
  };

  /**
   * The knife (post-M8). Only the swing itself is handled here.
   *
   * A connecting knife goes through `DamageSystem` like anything else, so the hitmarker,
   * the flesh impact, the damage number and the kill sound are already subscribed above —
   * there is deliberately no melee-specific branch in any of them. A melee that needed its
   * own hitmarker path would be a second implementation of feedback, and the two would
   * eventually disagree about what a kill looks like.
   */
  private readonly onMeleeSwing = (p: { sourceId: number; x: number; y: number; z: number; hit: boolean }): void => {
    this.deps.weaponAudio.playMeleeSwing(p.x, p.y, p.z, p.hit);
    if (this.deps.identity.is(p.sourceId)) {
      this.deps.cameraRig.shake.add(p.hit ? MELEE_SHAKE_HIT : MELEE_SHAKE_MISS);
    }
  };

  private readonly onDamageDealt = (p: {
    sourceId: number;
    targetId: number;
    zone: HitZone;
    amount: number;
    x: number;
    y: number;
    z: number;
    lethal: boolean;
    autonomous: boolean;
  }): void => {
    if (this.deps.identity.is(p.targetId)) {
      this.onPlayerHurt(p.sourceId, p.amount);
      return;
    }
    // A round landing on a body is a sound in the room no matter who fired it (S6.8).
    this.deps.weaponAudio.playFleshImpact(p.x, p.y, p.z, p.zone === 'head');
    if (!this.deps.identity.is(p.sourceId)) return;
    this.markOwnHit(p);
  };

  private readonly onEntityKilled = (p: { targetId: number }): void => {
    if (this.deps.identity.is(p.targetId)) {
      this.deps.onPlayerKilled();
      return;
    }
    const victim = this.deps.bodyAt(p.targetId);
    if (victim === null) return;
    // Slightly off the floor: the sound is the body arriving, not the feet.
    this.deps.weaponAudio.playDeath(victim.x, victim.y + 0.4, victim.z);
  };

  private readonly onDryFired = (p: { sourceId: number }): void => {
    const at = this.sourcePosition(p.sourceId);
    this.deps.weaponAudio.playDryFire(at.x, at.y, at.z);
  };

  private readonly onReloadStep = (p: { sourceId: number; step: string }): void => {
    const at = this.sourcePosition(p.sourceId);
    this.deps.weaponAudio.playReloadStep(at.x, at.y, at.z, p.step as never);
  };

  private readonly onAdsChanged = (p: { sourceId: number; aiming: boolean }): void => {
    const at = this.sourcePosition(p.sourceId);
    this.deps.weaponAudio.playAdsRustle(at.x, at.y, at.z, p.aiming);
  };

  /**
   * Feet, from M1, and from M3 for everybody rather than only the player.
   *
   * Both play positionally for every combatant — that is how you hear one drop in behind you.
   * The *camera dip* is the one part that is not shared: only the local player's own landing
   * moves the local player's view, which was an M3 bug when `player.landed` grew an entity id
   * and this handler did not read it.
   */
  private readonly onLanded = (p: {
    entityId: number;
    x: number;
    y: number;
    z: number;
    impactSpeed: number;
    material: number;
  }): void => {
    const own = this.deps.identity.is(p.entityId);
    if (own) this.deps.cameraRig.applyLanding(this.deps.cameraConfig, p.impactSpeed);
    this.deps.audio.playLanding(
      p.x,
      p.y,
      p.z,
      p.impactSpeed,
      p.material,
      own ? MIX.ownFootstep : MIX.otherFootstep,
    );
  };

  private readonly onFootstep = (p: {
    entityId: number;
    x: number;
    y: number;
    z: number;
    speed: number;
    heavy: boolean;
    material: number;
  }): void => {
    // M8 mix: your own steps are constant, carry no information, and are the best mask
    // in the game for the one sound you most need to hear (`engine/AudioMix.ts`).
    const own = this.deps.identity.is(p.entityId);
    this.deps.audio.playFootstep(
      p.x,
      p.y,
      p.z,
      p.speed,
      p.heavy,
      p.material,
      own ? MIX.ownFootstep : MIX.otherFootstep,
    );
  };

  // -- what a shot looks like --------------------------------------------------

  /** An ordinary round: the flash, and a tracer where the round carries one. */
  private fireShot(
    p: { x: number; y: number; z: number; endX: number; endY: number; endZ: number; tracer: boolean },
    scale: number,
    local: boolean,
  ): void {
    this.deps.fx.fireMuzzleFlash(p.x, p.y, p.z, scale, local);
    if (p.tracer) this.deps.fx.spawnTracer(p.x, p.y, p.z, p.endX, p.endY, p.endZ);
  }

  /**
   * A jet, not a shot (2026-09-28). The star-shaped flash on the nozzle ten times a second
   * is what made the flamethrower read as a machine gun, so it gets the fire instead, and
   * of the flash only the world light — thrown a metre and a half down the jet, which is
   * where the fire that would light a wall actually is.
   */
  private fireJet(
    p: {
      x: number;
      y: number;
      z: number;
      dx: number;
      dy: number;
      dz: number;
      endX: number;
      endY: number;
      endZ: number;
      distance: number;
    },
    scale: number,
    local: boolean,
  ): void {
    this.deps.flame.emit(p.x, p.y, p.z, p.endX, p.endY, p.endZ, local);
    const lit = Math.min(JET_LIGHT_REACH, p.distance * 0.5);
    this.deps.fx.fireMuzzleFlash(p.x + p.dx * lit, p.y + p.dy * lit, p.z + p.dz * lit, scale, false);
  }

  // -- damage, both ways -------------------------------------------------------

  /** A round of the local player's own landing on somebody else: the mark, the puff, the number. */
  private markOwnHit(p: {
    zone: HitZone;
    amount: number;
    x: number;
    y: number;
    z: number;
    lethal: boolean;
    autonomous: boolean;
  }): void {
    // Timestamped here, at the moment the damage was applied, so the hitmarker latency
    // reported in the overlay is hit-to-visual and not visual-to-visual.
    // `autonomous`: the player's own sentry landed it. The mark is theirs — the kill is
    // credited to them — but it is a different colour, so nobody reads a turret's work as
    // their own aim (the human, 2026-09-24).
    this.deps.hud.showHitmarker(p.lethal, performance.now(), p.autonomous);
    this.deps.weaponAudio.playHitmarker(p.lethal);
    // Debris comes back along the shot, so the puff faces the shooter.
    const sim = this.deps.player.sim;
    const bx = sim.x - p.x;
    const by = sim.y + sim.eyeHeight - p.y;
    const bz = sim.z - p.z;
    const inv = 1 / Math.max(1e-4, Math.hypot(bx, by, bz));
    this.deps.fx.spawnHitPuff(p.x, p.y, p.z, bx * inv, by * inv, bz * inv);
    this.queueDamageNumber(p.x, p.y, p.z, p.amount, p.zone);
  }

  /**
   * The player took a round. The vignette says how hard, the chevron says from where — and the
   * chevron is the important one, because being shot from off-screen with no indication of the
   * direction is the single most frustrating way to die.
   */
  private onPlayerHurt(sourceId: number, amount: number): void {
    const max = this.deps.playerHealth.max;
    this.deps.hud.showHurt(amount, max);
    // A jolt proportional to the round, capped well below the landing shake: being shot has to
    // register in the body without taking the aim away from the player.
    const severity = Math.min(1, amount / Math.max(max * HURT_SHAKE_SPAN, 1));
    this.deps.cameraRig.shake.add(HURT_SHAKE_BASE + severity * HURT_SHAKE_RANGE);

    if (this.deps.identity.is(sourceId)) return;
    // A shooter this client was not told about wakes in the next snapshot (R9); until it does
    // there is nothing to point at, so the chevron waits for it rather than not appearing.
    if (!this.pointChevron(sourceId)) this.chevronWait.add(sourceId, performance.now());
  }

  /** Point a hit-direction chevron at `sourceId`'s body. False when there is no body to point at. */
  private readonly pointChevron = (sourceId: number): boolean => {
    const shooter = this.deps.bodyAt(sourceId);
    if (shooter === null) return false;
    /**
     * The bearing, from the one projection (P9 follow-up).
     *
     * This expression was right — it is the one the other two disagreed with — but it was a
     * *third* copy of the same idea, written in yaw rather than in the camera's own basis. With
     * `projectToScreen` it is the same call the two ring arrows make, so there is nothing left
     * for them to drift apart from, and the property that was silently false for a milestone is
     * now measured in `readability` rather than reasoned about here.
     */
    const camera = this.deps.cameraRig.camera;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    projectToScreen(
      camera.matrixWorldInverse.elements,
      camera.projectionMatrix.elements,
      shooter.x,
      camera.position.y,
      shooter.z,
      1,
      1,
      hitScreenScratch,
    );
    this.deps.hud.showHitDirection(hitScreenScratch.bearingRad);
    return true;
  };

  // -- where a sound is --------------------------------------------------------

  /**
   * Where an entity's weapon sounds should come from. The player's own mechanical noises sit at
   * their eye; a bot's sit at the bot, which is what makes hearing one reload behind a crate a
   * usable piece of information rather than a confusing one.
   */
  private sourcePosition(sourceId: number): SoundAt {
    if (this.deps.identity.is(sourceId)) {
      const sim = this.deps.player.sim;
      sourceAt.x = sim.x;
      sourceAt.y = sim.y + sim.eyeHeight;
      sourceAt.z = sim.z;
      return sourceAt;
    }
    const body = this.deps.bodyAt(sourceId);
    if (body !== null) {
      sourceAt.x = body.x;
      sourceAt.y = body.y + body.eyeHeight;
      sourceAt.z = body.z;
      return sourceAt;
    }
    // Unregistered source (a range dummy). Put it at the listener so it stays audible rather
    // than being panned to the origin of the world.
    return this.deps.listener();
  }

  // -- the damage numbers ------------------------------------------------------

  private queueDamageNumber(x: number, y: number, z: number, amount: number, zone: HitZone): void {
    if (this.numberCount >= NUMBER_QUEUE) return;
    const slot = this.numberQueue[this.numberCount];
    if (slot === undefined) return;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.amount = amount;
    slot.zone = zone;
    this.numberCount++;
  }

  private flushDamageNumbers(camera: THREE.PerspectiveCamera): void {
    if (this.numberCount === 0) return;
    if (this.deps.hud.damageNumbersEnabled) this.showDamageNumbers(camera);
    this.numberCount = 0;
  }

  /**
   * The queue, projected onto the screen.
   *
   * The cached window size: reading it here, after a frame of HUD writes, forced a reflow
   * every frame a number was on screen. See `ui/Viewport.ts`.
   */
  private showDamageNumbers(camera: THREE.PerspectiveCamera): void {
    const halfW = viewport.width * 0.5;
    const halfH = viewport.height * 0.5;
    for (let i = 0; i < this.numberCount; i++) {
      const n = this.numberQueue[i];
      if (n === undefined) continue;
      this.projectScratch.set(n.x, n.y, n.z).project(camera);
      if (this.projectScratch.z > 1) continue;
      this.deps.hud.showDamageNumber(
        halfW + this.projectScratch.x * halfW,
        halfH - this.projectScratch.y * halfH,
        n.amount,
        n.zone,
      );
    }
  }
  //#endregion
}
//#endregion
