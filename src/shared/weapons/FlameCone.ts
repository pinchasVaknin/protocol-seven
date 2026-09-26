import { DEG2RAD } from '../core/MathUtil';
import { simCos } from '../core/SimMath';

/**
 * Is this body in the jet, and how far down it?
 *
 * The one piece of the flamethrower that is pure arithmetic, so it is the piece that can be
 * asserted about without a match, a world or a damage system. Everything else the weapon does —
 * who may be hurt, what a hit costs at that distance, what catches fire — is somebody else's
 * rule already: the friendly gate is at the damage door, the falloff is `damageAtRange`, and the
 * burn is `BurnSystem`. This answers the only question none of them can.
 *
 * ## The shape it tests, and the one it deliberately does not
 *
 * A **cone from the muzzle about the aim direction**: inside `rangeM`, and within
 * `halfAngleDeg` of the axis. Not a capsule, not the swept volume of a jet that bends — a
 * player pointing a flamethrower at a doorway is pointing it in a direction, and the cone is
 * what that means.
 *
 * The target is a **point at chest height**, not its hitbox rig. A jet that resolved against
 * boxes would ask which box caught fire, and the answer would be a zone multiplier on a weapon
 * whose whole design is that it does not care where it lands (`headshotMult` is 1). A point is
 * also what makes the near edge of the cone honest: at two metres the cone is 1.1 m across, and
 * a rig would let a shoulder outside it collect a full tick.
 *
 * The **half-angle opens with distance at the root**. At half a metre a 16-degree cone is 28 cm
 * wide, which is narrower than the body holding the weapon — so a target close enough to touch
 * could stand outside the jet while standing inside the player. `MIN_WIDTH_M` is the floor: the
 * cone is at least this wide at any distance, which costs nothing past two metres and makes the
 * weapon behave at contact range the way a player expects a flamethrower to.
 */

/** Metres. The jet is never narrower than this, however close the target is. See above. */
const MIN_WIDTH_M = 0.7;

export interface FlameHit {
  /** Metres from the muzzle, for `damageAtRange`. */
  readonly distance: number;
}

/**
 * `null` when the point is not in the jet.
 *
 * `dx, dy, dz` must be a unit aim direction; `ox, oy, oz` is the muzzle. The target point is
 * `tx, ty, tz` — chest height, not feet, and not a box.
 */
export function flameHit(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tx: number,
  ty: number,
  tz: number,
  rangeM: number,
  halfAngleDeg: number,
): FlameHit | null {
  const vx = tx - ox;
  const vy = ty - oy;
  const vz = tz - oz;
  const distance = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (distance > rangeM) return null;
  // Standing inside the muzzle is inside the jet, and the angle is undefined there.
  if (distance < 1e-4) return { distance: 0 };

  // Along the axis: behind the muzzle is never in the jet, whatever the angle works out to.
  const along = vx * dx + vy * dy + vz * dz;
  if (along <= 0) return null;

  const cosAngle = along / distance;
  if (cosAngle >= simCos(halfAngleDeg * DEG2RAD)) return { distance };

  // Outside the angle, but the cone has a minimum width — see `MIN_WIDTH_M`. The perpendicular
  // offset from the axis is what that width is measured across.
  const offsetSq = distance * distance - along * along;
  const halfWidth = MIN_WIDTH_M * 0.5;
  if (offsetSq <= halfWidth * halfWidth) return { distance };
  return null;
}
