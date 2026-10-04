import { describe, expect, it } from 'vitest';
import { MAPS } from '../../shared/modes/ModeRegistry';
import { EFlag, makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import { DEFAULT_MOVEMENT_CONFIG } from '../../shared/player/MovementConfig';
import { ColliderSet } from '../../shared/world/ColliderSet';
import { CollisionWorld } from '../../shared/world/CollisionWorld';
import { makeRayHit } from '../../shared/world/Geometry';
import { loadMapCollision } from '../../shared/world/MapLoader';
import {
  clearLine,
  LINGER_MS,
  NEAR_RADIUS_M,
  RelevanceTracker,
  relevantNow,
  type RelevanceContext,
} from './Relevance';

/**
 * Who each player is told about (anti-wallhack phase 1).
 *
 * The exact cases run in a room built for them — a wall across x = 0 with a two-metre doorway in
 * it at |z| < 1 — so each one is a line drawn on paper. The properties at the end run on FOUNDRY.
 */

function room(): CollisionWorld {
  const set = new ColliderSet(8);
  set.add({ x: 0, y: -1, z: 0 }, { x: 60, y: 2, z: 60 }, 0, 0, 0, 'floor');
  // Two wall pieces, z in [-10, -1] and [1, 10]; the gap between them is the doorway.
  set.add({ x: 0, y: 2, z: -5.5 }, { x: 0.3, y: 4, z: 9 }, 0, 0, 0, 'concrete');
  set.add({ x: 0, y: 2, z: 5.5 }, { x: 0.3, y: 4, z: 9 }, 0, 0, 0, 'concrete');
  const world = new CollisionWorld(set, { min: { x: -30, y: -8, z: -30 }, max: { x: 30, y: 24, z: 30 } }, 4);
  world.configure(DEFAULT_MOVEMENT_CONFIG.maxSlopeDeg, DEFAULT_MOVEMENT_CONFIG.collisionSkin);
  return world;
}

const ROOM = room();

function body(entityId: number, x: number, z: number, team: 'A' | 'B', vx = 0, vz = 0): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.x = x;
  e.y = 0;
  e.z = z;
  e.vx = vx;
  e.vz = vz;
  e.flags = EFlag.Alive | (team === 'B' ? EFlag.TeamB : 0);
  return e;
}

function ctx(lookAheadSec = 0, freeForAll = false, world = ROOM): RelevanceContext {
  return { world, freeForAll, lookAheadSec };
}

const hit = makeRayHit();
const relevant = (c: RelevanceContext, viewer: EntitySnapshot, target: EntitySnapshot): boolean =>
  relevantNow(c, viewer, target, -1, hit).relevant;

describe('relevance in a room with one wall and one doorway', () => {
  const viewer = body(1, -5, 0, 'A');

  it('hides an enemy behind the wall', () => {
    expect(relevant(ctx(), body(2, 5, -5, 'B'), body(3, -5, -5, 'A'))).toBe(false);
    expect(relevant(ctx(), viewer, body(2, 5, 5, 'B'))).toBe(false);
  });

  it('shows an enemy through the doorway', () => {
    expect(relevant(ctx(), viewer, body(2, 5, 0, 'B'))).toBe(true);
  });

  it('shows a body the wall only half covers — one shoulder is enough', () => {
    // From x = -5 the doorway edge at z = 1 projects to z = 2 at x = 5; a body centred 0.15 past
    // it has its near shoulder still in the opening.
    expect(relevant(ctx(), viewer, body(2, 5, 2.15, 'B'))).toBe(true);
  });

  it('shows an enemy about to step into view before it does (the peek look-ahead)', () => {
    // Behind the wall at z = 3, running toward the doorway at 6 m/s.
    const runner = body(2, 5, 3, 'B', 0, -6);
    expect(relevant(ctx(0), viewer, runner)).toBe(false);
    expect(relevant(ctx(0.3), viewer, runner)).toBe(true);
  });

  it('shows the enemy to a viewer about to step into the doorway', () => {
    const viewerRunning = body(1, -5, 4, 'A', 0, -8);
    const target = body(2, 5, -1.5, 'B');
    expect(relevant(ctx(0), viewerRunning, target)).toBe(false);
    expect(relevant(ctx(0.4), viewerRunning, target)).toBe(true);
  });

  it(`always shows a body within ${NEAR_RADIUS_M} m, wall or not`, () => {
    expect(relevant(ctx(), body(1, -2, -5, 'A'), body(2, 2, -5, 'B'))).toBe(true);
  });

  it('always shows a teammate, and in free-for-all there are none', () => {
    const behindWall = body(2, 5, -5, 'A');
    expect(relevant(ctx(), viewer, behindWall)).toBe(true);
    expect(relevant(ctx(0, true), viewer, behindWall)).toBe(false);
  });
});

describe('the tracker', () => {
  it(`keeps a body for ${LINGER_MS} ms after it was last seen, then lets it go`, () => {
    const tracker = new RelevanceTracker();
    const viewer = body(1, -5, 0, 'A');
    expect(tracker.relevant(0, ctx(), viewer, body(2, 5, 0, 'B'))).toBe(true);
    const hidden = body(2, 5, 5, 'B');
    expect(tracker.relevant(100, ctx(), viewer, hidden)).toBe(true);
    expect(tracker.relevant(LINGER_MS - 1, ctx(), viewer, hidden)).toBe(true);
    expect(tracker.relevant(LINGER_MS + 1, ctx(), viewer, hidden)).toBe(false);
  });

  it('forgets a body whose id is gone, so a reused id does not inherit its linger', () => {
    const tracker = new RelevanceTracker();
    const viewer = body(1, -5, 0, 'A');
    tracker.relevant(0, ctx(), viewer, body(2, 5, 0, 'B'));
    tracker.forget(2);
    expect(tracker.relevant(100, ctx(), viewer, body(2, 5, 5, 'B'))).toBe(false);
  });

  it('lets a dead spectator see whatever any living teammate sees', () => {
    const tracker = new RelevanceTracker();
    const blind = body(3, -5, -5, 'A');
    const seeing = body(4, -5, 0, 'A');
    const target = body(2, 5, 0, 'B');
    // Straight across the wall piece at z = -5: nothing of the body is in the doorway.
    expect(tracker.relevantToAny(0, ctx(), [blind], body(2, 5, -5, 'B'))).toBe(false);
    expect(tracker.relevantToAny(1000, ctx(), [blind, seeing], target)).toBe(true);
  });
});

describe('clearLine', () => {
  it('tries the last clear ray first and finds it again', () => {
    const viewer = body(1, -5, 0, 'A');
    const target = body(2, 5, 0, 'B');
    const first = clearLine(ROOM, viewer, target, 0, -1);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(clearLine(ROOM, viewer, target, 0, first)).toBe(first);
  });
});

describe('on FOUNDRY', () => {
  const entry = MAPS.find((m) => m.id === 'mp_foundry');
  if (entry === undefined) throw new Error('no FOUNDRY');
  const world = loadMapCollision(entry.def).collision;
  const b = entry.def.navBounds;

  function randomPairs(n: number): Array<[EntitySnapshot, EntitySnapshot]> {
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const out: Array<[EntitySnapshot, EntitySnapshot]> = [];
    while (out.length < n) {
      const a = body(1, b.min.x + rnd() * (b.max.x - b.min.x), b.min.z + rnd() * (b.max.z - b.min.z), 'A', rnd() * 8 - 4, rnd() * 8 - 4);
      const t = body(2, b.min.x + rnd() * (b.max.x - b.min.x), b.min.z + rnd() * (b.max.z - b.min.z), 'B', rnd() * 8 - 4, rnd() * 8 - 4);
      if (Math.hypot(a.x - t.x, a.z - t.z) > NEAR_RADIUS_M) out.push([a, t]);
    }
    return out;
  }

  it('hides most enemies from most places — the culling has something to cull', () => {
    const pairs = randomPairs(2000);
    const seen = pairs.filter(([a, t]) => relevant(ctx(0, false, world), a, t)).length / pairs.length;
    expect(seen).toBeGreaterThan(0.02);
    expect(seen).toBeLessThan(0.6);
  });

  it('only ever adds bodies when it looks ahead, never removes one', () => {
    for (const [a, t] of randomPairs(2000)) {
      if (relevant(ctx(0, false, world), a, t)) expect(relevant(ctx(0.3, false, world), a, t)).toBe(true);
    }
  });
});
