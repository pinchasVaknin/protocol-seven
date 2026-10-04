import { describe, expect, it } from 'vitest';
import { EFlag, makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import { DEFAULT_MOVEMENT_CONFIG } from '../../shared/player/MovementConfig';
import { ColliderSet } from '../../shared/world/ColliderSet';
import { CollisionWorld } from '../../shared/world/CollisionWorld';
import type { RelevanceContext } from './Relevance';
import { SeatView, writeDormant } from './SeatView';

/**
 * One seat's entity list (anti-wallhack phase 1): who goes out as they are, who goes out dormant,
 * and what a dormant record does and does not say.
 *
 * The room: a wall across x = 0 with a doorway at |z| < 1. The viewer (1, team A) stands at
 * x = -5 on the doorway's line; an enemy at (5, 0) is in view, one at (5, 5) is not.
 */

function room(): CollisionWorld {
  const set = new ColliderSet(8);
  set.add({ x: 0, y: -1, z: 0 }, { x: 60, y: 2, z: 60 }, 0, 0, 0, 'floor');
  set.add({ x: 0, y: 2, z: -5.5 }, { x: 0.3, y: 4, z: 9 }, 0, 0, 0, 'concrete');
  set.add({ x: 0, y: 2, z: 5.5 }, { x: 0.3, y: 4, z: 9 }, 0, 0, 0, 'concrete');
  const world = new CollisionWorld(set, { min: { x: -30, y: -8, z: -30 }, max: { x: 30, y: 24, z: 30 } }, 4);
  world.configure(DEFAULT_MOVEMENT_CONFIG.maxSlopeDeg, DEFAULT_MOVEMENT_CONFIG.collisionSkin);
  return world;
}

const CTX: RelevanceContext = { world: room(), freeForAll: false, lookAheadSec: 0 };

function body(entityId: number, x: number, z: number, team: 'A' | 'B', alive = true): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.displayName = `E${entityId}`;
  e.x = x;
  e.z = z;
  e.flags = (alive ? EFlag.Alive : 0) | (team === 'B' ? EFlag.TeamB : 0);
  return e;
}

const NOBODY_HIDDEN = (): boolean => false;

function listed(view: SeatView): Map<number, EntitySnapshot> {
  const out = new Map<number, EntitySnapshot>();
  for (let i = 0; i < view.count; i++) {
    const e = view.list[i];
    if (e !== undefined) out.set(e.entityId, e);
  }
  return out;
}

const dormant = (e: EntitySnapshot | undefined): boolean => e !== undefined && (e.flags & EFlag.Dormant) !== 0;

describe('a seat\'s entity list', () => {
  it('sends a visible enemy as it is, and one behind the wall dormant', () => {
    const view = new SeatView();
    const entities = [body(1, -5, 0, 'A'), body(2, 5, 0, 'B'), body(3, 5, 5, 'B')];
    view.build(0, 1, entities, 3, CTX, false, false, NOBODY_HIDDEN);
    const out = listed(view);
    expect(out.get(1)).toBe(entities[0]);
    expect(out.get(2)).toBe(entities[1]);
    expect(dormant(out.get(3))).toBe(true);
    expect(view.enemies).toBe(2);
    expect(view.dormantSent).toBe(1);
  });

  it('never tells a viewer where a body it has not seen is: a blank record at the origin', () => {
    const view = new SeatView();
    const hidden = body(3, 5, 5, 'B');
    hidden.yaw = 2;
    hidden.health = 37;
    view.build(0, 1, [body(1, -5, 0, 'A'), hidden], 2, CTX, false, false, NOBODY_HIDDEN);
    const rec = listed(view).get(3);
    expect(rec).toMatchObject({ x: 0, y: 0, z: 0, yaw: 0, health: 100, displayName: 'E3' });
  });

  it('freezes a body where it was last seen, and keeps only its public facts live', () => {
    const view = new SeatView();
    const viewer = body(1, -5, 0, 'A');
    const enemy = body(2, 5, 0, 'B');
    enemy.health = 80;
    view.build(0, 1, [viewer, enemy], 2, CTX, false, false, NOBODY_HIDDEN);

    // It walks behind the wall, takes damage, fires, and dies — all out of sight, past the linger.
    const moved = body(2, 5, 6, 'B', false);
    moved.health = 0;
    moved.deathSerial = 4;
    moved.flags |= EFlag.Firing;
    view.build(10_000, 1, [viewer, moved], 2, CTX, false, false, NOBODY_HIDDEN);
    const rec = listed(view).get(2);
    expect(dormant(rec)).toBe(true);
    // Where it was, as it was: the place, and the health it had in view.
    expect(rec).toMatchObject({ x: 5, z: 0, health: 80 });
    // What is public: it died, and that it died.
    expect((rec?.flags ?? 0) & EFlag.Alive).toBe(0);
    expect(rec?.deathSerial).toBe(4);
    // What it was doing is not.
    expect((rec?.flags ?? 0) & EFlag.Firing).toBe(0);
  });

  it('hides an Unseen body from everybody but itself, and shows everything to a free cam', () => {
    const entities = [body(1, -5, 0, 'A'), body(2, 5, 0, 'B'), body(3, 5, 5, 'B')];
    const unseen = (id: number): boolean => id === 2;
    const view = new SeatView();
    view.build(0, 1, entities, 3, CTX, false, false, unseen);
    expect(dormant(listed(view).get(2))).toBe(true);

    const freeCam = new SeatView();
    freeCam.build(0, 1, entities, 3, CTX, true, false, unseen);
    expect([...listed(freeCam).values()].some(dormant)).toBe(false);
  });

  it('lets a dead spectator see what its living team sees, not where its own body lies', () => {
    const view = new SeatView();
    const corpse = body(1, -5, -5, 'A', false);
    const teammate = body(4, -5, 0, 'A');
    const enemy = body(2, 5, 0, 'B');
    view.build(0, 1, [corpse, teammate, enemy], 3, CTX, false, true, NOBODY_HIDDEN);
    expect(dormant(listed(view).get(2))).toBe(false);
    // The same corpse outside a one-life mode sees from where it lies: the line from (-5, -5) to
    // the enemy crosses the wall at z = -2.5, so with its own eyes it sees nothing.
    const own = new SeatView();
    own.build(0, 1, [corpse, teammate, body(2, 5, 0, 'B')], 3, CTX, false, false, NOBODY_HIDDEN);
    expect(dormant(listed(own).get(2))).toBe(true);
  });

  it('forgets a body that left, so its id is clean for whoever is handed it next', () => {
    const view = new SeatView();
    const viewer = body(1, -5, 0, 'A');
    view.build(0, 1, [viewer, body(2, 5, 0, 'B')], 2, CTX, false, false, NOBODY_HIDDEN);
    view.build(100, 1, [viewer], 1, CTX, false, false, NOBODY_HIDDEN);
    // A new body on id 2, behind the wall, 200 ms later: no linger, no frozen record, blank.
    view.build(200, 1, [viewer, body(2, 5, 5, 'B')], 2, CTX, false, false, NOBODY_HIDDEN);
    const rec = listed(view).get(2);
    expect(dormant(rec)).toBe(true);
    expect(rec).toMatchObject({ x: 0, z: 0 });
  });
});

describe('writeDormant', () => {
  it('carries alive, team, bot, name, character and death — and nothing else — from the live body', () => {
    const live = body(9, 3, 4, 'B');
    live.flags |= EFlag.Bot | EFlag.Sprinting | EFlag.Ads;
    live.characterIndex = 2;
    live.deathSerial = 1;
    live.weaponIndex = 5;
    const out = makeEntitySnapshot();
    writeDormant(out, null, live);
    expect(out.flags).toBe(EFlag.Alive | EFlag.TeamB | EFlag.Bot | EFlag.Dormant);
    expect(out).toMatchObject({ entityId: 9, displayName: 'E9', characterIndex: 2, deathSerial: 1, x: 0, z: 0, weaponIndex: 255 });
  });
});
