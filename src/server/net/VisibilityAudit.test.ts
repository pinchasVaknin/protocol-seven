import { describe, expect, it } from 'vitest';
import { EFlag, makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import { DEFAULT_MOVEMENT_CONFIG } from '../../shared/player/MovementConfig';
import { ColliderSet } from '../../shared/world/ColliderSet';
import { CollisionWorld } from '../../shared/world/CollisionWorld';
import type { RelevanceContext } from './Relevance';
import { SeatView } from './SeatView';
import type { BombInfo } from '../../shared/modes/GameMode';
import { emptyAuditStats, SeatAudit } from './VisibilityAudit';

/**
 * The audit grades culling; this grades the audit. An instrument that never fires reads exactly
 * like a culler that never fails, so each verdict is produced here on purpose.
 */

function room(): CollisionWorld {
  const set = new ColliderSet(4);
  set.add({ x: 0, y: -1, z: 0 }, { x: 60, y: 2, z: 60 }, 0, 0, 0, 'floor');
  // A wall across x = 10 with a doorway at |z| < 1.
  set.add({ x: 10, y: 2, z: -5.5 }, { x: 0.3, y: 4, z: 9 }, 0, 0, 0, 'concrete');
  set.add({ x: 10, y: 2, z: 5.5 }, { x: 0.3, y: 4, z: 9 }, 0, 0, 0, 'concrete');
  const world = new CollisionWorld(set, { min: { x: -30, y: -8, z: -30 }, max: { x: 30, y: 24, z: 30 } }, 4);
  world.configure(DEFAULT_MOVEMENT_CONFIG.maxSlopeDeg, DEFAULT_MOVEMENT_CONFIG.collisionSkin);
  return world;
}

// No look-ahead and no reach, so a body is relevant exactly when it is visible: every appearance is
// as late as an appearance can be. That is the culler the audit has to catch.
const CTX: RelevanceContext = { world: room(), freeForAll: false, lookAheadSec: 0 };
const DRAW_DELAY = 100;
const NOBODY = (): boolean => false;

function body(entityId: number, x: number, z: number, team: 'A' | 'B'): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.x = x;
  e.z = z;
  e.flags = EFlag.Alive | (team === 'B' ? EFlag.TeamB : 0);
  return e;
}

function run(
  view: SeatView,
  audit: SeatAudit,
  stats: ReturnType<typeof emptyAuditStats>,
  from: number,
  to: number,
  entities: EntitySnapshot[],
  hidden: (id: number) => boolean = NOBODY,
): void {
  for (let t = from; t <= to; t += 50) {
    view.build(t, 1, entities, entities.length, CTX, false, false, hidden);
    audit.observe(t, view, 1, entities, entities.length, CTX, DRAW_DELAY, stats);
  }
}

describe('SeatAudit', () => {
  it('counts a body in plain view that was sent dormant as a hard miss, every snapshot', () => {
    const view = new SeatView();
    const audit = new SeatAudit();
    const stats = emptyAuditStats();
    // In the doorway's line, and dormant by `Unseen` — exactly what a broken culler would send.
    run(view, audit, stats, 0, 1000, [body(1, 0, 0, 'A'), body(2, 20, 0, 'B')], (id) => id === 2);
    expect(stats.hardMisses).toBe(stats.visible);
    expect(stats.hardMisses).toBeGreaterThan(10);
  });

  it('counts a body that is relevant only from the moment it is visible as one late wake', () => {
    const view = new SeatView();
    const audit = new SeatAudit();
    const stats = emptyAuditStats();
    const viewer = body(1, 0, 0, 'A');
    const enemy = body(2, 20, 6, 'B');
    run(view, audit, stats, 0, 500, [viewer, enemy]);
    expect(stats.appearances).toBe(0);
    // Steps into the doorway's line: visible and relevant in the same snapshot.
    enemy.z = 0;
    run(view, audit, stats, 550, 1000, [viewer, enemy]);
    expect(stats.appearances).toBe(1);
    expect(stats.lateWakes).toBe(1);
    expect(stats.worstShortfallMs).toBe(DRAW_DELAY);
    expect(stats.hardMisses).toBe(0);
  });

  it('does not count a body that appears by respawning in view', () => {
    const view = new SeatView();
    const audit = new SeatAudit();
    const stats = emptyAuditStats();
    const viewer = body(1, 0, 0, 'A');
    const enemy = body(2, 20, 6, 'B');
    run(view, audit, stats, 0, 500, [viewer, enemy]);
    enemy.z = 0;
    enemy.spawnSerial++;
    run(view, audit, stats, 550, 1000, [viewer, enemy]);
    expect(stats.appearances).toBe(1);
    expect(stats.lateWakes).toBe(0);
  });

  it('counts a hit from a dormant shooter, and R9 waking it by the next snapshot', () => {
    const view = new SeatView();
    const audit = new SeatAudit();
    const stats = emptyAuditStats();
    const viewer = body(1, 0, 0, 'A');
    // Behind the wall: dormant to the viewer.
    const shooter = body(2, 20, 6, 'B');
    run(view, audit, stats, 0, 500, [viewer, shooter]);
    audit.noteHurt(view, 2, stats);
    view.reveal(2, 500);
    run(view, audit, stats, 550, 550, [viewer, shooter]);
    expect(stats.hurtTotal).toBe(1);
    expect(stats.hurtFromDormant).toBe(1);
    expect(stats.hurtStillDormant).toBe(0);
  });

  it('counts the shooter still dormant when nothing woke it — what a missing R9 looks like', () => {
    const view = new SeatView();
    const audit = new SeatAudit();
    const stats = emptyAuditStats();
    const viewer = body(1, 0, 0, 'A');
    const shooter = body(2, 20, 6, 'B');
    run(view, audit, stats, 0, 500, [viewer, shooter]);
    audit.noteHurt(view, 2, stats);
    // The hit killed the viewer: still graded, because the death report wants the killer too.
    viewer.flags &= ~EFlag.Alive;
    run(view, audit, stats, 550, 550, [viewer, shooter]);
    expect(stats.hurtStillDormant).toBe(1);
  });

  it('does not count a hit from a shooter the viewer could already see', () => {
    const view = new SeatView();
    const audit = new SeatAudit();
    const stats = emptyAuditStats();
    run(view, audit, stats, 0, 500, [body(1, 0, 0, 'A'), body(2, 20, 0, 'B')]);
    audit.noteHurt(view, 2, stats);
    expect(stats.hurtTotal).toBe(1);
    expect(stats.hurtFromDormant).toBe(0);
  });

  describe('the bomb', () => {
    const bomb = (x: number, z: number, carrierId = 2): BombInfo => ({
      state: 'CARRIED',
      carrierId,
      attackers: 'B',
      x,
      y: 0,
      z,
      secondsLeft: 0,
      interactFraction: 0,
      interactEntity: -1,
      plantedSiteIndex: -1,
    });
    const seen = (): SeatView => {
      const view = new SeatView();
      // The carrier is first seen through the doorway, then walks behind the wall and goes dormant.
      const viewer = body(1, 0, 0, 'A');
      const carrier = body(2, 20, 0, 'B');
      view.build(0, 1, [viewer, carrier], 2, CTX, false, false, NOBODY);
      carrier.z = 6;
      view.build(1000, 1, [viewer, carrier], 2, CTX, false, false, NOBODY);
      return view;
    };

    it('passes a carried bomb sent where the seat last saw its unseen carrier', () => {
      const stats = emptyAuditStats();
      new SeatAudit().observeBomb(bomb(20, 0), bomb(20, 6), seen(), stats);
      expect(stats).toMatchObject({ bombCarried: 1, bombCarrierUnseen: 1, bombLeaks: 0 });
    });

    it("catches the old send: the carrier's real place on a seat that cannot see it", () => {
      const stats = emptyAuditStats();
      new SeatAudit().observeBomb(bomb(20, 6), bomb(20, 6), seen(), stats);
      expect(stats.bombLeaks).toBe(1);
    });

    it('ignores a bomb on the floor, which is public', () => {
      const stats = emptyAuditStats();
      new SeatAudit().observeBomb(bomb(20, 6, -1), bomb(20, 6, -1), seen(), stats);
      expect(stats.bombCarried).toBe(0);
    });
  });
});
