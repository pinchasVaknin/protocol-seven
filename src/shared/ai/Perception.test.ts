import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { Rng } from '../core/Rng';
import { Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { BotBlackboard } from './BotBlackboard';
import type { Combatant } from './Combatant';
import { DEFAULT_PERCEPTION, DEFAULT_TIERS } from './DifficultyTiers';
import { NoiseKind, Perception, type SightOccluder } from './Perception';

/**
 * Sight and hearing, pinned.
 *
 * Everything in this file protects one property: **a bot can be beaten by breaking line of
 * sight**. So the tests are mostly about the ways sight is refused — out of the cone, out of
 * range, behind geometry, inside smoke, or because the bot has been flashed — and about the one
 * thing that bypasses the cone on purpose, a scope glint.
 *
 * Three design decisions get a test each because they are cheap to lose:
 *
 * **Two rays, chest then head.** One ray at chest height calls a bot blind to anyone whose
 * chest is behind a barrier but whose head is over it, which on this map is most of the
 * interesting cases — and the aim point has to move to what is actually exposed.
 *
 * **Smoke is checked after the geometry ray, not instead of it.** Running it first would pay
 * for a volume walk on every candidate a wall was going to reject anyway.
 *
 * **Hearing produces a place to look, never a target.** A heard noise is an investigate
 * position; nothing about it sets `targetId`.
 */

const CFG = DEFAULT_PERCEPTION;
const TIER = DEFAULT_TIERS.REGULAR;
const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };
const BOUNDS = { min: { x: -80, y: -8, z: -80 }, max: { x: 80, y: 16, z: 80 } };

/** A world with a floor whose top face is y = 0, plus whatever else the test asks for. */
function world(...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>) {
  const set = new ColliderSet(boxes.length + 2);
  set.add({ x: 0, y: -0.5, z: 0 }, { x: 160, y: 1, z: 160 }, 0, 0, 0, 'floor');
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  return new CollisionWorld(set, BOUNDS, 4);
}

/**
 * A body at `(x, 0, z)` on `team`, facing yaw 0 — which looks down -Z everywhere in this
 * project, so a bot at the origin is looking at anything with a negative z.
 */
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

interface Arena {
  readonly perception: Perception;
  readonly self: Combatant;
  readonly bb: BotBlackboard;
  readonly rng: Rng;
}

function arena(cw = world(), selfOver: Partial<Combatant> = {}): Arena {
  return {
    perception: new Perception(cw),
    self: combatant(1, 'A', 0, 0, selfOver),
    bb: new BotBlackboard(),
    rng: new Rng(4242),
  };
}

/** One perception sample over `roster`, at the scheduler's own interval. */
function sense(a: Arena, roster: readonly Combatant[]): void {
  a.perception.sense(a.self, a.bb, roster, CFG, TIER, a.rng, 0.1);
}

/** An occluder that blocks everything, like standing inside a grown cloud. */
const SOLID_SMOKE: SightOccluder = { blocksSight: () => true };

describe('a bot with nobody to see', () => {
  it('sees nothing and reports nothing', () => {
    const a = arena();
    sense(a, [a.self]);
    expect(a.bb.visibleEnemies).toBe(0);
    expect(a.bb.hasLos).toBe(false);
    expect(a.bb.targetId).toBe(-1);
    expect(a.perception.stats.sightings).toBe(0);
  });
});

describe('an enemy in the open', () => {
  it('is seen, and the blackboard is told where and how far', () => {
    const a = arena();
    const enemy = combatant(2, 'B', 0, -10);
    sense(a, [a.self, enemy]);
    expect(a.bb.visibleEnemies).toBe(1);
    expect(a.bb.hasLos).toBe(true);
    expect(a.bb.targetId).toBe(2);
    expect(a.bb.lastKnownX).toBe(0);
    expect(a.bb.lastKnownZ).toBe(-10);
    // The aim point is the chest, which is where the ray went.
    expect(a.bb.lastKnownY).toBe(enemy.py + enemy.aimHeight);
    expect(a.bb.lastKnownRange).toBeGreaterThan(9);
    expect(a.perception.stats.sightings).toBe(1);
    expect(a.perception.stats.losRays).toBe(1);
  });

  it('pays the reaction delay on a fresh contact', () => {
    const a = arena();
    sense(a, [a.self, combatant(2, 'B', 0, -10)]);
    expect(a.bb.reactionPaid).toBe(false);
    expect(a.bb.reactionTimer).toBeGreaterThanOrEqual(TIER.reactionMin);
    expect(a.bb.reactionTimer).toBeLessThanOrEqual(TIER.reactionMax);
  });

  it('does not pay it again while the same contact is held', () => {
    const a = arena();
    const enemy = combatant(2, 'B', 0, -10);
    sense(a, [a.self, enemy]);
    a.bb.reactionTimer = 0;
    a.bb.reactionPaid = true;
    sense(a, [a.self, enemy]);
    expect(a.bb.reactionPaid).toBe(true);
  });

  it('pays it again once the old contact has been lost for long enough', () => {
    const a = arena();
    const enemy = combatant(2, 'B', 0, -10);
    sense(a, [a.self, enemy]);
    a.bb.reactionPaid = true;
    a.bb.sinceLos = 2;
    sense(a, [a.self, enemy]);
    expect(a.bb.reactionPaid).toBe(false);
  });
});

describe('the ways sight is refused', () => {
  it('is refused behind the bot, outside the cone', () => {
    const a = arena();
    // Yaw 0 looks down -Z, so a body at +Z is behind it.
    sense(a, [a.self, combatant(2, 'B', 0, 10)]);
    expect(a.bb.visibleEnemies).toBe(0);
    expect(a.bb.hasLos).toBe(false);
    // Rejected on the cheap test: no ray was spent.
    expect(a.perception.stats.coneChecks).toBe(1);
    expect(a.perception.stats.losRays).toBe(0);
  });

  it('is refused beyond the vision range, before the cone is even asked', () => {
    const a = arena();
    sense(a, [a.self, combatant(2, 'B', 0, -(CFG.visionRange + 10))]);
    expect(a.bb.visibleEnemies).toBe(0);
    expect(a.perception.stats.coneChecks).toBe(0);
  });

  it('is granted at point blank whatever the facing, inside the proximity radius', () => {
    const a = arena();
    // Behind the bot but close enough to brush against.
    sense(a, [a.self, combatant(2, 'B', 0, 2)]);
    expect(a.bb.visibleEnemies).toBe(1);
  });

  it('is refused through a wall', () => {
    const a = arena(world([0, 3, -5, 12, 6, 0.6]));
    sense(a, [a.self, combatant(2, 'B', 0, -10)]);
    expect(a.bb.visibleEnemies).toBe(0);
    // Two rays spent: the chest, and then the head over the same piece of cover.
    expect(a.perception.stats.losRays).toBe(2);
  });

  it('is refused to a body that is not in the match, or is dead', () => {
    const out = arena();
    sense(out, [out.self, combatant(2, 'B', 0, -10, { participating: false })]);
    expect(out.bb.visibleEnemies).toBe(0);

    const dead = arena();
    const corpse = combatant(2, 'B', 0, -10);
    corpse.health.alive = false;
    sense(dead, [dead.self, corpse]);
    expect(dead.bb.visibleEnemies).toBe(0);
  });

  it('is refused to a team-mate, and granted once there are no team-mates', () => {
    const teams = arena();
    sense(teams, [teams.self, combatant(2, 'A', 0, -10)]);
    expect(teams.bb.visibleEnemies).toBe(0);

    const ffa = arena();
    ffa.perception.freeForAll = true;
    sense(ffa, [ffa.self, combatant(2, 'A', 0, -10)]);
    expect(ffa.bb.visibleEnemies).toBe(1);
  });

  it('is never granted to the bot about itself', () => {
    const a = arena();
    a.perception.freeForAll = true;
    sense(a, [a.self]);
    expect(a.bb.visibleEnemies).toBe(0);
  });
});

describe('the head over the cover', () => {
  it('is seen when the chest is not, and becomes what the bot aims at', () => {
    // A wall 1.5 m tall, half way between them. The eye is at 1.6 and the chest at 1.26, so
    // the chest line passes 1.43 m up at the wall and the head line 1.63: this stops the first
    // and not the second, which is the case the two-ray test exists for.
    const a = arena(world([0, 0.75, -5, 12, 1.5, 0.6]));
    const enemy = combatant(2, 'B', 0, -10);
    sense(a, [a.self, enemy]);
    expect(a.bb.visibleEnemies).toBe(1);
    expect(a.perception.stats.losRays).toBe(2);
    // Not the chest: the aim point moved up to what is actually exposed.
    expect(a.bb.lastKnownY).toBeGreaterThan(enemy.py + enemy.aimHeight);
    expect(a.bb.lastKnownY).toBeLessThan(enemy.py + enemy.rig.standingHeight);
  });
});

describe('a scope glint', () => {
  it('is noticed from behind, which is the whole point of one', () => {
    const plain = arena();
    sense(plain, [plain.self, combatant(2, 'B', 6, 8)]);
    expect(plain.bb.visibleEnemies).toBe(0);

    const glinting = arena();
    sense(glinting, [glinting.self, combatant(2, 'B', 6, 8, { glinting: true })]);
    expect(glinting.bb.visibleEnemies).toBe(1);
  });

  it('does not let a bot see through a wall', () => {
    const a = arena(world([0, 3, -5, 12, 6, 0.6]));
    sense(a, [a.self, combatant(2, 'B', 0, -10, { glinting: true })]);
    expect(a.bb.visibleEnemies).toBe(0);
  });
});

describe('smoke', () => {
  it('refuses a sighting the geometry allowed, and says it did', () => {
    const a = arena();
    a.perception.occluder = SOLID_SMOKE;
    sense(a, [a.self, combatant(2, 'B', 0, -10)]);
    expect(a.bb.visibleEnemies).toBe(0);
    expect(a.perception.smokeBlocked).toBe(1);
  });

  it('is asked after the geometry ray, never instead of it', () => {
    let asked = 0;
    const a = arena(world([0, 3, -5, 12, 6, 0.6]));
    a.perception.occluder = {
      blocksSight: () => {
        asked++;
        return false;
      },
    };
    sense(a, [a.self, combatant(2, 'B', 0, -10)]);
    // The wall rejected the candidate, so the volume walk was never paid for.
    expect(asked).toBe(0);
    expect(a.perception.smokeBlocked).toBe(0);
  });

  it('is absent by default, which is what every M3 measurement was taken with', () => {
    const a = arena();
    expect(a.perception.occluder).toBe(null);
    expect(a.perception.blindSource).toBe(null);
  });
});

describe('a flashed bot', () => {
  it('stops looking for targets but keeps hearing', () => {
    const a = arena();
    a.perception.blindSource = { blindness: () => 1 };
    a.perception.noise.emit(NoiseKind.Gunfire, 2, 'B', 0, 0, -8);
    sense(a, [a.self, combatant(2, 'B', 0, -10)]);
    expect(a.bb.visibleEnemies).toBe(0);
    expect(a.bb.hasLos).toBe(false);
    // The flash is a window, not a kill: it still knows something happened over there.
    expect(a.bb.investigateValid).toBe(true);
    expect(a.bb.investigateZ).toBe(-8);
    expect(a.perception.stats.coneChecks).toBe(0);
  });

  it('still sees once the worst of it has passed', () => {
    const a = arena();
    a.perception.blindSource = { blindness: () => 0.3 };
    sense(a, [a.self, combatant(2, 'B', 0, -10)]);
    expect(a.bb.visibleEnemies).toBe(1);
  });
});

describe('two enemies at once', () => {
  it('counts both and takes the nearest', () => {
    const a = arena();
    sense(a, [a.self, combatant(2, 'B', 0, -30), combatant(3, 'B', 0, -6)]);
    expect(a.bb.visibleEnemies).toBe(2);
    expect(a.bb.targetId).toBe(3);
  });

  it('holds the one it is already engaged with against a slightly nearer one', () => {
    const a = arena();
    const engaged = combatant(2, 'B', 0, -14);
    const fresh = combatant(3, 'B', 0, -11);
    a.bb.targetId = 2;
    sense(a, [a.self, engaged, fresh]);
    // The six-metre stickiness bonus: a bot does not flick between two enemies every sample.
    expect(a.bb.targetId).toBe(2);
  });

  it('does switch when the other is much nearer', () => {
    const a = arena();
    a.bb.targetId = 2;
    sense(a, [a.self, combatant(2, 'B', 0, -30), combatant(3, 'B', 0, -4)]);
    expect(a.bb.targetId).toBe(3);
  });
});

describe('the noise field', () => {
  it('hands over the nearest audible noise as a place to go and look', () => {
    const a = arena();
    a.perception.noise.emit(NoiseKind.Gunfire, 2, 'B', 20, 0, 0);
    a.perception.noise.emit(NoiseKind.Gunfire, 3, 'B', 5, 0, 0);
    sense(a, [a.self]);
    expect(a.bb.investigateValid).toBe(true);
    expect(a.bb.investigateX).toBe(5);
    // A place, not a person.
    expect(a.bb.targetId).toBe(-1);
    expect(a.bb.hasLos).toBe(false);
  });

  it('hears gunfire much further than footsteps', () => {
    const far = arena();
    far.perception.noise.emit(NoiseKind.Gunfire, 2, 'B', 0, 0, -30);
    sense(far, [far.self]);
    expect(far.bb.investigateValid).toBe(true);

    const quiet = arena();
    quiet.perception.noise.emit(NoiseKind.Footstep, 2, 'B', 0, 0, -30);
    sense(quiet, [quiet.self]);
    expect(quiet.bb.investigateValid).toBe(false);
  });

  it('hears a footstep close by', () => {
    const a = arena();
    a.perception.noise.emit(NoiseKind.Footstep, 2, 'B', 0, 0, -6);
    sense(a, [a.self]);
    expect(a.bb.investigateValid).toBe(true);
  });

  it('discounts a team-mate noise, and nothing at all in free-for-all', () => {
    const teams = arena();
    teams.perception.noise.emit(NoiseKind.Gunfire, 2, 'A', 0, 0, -8);
    sense(teams, [teams.self]);
    expect(teams.bb.investigateValid).toBe(false);

    const ffa = arena();
    ffa.perception.freeForAll = true;
    ffa.perception.noise.emit(NoiseKind.Gunfire, 2, 'A', 0, 0, -8);
    sense(ffa, [ffa.self]);
    expect(ffa.bb.investigateValid).toBe(true);
  });

  it('considers a noise once, by serial, and not again', () => {
    const a = arena();
    a.perception.noise.emit(NoiseKind.Gunfire, 2, 'B', 0, 0, -8);
    sense(a, [a.self]);
    expect(a.bb.investigateValid).toBe(true);
    expect(a.bb.noiseCursor).toBe(a.perception.noise.currentSerial);

    a.bb.investigateValid = false;
    sense(a, [a.self]);
    expect(a.bb.investigateValid).toBe(false);
  });

  it('forgets everything on reset', () => {
    const a = arena();
    a.perception.noise.emit(NoiseKind.Gunfire, 2, 'B', 0, 0, -8);
    a.perception.noise.reset();
    expect(a.perception.noise.currentSerial).toBe(0);
    sense(a, [a.self]);
    expect(a.bb.investigateValid).toBe(false);
  });
});

describe('the diagnostics', () => {
  it('count the cheap tests, the rays and the sightings, and start over on request', () => {
    const a = arena();
    sense(a, [a.self, combatant(2, 'B', 0, -10), combatant(3, 'B', 0, -12)]);
    expect(a.perception.stats.coneChecks).toBe(2);
    expect(a.perception.stats.losRays).toBe(2);
    expect(a.perception.stats.sightings).toBe(1);
    a.perception.resetStats();
    expect(a.perception.stats).toEqual({ coneChecks: 0, losRays: 0, sightings: 0 });
    expect(a.perception.smokeBlocked).toBe(0);
  });
});

describe('the line of sight anything may ask for', () => {
  it('is clear across an empty floor and blocked by a wall', () => {
    const open = arena();
    expect(open.perception.clearLine(0, 1.5, 0, 0, 1.5, -20)).toBe(true);

    const walled = arena(world([0, 3, -5, 12, 6, 0.6]));
    expect(walled.perception.clearLine(0, 1.5, 0, 0, 1.5, -20)).toBe(false);
  });
});
