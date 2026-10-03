import * as THREE from 'three';
import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';
import { THROW_FOLLOW_THROUGH, THROW_RELEASE_TIME } from '../../shared/equipment/ThrowController';
import { selectThrowClip } from './AnimationSelector';
import type { CharacterAnimationId } from './CharacterCatalog';

/**
 * The throw, on the upper body alone (2026-09-28, the human's bug 1, option A).
 *
 * Until now a drawn grenade started the whole-body throw clip: about 1.8 s of wind-up, then a
 * freeze in the middle of the throw — twisted, both arms out — for as long as the grenade was
 * held. The legs were in that clip too, so a player walking with a grenade out slid across the
 * floor on frozen legs, and every stop, step, jump or crouch restarted the wind-up: the "loop"
 * the playtest saw.
 *
 * This is the other half of the body. The mixer runs the legs' clip as it always has — idle, walk,
 * run, crouch, jump — and this writes the spine, the neck, the head and both arms **after** it,
 * sampled from the throw clip at a time of its own. What that time is, is the simulation's phase:
 *
 * | phase | the upper body |
 * |---|---|
 * | `READY` | the grenade held at the chest — the clip's `ready` frame, blended in from the rifle pose |
 * | `COOKING` | the arm drawn back to `cocked` over `COOK_WINDUP_SECONDS`, and held there |
 * | `THROWING` | the swing to `release` over `THROW_RELEASE_TIME`: the hand opens on the tick the grenade leaves |
 * | follow-through | on to `settled` over `THROW_FOLLOW_THROUGH`, then blended back out to the rifle |
 *
 * It writes rotations only, on bones the mixer has already posed, and slerps from the mixer's
 * answer by its weight — so it fades in and out over whatever the legs are doing, and a body that
 * stops holding a grenade hands its arms back without a pop. Presentation only: the hitbox layout
 * is the stance's, as it was for the whole-body clip.
 */

/** Where in a throw clip each stage of the throw sits, as fractions of the clip. */
interface ThrowClipTiming {
  /** The grenade held up in front of the chest, pin still in. */
  readonly ready: number;
  /** The arm furthest back: where a cook waits. */
  readonly cocked: number;
  /** Over the top and coming forward: the frame the hand opens on. */
  readonly release: number;
  /** The arm through and coming back: where the follow-through ends and the fade to the rifle starts. */
  readonly settled: number;
}

/**
 * Measured through the real import path on Echo, the right hand against the hips, and looked at.
 *
 * `ready` was asked for at 0.30 of the standing throw, from a description of that frame as the
 * grenade at the chest — and on the body it is not: by 0.27 the hand is rising to the face, and at
 * 0.30 it is at the mouth, the pin coming out with the teeth. 0.25 is the pose the description
 * meant, upright with the grenade held in front of the chest below the chin, and the kneeling
 * throw has the same pose at the same fraction; the walking throw has it, both hands at the chest,
 * at 0.44. `cocked` is the furthest-back point of the hand; `release` the top of the arc after
 * it, which is the frame the grenade has to leave on (`THROW_RELEASE_FRACTION` in the whole-body
 * version); `settled` a tenth of a clip on, with the arm through and the torso coming back.
 */
const THROW_CLIP_TIMING: Readonly<Record<'throwStand' | 'throwWalk' | 'throwCrouch', ThrowClipTiming>> = {
  throwStand: { ready: 0.25, cocked: 0.5, release: 0.58, settled: 0.68 },
  throwWalk: { ready: 0.44, cocked: 0.66, release: 0.72, settled: 0.82 },
  throwCrouch: { ready: 0.25, cocked: 0.58, release: 0.66, settled: 0.76 },
};

/**
 * Seconds from the pin coming out to the arm being drawn back. A cook's wind-up has no length in
 * the simulation — the pin is out and the fuse burning from the tick the button goes down — so
 * this is a feel number: long enough to read as a wind-up, short enough that a tap-throw is not
 * still winding up when the release arrives.
 */
const COOK_WINDUP_SECONDS = 0.25;
/** The rifle pose to the grenade at the chest: the draw. */
const FADE_IN_SECONDS = 0.2;
/** The arm back to the rifle once the throw is over, or the grenade has been put away. */
const FADE_OUT_SECONDS = 0.2;
/** The upper body from one throw clip's pose to another's, when a held grenade crouches or moves off. */
const SWITCH_SECONDS = 0.15;
/** Out of the way of a slide, whose clip lays the whole body down; the slide's own fade. */
const SLIDE_FADE_SECONDS = 0.07;

/**
 * The bones this layer owns: the spine and everything above it. The hips and the legs are the
 * locomotion's; so is the root, which never moves in this library anyway (the root lock).
 * Matched on the end of the name so a rig with a different prefix is still read.
 */
const UPPER_BODY = /(Spine\d*|Neck\d*|Head|(Left|Right)(Shoulder|Arm|ForeArm|Hand\w*))$/;

/** One throw clip's upper-body rotation tracks, bound to one skeleton. */
class UpperBodyClip {
  readonly bones: THREE.Object3D[] = [];
  private readonly interpolants: THREE.Interpolant[] = [];
  readonly duration: number;

  constructor(
    readonly id: 'throwStand' | 'throwWalk' | 'throwCrouch',
    root: THREE.Object3D,
    clip: THREE.AnimationClip,
  ) {
    this.duration = clip.duration;
    for (const track of clip.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      if (parsed.propertyName !== 'quaternion' || !UPPER_BODY.test(parsed.nodeName)) continue;
      const bone = THREE.PropertyBinding.findNode(root, parsed.nodeName) as THREE.Object3D | undefined;
      if (bone === undefined || bone === null) continue;
      this.bones.push(bone);
      // The interpolant a mixer would build for a rotation track — a slerp between keys — with a
      // result buffer of its own, so the template clip every body shares is only ever read.
      this.interpolants.push(
        new THREE.QuaternionLinearInterpolant(track.times, track.values, track.getValueSize(), new Float32Array(4)),
      );
    }
  }

  get timing(): ThrowClipTiming {
    return THROW_CLIP_TIMING[this.id];
  }

  /** The clip's rotation of bone `index` at `time`, written into `out`. */
  sample(index: number, time: number, out: THREE.Quaternion): THREE.Quaternion {
    const v = this.interpolants[index]!.evaluate(time);
    return out.set(v[0]!, v[1]!, v[2]!, v[3]!);
  }
}

const scratch = new THREE.Quaternion();

export class ThrowLayer {
  private readonly clips = new Map<string, UpperBodyClip>();
  private clip: UpperBodyClip | null = null;
  /** Clip seconds the upper body is posed at. */
  private time = 0;
  /** Clip seconds per second for the stage in progress. */
  private rate = 0;
  /** The stage the rate was set for; a new phase sets a new one. */
  private stage: 'ready' | 'cook' | 'release' | 'follow' = 'ready';
  /** How much of the upper body is this layer's, 0..1. */
  private weight = 0;
  /** The pose a clip switch blends from, per bone of the new clip, and how far through it is. */
  private switchFrom: THREE.Quaternion[] = [];
  private switchT = 1;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly source: ReadonlyMap<CharacterAnimationId, readonly THREE.AnimationClip[]>,
  ) {}

  /** Whether the layer is posing anything at all. */
  get active(): boolean {
    return this.clip !== null && this.weight > 0;
  }

  /**
   * Advance the layer one rendered frame from the simulation's facts. Called before the mixer
   * runs, so the bones still hold last frame's final pose — which is what a clip switch blends from.
   */
  step(input: ActorAnimationInput, planarSpeed: number, dt: number): void {
    const step = Math.max(0, dt);
    if (!input.throwing) {
      // Thrown, or put back: the arm returns to the rifle from wherever it is.
      this.weight = Math.max(0, this.weight - step / FADE_OUT_SECONDS);
      if (this.weight === 0) this.clip = null;
      return;
    }

    const wanted = selectThrowClip(input, planarSpeed);
    if (this.clip === null) {
      this.clip = this.clipFor(wanted);
      this.time = this.clip === null ? 0 : this.clip.timing.ready * this.clip.duration;
      this.stage = 'ready';
      this.switchT = 1;
    } else if (input.throwPhase === 'READY' && wanted !== this.clip.id) {
      // A held grenade may change clips — the body crouched, or moved off — but a cook or a throw
      // is committed to the clip it started in: the stages sit at different fractions of each.
      this.switchTo(wanted);
    }
    const clip = this.clip;
    if (clip === null) return;

    this.advance(clip, input.throwPhase, step);
    const target = input.stance === 'SLIDE' ? 0 : 1;
    const fade = input.stance === 'SLIDE' ? SLIDE_FADE_SECONDS : FADE_IN_SECONDS;
    this.weight = target > this.weight ? Math.min(target, this.weight + step / fade) : Math.max(target, this.weight - step / fade);
    if (this.switchT < 1) this.switchT = Math.min(1, this.switchT + step / SWITCH_SECONDS);
  }

  /** Write the upper body over the mixer's pose. Called after `mixer.update`. */
  apply(): void {
    const clip = this.clip;
    if (clip === null || this.weight <= 0) return;
    const switching = this.switchT < 1 && this.switchFrom.length === clip.bones.length;
    for (let i = 0; i < clip.bones.length; i++) {
      const q = clip.sample(i, this.time, scratch);
      if (switching) q.slerpQuaternions(this.switchFrom[i]!, q, this.switchT);
      clip.bones[i]!.quaternion.slerp(q, this.weight);
    }
  }

  /** A death or a respawn: nothing carries over. */
  reset(): void {
    this.clip = null;
    this.weight = 0;
    this.switchT = 1;
  }

  /**
   * Move the pose time for this frame. Each stage's rate is set when the stage starts, from where
   * the arm is then, so a tap-throw that arrives mid-wind-up still reaches `release` on time.
   */
  private advance(clip: UpperBodyClip, phase: ActorAnimationInput['throwPhase'], dt: number): void {
    const d = clip.duration;
    const t = clip.timing;
    switch (phase) {
      case 'READY':
        if (this.stage !== 'ready') this.stage = 'ready';
        this.time = t.ready * d;
        return;
      case 'COOKING':
        if (this.stage !== 'cook') {
          this.stage = 'cook';
          this.rate = ((t.cocked - t.ready) * d) / COOK_WINDUP_SECONDS;
        }
        this.time = Math.min(t.cocked * d, this.time + this.rate * dt);
        return;
      case 'THROWING':
        if (this.stage !== 'release') {
          this.stage = 'release';
          this.rate = Math.max(0, t.release * d - this.time) / THROW_RELEASE_TIME;
        }
        this.time = Math.min(t.release * d, this.time + this.rate * dt);
        return;
      case 'IDLE':
        // `throwing` with no phase is the follow-through: the grenade has gone.
        if (this.stage !== 'follow') {
          this.stage = 'follow';
          this.rate = Math.max(0, t.settled * d - this.time) / THROW_FOLLOW_THROUGH;
        }
        this.time = Math.min(t.settled * d, this.time + this.rate * dt);
        return;
    }
  }

  private switchTo(id: 'throwStand' | 'throwWalk' | 'throwCrouch'): void {
    const next = this.clipFor(id);
    if (next === null) return;
    // The bones hold last frame's final pose until the mixer runs, so this is what was drawn.
    this.switchFrom = next.bones.map((bone) => bone.quaternion.clone());
    this.switchT = 0;
    this.clip = next;
    this.time = next.timing.ready * next.duration;
  }

  private clipFor(id: 'throwStand' | 'throwWalk' | 'throwCrouch'): UpperBodyClip | null {
    const existing = this.clips.get(id);
    if (existing !== undefined) return existing;
    const source = this.source.get(id)?.[0];
    if (source === undefined) return null;
    const built = new UpperBodyClip(id, this.root, source);
    this.clips.set(id, built);
    return built;
  }
}
