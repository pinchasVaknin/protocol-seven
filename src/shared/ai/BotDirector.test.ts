import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { DamageSystem } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import { cloneWeaponDef, requireWeapon } from '../weapons/WeaponDefs';
import { DEFAULT_VIEWMODEL_CONFIG } from '../weapons/ViewmodelConfig';
import { loadMapCollision } from '../world/MapLoader';
import { GREYBOX_MAP } from '../world/maps/greybox';
import { MAPS } from '../modes/ModeRegistry';
import { DEFAULT_SCHEDULER } from './AiScheduler';
import { BOT_ID_BASE, BotDirector, type BotDirectorDeps } from './BotDirector';
import type { Combatant } from './Combatant';
import { DEFAULT_PERCEPTION, DEFAULT_TIERS, type BotTier } from './DifficultyTiers';
import { dealTiers, seatToVacate } from './RosterDeal';

/**
 * Everything that turns a pile of AI classes into a firefight, pinned.
 *
 * Built on the real greybox map with a real `CollisionWorld`, a real bake, a real
 * `DamageSystem` and a real bus, because three quarters of what this class does is wiring and
 * a test against stubs would pin the stubs. The navmesh bake is the slow part, so it is baked
 * once at module scope and handed to every director through `deps.nav` — which is the field
 * that exists for exactly this, the server's map cache.
 *
 * Four groups of behaviour, and each has a history:
 *
 *  - **The deal.** `populate` fills both sides from `RosterDeal`, and the ids come from one
 *    counter so no two bodies can ever share one. The counter is deliberately not derived
 *    from `bots.length`, which falls when `removeOne` seats a human.
 *  - **The translation.** This is the only subscriber that turns world events into AI input:
 *    gunfire and footsteps into the noise field, damage into a flinch, a kill into a fall in
 *    the direction the round was travelling. Each of the five handlers has a rule inside it
 *    that is easy to lose — Dead Silence, the 4 m/s landing threshold, "a frag is not a round
 *    fired" — so each is asserted on its own.
 *  - **The tick.** Perception, then the decision that reads it, then the path request that
 *    reads that, then steering. A bot whose decision landed this tick acts on it this tick.
 *  - **The report.** Acceptance criteria 3, 5 and 6, including the per-team split that playtest
 *    round 5 asked for: a tier dealt to one side only looks ordinary in a table with no team
 *    column, which is how a VETERAN going 36-5 for the opposition reads as balance.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const COLLISION = loadMapCollision(GREYBOX_MAP);
const MIX: readonly BotTier[] = MAPS.find((m) => m.id === GREYBOX_MAP.id)?.tierMix ?? ['REGULAR'];

/** The player seat: a body on team A that is not a bot, exactly as the roster holds it. */
function player(): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(0, 0, 0, 0);
  return {
    entityId: 0,
    displayName: 'PLAYER',
    health: new Health(DEFAULT_HEALTH_CONFIG),
    rig,
    team: 'A',
    px: 0,
    py: 0,
    pz: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

interface Rig {
  readonly director: BotDirector;
  readonly bus: GameBus;
  readonly me: Combatant;
}

function rig(over: Partial<BotDirectorDeps> = {}): Rig {
  const bus = createGameBus();
  const me = player();
  const deps: BotDirectorDeps = {
    world: COLLISION.collision,
    mapDef: GREYBOX_MAP,
    bus,
    damage: new DamageSystem(bus),
    movement: DEFAULT_MOVEMENT_CONFIG,
    healthConfig: DEFAULT_HEALTH_CONFIG,
    viewmodelConfig: DEFAULT_VIEWMODEL_CONFIG,
    tiers: DEFAULT_TIERS,
    perceptionConfig: DEFAULT_PERCEPTION,
    scheduler: DEFAULT_SCHEDULER,
    player: me,
    seed: 1234,
    ...over,
  };
  const director = new BotDirector(deps);
  return { director, bus, me };
}

/** A populated 4v5 — the solo split, and the one the round-5 report was written against. */
function populated(teamA = 4, teamB = 5): Rig {
  const r = rig();
  r.director.populate(teamA, teamB, MIX);
  return r;
}

function fired(sourceId: number, over: Record<string, unknown> = {}): never {
  return {
    weaponId: 'ar_carbine',
    sourceId,
    x: 1,
    y: 1,
    z: 1,
    dx: 0,
    dy: 0,
    dz: -1,
    endX: 1,
    endY: 1,
    endZ: -10,
    distance: 11,
    shotIndex: 0,
    spreadDeg: 0,
    tracer: false,
    hitTarget: false,
    ammoInMag: 29,
    pellets: 1,
    pelletsHit: 0,
    minimapPing: true,
    ...over,
  } as never;
}

function hurt(sourceId: number, targetId: number, over: Record<string, unknown> = {}): never {
  return {
    sourceId,
    targetId,
    weaponId: 'ar_carbine',
    zone: 'torso',
    amount: 25,
    x: 0,
    y: 1,
    z: 0,
    distance: 10,
    falloffLoss: 0,
    penetrationLoss: 0,
    lethal: false,
    autonomous: false,
    ...over,
  } as never;
}

describe('a director before anybody is dealt', () => {
  it('bakes the navmesh, the cover index and the spawn pool, and reports what it found', () => {
    const { director } = rig();
    expect(director.botCount).toBe(0);
    expect(director.nav.cellCount).toBeGreaterThan(0);
    expect(director.navStats.walkable).toBeGreaterThan(0);
    expect(director.navStats.coverPoints).toBeGreaterThan(0);
    expect(director.navStats.spawnCandidates).toBeGreaterThan(0);
    expect(director.navStats.patrolPoints).toBeGreaterThan(0);
  });

  it('takes a prebaked navmesh when the server hands it one, rather than baking again', () => {
    const first = rig();
    const second = rig({ nav: first.director.nav });
    expect(second.director.nav).toBe(first.director.nav);
  });

  it('holds the player in the roster from the start, because spawn safety has no business asking who is human', () => {
    const { director, me } = rig();
    expect(director.roster).toEqual([me]);
  });

  it('is allowed to respawn anybody while no policy has been set', () => {
    const { director } = rig();
    expect(director.respawnPolicy).toBe(null);
  });
});

describe('dealing a roster', () => {
  it('fills both sides from the deal, in mix order', () => {
    const { director } = populated(4, 5);
    const deal = dealTiers(4, 5, MIX);
    expect(director.tiersOn('A')).toEqual([...deal.a]);
    expect(director.tiersOn('B')).toEqual([...deal.b]);
    expect(director.botCount).toBe(9);
  });

  it('mints ids from the base, monotonically, so no two bodies can share one', () => {
    const { director } = populated(4, 5);
    const ids = director.bots.map((b) => b.entityId);
    expect(ids).toEqual(Array.from({ length: 9 }, (_, i) => BOT_ID_BASE + i));
    expect(new Set(ids).size).toBe(9);
  });

  it('puts every bot in the roster beside the player, and in the id map', () => {
    const { director, me } = populated(2, 2);
    expect(director.roster[0]).toBe(me);
    expect(director.roster).toHaveLength(5);
    for (const bot of director.bots) expect(director.get(bot.entityId)).toBe(bot);
    expect(director.get(9999)).toBeUndefined();
  });

  it('spawns everybody somewhere the navmesh accepts', () => {
    const { director } = populated(2, 2);
    for (const bot of director.bots) {
      expect(bot.health.alive).toBe(true);
      expect(Number.isFinite(bot.px)).toBe(true);
      expect(director.nav.nearestCell(bot.px, bot.py, bot.pz)).toBeGreaterThanOrEqual(0);
    }
  });

  it('announces every spawn with the body, the side, the tier and how close the nearest enemy was', () => {
    const r = rig();
    const seen: Array<{ entityId: number; team: string; tier: string }> = [];
    r.bus.on(EV.BotSpawned, (p) => seen.push({ entityId: p.entityId, team: p.team, tier: p.tier }));
    r.director.populate(1, 1, ['REGULAR']);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.team).toBe('A');
    expect(seen[1]?.team).toBe('B');
  });

  it('deals each bot its own weapon, not the player’s (M7)', () => {
    // Equipping a sniper in Create-a-Class used to arm all nine bots with snipers.
    const { director } = populated(5, 5);
    const ids = new Set(director.bots.map((b) => b.weapons.definition.id));
    expect(ids.size).toBeGreaterThan(1);
    for (const bot of director.bots) {
      expect(bot.weapons.definition).not.toBe(requireWeapon(bot.weapons.definition.id ?? ''));
    }
  });

  it('gives every bot the same weapon when the harness asks for one', () => {
    const { director } = rig({ botWeaponId: 'shotgun_breacher' });
    director.populate(3, 3, MIX);
    for (const bot of director.bots) expect(bot.weapons.definition.id).toBe('shotgun_breacher');
  });

  it('is reproducible: one seed deals one roster', () => {
    const first = rig({ seed: 77 });
    const second = rig({ seed: 77 });
    first.director.populate(4, 5, MIX);
    second.director.populate(4, 5, MIX);
    expect(first.director.bots.map((b) => `${b.tierName}:${b.weapons.definition.id}`)).toEqual(
      second.director.bots.map((b) => `${b.tierName}:${b.weapons.definition.id}`),
    );
  });

  it('starts over on a second populate rather than stacking', () => {
    const { director } = populated(4, 5);
    director.populate(2, 2, MIX);
    expect(director.botCount).toBe(4);
    expect(director.bots.map((b) => b.entityId)).toEqual([100, 101, 102, 103]);
  });
});

describe('a seat changing hands mid-match', () => {
  it('takes the bot a joining human displaces, which is the weakest on that side', () => {
    const { director } = populated(5, 5);
    const before = director.tiersOn('A');
    const expected = before[seatToVacate(before)];
    const gone = director.removeOne('A');
    expect(gone?.tierName).toBe(expected);
    expect(director.tiersOn('A')).toHaveLength(4);
    expect(director.get(gone?.entityId ?? -1)).toBeUndefined();
  });

  it('has nothing to give on a side with no bots', () => {
    const { director } = populated(0, 3);
    expect(director.removeOne('A')).toBe(null);
  });

  it('mints a replacement with an id nobody is using', () => {
    const { director } = populated(4, 5);
    const gone = director.removeOne('B');
    const added = director.addOne('B', 'HARDENED');
    expect(added).not.toBe(null);
    expect(added?.entityId).not.toBe(gone?.entityId);
    expect(added?.entityId).toBe(BOT_ID_BASE + 9);
    expect(added?.tierName).toBe('HARDENED');
  });

  it('refuses to mint past the id ceiling rather than wrapping onto a live body', () => {
    // A wrapped id is two bodies on one entity, which inherits another's rig history and,
    // on every client, its mesh.
    const { director } = rig();
    director.populate(0, 0, MIX);
    let minted = 0;
    for (let i = 0; i < 200; i++) if (director.addOne('A', 'REGULAR') !== null) minted++;
    expect(minted).toBe(150);
    expect(director.addOne('A', 'REGULAR')).toBe(null);
    for (const bot of director.bots) expect(bot.entityId).toBeLessThan(255);
  });

  it('releases everything a removed bot held in shared/', () => {
    const { director } = populated(2, 2);
    const gone = director.removeOne('A');
    expect(gone).not.toBe(null);
    expect(director.bots).not.toContain(gone);
    expect(director.roster).not.toContain(gone);
  });
});

describe('clearing and retuning the roster', () => {
  it('leaves the player alone in the roster', () => {
    const { director, me } = populated(4, 5);
    director.clear();
    expect(director.botCount).toBe(0);
    expect(director.roster).toEqual([me]);
  });

  it('promotes every bot when the debug panel asks', () => {
    const { director } = populated(2, 2);
    director.setAllTiers('VETERAN');
    for (const bot of director.bots) {
      expect(bot.tierName).toBe('VETERAN');
      expect(bot.tier).toBe(DEFAULT_TIERS.VETERAN);
    }
  });

  it('retunes health on the living roster', () => {
    const { director } = populated(2, 2);
    director.applyHealthConfig({ max: 50, regenDelay: 1, regenRate: 1 });
    for (const bot of director.bots) expect(bot.health.max).toBe(50);
  });

  it('swaps the weapon under every bot for a controlled measurement', () => {
    const { director } = populated(2, 2);
    director.applyWeaponDef(cloneWeaponDef(requireWeapon('sniper_kestrel')));
    for (const bot of director.bots) {
      expect(bot.weapons.definition.id).toBe('sniper_kestrel');
      // Derived rather than cached, so the profile describes the gun it is actually holding.
      expect(bot.weaponProfile.preferredRange).toBeGreaterThan(0);
    }
  });
});

describe('turning world events into AI input', () => {
  it('counts a trigger pull as rays fired and rays that connected', () => {
    const { director, bus } = populated(1, 1);
    const shooter = director.bots[0];
    expect(shooter).toBeDefined();
    bus.emit(EV.WeaponFired, fired(shooter?.entityId ?? 0, { pellets: 8, pelletsHit: 3 }));
    expect(shooter?.shotsFired).toBe(8);
    expect(shooter?.shotsHit).toBe(3);
  });

  it('counts both halves off one event, so a hit rate cannot read over 100%', () => {
    const { director, bus } = populated(1, 1);
    const shooter = director.bots[0];
    for (let i = 0; i < 4; i++) {
      bus.emit(EV.WeaponFired, fired(shooter?.entityId ?? 0, { pellets: 1, pelletsHit: 1 }));
    }
    expect(shooter?.shotsHit).toBeLessThanOrEqual(shooter?.shotsFired ?? 0);
  });

  it('ignores a shot from somebody who is not a bot', () => {
    const { director, bus } = populated(1, 1);
    expect(() => bus.emit(EV.WeaponFired, fired(0))).not.toThrow();
    for (const bot of director.bots) expect(bot.shotsFired).toBe(0);
  });

  it('puts gunfire in the noise field so bots can hear it', () => {
    const { director, bus } = populated(1, 1);
    const before = director.perception.noise.currentSerial;
    bus.emit(EV.WeaponFired, fired(director.bots[0]?.entityId ?? 0));
    expect(director.perception.noise.currentSerial).toBeGreaterThan(before);
  });

  it('keeps a crouch-walking body silent, which is the whole reason to crouch-walk', () => {
    const { director, bus } = populated(1, 1);
    const before = director.perception.noise.currentSerial;
    bus.emit(EV.PlayerFootstep, {
      entityId: 0,
      x: 0,
      y: 0,
      z: 0,
      speed: 2,
      heavy: false,
      quiet: true,
      material: 0,
    });
    expect(director.perception.noise.currentSerial).toBe(before);
  });

  it('cuts the enemy’s hearing for Dead Silence, not the step itself (M6)', () => {
    const { director, bus } = populated(1, 1);
    director.silentFootsteps = (entityId) => entityId === 0;
    const before = director.perception.noise.currentSerial;
    const step = {
      entityId: 0,
      x: 0,
      y: 0,
      z: 0,
      speed: 4,
      heavy: true,
      quiet: false,
      material: 0,
    };
    bus.emit(EV.PlayerFootstep, step);
    expect(director.perception.noise.currentSerial).toBe(before);

    // Somebody else's step still sounds.
    bus.emit(EV.PlayerFootstep, { ...step, entityId: director.bots[0]?.entityId ?? 100 });
    expect(director.perception.noise.currentSerial).toBeGreaterThan(before);
  });

  it('hears a heavy landing and ignores a gentle one', () => {
    const { director, bus } = populated(1, 1);
    const landing = { entityId: 0, x: 0, y: 0, z: 0, impactSpeed: 3.9, stance: 'STAND' as const, material: 0 };
    const quiet = director.perception.noise.currentSerial;
    bus.emit(EV.PlayerLanded, landing);
    expect(director.perception.noise.currentSerial).toBe(quiet);

    bus.emit(EV.PlayerLanded, { ...landing, impactSpeed: 4.1 });
    expect(director.perception.noise.currentSerial).toBeGreaterThan(quiet);
  });

  it('turns damage into a flinch and a reason to look that way', () => {
    const { director, bus } = populated(1, 1);
    const victim = director.bots[0];
    expect(victim).toBeDefined();
    bus.emit(
      EV.DamageDealt,
      hurt(0, victim?.entityId ?? 0, { x: (victim?.px ?? 0) + 1, z: victim?.pz ?? 0 }),
    );
    expect(victim?.visual.flinchSerial).toBe(1);
    expect(victim?.blackboard.sinceDamage).toBeLessThan(1);
  });

  it('credits damage but not rounds to a bot’s grenade', () => {
    // Counted as a shot, a frag made the tier hit-rate a number about grenades.
    const { director, bus } = populated(1, 1);
    const shooter = director.bots[0];
    bus.emit(EV.DamageDealt, hurt(shooter?.entityId ?? 0, 0, { weaponId: 'frag', amount: 40, distance: 3 }));
    expect(shooter?.damageDealt).toBe(40);
    expect(shooter?.shotsFired).toBe(0);
  });

  it('does not flinch a body the same round killed', () => {
    const { director, bus } = populated(1, 1);
    const victim = director.bots[0];
    bus.emit(EV.DamageDealt, {
      sourceId: 0,
      targetId: victim?.entityId ?? 0,
      weaponId: 'ar_carbine',
      zone: 'head',
      amount: 200,
      x: 0,
      y: 1,
      z: 0,
      distance: 10,
      falloffLoss: 0,
      penetrationLoss: 0,
      lethal: true,
    } as never);
    expect(victim?.visual.flinchSerial).toBe(0);
  });

  it('turns a kill into a credited kill and a fall away from the killer', () => {
    const { director, bus } = populated(1, 1);
    const killer = director.bots[0];
    const victim = director.bots[1];
    expect(victim).toBeDefined();
    bus.emit(EV.EntityKilled, {
      targetId: victim?.entityId ?? 0,
      sourceId: killer?.entityId ?? 0,
      weaponId: 'ar_carbine',
      zone: 'torso',
      killerHealth: 80,
    });
    expect(killer?.kills).toBe(1);
    expect(victim?.deaths).toBe(1);
    expect(victim?.state).toBe('DEAD');
    expect(victim?.respawnTimer).toBeGreaterThan(0);
    expect(victim?.visual.deathSerial).toBe(1);
  });

  it('still drops a body whose killer is nobody in particular', () => {
    const { director, bus } = populated(1, 1);
    const victim = director.bots[0];
    bus.emit(EV.EntityKilled, {
      targetId: victim?.entityId ?? 0,
      sourceId: 9999,
      weaponId: 'world',
      zone: 'torso',
      killerHealth: 0,
    });
    expect(victim?.deaths).toBe(1);
    expect(victim?.visual.deathDirZ).toBe(1);
  });
});

describe('the tick', () => {
  it('ages every bot and advances the living ones', () => {
    const { director } = populated(2, 2);
    director.simulate(7, 112);
    for (const bot of director.bots) {
      expect(bot.lastCommand.tickIndex).toBe(7);
      expect(bot.lastCommand.sampledAtMs).toBe(112);
    }
    expect(director.currentTick).toBe(7);
    expect(director.simSeconds).toBeCloseTo(7 * DT, 10);
  });

  it('decides before it paths and paths before it steers, so a decision lands the tick it is made', () => {
    const { director } = populated(1, 1);
    // Twenty ticks is past the 4 Hz tactical interval, so every bot has decided by now and
    // none is still in the IDLE the machine starts in.
    for (let tick = 1; tick <= 20; tick++) director.simulate(tick, tick * 16);
    for (const bot of director.bots) expect(bot.state).not.toBe('IDLE');
    // And at least one has a goal it asked the pathfinder for — the third step of the order.
    expect(director.bots.some((b) => b.brain.goal !== 'NONE')).toBe(true);
    expect(director.bots.some((b) => b.brain.replans > 0)).toBe(true);
  });

  it('strips movement from every command while the countdown is frozen', () => {
    const { director } = populated(1, 1);
    director.inputFrozen = true;
    for (let tick = 1; tick <= 30; tick++) director.simulate(tick, tick * 16);
    for (const bot of director.bots) {
      expect(bot.lastCommand.moveX).toBe(0);
      expect(bot.lastCommand.moveZ).toBe(0);
      expect(bot.lastCommand.buttons).toBe(0);
    }
  });

  it('reads the health and not the event, because the event does not do the killing', () => {
    // `onKilled` drops the bot's own participation flag and its brain into DEAD; the health is
    // already gone by then, because `DamageSystem` took it before it published the kill. The
    // tick asks `health.alive`, so a test that only emits the event has a standing corpse.
    const { director, bus } = populated(1, 1);
    const victim = director.bots[0];
    bus.emit(EV.EntityKilled, {
      targetId: victim?.entityId ?? 0,
      sourceId: 0,
      weaponId: 'ar_carbine',
      zone: 'torso',
      killerHealth: 80,
    });
    expect(victim?.participating).toBe(false);
    expect(victim?.state).toBe('DEAD');
    expect(victim?.health.alive).toBe(true);
  });

  it('brings a dead bot back once the timer and the fall are both done', () => {
    const { director, bus } = populated(1, 1);
    const victim = director.bots[0];
    expect(victim).toBeDefined();
    victim?.health.applyDamage(1000);
    bus.emit(EV.EntityKilled, {
      targetId: victim?.entityId ?? 0,
      sourceId: 0,
      weaponId: 'ar_carbine',
      zone: 'torso',
      killerHealth: 80,
    });
    expect(victim?.health.alive).toBe(false);

    const spawns = victim?.visual.spawnSerial ?? 0;
    for (let tick = 1; tick <= 600; tick++) director.simulate(tick, tick * 16);
    expect(victim?.health.alive).toBe(true);
    expect(victim?.visual.spawnSerial).toBeGreaterThan(spawns);
  });

  it('asks the respawn policy first, and keeps a body down when it says no', () => {
    const { director, bus } = populated(1, 1);
    const asked: number[] = [];
    director.respawnPolicy = {
      allowed: (entityId) => {
        asked.push(entityId);
        return false;
      },
      noted: () => undefined,
    };
    const victim = director.bots[0];
    victim?.health.applyDamage(1000);
    bus.emit(EV.EntityKilled, {
      targetId: victim?.entityId ?? 0,
      sourceId: 0,
      weaponId: 'ar_carbine',
      zone: 'torso',
      killerHealth: 80,
    });
    for (let tick = 1; tick <= 600; tick++) director.simulate(tick, tick * 16);
    expect(asked.length).toBeGreaterThan(0);
    expect(victim?.health.alive).toBe(false);
  });

  it('puts everybody back on a spawn for a round boundary, bypassing the gate', () => {
    // With one life per round the gate's answer is permanently "no", which is right for a
    // death mid-round and exactly wrong for the round boundary.
    const { director } = populated(2, 2);
    director.respawnPolicy = { allowed: () => false, noted: () => undefined };
    const before = director.bots.map((b) => b.visual.spawnSerial);
    director.respawnAll();
    expect(director.bots.map((b) => b.visual.spawnSerial)).toEqual(before.map((n) => n + 1));
    for (const bot of director.bots) expect(bot.health.alive).toBe(true);
  });
});

describe('spawn selection through the director', () => {
  it('seats anybody on a side, including the player', () => {
    const { director } = populated(2, 2);
    const out = { x: 0, y: 0, z: 0, yaw: 0, tier: 'safe' as const, nearestEnemy: 0, insideCone: false, visible: false };
    expect(director.selectSpawn('A', 0, out)).toBe(true);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(director.nav.nearestCell(out.x, out.y, out.z)).toBeGreaterThanOrEqual(0);
  });

  it('opens the whole map in free-for-all', () => {
    const { director } = rig();
    expect(director.freeForAll).toBe(false);
    director.freeForAll = true;
    expect(director.freeForAll).toBe(true);
    expect(director.spawns.freeForAll).toBe(true);
  });
});

describe('the report', () => {
  it('tallies per tier and, separately, per tier per side (round 5, B4)', () => {
    const { director } = populated(4, 5);
    const deal = dealTiers(4, 5, MIX);
    const report = director.report();

    expect(report.bots).toBe(9);
    for (const tier of new Set(deal.a)) expect(report.perTier[tier]?.bots).toBeGreaterThan(0);

    // Every side's count in the split table adds back up to the combined one.
    for (const tier of Object.keys(report.perTier)) {
      const both = report.perTier[tier]?.bots ?? 0;
      const a = report.perTeamTier.A[tier]?.bots ?? 0;
      const b = report.perTeamTier.B[tier]?.bots ?? 0;
      expect(a + b).toBe(both);
    }
  });

  it('leaves a tier out of a side that has none of it', () => {
    const { director } = populated(1, 1);
    const report = director.report();
    const dealt = new Set(director.tiersOn('A'));
    for (const tier of Object.keys(report.perTeamTier.A)) expect(dealt.has(tier as BotTier)).toBe(true);
  });

  it('derives the hit rate from the two counters it reports', () => {
    const { director, bus } = populated(2, 2);
    const shooter = director.bots[0];
    bus.emit(EV.WeaponFired, fired(shooter?.entityId ?? 0, { pellets: 10, pelletsHit: 4 }));
    const report = director.report();
    const row = report.perTier[shooter?.tierName ?? 'REGULAR'];
    expect(row?.shotsFired).toBeGreaterThanOrEqual(10);
    expect(row?.hitRate).toBeCloseTo((row?.shotsHit ?? 0) / (row?.shotsFired ?? 1), 12);
  });

  it('reports a zero hit rate rather than a division by zero', () => {
    const { director } = populated(1, 1);
    const report = director.report();
    for (const row of Object.values(report.perTier)) {
      expect(row.shotsFired).toBe(0);
      expect(row.hitRate).toBe(0);
    }
  });

  it('carries the nav, scheduler, A*, spawn and locomotion blocks', () => {
    const { director } = populated(2, 2);
    for (let tick = 1; tick <= 60; tick++) director.simulate(tick, tick * 16);
    const report = director.report();
    expect(report.nav.walkable).toBeGreaterThan(0);
    expect(report.ai.samples).toBeGreaterThan(0);
    expect(report.astar.completed).toBeGreaterThanOrEqual(0);
    expect(report.spawns.selections).toBeGreaterThan(0);
    expect(report.locomotion.travelTicks).toBeGreaterThanOrEqual(0);
    expect(report.stuckEvents).toBeGreaterThanOrEqual(0);
  });

  it('hands out a copy of the spawn stats, not the live object', () => {
    const { director } = populated(1, 1);
    const report = director.report();
    expect(report.spawns).not.toBe(director.spawns.stats);
    expect(report.spawns).toEqual({ ...director.spawns.stats });
  });
});

describe('zeroing the counters between measurements', () => {
  it('clears every per-bot tally the report sums', () => {
    const { director, bus } = populated(2, 2);
    const bot = director.bots[0];
    bus.emit(EV.WeaponFired, fired(bot?.entityId ?? 0, { pellets: 4, pelletsHit: 2 }));
    for (let tick = 1; tick <= 120; tick++) director.simulate(tick, tick * 16);

    director.resetCounters();
    for (const each of director.bots) {
      expect(each.shotsFired).toBe(0);
      expect(each.shotsHit).toBe(0);
      expect(each.kills).toBe(0);
      expect(each.deaths).toBe(0);
      expect(each.damageDealt).toBe(0);
      expect(each.brain.stuckEvents).toBe(0);
      expect(each.brain.pathFailures).toBe(0);
      expect(each.brain.replans).toBe(0);
      expect(each.brain.sprintFlips).toBe(0);
      expect(each.brain.sprintStarts).toBe(0);
      expect(each.brain.sprintTicks).toBe(0);
      expect(each.brain.travelTicks).toBe(0);
      // Backlog #23: the one counter this loop used to miss, so the locomotion block the
      // report prints covers one window in every number rather than seven out of eight.
      expect(each.brain.climbsCompleted).toBe(0);
    }
  });

  it('clears the collaborators’ own stats too', () => {
    const { director } = populated(2, 2);
    for (let tick = 1; tick <= 60; tick++) director.simulate(tick, tick * 16);
    director.resetCounters();
    expect(director.spawns.stats.selections).toBe(0);
    expect(director.report().ai.samples).toBe(0);
  });
});

describe('disposal', () => {
  it('drops the roster and every subscription it owned', () => {
    const { director, bus } = populated(2, 2);
    director.dispose();
    expect(director.botCount).toBe(0);
    // The bus must no longer reach a disposed director.
    expect(() => bus.emit(EV.WeaponFired, fired(100))).not.toThrow();
  });
});
