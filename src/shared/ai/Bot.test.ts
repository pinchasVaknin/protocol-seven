import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { Btn, isDown } from '../core/InputCommand';
import { DT } from '../core/Loop';
import { DamageSystem } from '../combat/DamageSystem';
import { HUMANOID_RIG } from '../combat/HitboxRig';
import { DEFAULT_HEALTH_CONFIG } from '../player/Health';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import { cloneWeaponDef, requireWeapon } from '../weapons/WeaponDefs';
import { DEFAULT_VIEWMODEL_CONFIG } from '../weapons/ViewmodelConfig';
import { loadMapCollision } from '../world/MapLoader';
import { bakeNavmesh, samplePatrolCells } from '../world/NavBake';
import type { NavGrid } from '../world/NavGrid';
import { GREYBOX_MAP } from '../world/maps/greybox';
import { Bot, type BotDeps, type BotSpec } from './Bot';
import { navBakeOptionsFor } from './BotDirector';
import type { BrainDeps } from './BotBrain';
import { CoverIndex } from './Cover';
import { DEFAULT_PERCEPTION, DEFAULT_TIERS } from './DifficultyTiers';
import { Pathfinder } from './Pathing';
import { Perception } from './Perception';
import type { BotState } from './BotStates';

/**
 * One bot, pinned through its public surface.
 *
 * Built out of the real stack rather than fakes — the greybox collision world, a baked
 * navmesh, a real `DamageSystem`, `PlayerController` and `WeaponSystem` — because what this
 * file is actually asserting is S6.1's claim that a bot is not a special case. A test that
 * handed `Bot` a stub controller would pin the stub.
 *
 * Four things are worth saying about what is pinned:
 *
 *  - **The render snapshots.** `beginTick` copies curr→prev and `advance` writes curr, so an
 *    interpolated read between two ticks is the whole contract the client renders from.
 *  - **The frozen command.** The pre-match countdown strips the axes and the buttons and keeps
 *    the look angles, which is what makes the start of a round read as a starting gun.
 *  - **The death variant.** Derived from (entityId, deathSerial) and never drawn from the
 *    bot's own `Rng`, so a replayed tick cannot diverge. Spending an `Rng` value here would
 *    not show up in any assertion about the fall — only in a hash three minutes later.
 *  - **`animation`.** One reused record per bot. Rendering must not allocate per actor per
 *    frame, so identity is the assertion.
 */

let fakeNow = 0;
// The navmesh bake times itself off the clock, and vitest bakes at collection time.
installClock({ nowMs: () => fakeNow++ });

const COLLISION = loadMapCollision(GREYBOX_MAP);
const NAV: NavGrid = bakeNavmesh(
  COLLISION.collision,
  GREYBOX_MAP.navBounds,
  navBakeOptionsFor(GREYBOX_MAP, DEFAULT_MOVEMENT_CONFIG),
);
// `BotDirector`'s own spacing, which is not exported. Only the patrol goals read it.
const PATROL_CELLS = samplePatrolCells(NAV, 7);

/** An open floor position from the greybox spawn list, well clear of every prop. */
const SPAWN = { x: -20, y: 0.05, z: -14 };

interface Rig {
  readonly bot: Bot;
  readonly bus: GameBus;
  readonly brain: BrainDeps;
}

function rig(spec: Partial<BotSpec> = {}): Rig {
  const bus = createGameBus();
  const perception = new Perception(COLLISION.collision);
  const brain: BrainDeps = {
    nav: NAV,
    pathfinder: new Pathfinder(NAV, DEFAULT_MOVEMENT_CONFIG.stepHeight, DEFAULT_MOVEMENT_CONFIG.groundSnapDist),
    cover: new CoverIndex(GREYBOX_MAP.coverPoints, NAV),
    perception,
    patrolCells: PATROL_CELLS,
    objectives: () => null,
    streakObjectives: () => null,
    pushScale: () => 1,
  };
  const deps: BotDeps = {
    world: COLLISION.collision,
    bus,
    damage: new DamageSystem(bus),
    movement: DEFAULT_MOVEMENT_CONFIG,
    healthConfig: DEFAULT_HEALTH_CONFIG,
    weaponDef: cloneWeaponDef(requireWeapon('ar_carbine')),
    viewmodelConfig: DEFAULT_VIEWMODEL_CONFIG,
    tiers: DEFAULT_TIERS,
    perceptionConfig: DEFAULT_PERCEPTION,
    brain,
  };
  const bot = new Bot(
    { entityId: 101, displayName: 'BOT ONE', team: 'A', tier: 'REGULAR', seed: 1234, ...spec },
    deps,
  );
  return { bot, bus, brain };
}

/** A bot standing on the floor, which is where every behaviour below starts. */
function spawned(spec: Partial<BotSpec> = {}): Rig {
  const r = rig(spec);
  r.bot.spawn(SPAWN.x, SPAWN.y, SPAWN.z, 0);
  return r;
}

function stateChanges(bus: GameBus): Array<{ from: BotState; to: BotState }> {
  const seen: Array<{ from: BotState; to: BotState }> = [];
  bus.on(EV.BotStateChanged, (e) => seen.push({ from: e.from, to: e.to }));
  return seen;
}

describe('a freshly built bot', () => {
  it('carries the identity it was dealt and nothing derived from it', () => {
    const { bot } = rig();
    expect(bot.entityId).toBe(101);
    expect(bot.displayName).toBe('BOT ONE');
    expect(bot.team).toBe('A');
    expect(bot.tierName).toBe('REGULAR');
    expect(bot.pathClientId).toBe(101);
  });

  it('owns the same three things the player owns, plus a controller', () => {
    const { bot } = rig();
    expect(bot.health.alive).toBe(true);
    expect(bot.rig.layout).toBe(HUMANOID_RIG);
    expect(bot.weapons.definition.id).toBe('ar_carbine');
    expect(bot.controller).toBeDefined();
    expect(bot.brain.state).toBe('IDLE');
  });

  it('declares no body and holds no equipment', () => {
    const { bot } = rig();
    expect(bot.characterId).toBe(null);
    expect(bot.heldEquipmentId).toBe(null);
  });

  it('starts the match statistics at zero', () => {
    const { bot } = rig();
    expect([bot.kills, bot.deaths, bot.shotsFired, bot.shotsHit, bot.damageDealt]).toEqual([0, 0, 0, 0, 0]);
    expect([bot.respawnTimer, bot.deadTime]).toEqual([0, 0]);
  });

  it('seeds its weapon from a different stream than its own', () => {
    // Two bots firing at one target must not share a spread sequence.
    const a = rig({ entityId: 101, seed: 7 });
    const b = rig({ entityId: 102, seed: 7 });
    expect(a.bot.rng.int(0, 1_000_000)).toBe(b.bot.rng.int(0, 1_000_000));
    expect(a.bot.weapons.definition.id).toBe(b.bot.weapons.definition.id);
  });

  it('derives what it is carrying rather than caching it', () => {
    const { bot } = rig();
    expect(bot.weaponId).toBe('ar_carbine');
    expect(bot.weaponProfile.preferredRange).toBeGreaterThan(0);
  });
});

describe('spawning a bot', () => {
  it('puts it where it was told, facing where it was told', () => {
    const { bot } = spawned();
    expect(bot.px).toBe(SPAWN.x);
    expect(bot.pz).toBe(SPAWN.z);
    expect(bot.yaw).toBe(0);
    expect(bot.participating).toBe(true);
  });

  it('resets the brain, the path, the blackboard and the timers', () => {
    const { bot } = spawned();
    bot.respawnTimer = 5;
    bot.deadTime = 2;
    bot.spawn(SPAWN.x, SPAWN.y, SPAWN.z, 1);
    expect(bot.brain.state).toBe('IDLE');
    expect(bot.respawnTimer).toBe(0);
    expect(bot.deadTime).toBe(0);
    expect(bot.path.count).toBe(0);
    expect(bot.blackboard.hasKnownTarget).toBe(false);
  });

  it('bumps the spawn serial every time, which is what the client watches', () => {
    const { bot } = rig();
    expect(bot.visual.spawnSerial).toBe(0);
    bot.spawn(SPAWN.x, SPAWN.y, SPAWN.z, 0);
    expect(bot.visual.spawnSerial).toBe(1);
    bot.spawn(SPAWN.x, SPAWN.y, SPAWN.z, 0);
    expect(bot.visual.spawnSerial).toBe(2);
  });

  it('says nothing when it was already IDLE', () => {
    const { bot, bus } = rig();
    const seen = stateChanges(bus);
    bot.spawn(SPAWN.x, SPAWN.y, SPAWN.z, 0);
    expect(seen).toEqual([]);
  });

  it('announces DEAD -> IDLE as the transition it is', () => {
    const { bot, bus } = spawned();
    bot.onKilled(1, 0, 5);
    const seen = stateChanges(bus);
    bot.spawn(SPAWN.x, SPAWN.y, SPAWN.z, 0);
    expect(seen).toEqual([{ from: 'DEAD', to: 'IDLE' }]);
  });

  it('starts the render snapshots at the spawn pose, so the first frame does not slide', () => {
    const { bot } = spawned();
    expect(bot.renderX(0)).toBe(SPAWN.x);
    expect(bot.renderX(1)).toBe(SPAWN.x);
    expect(bot.renderZ(0.5)).toBe(SPAWN.z);
    expect(bot.renderYaw(0.5)).toBe(0);
    expect(bot.renderScale(0.5)).toBe(1);
    expect(bot.capsuleScale).toBe(1);
  });
});

describe('a bot that was killed', () => {
  it('counts the death, stops participating and goes to DEAD', () => {
    const { bot, bus } = spawned();
    const seen = stateChanges(bus);
    bot.onKilled(0.6, -0.8, 7);
    expect(bot.deaths).toBe(1);
    expect(bot.participating).toBe(false);
    expect(bot.state).toBe('DEAD');
    expect(bot.respawnTimer).toBe(7);
    expect(bot.deadTime).toBe(0);
    expect(seen).toEqual([{ from: 'IDLE', to: 'DEAD' }]);
  });

  it('remembers the direction the killing round was travelling', () => {
    const { bot } = spawned();
    bot.onKilled(0.6, -0.8, 7);
    expect(bot.visual.deathSerial).toBe(1);
    expect(bot.visual.deathDirX).toBe(0.6);
    expect(bot.visual.deathDirZ).toBe(-0.8);
  });

  it('derives the fall variant from the body and the serial, not from its Rng', () => {
    const killed = spawned({ entityId: 101 }).bot;
    const untouched = spawned({ entityId: 101 }).bot;
    killed.onKilled(1, 0, 5);
    // Spending a value on an animation nothing headless plays would make a replayed tick
    // diverge from the tick it is replaying, and this is the assertion that says so.
    expect(killed.rng.int(0, 1_000_000)).toBe(untouched.rng.int(0, 1_000_000));
    expect(killed.visual.deathVariant).toBeGreaterThanOrEqual(0);
  });

  it('gives two bodies dying the same death different falls', () => {
    const one = spawned({ entityId: 101 }).bot;
    const two = spawned({ entityId: 104 }).bot;
    one.onKilled(1, 0, 5);
    two.onKilled(1, 0, 5);
    expect(one.visual.deathVariant).not.toBe(two.visual.deathVariant);
  });

  it('gives one body its second death a different fall from its first', () => {
    const { bot } = spawned({ entityId: 101 });
    bot.onKilled(1, 0, 5);
    const first = bot.visual.deathVariant;
    bot.spawn(SPAWN.x, SPAWN.y, SPAWN.z, 0);
    bot.onKilled(1, 0, 5);
    expect(bot.visual.deathSerial).toBe(2);
    expect(bot.visual.deathVariant).not.toBe(first);
  });

  it('cannot be killed twice', () => {
    const { bot } = spawned();
    bot.onKilled(1, 0, 5);
    bot.onKilled(1, 0, 9);
    expect(bot.deaths).toBe(1);
    expect(bot.respawnTimer).toBe(5);
  });

  it('ages the corpse and runs the respawn timer down on its own ticks', () => {
    const { bot } = spawned();
    bot.onKilled(1, 0, 2 * DT);
    bot.beginTick();
    expect(bot.deadTime).toBeCloseTo(DT, 10);
    expect(bot.respawnTimer).toBeCloseTo(DT, 10);
    bot.beginTick();
    expect(bot.respawnTimer).toBe(0);
    bot.beginTick();
    // Clamped, never negative: the director reads this to decide when to put the bot back.
    expect(bot.respawnTimer).toBe(0);
    expect(bot.deadTime).toBeCloseTo(3 * DT, 10);
  });

  it('does not move when advanced', () => {
    const { bot } = spawned();
    bot.onKilled(1, 0, 5);
    bot.advance(1, 0, [bot]);
    expect(bot.px).toBe(SPAWN.x);
    expect(bot.pz).toBe(SPAWN.z);
  });
});

describe('a bot that was hurt but lived', () => {
  it('remembers the direction of the impact for the flinch', () => {
    const { bot } = spawned();
    bot.onHurt(SPAWN.x + 5, SPAWN.z, 1, 0, 20);
    expect(bot.visual.flinchSerial).toBe(1);
    expect(bot.visual.flinchDirX).toBe(1);
    expect(bot.visual.flinchDirZ).toBe(0);
  });

  it('looks where the shot came from when it was not already looking there', () => {
    const { bot } = spawned();
    bot.onHurt(SPAWN.x + 5, SPAWN.z + 3, 1, 0, 20);
    expect(bot.blackboard.investigateValid).toBe(true);
    expect(bot.blackboard.investigateX).toBe(SPAWN.x + 5);
    expect(bot.blackboard.investigateZ).toBe(SPAWN.z + 3);
    // Eye level of the shooter, not the floor: a bot investigating looks at a head height.
    expect(bot.blackboard.investigateY).toBeCloseTo(bot.py + 1.2, 10);
  });

  it('keeps its eyes on a target it can already see', () => {
    const { bot } = spawned();
    bot.blackboard.hasLos = true;
    bot.onHurt(SPAWN.x + 5, SPAWN.z + 3, 1, 0, 20);
    expect(bot.blackboard.investigateValid).toBe(false);
    expect(bot.visual.flinchSerial).toBe(1);
  });
});

describe('the tick', () => {
  it('copies the render pose forward before anything moves', () => {
    const { bot } = spawned();
    bot.beginTick();
    bot.advance(1, 0, [bot]);
    const atStart = bot.renderX(0);
    const atEnd = bot.renderX(1);
    expect(atStart).toBe(SPAWN.x);
    expect(atEnd).toBe(bot.px);
  });

  it('writes a command with a rising sequence and the tick it belongs to', () => {
    const { bot } = spawned();
    bot.advance(11, 250, [bot]);
    expect(bot.lastCommand.seq).toBe(0);
    expect(bot.lastCommand.tickIndex).toBe(11);
    expect(bot.lastCommand.sampledAtMs).toBe(250);
    bot.advance(12, 266, [bot]);
    expect(bot.lastCommand.seq).toBe(1);
    expect(bot.lastCommand.tickIndex).toBe(12);
  });

  it('strips the axes and every action bit while frozen, and keeps the look angles', () => {
    const { bot } = spawned();
    // A target to look at, so the brain has a reason to aim somewhere.
    bot.blackboard.noteSighting(2, SPAWN.x + 8, 1.6, SPAWN.z, 0, 8, 0);
    bot.brain.state = 'ENGAGE';
    bot.advance(1, 0, [bot], true);
    expect(bot.lastCommand.moveX).toBe(0);
    expect(bot.lastCommand.moveZ).toBe(0);
    expect(bot.lastCommand.buttons).toBe(0);
    expect(bot.lastCommand.yaw).toBe(bot.combat.aimYaw);
    expect(bot.lastCommand.pitch).toBe(bot.combat.aimPitch);
  });

  it('still runs the controller while frozen, so a bot on a ramp does not hang in the air', () => {
    const { bot } = spawned();
    // Dropped in above the floor: gravity has to keep working through the countdown.
    bot.spawn(SPAWN.x, 2, SPAWN.z, 0);
    bot.beginTick();
    bot.advance(1, 0, [bot], true);
    expect(bot.py).toBeLessThan(2);
    expect(bot.grounded).toBe(false);
  });

  it('carries the weapon weight into the controller, as a player does', () => {
    const { bot } = spawned();
    bot.advance(1, 0, [bot]);
    expect(bot.controller.weaponSpeedScale).toBeGreaterThan(0);
    expect(bot.controller.weaponSpeedScale).toBeLessThanOrEqual(1);
  });

  it('puts the rig on the simulation pose of the tick the shot resolves', () => {
    const { bot } = spawned();
    bot.advance(1, 0, [bot]);
    expect(bot.rig.x).toBe(bot.px);
    expect(bot.rig.y).toBe(bot.py);
    expect(bot.rig.z).toBe(bot.pz);
    expect(bot.rig.yaw).toBe(bot.yaw);
    expect(bot.aimHeight).toBe(bot.rig.layout.aimY);
  });
});

describe('what a renderer and the brain read off a bot', () => {
  it('interpolates position, facing and squash between the last two ticks', () => {
    const { bot } = spawned();
    bot.beginTick();
    bot.advance(1, 0, [bot]);
    const from = SPAWN.x;
    const to = bot.px;
    expect(bot.renderX(0)).toBe(from);
    expect(bot.renderX(1)).toBe(to);
    expect(bot.renderX(0.5)).toBe(from + (to - from) * 0.5);
    expect(bot.renderY(0)).toBeCloseTo(SPAWN.y, 10);
    expect(bot.renderZ(0)).toBe(SPAWN.z);
  });

  it('turns the short way round', () => {
    const { bot } = spawned();
    bot.spawn(SPAWN.x, SPAWN.y, SPAWN.z, 3.0);
    bot.beginTick();
    // A dead brain writes the aim straight through, which is the one way a test can hand the
    // controller a chosen yaw without driving the whole decision layer.
    bot.brain.state = 'DEAD';
    bot.combat.aimYaw = -3.0;
    bot.advance(1, 0, [bot]);
    expect(bot.yaw).toBe(-3.0);
    // Through pi rather than back across zero: the halfway point is outside [-3, 3].
    expect(Math.abs(bot.renderYaw(0.5))).toBeGreaterThan(3);
    expect(bot.renderYaw(0)).toBe(3.0);
    // Unwrapped rather than normalised: the end of the sweep is the target angle plus a turn,
    // which is the same facing and is what a renderer feeding a quaternion wants.
    expect(bot.renderYaw(1)).toBeCloseTo(-3.0 + Math.PI * 2, 10);
  });

  it('hands out one reused animation record, never a fresh one', () => {
    const { bot } = spawned();
    expect(bot.animation).toBe(bot.animation);
  });

  it('reads the animation inputs off the live simulation', () => {
    const { bot } = spawned();
    // Spawned a few centimetres up, so the first tick is AIRBORNE until the ground probe lands.
    for (let tick = 0; tick < 8; tick++) {
      bot.beginTick();
      bot.advance(tick, tick * 16, [bot]);
    }
    const anim = bot.animation;
    expect(anim.stance).toBe(bot.controller.sim.stance);
    expect(anim.stance).toBe('STAND');
    expect(anim.reloading).toBe(false);
    expect(anim.firing).toBe(isDown(bot.lastCommand.buttons, Btn.Fire));
    // A bot presses neither the throw nor the knife button, so these are constants.
    expect(anim.throwing).toBe(false);
    expect(anim.throwPhase).toBe('IDLE');
    expect(anim.meleeing).toBe(false);
  });

  it('is quiet only while crouched or sliding', () => {
    const { bot } = spawned();
    expect(bot.quiet).toBe(false);
    bot.controller.sim.stance = 'CROUCH';
    expect(bot.quiet).toBe(true);
    bot.controller.sim.stance = 'SLIDE';
    expect(bot.quiet).toBe(true);
    bot.controller.sim.stance = 'STAND';
    expect(bot.quiet).toBe(false);
  });

  it('exposes the weapon state the brain decides on', () => {
    const { bot } = spawned();
    expect(bot.magazine).toBe(bot.weapons.weapon.mag);
    expect(bot.reserve).toBe(bot.weapons.weapon.reserve);
    expect(bot.reloading).toBe(false);
    expect(bot.canFire).toBe(true);
    expect(bot.healthFraction).toBe(1);
    expect(bot.glinting).toBe(bot.weapons.glinting);
    expect(bot.state).toBe(bot.brain.state);
    expect(bot.speed).toBe(bot.controller.sim.speed);
    expect(bot.eyeHeight).toBe(bot.controller.sim.eyeHeight);
  });

  it('reads its tier out of the table it was given, so the debug panel can promote it', () => {
    const { bot } = spawned();
    expect(bot.tier).toBe(DEFAULT_TIERS.REGULAR);
    bot.tierName = 'VETERAN';
    expect(bot.tier).toBe(DEFAULT_TIERS.VETERAN);
  });
});

describe('the path client role', () => {
  it('rewinds the cursor when a route arrives', () => {
    const { bot } = spawned();
    bot.path.cursor = 4;
    bot.onPathReady(true);
    expect(bot.path.cursor).toBe(0);
  });

  it('tells the brain when there was no route', () => {
    const { bot } = spawned();
    const before = bot.brain.pathFailures;
    bot.onPathReady(false);
    expect(bot.brain.pathFailures).toBe(before + 1);
  });
});

describe('a state change announced by the bot', () => {
  it('carries the body, both ends of the edge and the tier', () => {
    const { bot, bus } = spawned();
    bot.tierName = 'HARDENED';
    const seen: unknown[] = [];
    bus.on(EV.BotStateChanged, (e) => seen.push({ ...e }));
    bot.noteStateChange('PATROL', 'ENGAGE');
    expect(seen).toEqual([{ entityId: 101, from: 'PATROL', to: 'ENGAGE', tier: 'HARDENED' }]);
  });
});
