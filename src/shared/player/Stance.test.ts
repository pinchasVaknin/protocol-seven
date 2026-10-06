import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVEMENT_CONFIG } from './MovementConfig';
import {
  capsuleHeightFor,
  eyeHeightFor,
  isLegalStanceTransition,
  isLowStance,
  LOCOMOTION_IDLE_SPEED,
  LOCOMOTION_RUN_SPEED,
  STANCES,
  type StanceId,
} from './Stance';

/**
 * The stance vocabulary, which four systems answer to.
 *
 * Stance is the single authority for capsule height, eye height and the speed cap, and three of
 * the four readers are not the simulation: `AnimationSelector` picks a clip from it, `rigLayoutFor`
 * picks a hitbox layout, and the camera takes its eye height. A table that quietly gained or lost
 * a row would not fail anywhere — it would draw a body in the wrong pose and put its head boxes
 * somewhere a bullet does not go.
 *
 * The transition matrix is the part worth asserting exhaustively. `setStance` logs and *refuses*
 * an illegal edge rather than throwing, so an edge wrongly marked illegal is a movement bug that
 * announces itself only in a log line nobody is reading.
 */

const CFG = DEFAULT_MOVEMENT_CONFIG;

describe('the stance list', () => {
  it('is the five the machine is written for', () => {
    expect(STANCES).toEqual(['STAND', 'CROUCH', 'SLIDE', 'AIRBORNE', 'MANTLE']);
  });
});

describe('legal stance transitions', () => {
  /**
   * The whole 5x5 matrix, written out. The diagonal is legal by definition — `setStance` returns
   * early on it — and the three cells that are not are the ones worth protecting.
   */
  const LEGAL_MATRIX: Readonly<Record<StanceId, readonly StanceId[]>> = {
    STAND: ['STAND', 'CROUCH', 'SLIDE', 'AIRBORNE', 'MANTLE'],
    CROUCH: ['STAND', 'CROUCH', 'SLIDE', 'AIRBORNE', 'MANTLE'],
    SLIDE: ['STAND', 'CROUCH', 'SLIDE', 'AIRBORNE', 'MANTLE'],
    AIRBORNE: ['STAND', 'CROUCH', 'AIRBORNE', 'MANTLE'],
    MANTLE: ['STAND', 'CROUCH', 'AIRBORNE', 'MANTLE'],
  };

  it('allows exactly the edges the machine documents', () => {
    for (const from of STANCES) {
      for (const to of STANCES) {
        const expected = LEGAL_MATRIX[from].includes(to);
        expect(isLegalStanceTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('refuses the three edges that would skip a state', () => {
    // There is no sliding out of the air and no sliding out of a vault: a slide needs ground
    // and a crouch press, and both of those paths land first.
    expect(isLegalStanceTransition('AIRBORNE', 'SLIDE')).toBe(false);
    expect(isLegalStanceTransition('MANTLE', 'SLIDE')).toBe(false);
    // A slide cannot become the air without the jump-cancel route, which is SLIDE -> AIRBORNE
    // and is legal; what is refused is the reverse.
    expect(isLegalStanceTransition('SLIDE', 'AIRBORNE')).toBe(true);
  });

  it('is reflexive on every stance', () => {
    for (const stance of STANCES) expect(isLegalStanceTransition(stance, stance)).toBe(true);
  });
});

describe('the low stances', () => {
  it('are the three a body is drawn kneeling in', () => {
    // One predicate, so the hitbox boxes and the drawn body cannot disagree about the pose.
    expect(isLowStance('CROUCH')).toBe(true);
    expect(isLowStance('SLIDE')).toBe(true);
    expect(isLowStance('MANTLE')).toBe(true);
    expect(isLowStance('STAND')).toBe(false);
    expect(isLowStance('AIRBORNE')).toBe(false);
  });

  it('are exactly the stances whose capsule is shorter than standing', () => {
    for (const stance of STANCES) {
      const shorter = capsuleHeightFor(CFG, stance) < CFG.standHeight;
      expect(shorter, stance).toBe(isLowStance(stance));
    }
  });
});

describe('the capsule and the eye', () => {
  it('give every stance a height, with the air standing and the vault crouched', () => {
    expect(capsuleHeightFor(CFG, 'STAND')).toBe(CFG.standHeight);
    expect(capsuleHeightFor(CFG, 'CROUCH')).toBe(CFG.crouchHeight);
    expect(capsuleHeightFor(CFG, 'SLIDE')).toBe(CFG.slideHeight);
    // Airborne is a standing capsule: a jump must not shrink the body through a ceiling.
    expect(capsuleHeightFor(CFG, 'AIRBORNE')).toBe(CFG.standHeight);
    // A vault ducks under the lip, which is what lets a mantle finish under a low soffit.
    expect(capsuleHeightFor(CFG, 'MANTLE')).toBe(CFG.crouchHeight);
  });

  it('gives every stance an eye height, on the same pairing', () => {
    expect(eyeHeightFor(CFG, 'STAND')).toBe(CFG.standEye);
    expect(eyeHeightFor(CFG, 'CROUCH')).toBe(CFG.crouchEye);
    expect(eyeHeightFor(CFG, 'SLIDE')).toBe(CFG.slideEye);
    expect(eyeHeightFor(CFG, 'AIRBORNE')).toBe(CFG.standEye);
    expect(eyeHeightFor(CFG, 'MANTLE')).toBe(CFG.crouchEye);
  });

  it('keeps the eye inside the capsule for every stance', () => {
    for (const stance of STANCES) {
      expect(eyeHeightFor(CFG, stance), stance).toBeLessThanOrEqual(capsuleHeightFor(CFG, stance));
      expect(eyeHeightFor(CFG, stance), stance).toBeGreaterThan(0);
    }
    // The slide is the one stance where the two are equal: the camera rides the top of a 0.55 m
    // capsule, which is what makes a slide read as a body gone flat rather than a short walk.
    expect(eyeHeightFor(CFG, 'SLIDE')).toBe(capsuleHeightFor(CFG, 'SLIDE'));
    for (const stance of ['STAND', 'CROUCH', 'AIRBORNE', 'MANTLE'] as const) {
      expect(eyeHeightFor(CFG, stance), stance).toBeLessThan(capsuleHeightFor(CFG, stance));
    }
  });
});

describe('the locomotion thresholds', () => {
  it('are a dead zone below and a run above, with the walk cap between them', () => {
    expect(LOCOMOTION_IDLE_SPEED).toBe(0.12);
    expect(LOCOMOTION_RUN_SPEED).toBe(5.4);
    // Deliberately above the walk cap: the renderer's speed comes from pose deltas and must not
    // flicker on the walk/run boundary.
    expect(LOCOMOTION_RUN_SPEED).toBeGreaterThan(CFG.walkSpeed);
    expect(LOCOMOTION_RUN_SPEED).toBeLessThan(CFG.sprintSpeed);
    expect(LOCOMOTION_IDLE_SPEED).toBeLessThan(CFG.crouchSpeed);
  });
});
