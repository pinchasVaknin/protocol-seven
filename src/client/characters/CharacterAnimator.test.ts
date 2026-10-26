import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';
import { LOCOMOTION_IDLE_SPEED, LOCOMOTION_RUN_SPEED } from '../../shared/player/Stance';
import { characterDefinition, type CharacterAnimationId } from './CharacterCatalog';
import { CharacterAnimator } from './CharacterAnimator';

/**
 * The animator, pinned before unit C5's refactor.
 *
 * `setLocomotion` is the function being split, and it is an eight-branch priority chain where
 * every branch was written against a defect somebody measured in a live match: the ground edge
 * interrupts because a 330 ms hop never showed its landing; the grace exists because a body
 * walking off a kerb restarted the launch clip; the settle exists because the roster started 73
 * locomotion loops in ten seconds. None of that is visible in a screenshot and none of it is
 * reachable from the pure selector — it is all *this* class deciding what to believe and when.
 * So the order of the branches and the two settling rules are asserted directly, before a line
 * of it moves.
 *
 * No GLB is needed: a mixer poses a plain `Object3D` quite happily, and what is read back is
 * which clip the animator chose, not where a bone ended up.
 */

const DEFINITION = characterDefinition('echo');

/** One synthetic clip per catalogue variant, so slot and variant counts line up with the real table. */
function clipMap(duration = 1): Map<CharacterAnimationId, THREE.AnimationClip[]> {
  const clips = new Map<CharacterAnimationId, THREE.AnimationClip[]>();
  for (const [slot, variants] of Object.entries(DEFINITION.animations)) {
    clips.set(
      slot as CharacterAnimationId,
      variants.map((v, i) => new THREE.AnimationClip(`${v.clipName}#${i}`, duration, [])),
    );
  }
  return clips;
}

function animator(duration = 1): CharacterAnimator {
  const made = new CharacterAnimator(new THREE.Object3D(), DEFINITION, clipMap(duration));
  made.setLife(7, 1);
  return made;
}

function input(over: Partial<ActorAnimationInput> = {}): ActorAnimationInput {
  return {
    stance: 'STAND',
    aiming: false,
    sprinting: false,
    reloading: false,
    reloadSeconds: 0,
    firing: false,
    throwing: false,
    throwPhase: 'IDLE',
    meleeing: false,
    ...over,
  };
}

/** What the mixer was last told to play. */
function playing(a: CharacterAnimator): CharacterAnimationId | null {
  return (a as unknown as { active: { id: CharacterAnimationId } | null }).active?.id ?? null;
}

function settled(a: CharacterAnimator): CharacterAnimationId | null {
  return (a as unknown as { settledLoop: CharacterAnimationId | null }).settledLoop;
}

function transition(a: CharacterAnimator): CharacterAnimationId | null {
  return (a as unknown as { transition: { id: CharacterAnimationId } | null }).transition?.id ?? null;
}

const STILL = 0;
const WALKING = (LOCOMOTION_IDLE_SPEED + LOCOMOTION_RUN_SPEED) / 2;
const RUNNING = LOCOMOTION_RUN_SPEED + 1;
const FRAME = 1 / 60;

/** Drive `seconds` of frames at a fixed step with one unchanging input. */
function run(a: CharacterAnimator, over: Partial<ActorAnimationInput>, speed: number, seconds: number): void {
  for (let t = 0; t < seconds; t += FRAME) {
    a.setLocomotion(input(over), speed, true, false, FRAME);
    a.update(FRAME);
  }
}

// ======================================= the loop it picks ====================================

describe('CharacterAnimator: the first loop of a life', () => {
  it('is taken immediately, with no settling', () => {
    const a = animator();
    a.setLocomotion(input(), RUNNING, true, false, FRAME);
    expect(playing(a)).toBe('runRelaxed');
    expect(settled(a)).toBe('runRelaxed');
  });

  it('plays a loop the catalogue has a variant of, dealt from the life', () => {
    const a = animator();
    a.setLocomotion(input(), STILL, true, false, FRAME);
    expect(playing(a)).toBe('idleWeaponReady');
  });
});

describe('CharacterAnimator: a loop has to be wanted before it is believed', () => {
  it('ignores a change that does not last', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    expect(settled(a)).toBe('idleWeaponReady');

    // Two frames of walking, which is the 30 ms flicker the measurement found.
    a.setLocomotion(input(), WALKING, true, false, FRAME);
    a.setLocomotion(input(), WALKING, true, false, FRAME);
    expect(settled(a)).toBe('idleWeaponReady');
    expect(playing(a)).toBe('idleWeaponReady');
  });

  it('believes a change that holds for the settle time', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    run(a, {}, WALKING, 0.2);
    expect(settled(a)).toBe('walkWeaponReady');
    expect(playing(a)).toBe('walkWeaponReady');
  });

  it('starts the clock again when the candidate changes', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    // Alternate between two candidates: neither ever holds long enough.
    for (let i = 0; i < 20; i++) {
      a.setLocomotion(input(), WALKING, true, false, FRAME);
      a.setLocomotion(input(), RUNNING, true, false, FRAME);
    }
    expect(settled(a)).toBe('idleWeaponReady');
  });

  it('does not make a slide wait, because a stance does not flicker at a threshold', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    a.setLocomotion(input({ stance: 'SLIDE' }), RUNNING, true, false, FRAME);
    expect(playing(a)).toBe('slide');
  });
});

// ======================================== the ground edge =====================================

describe('CharacterAnimator: the ground edge', () => {
  it('ignores a stumble that never became a jump', () => {
    const a = animator();
    run(a, {}, WALKING, 0.4);
    const before = playing(a);
    // Two frames off the ground — a kerb, a stair, the lip of a ramp.
    a.setLocomotion(input({ stance: 'AIRBORNE' }), WALKING, true, false, FRAME);
    a.setLocomotion(input({ stance: 'AIRBORNE' }), WALKING, true, false, FRAME);
    a.setLocomotion(input(), WALKING, true, false, FRAME);
    expect(playing(a)).toBe(before);
    expect(transition(a)).toBeNull();
  });

  it('launches once the body has really left the ground', () => {
    const a = animator();
    run(a, {}, WALKING, 0.4);
    run(a, { stance: 'AIRBORNE' }, WALKING, 0.2);
    expect(playing(a)).toBe('jumpLaunch');
  });

  it('lands on the frame the feet touch down, with no grace at all', () => {
    const a = animator();
    run(a, {}, WALKING, 0.4);
    run(a, { stance: 'AIRBORNE' }, WALKING, 0.2);
    expect(playing(a)).toBe('jumpLaunch');
    // One frame of ground is enough: the landing must not wait.
    a.setLocomotion(input(), WALKING, true, false, FRAME);
    expect(playing(a)).toBe('jumpLand');
  });

  it('interrupts a stance transition, which nothing else does', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    a.setLocomotion(input({ stance: 'CROUCH' }), STILL, true, false, FRAME);
    expect(transition(a)).toBe('standToCrouch');
    run(a, { stance: 'AIRBORNE' }, STILL, 0.2);
    expect(playing(a)).toBe('jumpLaunch');
  });

  it('goes straight into a slide if the body lands in one', () => {
    const a = animator();
    run(a, {}, WALKING, 0.3);
    run(a, { stance: 'AIRBORNE' }, WALKING, 0.2);
    a.setLocomotion(input({ stance: 'SLIDE' }), RUNNING, true, false, FRAME);
    expect(playing(a)).toBe('slide');
  });
});

// ========================================== the slide =========================================

describe('CharacterAnimator: the slide', () => {
  it('opens on the clip’s slide window rather than at frame zero', () => {
    const a = animator(1.55);
    run(a, {}, RUNNING, 0.3);
    a.setLocomotion(input({ stance: 'SLIDE' }), RUNNING, true, false, FRAME);
    const action = (a as unknown as { slide: { action: THREE.AnimationAction } | null }).slide?.action;
    expect(action).toBeDefined();
    expect(action?.time).toBeCloseTo(0.4, 6);
  });

  it('holds the last frame of the window rather than playing into the get-up', () => {
    const a = animator(1.55);
    run(a, {}, RUNNING, 0.3);
    run(a, { stance: 'SLIDE' }, RUNNING, 2);
    const action = (a as unknown as { slide: { action: THREE.AnimationAction } | null }).slide?.action;
    expect(action?.paused).toBe(true);
    expect(action?.time).toBeLessThanOrEqual(0.8 + 1e-6);
  });

  it('drops everything else the body was doing when it starts', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    a.setLocomotion(input({ stance: 'CROUCH' }), STILL, true, false, FRAME);
    expect(transition(a)).toBe('standToCrouch');
    a.setLocomotion(input({ stance: 'SLIDE' }), RUNNING, true, false, FRAME);
    expect(transition(a)).toBeNull();
    expect(playing(a)).toBe('slide');
  });

  it('leaves for whatever the stance says next, with no get-up transition', () => {
    const a = animator();
    run(a, {}, RUNNING, 0.3);
    run(a, { stance: 'SLIDE' }, RUNNING, 0.3);
    a.setLocomotion(input(), RUNNING, true, false, FRAME);
    expect(playing(a)).toBe('runRelaxed');
    expect(transition(a)).toBeNull();
  });

  it('does not open a slide with the crouch transition', () => {
    const a = animator();
    run(a, {}, RUNNING, 0.3);
    a.setLocomotion(input({ stance: 'SLIDE' }), RUNNING, true, false, FRAME);
    expect(playing(a)).not.toBe('standToCrouch');
  });
});

// ================================ transitions, gestures and actions ===========================

describe('CharacterAnimator: the crouch edge', () => {
  it('plays the authored transition in the held weapon’s version', () => {
    const rifle = animator();
    run(rifle, {}, STILL, 0.3);
    rifle.setLocomotion(input({ stance: 'CROUCH' }), STILL, true, false, FRAME);
    expect(transition(rifle)).toBe('standToCrouch');

    const pistol = animator();
    pistol.setLocomotion(input(), STILL, true, true, FRAME);
    pistol.setLocomotion(input({ stance: 'CROUCH' }), STILL, true, true, FRAME);
    expect(transition(pistol)).toBe('standToCrouchPistol');
  });

  it('holds a loop behind the transition, and it is the settled one', () => {
    const a = animator();
    const pending = (): CharacterAnimationId | null =>
      (a as unknown as { pendingLocomotion: CharacterAnimationId | null }).pendingLocomotion;
    run(a, {}, STILL, 0.3);

    // The two settling rules meet here. The crouch edge fires on the frame the stance changes,
    // but the crouch *loop* is still a candidate — `LOOP_SETTLE_SECONDS` has not elapsed — so
    // what waits behind the transition on this frame is the loop the body was already in.
    a.setLocomotion(input({ stance: 'CROUCH' }), STILL, true, false, FRAME);
    expect(transition(a)).toBe('standToCrouch');
    expect(pending()).toBe('idleWeaponReady');

    // Once the crouch loop settles, the frames that follow move the resume target onto it.
    run(a, { stance: 'CROUCH' }, STILL, 0.2);
    expect(pending()).toBe('crouchIdleAiming');
  });
});

describe('CharacterAnimator: the knife', () => {
  it('swings once and does not swing again while the bit is still up', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    a.setLocomotion(input({ meleeing: true }), STILL, true, false, FRAME);
    expect(transition(a)).toBe('meleeStand');
    const first = (a as unknown as { transition: { action: unknown } | null }).transition?.action;
    a.setLocomotion(input({ meleeing: true }), STILL, true, false, FRAME);
    expect((a as unknown as { transition: { action: unknown } | null }).transition?.action).toBe(first);
  });

  it('can swing again once the bit has cleared and come back', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    a.setLocomotion(input({ meleeing: true }), STILL, true, false, FRAME);
    const latched = (a as unknown as { gestureLatch: unknown }).gestureLatch;
    expect(latched).toBe('meleeStand');
    a.setLocomotion(input(), STILL, true, false, FRAME);
    expect((a as unknown as { gestureLatch: unknown }).gestureLatch).toBeNull();
  });
});

describe('CharacterAnimator: the reload', () => {
  it('stands in for the loop while the input says so, then hands back', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    a.setLocomotion(input({ reloading: true, reloadSeconds: 2 }), STILL, true, false, FRAME);
    expect(playing(a)).toBe('reloadStand');
    a.setLocomotion(input(), STILL, true, false, FRAME);
    expect(playing(a)).toBe('idleWeaponReady');
  });

  it('is fitted to the magazine it is drawing, not to the clip’s own length', () => {
    const a = animator(3.3);
    run(a, {}, STILL, 0.3);
    a.setLocomotion(input({ reloading: true, reloadSeconds: 1.7 }), STILL, true, false, FRAME);
    const action = (a as unknown as { action: { action: THREE.AnimationAction } | null }).action?.action;
    expect(action?.getEffectiveTimeScale()).toBeCloseTo(3.3 / 1.7, 5);
  });

  it('is never stretched or squeezed beyond a third either way', () => {
    const a = animator(3.3);
    run(a, {}, STILL, 0.3);
    a.setLocomotion(input({ reloading: true, reloadSeconds: 0.01 }), STILL, true, false, FRAME);
    const action = (a as unknown as { action: { action: THREE.AnimationAction } | null }).action?.action;
    expect(action?.getEffectiveTimeScale()).toBe(3);
  });

  it('keeps the loop for a pose the library cannot draw a reload in', () => {
    const a = animator();
    run(a, {}, RUNNING, 0.3);
    a.setLocomotion(input({ reloading: true, reloadSeconds: 2 }), RUNNING, true, false, FRAME);
    expect(playing(a)).toBe('runRelaxed');
  });
});

// ========================================== death =============================================

describe('CharacterAnimator: death', () => {
  it('ends everything else and stays ended', () => {
    const a = animator();
    run(a, {}, RUNNING, 0.3);
    a.beginDeath(input(), 0);
    expect(a.isDying).toBe(true);
    expect(playing(a)).toBe('deathStand');

    // Nothing the simulation says moves the body now.
    a.setLocomotion(input(), RUNNING, true, false, FRAME);
    expect(playing(a)).toBe('deathStand');
  });

  it('falls the way the body was standing', () => {
    const a = animator();
    a.beginDeath(input({ stance: 'CROUCH' }), 0);
    expect(playing(a)).toBe('deathCrouch');
  });

  it('indexes the slot by the simulation’s own variant, however large', () => {
    const a = animator();
    expect(() => a.beginDeath(input(), 99)).not.toThrow();
    expect(() => a.beginDeath(input(), -5)).not.toThrow();
  });

  it('clears every channel on the way back, so a respawn starts clean', () => {
    const a = animator();
    run(a, {}, RUNNING, 0.3);
    a.beginDeath(input(), 0);
    a.endDeath();
    expect(a.isDying).toBe(false);
    expect(settled(a)).toBeNull();
    expect(transition(a)).toBeNull();
    expect(playing(a)).toBeNull();

    // And the first loop of the new life is taken immediately again.
    a.setLocomotion(input(), RUNNING, true, false, FRAME);
    expect(playing(a)).toBe('runRelaxed');
  });

  it('ignores endDeath when the body is alive', () => {
    const a = animator();
    run(a, {}, STILL, 0.3);
    const before = playing(a);
    a.endDeath();
    expect(playing(a)).toBe(before);
  });
});

// ===================================== the support hand =======================================

describe('CharacterAnimator: the support-hand grip', () => {
  it('asks the catalogue rather than keeping a list of its own', () => {
    const a = animator();
    a.setLocomotion(input(), STILL, true, false, FRAME);
    expect(playing(a)).toBe('idleWeaponReady');
    expect(a.supportsWeaponSupportGrip).toBe(DEFINITION.animations.idleWeaponReady[0].weaponReady);
    expect(a.supportsWeaponSupportGrip).toBe(true);
  });

  it('refuses it for a relaxed loop, a reload and a death', () => {
    const relaxed = animator();
    relaxed.setLocomotion(input(), STILL, false, false, FRAME);
    expect(playing(relaxed)).toBe('idleRelaxed');
    expect(relaxed.supportsWeaponSupportGrip).toBe(false);

    const reloading = animator();
    run(reloading, {}, STILL, 0.3);
    reloading.setLocomotion(input({ reloading: true, reloadSeconds: 2 }), STILL, true, false, FRAME);
    expect(reloading.supportsWeaponSupportGrip).toBe(false);

    const dead = animator();
    dead.beginDeath(input(), 0);
    expect(dead.supportsWeaponSupportGrip).toBe(false);
  });
});

describe('CharacterAnimator: teardown', () => {
  it('drops every channel and detaches from the mixer', () => {
    const a = animator();
    run(a, {}, RUNNING, 0.3);
    a.dispose();
    expect(playing(a)).toBeNull();
    expect(transition(a)).toBeNull();
    expect(() => a.update(FRAME)).not.toThrow();
  });
});
