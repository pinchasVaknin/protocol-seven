import { describe, expect, it } from 'vitest';
import { HUMANOID_RIG } from '../../shared/combat/HitboxRig';
import type { StanceId } from '../../shared/player/Stance';
import { insideDrawnBody, type DrawnBody } from './BodyVolume';

/**
 * The decal veto: a cylinder around a drawn body, measured from the pose the server shoots at.
 *
 * The numbers below are read off `HUMANOID_RIG` rather than written down, so a layout change
 * moves the test with it. What is pinned is the *shape*: a point at chest height on the spine
 * is inside, a point an arm's length to the side is not, and a point above the crown is not.
 */

function body(stance: StanceId, x: number, y: number, z: number, dormant = false): DrawnBody {
  return {
    animation: { stance },
    dormant,
    renderX: () => x,
    renderY: () => y,
    renderZ: () => z,
  };
}

/** Where the standing rig keeps its chest, in metres above the feet. */
const CHEST = HUMANOID_RIG.aimY;
const CROWN = HUMANOID_RIG.height;

describe('insideDrawnBody', () => {
  it('vetoes a hole on the spine of a standing body', () => {
    expect(insideDrawnBody(body('STAND', 4, 0, -2), 4, CHEST, -2)).toBe(true);
  });

  it('vetoes a hole anywhere up the silhouette, feet to crown', () => {
    const operator = body('STAND', 0, 0, 0);
    expect(insideDrawnBody(operator, 0, 0, 0)).toBe(true);
    expect(insideDrawnBody(operator, 0, CROWN, 0)).toBe(true);
  });

  it('allows a hole on the floor under the body and on the wall above it', () => {
    const operator = body('STAND', 0, 0, 0);
    expect(insideDrawnBody(operator, 0, -0.01, 0)).toBe(false);
    expect(insideDrawnBody(operator, 0, CROWN + 0.01, 0)).toBe(false);
  });

  it('allows a hole a metre to the side: the cylinder is the body, not its surroundings', () => {
    expect(insideDrawnBody(body('STAND', 0, 0, 0), 1, CHEST, 0)).toBe(false);
  });

  it('covers the shoulders at every facing, since it ignores yaw', () => {
    // A quarter of a metre off the spine is inside an operator's arms whichever way they face.
    const operator = body('STAND', 0, 0, 0);
    expect(insideDrawnBody(operator, 0.25, CHEST, 0)).toBe(true);
    expect(insideDrawnBody(operator, 0, CHEST, 0.25)).toBe(true);
  });

  it('is shorter for a crouching body than a standing one', () => {
    const standing = body('STAND', 0, 0, 0);
    const crouched = body('CROUCH', 0, 0, 0);
    const head = CROWN - 0.2;
    expect(insideDrawnBody(standing, 0, head, 0)).toBe(true);
    expect(insideDrawnBody(crouched, 0, head, 0)).toBe(false);
  });

  it('vetoes nothing for a dormant body, which is not drawn', () => {
    expect(insideDrawnBody(body('STAND', 0, 0, 0, true), 0, CHEST, 0)).toBe(false);
  });
});
