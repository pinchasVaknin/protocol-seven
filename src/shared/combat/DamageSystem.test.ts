import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { Health } from '../player/Health';
import { AR_DEFAULT, cloneWeaponDef, requireWeapon, type WeaponDef } from '../weapons/WeaponDefs';
import {
  DamageSystem,
  PLAYER_ENTITY_ID,
  damageAtRange,
  makeDamageRequest,
  type Damageable,
  type DamageRequest,
} from './DamageSystem';
import { HitboxRig } from './HitboxRig';

/**
 * The one door, pinned.
 *
 * `RiotShield.test.ts` beside this one already pins the shield, which is the only rule in
 * `apply` that is about *direction*. What is pinned here is everything else the door decides,
 * in the order it decides it: the four refusals, the arithmetic, the waiting room's rule, and
 * the two records the hit is reported through.
 *
 * The numbers are the real `ar_carbine` and `sniper_kestrel` rather than hand-made profiles,
 * because the figures M2 verified are that weapon's and a made-up multiplier would pin nothing.
 */

let fakeNow = 1000;
installClock({ nowMs: () => fakeNow });

const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };
const SNIPER: WeaponDef = requireWeapon('sniper_kestrel');

/** A body at the origin facing yaw 0, on `team` — or on no side at all, like a range board. */
function body(entityId: number, team?: 'A' | 'B'): Damageable {
  const rig = new HitboxRig();
  rig.setTransform(0, 0, 0, 0);
  return { entityId, displayName: 'E' + entityId, health: new Health(HEALTH), rig, team };
}

interface Arena {
  readonly bus: GameBus;
  readonly damage: DamageSystem;
  readonly shooter: Damageable;
  readonly target: Damageable;
  readonly dealt: Array<Record<string, unknown>>;
  readonly killed: Array<Record<string, unknown>>;
}

/**
 * A shooter on A and a target on `targetTeam`, with both event streams recorded.
 *
 * `'none'` rather than `undefined` for the sideless target, because `undefined` passed to an
 * optional parameter is the default and the range board would quietly come back on team B.
 */
function arena(targetTeam: 'A' | 'B' | 'none' = 'B'): Arena {
  const bus = createGameBus();
  const damage = new DamageSystem(bus);
  const shooter = body(1, 'A');
  const target = body(2, targetTeam === 'none' ? undefined : targetTeam);
  damage.register(shooter);
  damage.register(target);
  const dealt: Array<Record<string, unknown>> = [];
  const killed: Array<Record<string, unknown>> = [];
  // The payloads are module-level singletons, so a copy is taken as each one arrives.
  bus.on(EV.DamageDealt, (p) => dealt.push({ ...p }));
  bus.on(EV.EntityKilled, (p) => killed.push({ ...p }));
  return { bus, damage, shooter, target, dealt, killed };
}

/** One hit, dead ahead at point blank unless the caller says otherwise. */
function request(weapon: WeaponDef = AR_DEFAULT): DamageRequest {
  const req = makeDamageRequest(weapon);
  req.sourceId = 1;
  req.targetId = 2;
  req.zone = 'torso';
  req.distance = 0;
  req.x = 0;
  req.y = 1.26;
  req.z = 0;
  req.originX = 0;
  req.originY = 1.26;
  req.originZ = -3;
  return req;
}

describe('a fresh request', () => {
  it('is aimed at nobody, from the single-player seat, with no losses', () => {
    expect(makeDamageRequest(AR_DEFAULT)).toEqual({
      sourceId: PLAYER_ENTITY_ID,
      targetId: -1,
      zone: 'torso',
      upperTorso: false,
      weapon: AR_DEFAULT,
      autonomous: false,
      distance: 0,
      penetrationRetain: 1,
      x: 0,
      y: 0,
      z: 0,
      originX: 0,
      originY: 0,
      originZ: 0,
    });
  });

  it('is the seat every piece of local presentation was written against', () => {
    expect(PLAYER_ENTITY_ID).toBe(0);
  });
});

describe('falloff', () => {
  it('is the near figure up to where it starts', () => {
    expect(damageAtRange(AR_DEFAULT, 0)).toBe(AR_DEFAULT.damage.near);
    expect(damageAtRange(AR_DEFAULT, AR_DEFAULT.damageFalloff.start)).toBe(AR_DEFAULT.damage.near);
  });

  it('is the far figure from where it ends', () => {
    expect(damageAtRange(AR_DEFAULT, AR_DEFAULT.damageFalloff.end)).toBe(AR_DEFAULT.damage.far);
    expect(damageAtRange(AR_DEFAULT, 500)).toBe(AR_DEFAULT.damage.far);
  });

  it('interpolates between them', () => {
    const { start, end } = AR_DEFAULT.damageFalloff;
    const half = damageAtRange(AR_DEFAULT, (start + end) * 0.5);
    expect(half).toBe((AR_DEFAULT.damage.near + AR_DEFAULT.damage.far) * 0.5);
    expect(half).toBeLessThan(AR_DEFAULT.damage.near);
    expect(half).toBeGreaterThan(AR_DEFAULT.damage.far);
  });

  it('is a step rather than a ramp when the band has no width', () => {
    const flat = cloneWeaponDef(AR_DEFAULT);
    flat.damageFalloff.start = 30;
    flat.damageFalloff.end = 30;
    expect(damageAtRange(flat, 29)).toBe(flat.damage.near);
    expect(damageAtRange(flat, 30)).toBe(flat.damage.near);
    expect(damageAtRange(flat, 31)).toBe(flat.damage.far);
  });
});

describe('the register of bodies that can be hurt', () => {
  it('keeps a map and a flat array of the same entities', () => {
    const damage = new DamageSystem(createGameBus());
    const a = body(1, 'A');
    const b = body(2, 'B');
    damage.register(a);
    damage.register(b);
    expect(damage.count).toBe(2);
    expect(damage.list).toEqual([a, b]);
    expect(damage.get(1)).toBe(a);
    expect(damage.get(9)).toBe(undefined);
  });

  it('replaces a body registered twice on one id rather than listing it twice', () => {
    const damage = new DamageSystem(createGameBus());
    const first = body(1, 'A');
    const second = body(1, 'B');
    damage.register(first);
    damage.register(second);
    expect(damage.count).toBe(1);
    expect(damage.get(1)).toBe(second);
  });

  it('forgets a body on request and ignores an id it never had', () => {
    const damage = new DamageSystem(createGameBus());
    damage.register(body(1, 'A'));
    damage.unregister(1);
    damage.unregister(1);
    damage.unregister(77);
    expect(damage.count).toBe(0);
    expect(damage.get(1)).toBe(undefined);
  });
});

describe('a hit the door refuses', () => {
  it('is one on a body it has never heard of', () => {
    const { damage, dealt } = arena();
    const req = request();
    req.targetId = 99;
    expect(damage.apply(req)).toBe(0);
    expect(dealt).toEqual([]);
  });

  it('is one on a body that is already dead', () => {
    const { damage, target, dealt } = arena();
    target.health.alive = false;
    expect(damage.apply(request())).toBe(0);
    expect(dealt).toEqual([]);
  });

  it('is one on a body that cannot be hurt at all, and it is counted', () => {
    const { damage, target, dealt, killed } = arena();
    const godly = { ...body(2, 'B'), invulnerable: true };
    damage.register(godly);
    expect(damage.apply(request())).toBe(0);
    expect(damage.blockedByInvulnerable).toBe(1);
    expect(godly.health.current).toBe(HEALTH.max);
    expect(target.health.current).toBe(HEALTH.max);
    // Returned before the event, which is why the counter has to exist.
    expect(dealt).toEqual([]);
    expect(killed).toEqual([]);
  });

  it('is one on a team-mate, with no event and nothing counted', () => {
    const { damage, target, dealt } = arena('A');
    expect(damage.apply(request())).toBe(0);
    expect(target.health.current).toBe(HEALTH.max);
    expect(damage.blockedByInvulnerable).toBe(0);
    expect(damage.blockedByShield).toBe(0);
    expect(dealt).toEqual([]);
  });
});

describe('the friendly gate', () => {
  it('lets a round through to a team-mate once there are no team-mates', () => {
    const { damage, target } = arena('A');
    damage.freeForAll = true;
    expect(damage.apply(request())).toBeGreaterThan(0);
    expect(target.health.current).toBeLessThan(HEALTH.max);
  });

  it('never applies to a body on no side at all, which is a range board', () => {
    const { damage, target } = arena('none');
    expect(damage.apply(request())).toBeGreaterThan(0);
    expect(target.health.current).toBeLessThan(HEALTH.max);
  });

  it('never applies when a shooter on no side is the source', () => {
    const bus = createGameBus();
    const damage = new DamageSystem(bus);
    damage.register(body(1, undefined));
    const target = body(2, 'A');
    damage.register(target);
    expect(damage.apply(request())).toBeGreaterThan(0);
  });

  it('never applies when a hit has no registered source, like a mortar shell', () => {
    const { damage, target } = arena('A');
    const req = request();
    req.sourceId = 404;
    expect(damage.apply(req)).toBeGreaterThan(0);
    expect(target.health.current).toBeLessThan(HEALTH.max);
  });

  it('is skipped for a body hurting itself', () => {
    const { damage, target } = arena('A');
    const req = request();
    req.sourceId = 2;
    expect(damage.apply(req)).toBeGreaterThan(0);
    expect(target.health.current).toBeLessThan(HEALTH.max);
  });
});

describe('what a hit costs', () => {
  it('is the weapon base damage on the abdomen', () => {
    const { damage } = arena();
    expect(damage.apply(request())).toBe(AR_DEFAULT.damage.near);
  });

  it('is the headshot multiplier on the head', () => {
    const { damage } = arena();
    const req = request();
    req.zone = 'head';
    expect(damage.apply(req)).toBe(AR_DEFAULT.damage.near * AR_DEFAULT.headshotMult);
  });

  it('is the limb multiplier on an arm and on a leg', () => {
    const arm = arena();
    const armReq = request();
    armReq.zone = 'arm';
    expect(arm.damage.apply(armReq)).toBe(AR_DEFAULT.damage.near * AR_DEFAULT.limbMult);

    const leg = arena();
    const legReq = request();
    legReq.zone = 'leg';
    expect(leg.damage.apply(legReq)).toBe(AR_DEFAULT.damage.near * AR_DEFAULT.limbMult);
  });

  it('ignores the chest for a weapon whose upper torso multiplier is one', () => {
    expect(AR_DEFAULT.upperTorsoMult).toBe(1);
    const { damage } = arena();
    const req = request();
    req.upperTorso = true;
    expect(damage.apply(req)).toBe(AR_DEFAULT.damage.near);
  });

  it('prices the chest above the abdomen for the two snipers', () => {
    const chest = arena();
    const chestReq = request(SNIPER);
    chestReq.upperTorso = true;
    expect(chest.damage.apply(chestReq)).toBe(SNIPER.damage.near * SNIPER.upperTorsoMult);

    const belly = arena();
    expect(belly.damage.apply(request(SNIPER))).toBe(SNIPER.damage.near);
  });

  it('falls off with the distance the round travelled', () => {
    const { damage } = arena();
    const req = request();
    req.distance = 500;
    expect(damage.apply(req)).toBe(AR_DEFAULT.damage.far);
  });

  it('loses the fraction the wall kept', () => {
    const { damage } = arena();
    const req = request();
    req.penetrationRetain = 0.5;
    expect(damage.apply(req)).toBe(AR_DEFAULT.damage.near * 0.5);
  });

  it('clamps a retain fraction a decoder could put out of range', () => {
    const over = arena();
    const overReq = request();
    overReq.penetrationRetain = 4;
    expect(over.damage.apply(overReq)).toBe(AR_DEFAULT.damage.near);

    const under = arena();
    const underReq = request();
    underReq.penetrationRetain = -2;
    expect(under.damage.apply(underReq)).toBe(0);
  });

  it('still reports a round a wall swallowed whole, unlike one a shield refused', () => {
    const { damage, dealt, target } = arena();
    const req = request();
    req.penetrationRetain = 0;
    expect(damage.apply(req)).toBe(0);
    expect(target.health.current).toBe(HEALTH.max);
    expect(dealt.length).toBe(1);
    expect(dealt[0]?.amount).toBe(0);
    expect(damage.blockedByShield).toBe(0);
  });
});

describe('the permanent warmup arena', () => {
  it('leaves a combatant health alone while still reporting what the hit would cost', () => {
    const { damage, target, dealt } = arena();
    damage.combatantsInvulnerable = true;
    expect(damage.apply(request())).toBe(AR_DEFAULT.damage.near);
    expect(target.health.current).toBe(HEALTH.max);
    expect(damage.lastHit.finalDamage).toBe(AR_DEFAULT.damage.near);
    expect(damage.lastHit.lethal).toBe(false);
    expect(dealt.length).toBe(1);
    expect(dealt[0]?.amount).toBe(AR_DEFAULT.damage.near);
    expect(dealt[0]?.lethal).toBe(false);
  });

  it('keeps the range boards killable, which is the point of the room', () => {
    const { damage, target } = arena('none');
    damage.combatantsInvulnerable = true;
    expect(damage.apply(request())).toBe(AR_DEFAULT.damage.near);
    expect(target.health.current).toBe(HEALTH.max - AR_DEFAULT.damage.near);
  });

  it('cannot kill a combatant however many rounds land', () => {
    const { damage, target, killed } = arena();
    damage.combatantsInvulnerable = true;
    for (let i = 0; i < 20; i++) damage.apply(request());
    expect(target.health.alive).toBe(true);
    expect(killed).toEqual([]);
  });
});

describe('the lethal hit', () => {
  it('drops the body once and only once', () => {
    const { damage, target, killed } = arena();
    const req = request();
    req.zone = 'head';
    // 34 x 1.5 is 51, so the second round is the lethal one.
    damage.apply(req);
    damage.apply(req);
    expect(target.health.alive).toBe(false);
    expect(killed.length).toBe(1);
    expect(damage.apply(req)).toBe(0);
    expect(killed.length).toBe(1);
  });

  it('names the weapon, the zone and the killer remaining health', () => {
    const { damage, shooter, killed } = arena();
    shooter.health.applyDamage(37.4);
    const req = request();
    req.zone = 'head';
    damage.apply(req);
    damage.apply(req);
    expect(killed[0]).toEqual({
      targetId: 2,
      sourceId: 1,
      weaponId: AR_DEFAULT.id,
      zone: 'head',
      killerHealth: Math.round(shooter.health.current),
    });
  });

  it('reports no killer health for a body that finished itself', () => {
    const { damage, killed } = arena();
    const req = request();
    req.sourceId = 2;
    req.zone = 'head';
    damage.apply(req);
    damage.apply(req);
    expect(killed[0]?.sourceId).toBe(2);
    expect(killed[0]?.killerHealth).toBe(0);
  });

  it('reports no killer health for a shooter that is not a body, like a sentry', () => {
    const { damage, killed } = arena();
    const req = request();
    req.sourceId = 500;
    req.zone = 'head';
    damage.apply(req);
    damage.apply(req);
    expect(killed[0]?.killerHealth).toBe(0);
  });

  it('marks the damage event lethal on the killing round alone', () => {
    const { damage, dealt } = arena();
    const req = request();
    req.zone = 'head';
    damage.apply(req);
    damage.apply(req);
    expect(dealt.map((d) => d.lethal)).toEqual([false, true]);
  });
});

describe('the debug read-out of the last hit', () => {
  it('starts out saying nothing happened', () => {
    const { damage } = arena();
    expect(damage.lastHit.valid).toBe(false);
    expect(damage.lastHit.targetName).toBe('');
  });

  it('splits one hit into the losses that produced it', () => {
    fakeNow = 4242;
    const { damage, target } = arena();
    const req = request(SNIPER);
    req.zone = 'torso';
    req.upperTorso = true;
    req.distance = SNIPER.damageFalloff.end;
    req.penetrationRetain = 0.5;
    const dealt = damage.apply(req);

    const base = SNIPER.damage.far;
    const mult = SNIPER.upperTorsoMult;
    expect(damage.lastHit).toEqual({
      valid: true,
      targetName: target.displayName,
      zone: 'torso',
      upperTorso: true,
      distance: SNIPER.damageFalloff.end,
      baseDamage: base,
      zoneMultiplier: mult,
      falloffLoss: (SNIPER.damage.near - base) * mult,
      penetrationLoss: base * mult - base * mult * 0.5,
      finalDamage: dealt,
      remainingHealth: target.health.current,
      lethal: false,
      atMs: 4242,
    });
  });

  it('carries the same two losses onto the event', () => {
    const { damage, dealt } = arena();
    const req = request();
    req.distance = 30;
    req.penetrationRetain = 0.75;
    req.autonomous = true;
    const amount = damage.apply(req);
    expect(dealt[0]).toEqual({
      sourceId: 1,
      targetId: 2,
      weaponId: AR_DEFAULT.id,
      zone: 'torso',
      amount,
      x: 0,
      y: 1.26,
      z: 0,
      distance: 30,
      falloffLoss: damage.lastHit.falloffLoss,
      penetrationLoss: damage.lastHit.penetrationLoss,
      lethal: false,
      autonomous: true,
    });
  });
});
