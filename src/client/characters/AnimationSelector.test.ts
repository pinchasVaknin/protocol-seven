import { describe, expect, it } from 'vitest';
import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';
import { rigLayoutFor } from '../../shared/combat/HitboxRig';
import { LOCOMOTION_IDLE_SPEED, LOCOMOTION_RUN_SPEED, STANCES } from '../../shared/player/Stance';
import {
  isAirborne,
  isRunLoop,
  selectAction,
  selectGesture,
  selectGroundTransition,
  selectLocomotion,
  selectStanceTransition,
} from './AnimationSelector';
import { CHARACTER_DEFINITIONS, type CharacterAnimationId } from './CharacterCatalog';

/**
 * The animation policy is a pure function of replicated state, so it is testable without a
 * renderer, a skin or a mixer — which is the whole reason it was separated from
 * `CharacterAnimator` in M13 Phase D.
 *
 * The test that matters most here is the last one. Admitting an incomplete pistol family rests
 * entirely on the claim that where the family has no clip, the body falls back to the rifle's clip
 * **and** the rifle's hitbox layout together; if that ever stops being true, a body is drawn in one
 * pose and shot in another, which is the defect M13 C2 found on the sliding body and the defect
 * decision 11 refused to introduce. So it is asserted over the whole cross product rather than
 * described in a comment.
 */

function input(over: Partial<ActorAnimationInput> = {}): ActorAnimationInput {
  return {
    stance: 'STAND',
    aiming: false,
    sprinting: false,
    reloading: false,
    reloadSeconds: 0,
    firing: false,
    throwing: false,
    meleeing: false,
    ...over,
  };
}

/** Comfortably inside each band rather than on its edge; the edges get their own assertions. */
const STILL = 0;
const WALKING = (LOCOMOTION_IDLE_SPEED + LOCOMOTION_RUN_SPEED) / 2;
const RUNNING = LOCOMOTION_RUN_SPEED + 1;
/** Inside the hysteresis band below the run threshold, where a sprint flag still decides. */
const IN_RUN_BAND = LOCOMOTION_RUN_SPEED - 0.2;

describe('selectLocomotion with a sidearm', () => {
  it('draws the four standing loops the pistol family brought', () => {
    expect(selectLocomotion(input(), STILL, true, true)).toBe('idleWeaponReadyPistol');
    expect(selectLocomotion(input(), WALKING, true, true)).toBe('walkWeaponReadyPistol');
    expect(selectLocomotion(input(), RUNNING, true, true)).toBe('runWeaponReadyPistol');
    // A sprint decides the loop inside the run band and nowhere else: a body at walking pace
    // with its sprint bit set is drawn walking, which is what it is doing. See `isRunning`.
    expect(selectLocomotion(input({ sprinting: true }), IN_RUN_BAND, true, true)).toBe('runWeaponReadyPistol');
    expect(selectLocomotion(input({ sprinting: true }), WALKING, true, true)).toBe('walkWeaponReadyPistol');
  });

  it('draws its own kneel, which is the clip that needed a layout of its own', () => {
    expect(selectLocomotion(input({ stance: 'CROUCH' }), STILL, true, true)).toBe('crouchIdleAimingPistol');
    expect(selectLocomotion(input({ stance: 'CROUCH' }), STILL, true, false)).toBe('crouchIdleAiming');
  });

  it('falls back to the rifle where the family has no clip', () => {
    // No crouched walk and no crouched run were delivered with it.
    expect(selectLocomotion(input({ stance: 'CROUCH' }), WALKING, true, true)).toBe('crouchWalkAiming');
    expect(selectLocomotion(input({ stance: 'SLIDE' }), RUNNING, true, true)).toBe('crouchRunAiming');
  });

  it('leaves every rifle answer exactly as it was', () => {
    expect(selectLocomotion(input(), STILL, true, false)).toBe('idleWeaponReady');
    expect(selectLocomotion(input(), STILL, false, false)).toBe('idleRelaxed');
    expect(selectLocomotion(input(), WALKING, true, false)).toBe('walkWeaponReady');
    expect(selectLocomotion(input(), WALKING, false, false)).toBe('walkRelaxed');
    expect(selectLocomotion(input(), RUNNING, true, false)).toBe('runRelaxed');
  });
});

describe('the ground edge', () => {
  it('reads AIRBORNE off the replicated stance and nothing else', () => {
    expect(isAirborne(input({ stance: 'AIRBORNE' }))).toBe(true);
    for (const stance of STANCES.filter((s) => s !== 'AIRBORNE')) {
      expect(isAirborne(input({ stance }))).toBe(false);
    }
  });

  it('launches on the way up and lands on the way down', () => {
    expect(selectGroundTransition(true)).toBe('jumpLaunch');
    expect(selectGroundTransition(false)).toBe('jumpLand');
  });

  it('leaves an airborne body a standing loop to come back to', () => {
    // The launch clip clamps and holds while the body is in the air, so what this returns is the
    // pose the landing hands back to — and it must not be a crouch, because AIRBORNE is not low.
    const airborne = selectLocomotion(input({ stance: 'AIRBORNE' }), STILL, true, false);
    expect(airborne).toBe('idleWeaponReady');
    expect(rigLayoutFor('AIRBORNE', 0, 0, false).id).toBe('humanoid');
  });
});

describe('the stance transition follows the weapon', () => {
  it('uses the sidearm pair when one is held', () => {
    expect(selectStanceTransition(true, true)).toBe('standToCrouchPistol');
    expect(selectStanceTransition(false, true)).toBe('crouchToStandPistol');
  });

  it('uses the rifle pair otherwise', () => {
    expect(selectStanceTransition(true, false)).toBe('standToCrouch');
    expect(selectStanceTransition(false, false)).toBe('crouchToStand');
  });
});

describe('selectGesture', () => {
  it('picks the throw for the pose the body is in', () => {
    expect(selectGesture(input({ throwing: true }), STILL)).toBe('throwStand');
    expect(selectGesture(input({ throwing: true }), WALKING)).toBe('throwWalk');
    expect(selectGesture(input({ throwing: true, stance: 'CROUCH' }), STILL)).toBe('throwCrouch');
  });

  it('draws nothing for a throw the library cannot pose', () => {
    // Crouch-walking while throwing: the body keeps its loop rather than popping into a kneel.
    expect(selectGesture(input({ throwing: true, stance: 'CROUCH' }), WALKING)).toBeNull();
  });

  it('puts the throw ahead of the knife, as the simulation does', () => {
    // `ClientMatch` refuses a swing while the thrower is busy, so a body with both bits up is
    // cooking a grenade and the swing it is drawn taking would be one that never happened.
    expect(selectGesture(input({ throwing: true, meleeing: true }), STILL)).toBe('throwStand');
  });

  it('swings standing only', () => {
    expect(selectGesture(input({ meleeing: true }), STILL)).toBe('meleeStand');
    expect(selectGesture(input({ meleeing: true }), RUNNING)).toBe('meleeStand');
    expect(selectGesture(input({ meleeing: true, stance: 'CROUCH' }), STILL)).toBeNull();
    expect(selectGesture(input({ meleeing: true, stance: 'AIRBORNE' }), STILL)).toBeNull();
  });

  it('is null when the body is doing neither', () => {
    expect(selectGesture(input(), STILL)).toBeNull();
    expect(selectGesture(input({ reloading: true, reloadSeconds: 2 }), STILL)).toBeNull();
  });
});

describe('selectAction still owns the reload alone', () => {
  it('does not answer for a throw or a swing', () => {
    expect(selectAction(input({ throwing: true }), STILL)).toBeNull();
    expect(selectAction(input({ meleeing: true }), STILL)).toBeNull();
  });

  it('answers for a reload in each pose it has a clip for', () => {
    expect(selectAction(input({ reloading: true }), STILL)).toBe('reloadStand');
    expect(selectAction(input({ reloading: true }), WALKING)).toBe('reloadWalk');
    expect(selectAction(input({ reloading: true, stance: 'CROUCH' }), STILL)).toBe('reloadCrouch');
    expect(selectAction(input({ reloading: true }), RUNNING)).toBeNull();
  });
});

/**
 * The run edge is a band, and the band is the fix for the hitch a playtest reported in a walking
 * body: `sprinting` is allowed to flicker — a bot's comes off `moveZ > 0.72` against the path it
 * is steering along — and with a single threshold the loop followed it at 3 Hz, restarting a clip
 * each time. These are the four corners of `RUN_RELEASE_SPEED`, plus the one case that must *not*
 * widen: a crouching body, whose threshold is shared with the hitbox layout.
 */
describe('the run edge has hysteresis while standing', () => {
  const BELOW_ENTRY = LOCOMOTION_RUN_SPEED - 0.2;
  const BELOW_RELEASE = 4.6; // the walk cap: a body that is not sprinting cannot exceed it

  it('needs the full run speed to start a run', () => {
    expect(selectLocomotion(input(), BELOW_ENTRY, true, false, false)).toBe('walkWeaponReady');
    expect(selectLocomotion(input(), LOCOMOTION_RUN_SPEED, true, false, false)).toBe('runRelaxed');
  });

  it('keeps a run through the band, which is where a dropped sprint flag lands', () => {
    expect(selectLocomotion(input(), BELOW_ENTRY, true, false, true)).toBe('runRelaxed');
    expect(selectLocomotion(input({ sprinting: true }), BELOW_ENTRY, true, false, false)).toBe('runRelaxed');
  });

  it('gives the run up when the body is actually walking', () => {
    expect(selectLocomotion(input(), BELOW_RELEASE, true, false, true)).toBe('walkWeaponReady');
  });

  it('refuses a run to a body that is not moving like one, flag or no flag', () => {
    // The measured case: 2.11 m/s with the sprint bit set, drawn at a full run over the wire.
    expect(selectLocomotion(input({ sprinting: true }), 2.11, true, false, false)).toBe('walkWeaponReady');
    expect(selectLocomotion(input({ sprinting: true }), 2.11, true, false, true)).toBe('walkWeaponReady');
  });

  it('names the loops that count as a run, including the sidearm and the crouch', () => {
    expect(isRunLoop('runRelaxed')).toBe(true);
    expect(isRunLoop('runWeaponReadyPistol')).toBe(true);
    expect(isRunLoop('crouchRunAiming')).toBe(true);
    expect(isRunLoop('walkWeaponReady')).toBe(false);
    expect(isRunLoop(null)).toBe(false);
  });

  it('does not widen the crouched edge, which the hitbox layout shares', () => {
    // `rigLayoutFor` switches to humanoid-crouch-run at exactly LOCOMOTION_RUN_SPEED and knows
    // nothing about what is already drawn. A clip that held its run through the band here would
    // be a body drawn running and shot walking — the defect M13 C2 found on the sliding body.
    const below = LOCOMOTION_RUN_SPEED - 0.2;
    expect(selectLocomotion(input({ stance: 'CROUCH' }), below, true, false, true)).toBe('crouchWalkAiming');
    expect(rigLayoutFor('CROUCH', below, 0, false).id).toBe('humanoid-crouch-walk');
  });
});

/**
 * The clip a body is drawn in and the boxes it is shot through are chosen from the same three
 * facts, so they cannot disagree. This is the invariant the pistol family was admitted on.
 */
describe('the drawn pose and the hitbox layout are one decision', () => {
  /** Which layout each low slot was measured against — the claim under every crouch number. */
  const LOW_SLOT_LAYOUT: Partial<Record<CharacterAnimationId, string>> = {
    crouchIdleAiming: 'humanoid-crouch',
    crouchIdleAimingPistol: 'humanoid-crouch-pistol',
    crouchWalkAiming: 'humanoid-crouch-walk',
    crouchRunAiming: 'humanoid-crouch-run',
  };

  const speeds = [0, LOCOMOTION_IDLE_SPEED, LOCOMOTION_IDLE_SPEED + 0.01, 3, LOCOMOTION_RUN_SPEED, RUNNING];

  it('pairs every (stance, speed, weapon) with the layout its clip was measured against', () => {
    for (const stance of STANCES) {
      for (const speed of speeds) {
        for (const pistol of [false, true]) {
          const slot = selectLocomotion(input({ stance }), speed, true, pistol);
          // The rig reads a velocity, the selector a scalar speed: one axis is enough to make
          // them the same number, and the selector has no direction to disagree about.
          const layout = rigLayoutFor(stance, speed, 0, pistol);
          const expected = LOW_SLOT_LAYOUT[slot] ?? 'humanoid';
          expect(layout.id, `${stance} at ${speed} m/s with ${pistol ? 'a pistol' : 'a rifle'} → ${slot}`).toBe(
            expected,
          );
        }
      }
    }
  });

  it('gives a sidearm its own layout only where it has its own clip', () => {
    // The half-squat is the one pose that differs, so it is the one layout that differs. Anywhere
    // else, asking with a pistol and asking with a rifle must return the identical layout object.
    let differed = 0;
    for (const stance of STANCES) {
      for (const speed of speeds) {
        const withPistol = rigLayoutFor(stance, speed, 0, true);
        const withRifle = rigLayoutFor(stance, speed, 0, false);
        if (withPistol !== withRifle) {
          differed++;
          expect(selectLocomotion(input({ stance }), speed, true, true)).toBe('crouchIdleAimingPistol');
        }
      }
    }
    expect(differed).toBeGreaterThan(0);
  });

  it('never names a slot the catalogue has no clip for', () => {
    const animations = CHARACTER_DEFINITIONS.echo.animations;
    for (const stance of STANCES) {
      for (const speed of speeds) {
        for (const pistol of [false, true]) {
          for (const armed of [false, true]) {
            const slot = selectLocomotion(input({ stance }), speed, armed, pistol);
            expect(animations[slot].length, slot).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
