import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { Rng } from '../core/Rng';
import { Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { bakeNavmesh } from '../world/NavBake';
import type { NavGrid } from '../world/NavGrid';
import type { SpawnZone } from '../world/maps/types';
import { installClock } from '../core/Clock';
import { DEG2RAD } from '../core/MathUtil';
import { simCos } from '../core/SimMath';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import type { Combatant } from './Combatant';
import { DEFAULT_PERCEPTION } from './DifficultyTiers';
import { Perception } from './Perception';
import {
  SpawnSelector,
  makeSpawnChoice,
  makeSpawnInspection,
  type SpawnChoice,
} from './SpawnSelector';

/**
 * Where somebody comes back, pinned.
 *
 * S6.9's rule is "never within 15 m of a living enemy, never inside their view cone", and the
 * interesting half is what happens when the map cannot honour it: the selector reports which
 * of three tiers it had to settle for rather than failing, because a spawn selector that can
 * return "no" is one that will, at which point a bot stops existing.
 *
 * So the three tiers are the spine of this file, and each is reached by building a world where
 * only that tier is available:
 *
 *  - **safe** — an empty room: beyond 15 m and in nobody's cone.
 *  - **hidden** — an enemy looking at the zone through a wall. Inside the cone, no line of
 *    sight. This is the tier that exists because a cone test alone is not an answer.
 *  - **leastBad** — a room too small for 15 m to be possible at all, which is the tier that
 *    runs most often in Free-for-All and the one whose scoring was wrong until post-M8: the
 *    unpenalised score was compared against a penalised best, so "best" collapsed into "very
 *    nearly the last candidate examined" and the fallback returned an arbitrary point.
 *
 * `inspect` is pinned against `select` rather than on its own, because the comment on it
 * promises the debug visualisation draws *the selector's own arithmetic*; a second
 * implementation would be a picture of a different spawn selector. `AiDebug` is the caller.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

/** A floor with a top face at y = 0, plus whatever walls the test asks for. */
function world(
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  ...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>
): CollisionWorld {
  const set = new ColliderSet(boxes.length + 2);
  const span = (bounds.max.x - bounds.min.x) * 2;
  set.add({ x: 0, y: -0.5, z: 0 }, { x: span, y: 1, z: span }, 0, 0, 0, 'floor');
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  return new CollisionWorld(set, bounds, 4);
}

function combatant(entityId: number, team: 'A' | 'B', x: number, z: number, yaw = 0): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(x, 0, z, yaw);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team,
    px: x,
    py: 0,
    pz: z,
    yaw,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

function zone(team: 'A' | 'B' | 'FFA', x: number, z: number, radius = 1.5): SpawnZone {
  return { team, position: { x, y: 0.05, z }, facingYaw: 0, radius };
}

interface Rig {
  readonly selector: SpawnSelector;
  readonly out: SpawnChoice;
}

/** A selector over `zones` in a room of `half` metres, with optional walls. */
function rig(
  zones: readonly SpawnZone[],
  half = 40,
  walls: ReadonlyArray<readonly [number, number, number, number, number, number]> = [],
  seed = 1234,
): Rig {
  const bounds = { min: { x: -half, y: -4, z: -half }, max: { x: half, y: 8, z: half } };
  const collision = world(bounds, ...walls);
  const nav: NavGrid = bakeNavmesh(collision, bounds, {
    cellSize: 0.5,
    capsuleRadius: DEFAULT_MOVEMENT_CONFIG.capsuleRadius,
    standHeight: DEFAULT_MOVEMENT_CONFIG.standHeight,
    stepHeight: DEFAULT_MOVEMENT_CONFIG.stepHeight,
    maxDrop: DEFAULT_MOVEMENT_CONFIG.groundSnapDist,
    // No verticality in these rooms: one floor, which is what the selector is about.
    mantleHeight: 0,
    dropHeight: 0,
    minGroundY: simCos(DEFAULT_MOVEMENT_CONFIG.maxSlopeDeg * DEG2RAD),
    // Reachability is seeded from the zones themselves, as `navBakeOptionsFor` seeds from
    // the map's spawns — otherwise the flood discards the floor and there is no navmesh.
    seeds: zones.map((z) => z.position),
    layers: 1,
  });
  const selector = new SpawnSelector(
    zones,
    nav,
    new Rng(seed),
    new Perception(collision),
    DEFAULT_PERCEPTION,
  );
  return { selector, out: makeSpawnChoice() };
}

describe('a fresh choice and a fresh inspection', () => {
  it('start blank, with the nearest enemy at infinity rather than at zero', () => {
    // Zero would read as "an enemy is standing on this point", which is the opposite.
    expect(makeSpawnChoice()).toEqual({
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      tier: 'safe',
      nearestEnemy: Infinity,
      insideCone: false,
      visible: false,
    });
    expect(makeSpawnInspection().eligible).toBe(false);
  });

  it('are a fresh record each time, so two readings cannot share one', () => {
    expect(makeSpawnChoice()).not.toBe(makeSpawnChoice());
    expect(makeSpawnInspection()).not.toBe(makeSpawnInspection());
  });
});

describe('the candidate pool', () => {
  it('jitters fourteen points per authored zone', () => {
    const { selector } = rig([zone('A', -20, 0), zone('B', 20, 0)]);
    expect(selector.candidateCount).toBe(28);
  });

  it('keeps the authored position among the candidates, within a cell of it', () => {
    // Sample 0 is the zone centre un-jittered, so a hand-placed spawn is always in the pool
    // rather than being jittered away from — then snapped to a navmesh cell centre, which is
    // why this is "within a cell" and not an equality.
    const { selector } = rig([zone('A', -20, 4)]);
    const nearest = Math.min(...selector.candidates.map((c) => Math.hypot(c.x - -20, c.z - 4)));
    expect(nearest).toBeLessThan(0.5);
  });

  it('keeps every candidate inside its zone radius, give or take the snap', () => {
    const { selector } = rig([zone('A', -20, 0, 2)]);
    for (const c of selector.candidates) {
      // The jitter is bounded by the radius; the snap to a 0.5 m cell centre can add half a
      // cell diagonal on top of it.
      expect(Math.hypot(c.x - -20, c.z - 0)).toBeLessThanOrEqual(2 + 0.5);
    }
  });

  it('is deterministic for a seed, which is what makes a bad spawn reproducible', () => {
    const first = rig([zone('A', -20, 0), zone('B', 20, 0)], 40, [], 777);
    const second = rig([zone('A', -20, 0), zone('B', 20, 0)], 40, [], 777);
    expect(first.selector.candidates.map((c) => `${c.x},${c.z}`)).toEqual(
      second.selector.candidates.map((c) => `${c.x},${c.z}`),
    );
  });

  it('drops a zone the navmesh has nothing under', () => {
    // A zone the map author put outside the world yields no usable point rather than one
    // broken one.
    const { selector } = rig([zone('A', -20, 0), zone('B', 500, 500)]);
    expect(selector.candidateCount).toBe(14);
  });
});

describe('choosing a spawn', () => {
  it('takes a safe one when the far end of the room is empty', () => {
    const r = rig([zone('A', -20, 0), zone('B', 20, 0)]);
    const enemy = combatant(2, 'B', 20, 0);
    expect(r.selector.select('A', [enemy], 1, 0, r.out)).toBe(true);
    expect(r.out.tier).toBe('safe');
    expect(r.out.insideCone).toBe(false);
    expect(r.out.visible).toBe(false);
    expect(r.out.nearestEnemy).toBeGreaterThanOrEqual(15);
  });

  it('draws only from its own side’s zones', () => {
    const r = rig([zone('A', -20, 0), zone('B', 20, 0)]);
    for (let i = 0; i < 10; i++) {
      r.selector.select('A', [], 1, i, r.out);
      expect(r.out.x).toBeLessThan(0);
      r.selector.select('B', [], 1, i, r.out);
      expect(r.out.x).toBeGreaterThan(0);
    }
  });

  it('draws from an FFA zone for either side', () => {
    const r = rig([zone('FFA', 0, 0, 2)]);
    expect(r.selector.select('A', [], 1, 0, r.out)).toBe(true);
    expect(r.selector.select('B', [], 1, 0, r.out)).toBe(true);
  });

  it('swaps which end a side draws from when the sides swap', () => {
    const r = rig([zone('A', -20, 0), zone('B', 20, 0)]);
    expect(r.selector.sidesSwapped).toBe(false);
    r.selector.select('A', [], 1, 0, r.out);
    expect(r.out.x).toBeLessThan(0);

    r.selector.setSideSwap(true);
    expect(r.selector.sidesSwapped).toBe(true);
    r.selector.select('A', [], 1, 0, r.out);
    expect(r.out.x).toBeGreaterThan(0);

    r.selector.setSideSwap(false);
    r.selector.select('A', [], 1, 0, r.out);
    expect(r.out.x).toBeLessThan(0);
  });

  it('settles for hidden when the only distant zone is inside a cone behind a wall', () => {
    // The enemy stands south of a long wall and looks north through it at the zone.
    const wall: readonly [number, number, number, number, number, number] = [0, 1.5, 0, 60, 3, 1];
    const r = rig([zone('A', 0, -20, 1)], 40, [wall]);
    // Yaw 0 looks down -Z, which from z = +20 is straight at the zone at z = -20.
    const enemy = combatant(2, 'B', 0, 20, 0);
    expect(r.selector.select('A', [enemy], 1, 0, r.out)).toBe(true);
    expect(r.out.tier).toBe('hidden');
    expect(r.out.insideCone).toBe(true);
    expect(r.out.visible).toBe(false);
  });

  it('falls back to least-bad in a room where 15 m is impossible', () => {
    const r = rig([zone('A', 0, 0, 2)], 6);
    const enemy = combatant(2, 'B', 3, 0);
    expect(r.selector.select('A', [enemy], 1, 0, r.out)).toBe(true);
    expect(r.out.tier).toBe('leastBad');
    expect(r.out.nearestEnemy).toBeLessThan(15);
  });

  it('maximises distance in the least-bad tier rather than taking an arbitrary point', () => {
    // The post-M8 fix: both sides of the comparison are the penalised score now. With the
    // enemy at one end, the chosen point has to be the far end of the zone.
    const r = rig([zone('A', 0, 0, 4)], 8);
    const enemy = combatant(2, 'B', 4, 0);
    r.selector.select('A', [enemy], 1, 0, r.out);
    expect(r.out.tier).toBe('leastBad');
    const best = Math.max(...r.selector.candidates.map((c) => Math.hypot(c.x - 4, c.z)));
    expect(r.out.nearestEnemy).toBeGreaterThan(best * 0.6);
  });

  it('ignores the dead, and itself', () => {
    const r = rig([zone('A', -20, 0), zone('B', 20, 0)]);
    const corpse = combatant(2, 'B', -20, 0);
    corpse.health.applyDamage(1000);
    expect(r.selector.select('A', [corpse], 1, 0, r.out)).toBe(true);
    expect(r.out.tier).toBe('safe');
    expect(r.out.nearestEnemy).toBe(Infinity);

    const self = combatant(1, 'A', -20, 0);
    r.selector.select('A', [self], 1, 0, r.out);
    expect(r.out.nearestEnemy).toBe(Infinity);
  });

  it('ignores anybody not participating', () => {
    const r = rig([zone('A', -20, 0)]);
    const waiting = { ...combatant(2, 'B', -20, 0), participating: false };
    r.selector.select('A', [waiting], 1, 0, r.out);
    expect(r.out.nearestEnemy).toBe(Infinity);
  });

  it('scores against everybody in free-for-all, not just the other side', () => {
    const r = rig([zone('FFA', 0, 0, 2)], 8);
    const sameTeam = combatant(2, 'A', 3, 0);
    r.selector.freeForAll = false;
    r.selector.select('A', [sameTeam], 1, 0, r.out);
    const asTeammate = r.out.nearestEnemy;

    r.selector.freeForAll = true;
    r.selector.select('A', [sameTeam], 1, 1, r.out);
    const asHostile = r.out.nearestEnemy;

    // A team-mate is not an enemy with teams and is one in FFA: seven hostiles, not one side.
    expect(asTeammate).toBe(Infinity);
    expect(asHostile).toBeLessThan(15);
  });

  it('avoids reusing the point it just used', () => {
    const r = rig([zone('A', -20, 0, 3)]);
    r.selector.select('A', [], 1, 100, r.out);
    const first = `${r.out.x},${r.out.z}`;
    r.selector.select('A', [], 1, 101, r.out);
    expect(`${r.out.x},${r.out.z}`).not.toBe(first);
  });

  it('is willing to reuse it again once the recency window has passed', () => {
    const r = rig([zone('A', -20, 0, 0.001)]);
    r.selector.select('A', [], 1, 0, r.out);
    const first = `${r.out.x},${r.out.z}`;
    r.selector.select('A', [], 1, 10_000, r.out);
    expect(`${r.out.x},${r.out.z}`).toBe(first);
  });

  it('fails only when there is no candidate at all', () => {
    const r = rig([]);
    expect(r.selector.candidateCount).toBe(0);
    expect(r.selector.select('A', [], 1, 0, r.out)).toBe(false);
  });
});

describe('the running totals the acceptance report reads', () => {
  it('counts selections by tier, and the two violations separately', () => {
    const r = rig([zone('A', -20, 0), zone('B', 20, 0)]);
    const enemy = combatant(2, 'B', 20, 0);
    for (let i = 0; i < 5; i++) r.selector.select('A', [enemy], 1, i * 500, r.out);

    const s = r.selector.stats;
    expect(s.selections).toBe(5);
    expect(s.safe).toBe(5);
    expect(s.hidden).toBe(0);
    expect(s.leastBad).toBe(0);
    expect(s.coneViolations).toBe(0);
    expect(s.visibleViolations).toBe(0);
    expect(s.minEnemyDistance).toBeGreaterThanOrEqual(15);
  });

  it('records the worst distance any selection produced', () => {
    const r = rig([zone('A', 0, 0, 2)], 6);
    const enemy = combatant(2, 'B', 3, 0);
    r.selector.select('A', [enemy], 1, 0, r.out);
    expect(r.selector.stats.leastBad).toBe(1);
    expect(r.selector.stats.minEnemyDistance).toBe(r.out.nearestEnemy);
    expect(r.selector.stats.minEnemyDistance).toBeLessThan(15);
  });

  it('is zeroed by resetStats, with the distance back at infinity', () => {
    const r = rig([zone('A', -20, 0)]);
    r.selector.select('A', [], 1, 0, r.out);
    r.selector.resetStats();
    expect(r.selector.stats.selections).toBe(0);
    expect(r.selector.stats.safe).toBe(0);
    expect(r.selector.stats.minEnemyDistance).toBe(Infinity);
  });
});

describe('inspecting a candidate for the debug visualisation', () => {
  it('reports the selector’s own arithmetic, not a second implementation of it', () => {
    // Every candidate in this room clears 15 m of the one enemy and is outside its cone, so
    // every one of them is in the `safe` tier and `select` ranks them by the unpenalised
    // score alone. That makes the two directly comparable: the point `select` chose has to be
    // the one `inspect` scores highest, which is only true while both call one `scoreOf`.
    const r = rig([zone('A', -20, 0, 3), zone('B', 20, 0)]);
    // Looking +X, away from the zone: nothing is inside this enemy's cone.
    const enemy = combatant(2, 'B', 20, 0, -Math.PI / 2);
    const look = makeSpawnInspection();

    // Scanned before selecting, because `select` stamps `lastUsedTick` on the point it takes
    // and a later inspection of that point would read the 9-point recency penalty — which is
    // the bookkeeping working, not a disagreement.
    let best = -Infinity;
    let bestAt = -1;
    for (let i = 0; i < r.selector.candidateCount; i++) {
      expect(r.selector.inspect(i, 'A', [enemy], 1, 0, look)).toBe(true);
      if (!look.eligible) continue;
      expect(look.tier).toBe('safe');
      if (look.score > best) {
        best = look.score;
        bestAt = i;
      }
    }

    r.selector.select('A', [enemy], 1, 0, r.out);
    expect(r.out.tier).toBe('safe');

    const chosen = r.selector.candidates[bestAt];
    expect(chosen).toBeDefined();
    expect(r.out.x).toBe(chosen?.x);
    expect(r.out.z).toBe(chosen?.z);
  });

  it('marks the other side’s candidates ineligible and scores them zero', () => {
    const r = rig([zone('A', -20, 0), zone('B', 20, 0)]);
    const look = makeSpawnInspection();
    let ineligible = 0;
    for (let i = 0; i < r.selector.candidateCount; i++) {
      r.selector.inspect(i, 'A', [], 1, 0, look);
      if (look.eligible) continue;
      ineligible++;
      expect(look.score).toBe(0);
      expect(look.tier).toBe('leastBad');
    }
    expect(ineligible).toBe(14);
  });

  it('refuses an index that is not a candidate', () => {
    const r = rig([zone('A', -20, 0)]);
    const look = makeSpawnInspection();
    expect(r.selector.inspect(999, 'A', [], 1, 0, look)).toBe(false);
  });

  it('classifies the tier the same way select does', () => {
    const r = rig([zone('A', 0, 0, 2)], 6);
    const enemy = combatant(2, 'B', 3, 0);
    const look = makeSpawnInspection();
    r.selector.inspect(0, 'A', [enemy], 1, 0, look);
    expect(look.distance).toBeLessThan(15);
    expect(look.tier).toBe('leastBad');

    const far = rig([zone('A', -20, 0)]);
    far.selector.inspect(0, 'A', [combatant(2, 'B', 20, 0)], 1, 0, look);
    expect(far.selector.candidateCount).toBeGreaterThan(0);
    expect(look.tier).toBe('safe');
  });
});
