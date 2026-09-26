import { describe, expect, it } from 'vitest';
import { flameHit } from './FlameCone';
import { flamethrowerWeapon } from '../streaks/StreakWeapons';
import { simTan } from '../core/SimMath';

/**
 * The jet's shape, which is the only part of the flamethrower that is arithmetic.
 *
 * Everything else it does is somebody else's rule — the friendly gate is at the damage door,
 * the falloff is `damageAtRange`, the burn is `BurnSystem` — so this is where the weapon can be
 * wrong in a way no other test would catch: a cone a metre too long, a degree too wide, or one
 * that reaches through the back of the player holding it.
 */

const flame = flamethrowerWeapon().flame;
const RANGE = flame?.rangeM ?? 0;
const HALF = flame?.halfAngleDeg ?? 0;

/** Looking down -Z, which is yaw 0 everywhere in this project. */
function hitAt(x: number, y: number, z: number): ReturnType<typeof flameHit> {
  return flameHit(0, 1.65, 0, 0, 0, -1, x, y + 1.65, z, RANGE, HALF);
}

describe('the flame cone', () => {
  it('reaches its stated range and not a metre further', () => {
    expect(hitAt(0, 0, -(RANGE - 0.5))).not.toBeNull();
    expect(hitAt(0, 0, -(RANGE + 0.5))).toBeNull();
  });

  it('reports how far down the jet the body is, for the falloff', () => {
    const near = hitAt(0, 0, -2);
    const far = hitAt(0, 0, -8);
    expect(near?.distance).toBeCloseTo(2, 3);
    expect(far?.distance).toBeCloseTo(8, 3);
  });

  it('opens to the angle it declares and closes past it', () => {
    // At six metres a 16-degree half-angle is 1.72 m off the axis.
    const inside = simTan((HALF - 2) * (Math.PI / 180)) * 6;
    const outside = simTan((HALF + 4) * (Math.PI / 180)) * 6;
    expect(hitAt(inside, 0, -6)).not.toBeNull();
    expect(hitAt(outside, 0, -6)).toBeNull();
  });

  it('never fires backwards', () => {
    // Directly behind, at a distance the range would otherwise allow.
    expect(hitAt(0, 0, 3)).toBeNull();
    // And just behind the shoulder, where the angle alone would say yes.
    expect(hitAt(0.2, 0, 0.5)).toBeNull();
  });

  /**
   * The rule that makes the weapon behave at contact range: at half a metre the declared cone
   * is 28 cm across, which is narrower than the body holding it, so a target close enough to
   * touch could stand outside the jet while standing inside the player.
   */
  it('is at least a body wide at the muzzle', () => {
    const halfMetreOut = 0.3;
    // Outside the angle at that distance — but inside the minimum width.
    expect(Math.atan2(halfMetreOut, 0.5) * (180 / Math.PI)).toBeGreaterThan(HALF);
    expect(hitAt(halfMetreOut, 0, -0.5)).not.toBeNull();
    // Still a limit: a metre off the axis at half a metre out is not in the jet.
    expect(hitAt(1, 0, -0.5)).toBeNull();
  });

  it('is a cone in three dimensions, not a fan', () => {
    const up = simTan((HALF + 6) * (Math.PI / 180)) * 5;
    expect(hitAt(0, up, -5)).toBeNull();
    expect(hitAt(0, up * 0.3, -5)).not.toBeNull();
  });

  it('treats a body standing in the muzzle as in the jet', () => {
    expect(hitAt(0, 0, 0)?.distance).toBe(0);
  });
});
