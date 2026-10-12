import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { createGameBus } from '../core/Events';
import { Btn, isDown } from '../core/InputCommand';
import { DT } from '../core/Loop';
import { DamageSystem } from '../combat/DamageSystem';
import { DEFAULT_HEALTH_CONFIG } from '../player/Health';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import { cloneWeaponDef, requireWeapon } from '../weapons/WeaponDefs';
import { DEFAULT_VIEWMODEL_CONFIG } from '../weapons/ViewmodelConfig';
import { loadMapCollision } from '../world/MapLoader';
import { bakeNavmesh, samplePatrolCells } from '../world/NavBake';
import type { NavGrid } from '../world/NavGrid';
import { GREYBOX_MAP } from '../world/maps/greybox';
import { Bot, type BotDeps } from './Bot';
import { navBakeOptionsFor } from './BotDirector';
import type { BrainDeps } from './BotBrain';
import { CoverIndex } from './Cover';
import { cloneTierTable, DEFAULT_PERCEPTION, DEFAULT_TIERS, type TierTable } from './DifficultyTiers';
import { makeObjectiveTarget, type ObjectiveProvider, type ObjectiveTarget } from './ObjectiveIntent';
import { Pathfinder } from './Pathing';
import { Perception } from './Perception';

/**
 * The decision layer, pinned: `decide` picks a state, `steer` turns it into one command.
 *
 * Both are driven here through the real stack — greybox collision, a baked navmesh, a real
 * `PlayerController` and `WeaponSystem` — for the reason S6.1 gives: the command the brain
 * writes is the command the player's sampler writes, so a test against a stub controller
 * would pin the stub and nothing else.
 *
 * ## The dice
 *
 * Four decisions in `decide` are gated on `bot.rng`: the push, the flank (twice) and the
 * strafe. A test that let them run would pin the seed rather than the logic, so most of the
 * cases below use `CALM`, a tier table with `pushAggression` and `flankChance` at zero —
 * which is how the *order* of the remaining branches becomes observable at all. The dice
 * themselves are pinned separately, by counting what a fixed seed actually does over 120
 * ticks: that count moves if the number or the order of `Rng` calls moves, which is the one
 * failure a refactor of `steer` is most likely to cause and the hardest to see by eye.
 *
 * ## What is deliberately not pinned
 *
 * `trySeekCover` on a live greybox depends on which of the map's authored cover points the
 * navmesh accepted and on a raycast per candidate. The cases here assert the *state* it
 * leaves behind, never a particular slot index.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const COLLISION = loadMapCollision(GREYBOX_MAP);
const NAV: NavGrid = bakeNavmesh(
  COLLISION.collision,
  GREYBOX_MAP.navBounds,
  navBakeOptionsFor(GREYBOX_MAP, DEFAULT_MOVEMENT_CONFIG),
);
const PATROL_CELLS = samplePatrolCells(NAV, 7);

/** Open floor in the middle of the greybox arena, clear of every prop. */
const AT = { x: -20, y: 0.05, z: -14 };

/** Regular, with every die loaded to zero: no push roll, no flank roll, no strafe. */
const CALM: TierTable = (() => {
  const table = cloneTierTable(DEFAULT_TIERS);
  for (const tier of ['RECRUIT', 'REGULAR', 'HARDENED', 'VETERAN'] as const) {
    table[tier].pushAggression = 0;
    table[tier].flankChance = 0;
    table[tier].strafeBias = 0;
  }
  return table;
})();

interface Rig {
  readonly bot: Bot;
  readonly brain: BrainDeps;
  /** What the mode is offering this bot, or null. Read through the `objectives` closure. */
  setObjective(provider: ObjectiveProvider | null): void;
  setStreakObjective(provider: ObjectiveProvider | null): void;
}

function rig(tiers: TierTable = CALM, seed = 1234): Rig {
  const bus = createGameBus();
  let objectives: ObjectiveProvider | null = null;
  let streakObjectives: ObjectiveProvider | null = null;
  const brain: BrainDeps = {
    nav: NAV,
    pathfinder: new Pathfinder(NAV, DEFAULT_MOVEMENT_CONFIG.stepHeight, DEFAULT_MOVEMENT_CONFIG.groundSnapDist),
    cover: new CoverIndex(GREYBOX_MAP.coverPoints, NAV),
    perception: new Perception(COLLISION.collision),
    patrolCells: PATROL_CELLS,
    objectives: () => objectives,
    streakObjectives: () => streakObjectives,
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
    tiers,
    perceptionConfig: DEFAULT_PERCEPTION,
    brain,
  };
  const bot = new Bot({ entityId: 101, displayName: 'BOT ONE', team: 'A', tier: 'REGULAR', seed }, deps);
  bot.spawn(AT.x, AT.y, AT.z, 0);
  return {
    bot,
    brain,
    setObjective: (p) => {
      objectives = p;
    },
    setStreakObjective: (p) => {
      streakObjectives = p;
    },
  };
}

/** A bot that can see something `range` metres east of it. */
function sees(bot: Bot, range: number): void {
  bot.blackboard.noteSighting(2, AT.x + range, 1.6, AT.z, 0, range, 0);
}

/** A bot that believes in a target it can no longer see. */
function remembers(bot: Bot, range: number, sinceLos: number, confidence: number): void {
  sees(bot, range);
  bot.blackboard.hasLos = false;
  bot.blackboard.sinceLos = sinceLos;
  bot.blackboard.confidence = confidence;
}

/** A straight route through the given points, as the pathfinder would have left it. */
function layPath(bot: Bot, points: ReadonlyArray<readonly [number, number, number]>): void {
  points.forEach(([x, y, z], i) => {
    bot.path.x[i] = x;
    bot.path.y[i] = y;
    bot.path.z[i] = z;
  });
  bot.path.count = points.length;
  bot.path.cursor = 0;
  bot.path.goalIndex = NAV.nearestCell(...(points[points.length - 1] ?? [0, 0, 0]));
}

/** A provider that offers one target and records every arrival reported to it. */
function provider(target: ObjectiveTarget): { provider: ObjectiveProvider; arrivals: number } {
  const record = { arrivals: 0 };
  const p: ObjectiveProvider = {
    assign: () => target,
    onArrived: () => {
      record.arrivals++;
    },
  };
  return { provider: p, get arrivals() {
    return record.arrivals;
  } };
}

function steerOnce(bot: Bot, roster: readonly Bot[] = []): void {
  bot.brain.steer(bot, bot.lastCommand as never, roster.length > 0 ? roster : [bot]);
}

/** A whole tick: the controller runs, so the bot actually walks and is actually grounded. */
function tick(bot: Bot, index: number): void {
  bot.beginTick();
  bot.advance(index, index * 16, [bot]);
}

/**
 * A bot that has seen something and is therefore in ENGAGE.
 *
 * Reached by a decision rather than by assignment, because the machine refuses the tactical
 * states to a bot that has just spawned — IDLE reaches neither SUPPRESS nor SEEK_COVER nor
 * PUSH. A test that wrote the state directly would pin an edge that no bot can ever take.
 */
function engaged(r: Rig, range = 10): void {
  sees(r.bot, range);
  r.bot.brain.decide(r.bot);
  expect(r.bot.brain.state).toBe('ENGAGE');
}

describe('a fresh brain', () => {
  it('starts idle with no goal and no diagnostics', () => {
    const { bot } = rig();
    const brain = bot.brain;
    expect(brain.state).toBe('IDLE');
    expect(brain.goal).toBe('NONE');
    expect(brain.stateTime).toBe(0);
    expect([brain.goalCell, brain.coverSlot]).toEqual([-1, -1]);
    expect([brain.stuckEvents, brain.pathFailures, brain.replans, brain.climbsCompleted]).toEqual([0, 0, 0, 0]);
    expect([brain.sprintFlips, brain.sprintStarts, brain.sprintTicks, brain.travelTicks]).toEqual([0, 0, 0, 0]);
    expect([brain.objectiveId, brain.objectiveLabel, brain.objectiveAction]).toEqual(['', '', '']);
  });

  it('is put back to idle by reset, keeping the counters a match reads', () => {
    const { bot } = rig();
    const brain = bot.brain;
    brain.state = 'ENGAGE';
    brain.stateTime = 9;
    brain.goal = 'FLANK';
    brain.goalCell = 42;
    brain.coverSlot = 3;
    brain.stuckEvents = 5;
    brain.reset();
    expect(brain.state).toBe('IDLE');
    expect(brain.stateTime).toBe(0);
    expect(brain.goal).toBe('NONE');
    expect([brain.goalCell, brain.coverSlot]).toEqual([-1, -1]);
    // A diagnostic survives a respawn: the director owns when it is zeroed.
    expect(brain.stuckEvents).toBe(5);
  });
});

describe('deciding, in order of urgency', () => {
  it('sends a dead bot to DEAD before it asks anything else', () => {
    const { bot } = rig();
    sees(bot, 10);
    bot.health.applyDamage(1000);
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('DEAD');
  });

  it('lets a reload in progress own the bot', () => {
    const { bot } = rig();
    sees(bot, 10);
    bot.weapons.weapon.reloading = true;
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('RELOAD');
    expect(bot.brain.goal).toBe('NONE');
  });

  it('reloads a dry magazine when nothing can see it', () => {
    const { bot } = rig();
    bot.weapons.weapon.mag = 0;
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('RELOAD');
  });

  it('reloads a magazine that is merely low, as a fraction of its size (M7)', () => {
    const { bot } = rig();
    // The carbine's 30-round magazine reloads at 8, which is what it did in M3.
    bot.weapons.weapon.mag = 8;
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('RELOAD');
    bot.brain.reset();
    bot.weapons.weapon.mag = 9;
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('PATROL');
  });

  it('refuses to reload with nothing left to reload from', () => {
    const { bot } = rig();
    bot.weapons.weapon.mag = 0;
    bot.weapons.weapon.reserve = 0;
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('PATROL');
  });

  it('keeps shooting a low magazine while the target is in sight', () => {
    const { bot } = rig();
    sees(bot, 10);
    bot.weapons.weapon.mag = 8;
    bot.brain.decide(bot);
    // Low and seeing is not urgent: the engagement wins until the magazine is dry.
    expect(bot.brain.state).toBe('ENGAGE');
  });

  it('takes cover to reload a dry magazine under fire', () => {
    const r = rig();
    engaged(r);
    r.bot.weapons.weapon.mag = 0;
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.state).toBe('SEEK_COVER');
    expect(r.bot.brain.goal).toBe('COVER');
    expect(r.bot.brain.coverSlot).toBeGreaterThanOrEqual(0);
  });

  it('refuses the tactical states to a bot that has only just spawned', () => {
    // The machine's doing, not the brain's: a decision that asks for SUPPRESS out of IDLE is
    // simply not applied, and this is where that becomes visible.
    const { bot } = rig();
    bot.blackboard.noteSighting(2, AT.x + 10, 1.6, AT.z, 0, 10, 0);
    bot.blackboard.hasLos = false;
    bot.blackboard.sinceLos = 1.0;
    bot.blackboard.confidence = 0.9;
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('IDLE');
  });

  it('holds a committed flank through a changing tactical picture (M4)', () => {
    const { bot } = rig();
    bot.brain.state = 'FLANK';
    bot.brain.stateTime = 1;
    layPath(bot, [[AT.x + 4, AT.y, AT.z]]);
    sees(bot, 10);
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('FLANK');
  });

  it('drops a committed flank once it has run long enough', () => {
    const { bot } = rig();
    bot.brain.state = 'FLANK';
    bot.brain.stateTime = 5.5;
    layPath(bot, [[AT.x + 4, AT.y, AT.z]]);
    sees(bot, 10);
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('ENGAGE');
  });

  it('drops a committed flank when badly hurt', () => {
    const { bot } = rig();
    bot.brain.state = 'FLANK';
    bot.brain.stateTime = 1;
    layPath(bot, [[AT.x + 4, AT.y, AT.z]]);
    sees(bot, 10);
    // Health runs to 200, so this is a bot at half, under Regular's 0.65 break point.
    bot.health.applyDamage(100);
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('SEEK_COVER');
  });

  it('keeps a committed flank through a wound that does not reach the break point', () => {
    const { bot } = rig();
    bot.brain.state = 'FLANK';
    bot.brain.stateTime = 1;
    layPath(bot, [[AT.x + 4, AT.y, AT.z]]);
    sees(bot, 10);
    // Exactly at 0.65, which the strict comparison does not call hurt.
    bot.health.applyDamage(70);
    expect(bot.healthFraction).toBe(0.65);
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('FLANK');
  });

  it('engages what it can see', () => {
    const { bot } = rig();
    sees(bot, 10);
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('ENGAGE');
    expect(bot.brain.goal).toBe('NONE');
  });

  it('suppresses the last known position for a beat after losing sight', () => {
    const r = rig();
    engaged(r);
    remembers(r.bot, 10, 1.0, 0.9);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.state).toBe('SUPPRESS');
    expect(r.bot.brain.goal).toBe('NONE');
  });

  it('stops suppressing once the belief is old', () => {
    const r = rig();
    engaged(r);
    remembers(r.bot, 10, 2.0, 0.9);
    r.bot.brain.decide(r.bot);
    // Believed but stale: it goes and looks instead of shooting at a memory.
    expect(r.bot.brain.state).toBe('PUSH');
    expect(r.bot.brain.goal).toBe('PUSH');
  });

  it('stops suppressing once the belief is weak', () => {
    const r = rig();
    engaged(r);
    remembers(r.bot, 10, 1.0, 0.3);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.state).toBe('PUSH');
  });

  it('investigates a position it has not reached yet', () => {
    const { bot } = rig();
    bot.blackboard.noteInvestigate(AT.x + 9, AT.y + 1.2, AT.z);
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('INVESTIGATE');
    expect(bot.brain.goal).toBe('INVESTIGATE');
    expect(bot.brain.goalX).toBe(AT.x + 9);
    expect(bot.brain.goalZ).toBe(AT.z);
  });

  it('forgets an investigation it has already walked into', () => {
    const { bot } = rig();
    bot.blackboard.noteInvestigate(AT.x + 0.3, AT.y, AT.z);
    bot.brain.decide(bot);
    // That is the point of hearing being imprecise: arrive, find nothing, carry on.
    expect(bot.blackboard.investigateValid).toBe(false);
    expect(bot.brain.state).toBe('PATROL');
  });

  it('falls through to a patrol route that crosses the map', () => {
    const { bot } = rig();
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('PATROL');
    expect(bot.brain.goal).toBe('PATROL');
    expect(Math.hypot(bot.brain.goalX - bot.px, bot.brain.goalZ - bot.pz)).toBeGreaterThanOrEqual(7);
  });

  it('keeps a patrol goal it is already walking to', () => {
    const { bot } = rig();
    bot.brain.decide(bot);
    const goal = { x: bot.brain.goalX, z: bot.brain.goalZ };
    layPath(bot, [[goal.x, AT.y, goal.z]]);
    bot.brain.decide(bot);
    expect(bot.brain.goalX).toBe(goal.x);
    expect(bot.brain.goalZ).toBe(goal.z);
  });
});

describe('the job the mode offers (M7)', () => {
  function target(over: Partial<ObjectiveTarget> = {}): ObjectiveTarget {
    return Object.assign(makeObjectiveTarget(), {
      id: 'flag-b',
      label: 'B',
      action: 'capture',
      x: AT.x + 12,
      y: AT.y,
      z: AT.z,
      radius: 2,
      priority: 0.35,
      ...over,
    });
  }

  it('is taken by a bot with nothing better to do', () => {
    const r = rig();
    r.setObjective(provider(target()).provider);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.state).toBe('OBJECTIVE');
    expect(r.bot.brain.goal).toBe('OBJECTIVE');
    // Snapped to the navmesh cell, not to the raw flag position.
    expect(Math.hypot(r.bot.brain.goalX - (AT.x + 12), r.bot.brain.goalZ - AT.z)).toBeLessThan(4);
  });

  it('is reported to the debug panel whether or not it is taken', () => {
    const r = rig();
    r.setObjective(provider(target({ action: 'defuse', label: 'BOMB' })).provider);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.objectiveId).toBe('flag-b');
    expect(r.bot.brain.objectiveLabel).toBe('BOMB');
    expect(r.bot.brain.objectiveAction).toBe('defuse');
  });

  it('is cleared from the panel when no mode is offering anything', () => {
    const r = rig();
    r.setObjective(provider(target()).provider);
    r.bot.brain.decide(r.bot);
    r.setObjective(null);
    r.bot.brain.decide(r.bot);
    expect([r.bot.brain.objectiveId, r.bot.brain.objectiveLabel, r.bot.brain.objectiveAction]).toEqual(['', '', '']);
  });

  it('is refused by a bot in contact when it is not worth breaking off for', () => {
    const r = rig();
    sees(r.bot, 10);
    r.setObjective(provider(target({ priority: 0.35 })).provider);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.state).toBe('ENGAGE');
  });

  it('pulls a bot out of a firefight when the priority earns it', () => {
    const r = rig();
    sees(r.bot, 10);
    r.setObjective(provider(target({ priority: 0.95 })).provider);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.state).toBe('OBJECTIVE');
  });

  it('is asked before the target block, so a defender that only heard something still goes', () => {
    const r = rig();
    // Heard, not seen: this fell into SUPPRESS and returned, and five S&D rounds in a row
    // ended in a detonation with no defuse attempted.
    remembers(r.bot, 10, 1.0, 0.9);
    r.setObjective(provider(target({ priority: 0.95, action: 'defuse' })).provider);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.state).toBe('OBJECTIVE');
  });

  it('reports an arrival every decision while the bot stands on it, and asks for no route', () => {
    const r = rig();
    const p = provider(target({ x: AT.x, z: AT.z, radius: 2 }));
    r.setObjective(p.provider);
    r.bot.brain.decide(r.bot);
    r.bot.brain.decide(r.bot);
    expect(p.arrivals).toBe(2);
    expect(r.bot.brain.state).toBe('OBJECTIVE');
    expect(r.bot.brain.goal).toBe('NONE');
  });

  it('does not count a target on another floor as arrived at', () => {
    const r = rig();
    const p = provider(target({ x: AT.x, z: AT.z, y: AT.y + 6, radius: 2 }));
    r.setObjective(p.provider);
    r.bot.brain.decide(r.bot);
    expect(p.arrivals).toBe(0);
  });

  it('lets a care package outrank the flag the bot was idly holding', () => {
    const r = rig();
    r.setObjective(provider(target({ id: 'flag', priority: 0.3 })).provider);
    r.setStreakObjective(provider(target({ id: 'package', label: 'CARE', priority: 0.8 })).provider);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.objectiveId).toBe('package');
  });

  it('keeps the job the mode offered when the streak offers less', () => {
    const r = rig();
    r.setObjective(provider(target({ id: 'flag', priority: 0.8 })).provider);
    r.setStreakObjective(provider(target({ id: 'package', priority: 0.3 })).provider);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.objectiveId).toBe('flag');
  });
});

describe('asking for a route', () => {
  it('drops the path it is holding when there is nowhere to go', () => {
    const { bot } = rig();
    layPath(bot, [[AT.x + 4, AT.y, AT.z]]);
    bot.brain.requestPath(bot);
    expect(bot.path.count).toBe(0);
    expect(bot.brain.goal).toBe('NONE');
  });

  it('requests one when the goal is reachable, and records the replan', () => {
    const { bot } = rig();
    bot.brain.decide(bot);
    bot.brain.requestPath(bot);
    expect(bot.brain.replans).toBe(1);
    expect(bot.brain.goalCell).toBeGreaterThanOrEqual(0);
  });

  it('gives up on a goal the navmesh does not have a cell for', () => {
    const { bot } = rig();
    bot.brain.decide(bot);
    // Far outside the arena bounds.
    bot.brain.goalX = 5000;
    bot.brain.goalZ = 5000;
    bot.brain.requestPath(bot);
    expect(bot.brain.goal).toBe('NONE');
    expect(bot.brain.pathFailures).toBe(1);
    expect(bot.brain.replans).toBe(0);
  });

  it('asks for nothing while the path it has still leads to the goal', () => {
    const { bot } = rig();
    bot.brain.decide(bot);
    bot.brain.requestPath(bot);
    const cell = bot.brain.goalCell;
    bot.path.count = 2;
    bot.path.cursor = 0;
    bot.path.goalIndex = cell;
    bot.brain.requestPath(bot);
    expect(bot.brain.replans).toBe(1);
  });

  it('says nothing at all for a dead bot', () => {
    const { bot } = rig();
    bot.brain.decide(bot);
    bot.health.applyDamage(1000);
    bot.brain.requestPath(bot);
    expect(bot.brain.replans).toBe(0);
  });

  it('counts a failure and keeps a patrol goal to rotate it', () => {
    const { bot } = rig();
    bot.brain.decide(bot);
    expect(bot.brain.goal).toBe('PATROL');
    bot.brain.onPathFailed();
    expect(bot.brain.pathFailures).toBe(1);
    expect(bot.brain.goal).toBe('PATROL');
  });

  it('drops a tactical goal that could not be reached', () => {
    const { bot } = rig();
    remembers(bot, 10, 2.0, 0.9);
    bot.brain.decide(bot);
    expect(bot.brain.goal).toBe('PUSH');
    bot.brain.onPathFailed();
    expect(bot.brain.goal).toBe('NONE');
    expect(bot.brain.goalCell).toBe(-1);
  });
});

describe('steering a dead bot', () => {
  it('writes the aim and nothing else', () => {
    const { bot } = rig();
    bot.combat.aimYaw = 1.25;
    bot.combat.aimPitch = -0.2;
    bot.brain.state = 'DEAD';
    steerOnce(bot);
    const cmd = bot.lastCommand;
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveZ).toBe(0);
    expect(cmd.buttons).toBe(0);
    expect(cmd.yaw).toBe(1.25);
    expect(cmd.pitch).toBe(-0.2);
    // The clock still runs: `stateTime` is how long the corpse has been one.
    expect(bot.brain.stateTime).toBeCloseTo(DT, 10);
  });

  it('does not count the sprint a bot died holding as a release', () => {
    const { bot } = rig();
    layPath(bot, [[AT.x, AT.y, AT.z - 30]]);
    bot.brain.state = 'PATROL';
    for (let i = 0; i < 60; i++) tick(bot, i);
    expect(bot.brain.sprintFlips).toBe(1);
    bot.brain.state = 'DEAD';
    steerOnce(bot);
    // Dying is not a change of mind, so the falling edge is never counted.
    expect(bot.brain.sprintFlips).toBe(1);
  });
});

describe('steering toward a path', () => {
  it('faces the way it is walking and pushes the stick forward', () => {
    const { bot } = rig();
    layPath(bot, [[AT.x, AT.y, AT.z - 10]]);
    bot.brain.state = 'PATROL';
    for (let i = 0; i < 40; i++) steerOnce(bot);
    const cmd = bot.lastCommand;
    // North is -Z, which is yaw 0 in this project's basis. A patrolling bot also scans, so
    // the facing wanders inside the 26-degree sweep rather than locking on the waypoint.
    expect(Math.abs(cmd.yaw)).toBeLessThan(0.6);
    expect(cmd.moveZ).toBeGreaterThan(0.9);
    // The sideways part is the scan, not a drift: the stick points at the waypoint in the
    // world while the body faces a few degrees off it, exactly as a human's would.
    expect(Math.abs(cmd.moveX)).toBeLessThan(0.25);
    expect(Math.hypot(cmd.moveX, cmd.moveZ)).toBeCloseTo(1, 6);
  });

  it('retires a waypoint it has arrived at', () => {
    const { bot } = rig();
    layPath(bot, [
      [AT.x, AT.y, AT.z - 0.2],
      [AT.x, AT.y, AT.z - 10],
    ]);
    bot.brain.state = 'PATROL';
    steerOnce(bot);
    expect(bot.path.cursor).toBe(1);
  });

  it('counts the ticks in which sprinting was even a question', () => {
    const { bot } = rig();
    layPath(bot, [[AT.x, AT.y, AT.z - 30]]);
    bot.brain.state = 'PATROL';
    for (let i = 0; i < 10; i++) steerOnce(bot);
    expect(bot.brain.travelTicks).toBe(10);
    bot.brain.state = 'ENGAGE';
    for (let i = 0; i < 10; i++) steerOnce(bot);
    expect(bot.brain.travelTicks).toBe(10);
  });

  it('holds the sprint through the band a cornering stick wobbles in (M13)', () => {
    const { bot } = rig();
    layPath(bot, [[AT.x, AT.y, AT.z - 30]]);
    bot.brain.state = 'PATROL';
    // Real ticks: the sprint needs the bot grounded, which only the controller can say.
    for (let i = 0; i < 60; i++) tick(bot, i);
    expect(isDown(bot.lastCommand.buttons, Btn.Sprint)).toBe(true);
    // One rising edge and no falling one over a whole second of travel. Before the Schmitt
    // trigger this was an edge per travelling bot-second and a mean sprint 0.48 s long.
    expect(bot.brain.sprintStarts).toBe(1);
    expect(bot.brain.sprintFlips).toBe(1);
    expect(bot.brain.sprintTicks).toBe(55);
    expect(bot.brain.travelTicks).toBe(60);
  });

  it('never sprints while shooting, nor on a route that is nearly over', () => {
    const { bot } = rig();
    layPath(bot, [[AT.x, AT.y, AT.z - 30]]);
    bot.brain.state = 'PATROL';
    for (let i = 0; i < 60; i++) tick(bot, i);
    expect(isDown(bot.lastCommand.buttons, Btn.Sprint)).toBe(true);

    bot.brain.state = 'PUSH';
    sees(bot, 10);
    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Sprint)).toBe(false);

    layPath(bot, [[bot.px, AT.y, bot.pz - 2]]);
    bot.brain.state = 'PATROL';
    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Sprint)).toBe(false);
  });

  it('presses jump on a cadence at the foot of a ledge, never holds it (M8)', () => {
    const { bot } = rig();
    // A waypoint a metre up and half a metre ahead: arrived in plan, not in height.
    layPath(bot, [[AT.x, AT.y + 1.0, AT.z - 0.5]]);
    bot.brain.state = 'PATROL';
    const pressed: number[] = [];
    for (let index = 1; index <= 26; index++) {
      // The controller is not stepped here, so the ground flag is stated rather than earned:
      // what is being pinned is the cadence, not the locomotion.
      bot.controller.sim.grounded = true;
      steerOnce(bot);
      if (isDown(bot.lastCommand.buttons, Btn.Jump)) pressed.push(index);
    }
    // Every twelfth tick, because a mantle fires on the press edge and a held button
    // climbs once and then does nothing at all.
    expect(pressed).toEqual([1, 13, 25]);
  });

  it('counts a climb where it lands, not where it was attempted', () => {
    const { bot } = rig();
    layPath(bot, [[AT.x, AT.y + 1.0, AT.z - 0.5]]);
    bot.brain.state = 'PATROL';
    steerOnce(bot);
    bot.path.clear();
    steerOnce(bot);
    // The bot never got up there, so the Depot verticality read-out must not claim it did.
    expect(bot.brain.climbsCompleted).toBe(0);
  });
});

describe('steering in a firefight', () => {
  it('aims at the target it can see', () => {
    const { bot } = rig();
    sees(bot, 12);
    bot.brain.state = 'ENGAGE';
    for (let i = 0; i < 60; i++) steerOnce(bot);
    // The target is due east, which is yaw -pi/2 in this basis.
    expect(bot.lastCommand.yaw).toBeLessThan(-1);
    expect(bot.lastCommand.yaw).toBeGreaterThan(-2);
  });

  it('shoots at a remembered position while suppressing, with no line of sight', () => {
    const r = rig();
    engaged(r, 12);
    remembers(r.bot, 12, 0.5, 0.9);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.state).toBe('SUPPRESS');
    // The reaction delay S6.3 specifies is paid by `Perception`, which is not running here.
    r.bot.blackboard.armReaction(0);
    let fired = 0;
    for (let i = 0; i < 180; i++) {
      steerOnce(r.bot);
      if (isDown(r.bot.lastCommand.buttons, Btn.Fire)) fired++;
    }
    // Three seconds of fire with the bursts and pauses the tier draws: SUPPRESS is the one
    // state that shoots without a line, which is what makes a lost contact cost the player.
    expect(fired).toBe(164);
  });

  it('holds its trigger with no target at all', () => {
    const { bot } = rig();
    bot.brain.state = 'ENGAGE';
    for (let i = 0; i < 60; i++) {
      steerOnce(bot);
      expect(isDown(bot.lastCommand.buttons, Btn.Fire)).toBe(false);
    }
  });

  it('strafes under a tier that rolls for it, and the dice are the same dice', () => {
    const { bot } = rig(DEFAULT_TIERS, 4242);
    sees(bot, 12);
    bot.brain.state = 'ENGAGE';
    let lateral = 0;
    for (let i = 0; i < 120; i++) {
      steerOnce(bot);
      if (Math.abs(bot.lastCommand.moveX) > 1e-6) lateral++;
    }
    // A fixed seed through the real Regular tier: this count moves if the number or the
    // order of `Rng` calls in `steer` moves, which is the failure hardest to see by eye.
    expect(lateral).toBe(55);
  });

  it('does not strafe under a tier that never rolls for it', () => {
    const { bot } = rig();
    sees(bot, 12);
    bot.brain.state = 'ENGAGE';
    for (let i = 0; i < 120; i++) {
      steerOnce(bot);
      expect(bot.lastCommand.moveX).toBe(0);
      expect(bot.lastCommand.moveZ).toBe(0);
    }
  });
});

describe('steering out of a crowd', () => {
  it('pushes away from a teammate standing on top of it', () => {
    const a = rig().bot;
    const b = rig().bot;
    b.spawn(AT.x + 0.5, AT.y, AT.z, 0);
    a.brain.state = 'ENGAGE';
    steerOnce(a, [a, b]);
    // Pushed west, away from the body to its east, with no path and no strafe in play.
    expect(a.lastCommand.moveX !== 0 || a.lastCommand.moveZ !== 0).toBe(true);
  });

  it('ignores a body that is far enough away, and a dead one on its feet', () => {
    const a = rig().bot;
    const b = rig().bot;
    b.spawn(AT.x + 3, AT.y, AT.z, 0);
    a.brain.state = 'ENGAGE';
    steerOnce(a, [a, b]);
    expect(a.lastCommand.moveX).toBe(0);
    expect(a.lastCommand.moveZ).toBe(0);

    b.spawn(AT.x + 0.5, AT.y, AT.z, 0);
    b.health.applyDamage(1000);
    steerOnce(a, [a, b]);
    expect(a.lastCommand.moveX).toBe(0);
    expect(a.lastCommand.moveZ).toBe(0);
  });
});

describe('the reload press', () => {
  it('is an edge held for exactly one tick', () => {
    const { bot } = rig();
    bot.weapons.weapon.mag = 0;
    bot.brain.decide(bot);
    expect(bot.brain.state).toBe('RELOAD');

    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Reload)).toBe(true);
    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Reload)).toBe(false);
    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Reload)).toBe(false);
  });

  it('is dropped once the reload it asked for is running', () => {
    const { bot } = rig();
    bot.weapons.weapon.mag = 0;
    bot.brain.decide(bot);
    bot.weapons.weapon.reloading = true;
    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Reload)).toBe(false);
    bot.weapons.weapon.reloading = false;
    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Reload)).toBe(false);
  });

  it('crouches to reload where nothing can see it', () => {
    const { bot } = rig();
    bot.brain.state = 'RELOAD';
    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Crouch)).toBe(true);
    bot.blackboard.hasLos = true;
    steerOnce(bot);
    expect(isDown(bot.lastCommand.buttons, Btn.Crouch)).toBe(false);
  });
});

describe('a bot that is not making progress', () => {
  it('abandons the path and rotates a patrol goal', () => {
    const { bot } = rig();
    bot.brain.decide(bot);
    const first = { x: bot.brain.goalX, z: bot.brain.goalZ };
    layPath(bot, [[AT.x, AT.y, AT.z - 30]]);
    bot.brain.state = 'PATROL';
    // Steered without ever advancing the controller: the bot stands still with a good path,
    // which is exactly what a bot wedged on a corner looks like from the follower's side.
    // Two windows, not one: the first closes against a mark that is still at the origin, so
    // the bot looks like it has crossed the map and only the second window can accuse it.
    for (let i = 0; i < 65; i++) steerOnce(bot);
    expect(bot.brain.stuckEvents).toBe(0);
    steerOnce(bot);
    expect(bot.brain.stuckEvents).toBe(1);
    expect(bot.path.count).toBe(0);
    expect(bot.brain.goal).toBe('PATROL');
    expect({ x: bot.brain.goalX, z: bot.brain.goalZ }).not.toEqual(first);
  });

  it('drops a tactical goal instead of retrying the same route', () => {
    const r = rig();
    engaged(r);
    remembers(r.bot, 10, 2.0, 0.9);
    r.bot.brain.decide(r.bot);
    expect(r.bot.brain.goal).toBe('PUSH');
    layPath(r.bot, [[AT.x, AT.y, AT.z - 30]]);
    for (let i = 0; i < 70; i++) steerOnce(r.bot);
    expect(r.bot.brain.stuckEvents).toBe(1);
    expect(r.bot.brain.goal).toBe('NONE');
  });

  it('is not called stuck while it has no path to be stuck on', () => {
    const { bot } = rig();
    bot.brain.state = 'PATROL';
    for (let i = 0; i < 120; i++) steerOnce(bot);
    expect(bot.brain.stuckEvents).toBe(0);
  });
});
