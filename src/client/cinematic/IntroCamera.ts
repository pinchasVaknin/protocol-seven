import * as THREE from 'three';
import {
  COUNTDOWN_SECONDS,
  planIntro,
  RETURN_SECONDS,
  type IntroPlan,
  type IntroPose,
} from '../../shared/cinematic/IntroPlan';
import type { MovementConfig } from '../../shared/player/MovementConfig';
import type { MatchWorld } from '../MatchWorld';
import { SpaceSkip } from '../ui/SpaceSkip';

/**
 * The match intro's camera (M15, Phase C): the plan, played over the round-one freeze.
 *
 * ## Asked, not pushed — the chopper's shape
 *
 * `Game` asks `cameraFor` once per render frame, before it asks the Chopper Gunner, and
 * renders through whatever answers: this while the intro runs, the takeover while a gunship
 * is up, the rig otherwise. There can be no chopper during a freeze, but the order is a fact
 * rather than an assumption. Nothing here is written back to the rig, so there is nothing
 * for `Game` to undo when the intro ends — the same reason the takeover works that way.
 *
 * ## The clock is the server's freeze
 *
 * The timeline runs on `flow.phaseSecondsTotal - flow.phaseSecondsRemaining`, not on a
 * local clock: a client that joins with four seconds of freeze left gets four seconds of
 * intro, and the cue that ends the freeze lands on everybody's own eyes at once. The plan is
 * built on the first eligible frame — `planIntro` over the match's own navmesh and
 * colliders, the shape `npm run intro` proves on every map — and plays exactly once per
 * match: a plan that has finished, or been skipped, is not rebuilt for the same round.
 *
 * ## Three blends the plan does not know about
 *
 * The plan starts wherever the approach's trim put it and ends on a hold; the rig is where
 * the player's eyes are. So the first `BLEND_IN` seconds ease the camera from the rig to the
 * plan (a fast push out of the eyes rather than a cut), the last `RETURN_SECONDS` ease it
 * back, and the lens goes with it — the player's own field of view to `FOV_DEG` and back —
 * because a 90° eye cut to a 60° lens is a jolt the timeline does not need.
 *
 * ## Fast-forward, and the skip that was here before it (2026-09-24, §8)
 *
 * **Hold Space.** The flyover runs at `SKIP_FAST_FORWARD`× for as long as the key is down
 * and at one times speed the moment it is let go, so a player who has seen this map forty
 * times spends a second and a half on it and one who has not is never cut off mid-sentence.
 * Nothing else skips: the old rule was *any key or any mouse button*, which meant the hand
 * still resting on jump at the whistle took the overview away, and which needed a list of
 * keys that did **not** skip (the class digits, Escape) to stop it eating the two things a
 * player does during a freeze. One key that means one thing needs no such list.
 *
 * ## Where the gained time goes, and why that is two answers
 *
 * The timeline runs on the freeze's own clock — `phaseSecondsTotal - phaseSecondsRemaining`
 * — so "run it faster" has to say faster *than what*, and the honest answer differs by who
 * owns the clock:
 *
 * - **Single-player**, where this client is the authority, the gain is handed to the freeze
 *   itself (`MatchFlow.shortenWarmup`). The camera, the HUD's countdown and the round all
 *   move together, and the round starts as soon as the flyover is done — which is M17 C2's
 *   rule, *the freeze is sized to the intro*, applied continuously instead of once.
 * - **Over the network** the freeze is the server's and `shortenWarmup` is a no-op, so the
 *   gain is kept as a local offset and only the camera runs fast. The player lands on their
 *   own eyes early and waits out the rest of the freeze, which is exactly what the old skip
 *   did and is the only thing a client may do to a clock it does not own.
 *
 * `absorbed` below is the bookkeeping that keeps those two from being two code paths: the
 * flow is asked to take the gain, and whatever it did not take is what the offset carries.
 */

export interface IntroCameraDeps {
  readonly movement: MovementConfig;
}

/** The intro's lens, vertical degrees; what the overview is fitted to. */
export const FOV_DEG = 60;
const BLEND_IN_SECONDS = 0.35;

function ease(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export class IntroCamera {
  private readonly deps: IntroCameraDeps;
  private readonly camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 500);
  private readonly pose: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private readonly endPose: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  /** The plan for the world it was built in; null between matches. */
  private plan: IntroPlan | null = null;
  private plannedFor: MatchWorld | null = null;
  /** True once this match's intro has ended, by time or by a key. Cleared with the world. */
  private done = false;
  /**
   * Seconds of fast-forward the **flow** would not take, added to the freeze's clock.
   *
   * Zero for the whole of a single-player intro, where `shortenWarmup` takes every gain; it
   * is the networked case's whole mechanism, and the leftover tick of rounding in the other.
   */
  private boost = 0;
  private readonly skipper = new SpaceSkip({ enabled: () => true, onLeave: null });

  constructor(deps: IntroCameraDeps) {
    this.deps = deps;
  }

  /** Whether the intro is drawing this frame — the HUD and the viewmodel read it. */
  get active(): boolean {
    return this.plan !== null && !this.done;
  }

  /** The label the intro wants on screen — an objective's — or empty. */
  get label(): string {
    const plan = this.plan;
    if (plan === null || this.done) return '';
    return this.currentLabel;
  }

  private currentLabel = '';

  /**
   * The camera to render this frame, or null when the rig's is the one.
   *
   * `rig` is the rig's camera after its own update this frame: where the player's eyes are,
   * and the lens they look through — both ends of the blends.
   */
  cameraFor(
    world: MatchWorld,
    rig: THREE.PerspectiveCamera,
    aspect: number,
    /** The render frame's own delta, seconds. What a held key multiplies. */
    dt: number,
  ): THREE.PerspectiveCamera | null {
    const match = world.match;
    const flow = match.flow;

    if (this.plannedFor !== world) {
      // A new world: forget the old plan, and nothing is decided about this one yet.
      this.plan = null;
      this.plannedFor = world;
      this.done = false;
      this.boost = 0;
    }
    if (this.done) return null;

    const eligible =
      flow.currentPhase === 'WARMUP' && flow.round <= 1 && !match.inWarmupArena && match.mode.id !== 'RANGE';
    if (!eligible) {
      // Not the round-one freeze: no intro this match, and no second chance at it.
      if (this.plan !== null) this.finish();
      else this.done = true;
      return null;
    }

    const total = flow.phaseSecondsTotal;
    if (this.plan === null) {
      const sim = world.player.sim;
      this.plan = planIntro({
        def: world.map.def,
        nav: match.bots.nav,
        collision: world.map.collision,
        movement: this.deps.movement,
        modeId: match.mode.id,
        spawn: { x: sim.x, y: sim.y, z: sim.z },
        fovDeg: FOV_DEG,
        freezeSeconds: total,
      });
      this.plan.poseAt(this.plan.seconds, this.endPose);
      this.listen();
    }
    const plan = this.plan;

    /**
     * The fast-forward, offered to the freeze first.
     *
     * `shortenWarmup` moves the phase forward when this client is the flow's authority and
     * does nothing at all when it is not, so asking it and then **measuring what it took**
     * is one line that is correct in both worlds — no branch here on whether there is a
     * server, which is the sort of question a camera should not be asking. What it took is
     * already in `phaseSecondsRemaining`; what it left is carried locally.
     */
    const gained = this.skipper.boost(dt);
    if (gained > 0) {
      const before = flow.phaseSecondsRemaining;
      // Never into the countdown: `COUNTDOWN_SECONDS` is the human's number for reading the
      // objective before the round starts (IntroPlan), and it is not the cinematic's to spend.
      flow.shortenWarmup(Math.max(COUNTDOWN_SECONDS, before - gained));
      const absorbed = before - flow.phaseSecondsRemaining;
      this.boost += Math.max(0, gained - absorbed);
    }
    const t = total - flow.phaseSecondsRemaining + this.boost;

    // The timeline: the plan, then the return blend. Both run on `t`, so a held key speeds
    // the return up as well — the blend is part of the cinematic, not an epilogue to it.
    const planEnd = plan.seconds;
    const returnEnd = planEnd + RETURN_SECONDS;
    if (t >= returnEnd) {
      this.finish();
      return null;
    }

    // Where the plan is: at `t` while it plays, held where the skip caught it afterwards.
    const planT = Math.min(t, planEnd);
    plan.poseAt(planT, this.pose);
    this.currentLabel = labelAt(plan, planT);

    // The blends: rig → plan over the first `BLEND_IN_SECONDS`, plan → rig over the return.
    let w = 1;
    if (t < BLEND_IN_SECONDS) w = ease(t / BLEND_IN_SECONDS);
    if (t > planEnd) w = 1 - ease((t - planEnd) / RETURN_SECONDS);

    const rigYaw = rig.rotation.y;
    const rigPitch = rig.rotation.x;
    const x = rig.position.x + (this.pose.x - rig.position.x) * w;
    const y = rig.position.y + (this.pose.y - rig.position.y) * w;
    const z = rig.position.z + (this.pose.z - rig.position.z) * w;
    const yaw = rigYaw + angleDelta(rigYaw, this.pose.yaw) * w;
    const pitch = rigPitch + (this.pose.pitch - rigPitch) * w;
    const fov = rig.fov + (FOV_DEG - rig.fov) * w;

    const cam = this.camera;
    cam.position.set(x, y, z);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    if (cam.aspect !== aspect || Math.abs(cam.fov - fov) > 1e-3) {
      cam.aspect = aspect;
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    return cam;
  }

  /** Called when the world goes away, so the next one plans afresh. */
  reset(): void {
    this.plan = null;
    this.plannedFor = null;
    this.done = false;
    this.boost = 0;
    this.unlisten();
  }

  dispose(): void {
    this.reset();
  }

  // -- internals -------------------------------------------------------------

  private finish(): void {
    this.done = true;
    this.currentLabel = '';
    this.unlisten();
  }

  private listen(): void {
    this.skipper.listen();
  }

  private unlisten(): void {
    this.skipper.unlisten();
  }
}

/** The label of the segment `t` falls in. */
function labelAt(plan: IntroPlan, t: number): string {
  let cursor = t;
  for (const segment of plan.segments) {
    if (cursor <= segment.seconds) return segment.label;
    cursor -= segment.seconds;
  }
  return plan.segments[plan.segments.length - 1]?.label ?? '';
}
