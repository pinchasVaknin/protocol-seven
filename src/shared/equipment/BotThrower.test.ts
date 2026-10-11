import { describe, expect, it } from 'vitest';
import type { Combatant } from '../ai/Combatant';
import type { BotTier, TierConfig } from '../ai/DifficultyTiers';
import { HitboxRig } from '../combat/HitboxRig';
import { DamageSystem } from '../combat/DamageSystem';
import { createGameBus } from '../core/Events';
import { Rng } from '../core/Rng';
import { Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { BotThrower, type ThrowIntent } from './BotThrower';
import { DEFAULT_EQUIPMENT_CONFIG } from './EquipmentConfig';
import { equipmentDef } from './EquipmentDefs';
import { EquipmentSystem } from './EquipmentSystem';

/**
 * Bots throwing grenades without blowing themselves up — pinned.
 *
 * Two things make this honest rather than a dice roll, and both are tests below.
 *
 * **The safety check runs the real integration.** `previewTrajectory` steps the same arc through
 * the same collision world the thrown object will use, so a bot in the open throws and a bot
 * facing a wall a metre away does not — the grenade would bounce back off the lip.
 *
 * **The tier gate is two-sided.** `grenadeChance` decides whether a tier throws at all and
 * `minBotTier` decides what it may carry, so a Recruit throws nothing and only a Veteran plants.
 *
 * The hard rule is the third: never near yourself, and never near a team-mate. `rejectedUnsafe`
 * exists because a bot that quietly stops throwing and a bot that is throwing safely look
 * identical from outside.
 */

const CFG = DEFAULT_EQUIPMENT_CONFIG;
const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };
const BOUNDS = { min: { x: -60, y: -8, z: -60 }, max: { x: 60, y: 16, z: 60 } };

/** A world with a floor whose top face is y = 0, plus whatever else the test asks for. */
function world(...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>) {
  const set = new ColliderSet(boxes.length + 2);
  set.add({ x: 0, y: -0.5, z: 0 }, { x: 120, y: 1, z: 120 }, 0, 0, 0, 'floor');
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  return new CollisionWorld(set, BOUNDS, 4);
}

function combatant(
  entityId: number,
  team: 'A' | 'B',
  x = 0,
  z = 0,
  over: Partial<Combatant> = {},
): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(x, 0, z, 0);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team,
    px: x,
    py: 0,
    pz: z,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
    ...over,
  };
}

/**
 * The four fields `BotThrower` reads off a tier, and nothing else.
 *
 * Narrowed deliberately: a whole `TierConfig` would put twenty numbers this class never looks at
 * into every test, and the gate being two-sided is exactly about these four.
 */
function tier(over: Partial<TierConfig> = {}): TierConfig {
  return {
    grenadeChance: 1,
    grenadeCooldown: 20,
    grenadeSafeRadius: 8,
    grenadeRange: 30,
    ...over,
  } as TierConfig;
}

function intent(over: Partial<ThrowIntent> = {}): ThrowIntent {
  return { targetX: 0, targetY: 0, targetZ: -14, sinceSeen: 0, hasTarget: true, ...over };
}

interface Arena {
  readonly thrower: BotThrower;
  readonly system: EquipmentSystem;
  readonly roster: Combatant[];
  readonly self: Combatant;
}

function arena(opts: { freeForAll?: boolean; cw?: CollisionWorld; mates?: Combatant[] } = {}): Arena {
  const bus = createGameBus();
  const cw = opts.cw ?? world();
  const self = combatant(1, 'A', 0, 0);
  const roster = [self, combatant(2, 'B', 0, -14), ...(opts.mates ?? [])];
  const damage = new DamageSystem(bus);
  for (const c of roster) damage.register(c);
  const system = new EquipmentSystem({
    bus,
    world: cw,
    damage,
    roster,
    cfg: CFG,
    freeForAll: opts.freeForAll ?? false,
  });
  return { thrower: new BotThrower(system, cw, CFG), system, roster, self };
}

/** A bot asked once, with its cooldown already spent. */
function consider(a: Arena, t: BotTier, cfg = tier(), i = intent(), seed = 12345): boolean {
  a.thrower.respawn(a.self.entityId);
  // The loadout starts on a four-second cooldown; hand over enough elapsed to clear it.
  return a.thrower.consider(a.self, t, cfg, i, a.roster, new Rng(seed), 10);
}

describe('what a bot starts a life holding', () => {
  it('is one of each, and the same figure the per-life audit asks for', () => {
    expect(BotThrower.fullStock).toMatchObject({ lethal: 1, tactical: 1 });
    const a = arena();
    a.thrower.respawn(1);
    expect(a.thrower.stockOf(1)).toMatchObject({ lethal: 1, tactical: 1 });
  });

  it('reads as full for a bot that has never been asked, without creating a row', () => {
    const a = arena();
    expect(a.thrower.stockOf(99)).toBe(BotThrower.fullStock);
  });

  it('is four seconds before it may throw at all', () => {
    const a = arena();
    a.thrower.respawn(1);
    expect(a.thrower.consider(a.self, 'VETERAN', tier(), intent(), a.roster, new Rng(1), 1)).toBe(
      false,
    );
    expect(a.thrower.throws).toBe(0);
  });

  it('is forgotten on reset, along with the diagnostics', () => {
    const a = arena();
    consider(a, 'VETERAN');
    a.thrower.reset();
    expect(a.thrower.throws).toBe(0);
    expect(a.thrower.rejectedUnsafe).toBe(0);
    expect(a.thrower.stockOf(1)).toBe(BotThrower.fullStock);
  });
});

describe('the tier gate', () => {
  it('lets a tier that throws, throw', () => {
    const a = arena();
    expect(consider(a, 'VETERAN')).toBe(true);
    expect(a.thrower.throws).toBe(1);
    expect(a.system.thrownTotal).toBe(1);
  });

  it('refuses a tier whose chance is zero, which is what a Recruit is', () => {
    const a = arena();
    expect(consider(a, 'RECRUIT', tier({ grenadeChance: 0 }))).toBe(false);
    expect(a.thrower.throws).toBe(0);
    // Refused before the cooldown is even re-armed, so nothing was spent.
    expect(a.thrower.stockOf(1).lethal).toBe(1);
  });

  it('only lets a tier carry what its index allows', () => {
    // A Regular is index 1, so the frag and the flashbang and nothing else; the semtex needs 2.
    const regular = arena();
    expect(consider(regular, 'REGULAR')).toBe(true);
    const thrownByRegular = regular.system.projectiles.items.find((p) => p.active);
    expect(['frag', 'flashbang']).toContain(thrownByRegular?.def.id);

    // Nobody plants: a claymore is not a thrown answer whatever the tier.
    for (const t of ['REGULAR', 'HARDENED', 'VETERAN'] as const) {
      const a = arena();
      consider(a, t);
      const p = a.system.projectiles.items.find((x) => x.active);
      expect(p?.def.impact).not.toBe('plant');
    }
  });

  it('spends the slot it threw and refuses once both are gone', () => {
    const a = arena();
    expect(consider(a, 'VETERAN')).toBe(true);
    const after = a.thrower.stockOf(1);
    expect(after.lethal + after.tactical).toBe(1);

    // Second throw takes the other slot; a third has nothing left to pick.
    expect(a.thrower.consider(a.self, 'VETERAN', tier(), intent(), a.roster, new Rng(7), 30)).toBe(
      true,
    );
    expect(a.thrower.stockOf(1)).toMatchObject({ lethal: 0, tactical: 0 });
    expect(a.thrower.consider(a.self, 'VETERAN', tier(), intent(), a.roster, new Rng(7), 30)).toBe(
      false,
    );
    expect(a.thrower.throws).toBe(2);
  });

  it('re-arms its cooldown whether or not it threw, so it does not test arcs all match', () => {
    const a = arena();
    const cfg = tier({ grenadeChance: 0.000001 });
    a.thrower.respawn(1);
    expect(a.thrower.consider(a.self, 'VETERAN', cfg, intent(), a.roster, new Rng(3), 10)).toBe(
      false,
    );
    // The dice refused, and the cooldown is now the tier's rather than spent: an evaluation a
    // moment later is refused before anything is computed, and one past the cooldown is not.
    expect(a.thrower.consider(a.self, 'VETERAN', tier(), intent(), a.roster, new Rng(3), 1)).toBe(
      false,
    );
    expect(
      a.thrower.consider(
        a.self,
        'VETERAN',
        tier(),
        intent(),
        a.roster,
        new Rng(3),
        cfg.grenadeCooldown + 1,
      ),
    ).toBe(true);
  });
});

describe('a bot with nothing worth throwing at', () => {
  it('refuses without a target', () => {
    const a = arena();
    expect(consider(a, 'VETERAN', tier(), intent({ hasTarget: false }))).toBe(false);
  });

  it('refuses a target it has not seen for too long', () => {
    const a = arena();
    expect(consider(a, 'VETERAN', tier(), intent({ sinceSeen: 3.5 }))).toBe(false);
    expect(consider(a, 'VETERAN', tier(), intent({ sinceSeen: 2.9 }))).toBe(true);
  });

  it('refuses a target closer than a grenade is worth', () => {
    const a = arena();
    expect(consider(a, 'VETERAN', tier(), intent({ targetZ: -4 }))).toBe(false);
  });

  it('refuses a target beyond the range its tier throws', () => {
    const a = arena();
    expect(consider(a, 'VETERAN', tier({ grenadeRange: 10 }), intent({ targetZ: -14 }))).toBe(
      false,
    );
  });
});

describe('the hard rule: never near yourself, never near a team-mate', () => {
  it('refuses a throw into a wall a metre in front of it', () => {
    const a = arena();
    // Every arc in the ladder comes back off the lip, so none of them lands near the target.
    const walled = arena({ cw: world([0, 3, -1.2, 20, 8, 0.5]) });
    expect(consider(walled, 'VETERAN')).toBe(false);
    // Refused by the accuracy gate rather than the safety one — the grenade would be wasted
    // rather than suicidal — so the unsafe counter is deliberately untouched here.
    expect(walled.thrower.rejectedUnsafe).toBe(0);
    expect(walled.thrower.throws).toBe(0);
    // The open-field case does throw, which is what makes the refusal above meaningful.
    expect(consider(a, 'VETERAN')).toBe(true);
  });

  it('refuses when a team-mate is standing on the landing spot', () => {
    const mate = combatant(3, 'A', 0, -14);
    const a = arena({ mates: [mate] });
    expect(consider(a, 'VETERAN')).toBe(false);
    expect(a.thrower.rejectedUnsafe).toBe(1);
  });

  it('throws anyway once nobody is a team-mate', () => {
    const mate = combatant(3, 'A', 0, -14);
    const a = arena({ mates: [mate], freeForAll: true });
    expect(a.system.freeForAll).toBe(true);
    expect(consider(a, 'VETERAN')).toBe(true);
    expect(a.thrower.rejectedUnsafe).toBe(0);
  });

  it('ignores a team-mate who is not in the match', () => {
    const mate = combatant(3, 'A', 0, -14, { participating: false });
    const a = arena({ mates: [mate] });
    expect(consider(a, 'VETERAN')).toBe(true);
  });

  it('is unmoved by an enemy on the landing spot, which is the point of throwing', () => {
    const extra = combatant(4, 'B', 0, -14.3);
    const a = arena({ mates: [extra] });
    expect(consider(a, 'VETERAN')).toBe(true);
  });
});

describe('where a bot aims', () => {
  it('throws toward the target, not past it', () => {
    const a = arena();
    expect(consider(a, 'VETERAN')).toBe(true);
    const p = a.system.projectiles.items.find((x) => x.active);
    expect(p).not.toBe(undefined);
    if (p === undefined) return;
    // The target is down -Z, so the grenade leaves going that way and lofted upward.
    expect(p.vz).toBeLessThan(0);
    expect(p.vy).toBeGreaterThan(0);
    expect(Math.abs(p.vx)).toBeLessThan(Math.abs(p.vz));
  });

  it('never cooks, because judging a fuse by eye is a human skill', () => {
    const a = arena();
    consider(a, 'VETERAN');
    const p = a.system.projectiles.items.find((x) => x.active);
    expect(p?.fuse).toBe(p?.def.fuseSeconds);
  });

  it('throws as the body it belongs to, on its own side', () => {
    const a = arena();
    consider(a, 'VETERAN');
    const p = a.system.projectiles.items.find((x) => x.active);
    expect(p?.ownerId).toBe(1);
    expect(p?.team).toBe('A');
  });

  it('refuses when the projectile pool has no room, without spending the slot', () => {
    const a = arena();
    for (let i = 0; i < 32; i++) {
      expect(
        a.system.throwFrom(equipmentDef('frag'), 9, 'B', 0, 2, 0, 0, 0, 0, 0, 0, false),
      ).not.toBe(null);
    }
    expect(consider(a, 'VETERAN')).toBe(false);
    expect(a.thrower.throws).toBe(0);
    expect(a.thrower.stockOf(1)).toMatchObject({ lethal: 1, tactical: 1 });
  });
});
