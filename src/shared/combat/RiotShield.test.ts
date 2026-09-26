import { describe, expect, it } from 'vitest';
import { createGameBus } from '../core/Events';
import { installClock } from '../core/Clock';
import { DEG2RAD } from '../core/MathUtil';
import { simCos, simSin } from '../core/SimMath';
import { Health } from '../player/Health';
import { HitboxRig } from './HitboxRig';
import { AR_DEFAULT } from '../weapons/WeaponDefs';
import { equipmentDef } from '../equipment/EquipmentDefs';
import { shieldPistolWeapon } from '../streaks/StreakWeapons';
import { DamageSystem, makeDamageRequest, type Damageable } from './DamageSystem';

/**
 * The wall, at the one door.
 *
 * Every rule the shield has is a rule about *direction*, and direction is the one thing the
 * damage door never had: a request carried where a hit landed and never where it came from.
 * So these tests are mostly about that pair — origin and impact — and about the two answers
 * the arc can give.
 *
 * They are deliberately written against `DamageSystem` rather than against a match. What a
 * shield does is not a property of the flamethrower, the grenade, the knife or the sentry that
 * ran into it; it is the door's answer, and the door is the whole of the feature.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };
const SHIELD = shieldPistolWeapon().shield;
/** The grenade's own blast profile — a real explosion, not a hand-made one. */
const BLAST = equipmentDef('frag').damageProfile ?? AR_DEFAULT;
const HALF = SHIELD?.halfAngleDeg ?? 0;

/** A body at the origin, facing yaw 0 — which looks down -Z everywhere in this project. */
function body(entityId: number, team: 'A' | 'B', yaw = 0): Damageable {
  const rig = new HitboxRig();
  rig.setTransform(0, 0, 0, yaw);
  return { entityId, displayName: `E${entityId}`, health: new Health(HEALTH), rig, team };
}

function arena(shielded: boolean): { damage: DamageSystem; target: Damageable } {
  const damage = new DamageSystem(createGameBus());
  const shooter = body(1, 'A');
  const target = body(2, 'B');
  damage.register(shooter);
  damage.register(target);
  if (shielded) damage.shieldOf = (id) => (id === 2 ? (SHIELD ?? null) : null);
  return { damage, target };
}

/**
 * One hit on the target from `angleDeg` off its facing, at three metres.
 *
 * Zero is dead ahead. The impact is the body; the origin is where the shot was taken from,
 * which is the only thing these tests vary.
 */
function hitFrom(
  damage: DamageSystem,
  angleDeg: number,
  weapon = AR_DEFAULT,
): number {
  const a = angleDeg * DEG2RAD;
  // The target faces -Z, so dead ahead of it is -Z, and the angle opens from there.
  const req = makeDamageRequest(weapon);
  req.sourceId = 1;
  req.targetId = 2;
  req.zone = 'torso';
  req.upperTorso = false;
  req.distance = 3;
  req.penetrationRetain = 1;
  req.x = 0;
  req.y = 1.2;
  req.z = 0;
  req.originX = simSin(a) * 3;
  req.originY = 1.2;
  req.originZ = -simCos(a) * 3;
  return damage.apply(req);
}

describe('a body behind a riot shield', () => {
  it('takes nothing from a rifle in front of it', () => {
    const { damage, target } = arena(true);
    expect(hitFrom(damage, 0)).toBe(0);
    expect(target.health.current).toBe(HEALTH.max);
    expect(damage.blockedByShield).toBe(1);
  });

  it('takes everything from a rifle behind it', () => {
    const { damage, target } = arena(true);
    const dealt = hitFrom(damage, 180);
    expect(dealt).toBeGreaterThan(0);
    expect(target.health.current).toBeLessThan(HEALTH.max);
    expect(damage.blockedByShield).toBe(0);
  });

  it('covers the arc it declares and not a degree more', () => {
    const inside = arena(true);
    expect(hitFrom(inside.damage, HALF - 2)).toBe(0);
    expect(hitFrom(inside.damage, -(HALF - 2))).toBe(0);

    const outside = arena(true);
    expect(hitFrom(outside.damage, HALF + 2)).toBeGreaterThan(0);
    expect(hitFrom(outside.damage, -(HALF + 2))).toBeGreaterThan(0);
  });

  /**
   * The shield is a fact about the *body*, so it turns with the body and not with the world.
   * A shot from due north is blocked or not depending on which way the target is looking, and
   * nothing else about the hit changes.
   */
  it('turns with the body', () => {
    const facingAway = new DamageSystem(createGameBus());
    facingAway.register(body(1, 'A'));
    const target = body(2, 'B', Math.PI);
    facingAway.register(target);
    facingAway.shieldOf = (id) => (id === 2 ? (SHIELD ?? null) : null);
    // The same shot that a body facing yaw 0 would have stopped dead.
    expect(hitFrom(facingAway, 0)).toBeGreaterThan(0);
  });

  it('halves a blast in front of it instead of refusing it', () => {
    const shielded = arena(true);
    const bare = arena(false);
    const withShield = hitFrom(shielded.damage, 0, BLAST);
    const without = hitFrom(bare.damage, 0, BLAST);
    expect(without).toBeGreaterThan(0);
    expect(withShield).toBeCloseTo(without * (SHIELD?.blastRetain ?? 0), 5);
    // Halved is not refused: the counter is for the hits that never landed at all.
    expect(shielded.damage.blockedByShield).toBe(0);
  });

  it('does nothing about a blast behind it', () => {
    const shielded = arena(true);
    const bare = arena(false);
    const profile = BLAST;
    expect(hitFrom(shielded.damage, 180, profile)).toBeCloseTo(hitFrom(bare.damage, 180, profile), 5);
  });

  /**
   * `BurnSystem` fills the origin with the impact to say "this did not arrive from anywhere".
   * A shield does not put out a fire burning on the arm holding it, and the door has to reach
   * that answer without knowing what a burn is.
   */
  it('does not stop damage that is already on it', () => {
    const { damage, target } = arena(true);
    const req = makeDamageRequest(AR_DEFAULT);
    req.sourceId = 1;
    req.targetId = 2;
    req.distance = 0;
    req.penetrationRetain = 1;
    req.x = 0;
    req.y = 1.2;
    req.z = 0;
    req.originX = 0;
    req.originY = 1.2;
    req.originZ = 0;
    expect(damage.apply(req)).toBeGreaterThan(0);
    expect(target.health.current).toBeLessThan(HEALTH.max);
  });
});

describe('a match with no shields in it', () => {
  it('is the game as it was: the door refuses nothing', () => {
    const { damage, target } = arena(false);
    expect(hitFrom(damage, 0)).toBeGreaterThan(0);
    expect(target.health.current).toBeLessThan(HEALTH.max);
    expect(damage.blockedByShield).toBe(0);
  });
});

describe('the shield-pistol', () => {
  it('carries the shield on the weapon, where the door looks for it', () => {
    const def = shieldPistolWeapon();
    expect(def.id).toBe('streak_shield');
    expect(def.shield?.halfAngleDeg).toBeGreaterThan(0);
    expect(def.shield?.blastRetain).toBeGreaterThan(0);
    expect(def.shield?.blastRetain).toBeLessThan(1);
  });

  it('is the streak is the ammunition, like the belt and the fuel', () => {
    expect(shieldPistolWeapon().reserveAmmo).toBe(0);
  });

  it('is one object, not one per call', () => {
    expect(shieldPistolWeapon()).toBe(shieldPistolWeapon());
  });
});
