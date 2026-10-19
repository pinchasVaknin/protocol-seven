import { describe, expect, it } from 'vitest';
import { HitboxRig, HUMANOID_LAYOUTS, HUMANOID_RIG, type RigLayout } from '../../shared/combat/HitboxRig';
import { DT } from '../../shared/core/Loop';
import { MAX_REWIND_MS } from '../../shared/net/Protocol';
import { Rewind, type Rewindable } from './Rewind';

/**
 * Lag compensation: the guarantees S4.13 asks for, as assertions (B1).
 *
 * Four of them are the whole feature and none was covered: every *other* rig moves to the
 * shooter's view tick, the shooter's does not, the 200 ms cap bites and is counted, and
 * `end()` puts everything back exactly — because a rewind that leaked would hand the next
 * tick's simulation a body in the past.
 *
 * A fifth is the degradation: an entity whose history does not hold the view tick stays in
 * the present and is counted as a miss, rather than being moved to a pose that was never real.
 */

const CROUCH: RigLayout = HUMANOID_LAYOUTS[1] ?? HUMANOID_RIG;

/** Milliseconds that round to `ticks` whole ticks, the way `begin` computes them. */
function msForTicks(ticks: number): number {
  return ticks * DT * 1000;
}

function entity(entityId: number, x: number, layout: RigLayout = HUMANOID_RIG): Rewindable {
  const rig = new HitboxRig(layout);
  rig.setTransform(x, 0, 0, 0);
  return { entityId, rig };
}

/**
 * A shooter and a mover, with the mover's z stepping one metre per tick over ticks 0..`until`
 * so a rewound pose is readable off the z it lands on.
 */
function world(until: number): { rewind: Rewind; shooter: Rewindable; mover: Rewindable } {
  const rewind = new Rewind();
  const shooter = entity(1, 10);
  const mover = entity(2, -10);
  rewind.register(shooter);
  rewind.register(mover);
  for (let tick = 0; tick <= until; tick++) {
    mover.rig.setTransform(-10, 0, tick, 0);
    rewind.record(tick);
  }
  return { rewind, shooter, mover };
}

describe('Rewind', () => {
  it('moves every other rig to the view tick and leaves the shooter where it is', () => {
    const { rewind, shooter, mover } = world(20);

    const rec = rewind.begin(shooter.entityId, 20, msForTicks(3));
    expect([rec.appliedTicks, rec.viewTick, rec.moved, rec.missed]).toEqual([3, 17, 1, 0]);
    expect(mover.rig.z).toBe(17);
    expect(shooter.rig.x).toBe(10);
    expect(rec.clamped).toBe(false);
  });

  it('puts every rewound rig back exactly, the pose included', () => {
    const rewind = new Rewind();
    const shooter = entity(1, 10);
    const mover = entity(2, -10, CROUCH);
    rewind.register(shooter);
    rewind.register(mover);
    for (let tick = 0; tick <= 20; tick++) {
      mover.rig.setTransform(-10, 0, tick, 0.5);
      rewind.record(tick);
    }
    mover.rig.setLayout(HUMANOID_RIG);
    mover.rig.setTransform(-10, 0, 20, 0.5);

    rewind.begin(shooter.entityId, 20, msForTicks(5));
    expect(mover.rig.z).toBe(15);
    rewind.end();

    expect([mover.rig.x, mover.rig.z, mover.rig.yaw]).toEqual([-10, 20, 0.5]);
    expect(mover.rig.layout).toBe(HUMANOID_RIG);
  });

  it('does nothing at all at zero rewind, and end() is safe after it', () => {
    const { rewind, shooter, mover } = world(20);

    const rec = rewind.begin(shooter.entityId, 20, 0);
    expect([rec.appliedTicks, rec.moved, rec.missed]).toEqual([0, 0, 0]);
    expect(mover.rig.z).toBe(20);
    expect(rewind.rewoundShots).toBe(0);
    rewind.end();
    expect(mover.rig.z).toBe(20);
  });

  it('rewinds nothing for a lag shorter than half a tick', () => {
    const { rewind, shooter, mover } = world(20);

    const rec = rewind.begin(shooter.entityId, 20, 8);
    expect(rec.appliedTicks).toBe(0);
    expect(mover.rig.z).toBe(20);
  });

  it('clamps at the 200 ms cap, says so, and counts the clamped shot', () => {
    const { rewind, shooter, mover } = world(60);

    const rec = rewind.begin(shooter.entityId, 60, 400);
    expect(rec.requestedMs).toBe(400);
    expect(rec.appliedMs).toBe(MAX_REWIND_MS);
    expect(rec.clamped).toBe(true);
    expect(rec.appliedTicks).toBe(Math.round(MAX_REWIND_MS / (DT * 1000)));
    expect(mover.rig.z).toBe(60 - rec.appliedTicks);
    expect(rewind.clampedShots).toBe(1);
  });

  it('leaves an entity whose history does not hold the tick in the present, and counts the miss', () => {
    const { rewind, shooter, mover } = world(20);
    const latecomer = entity(3, 5);
    rewind.register(latecomer);

    const rec = rewind.begin(shooter.entityId, 20, msForTicks(4));
    expect([rec.moved, rec.missed]).toEqual([1, 1]);
    expect(mover.rig.z).toBe(16);
    expect(latecomer.rig.x).toBe(5);
  });

  it('fills a spawned entity\'s history, so the tick it spawned on resolves', () => {
    const { rewind, shooter } = world(20);
    const spawned = entity(3, 7);
    rewind.register(spawned);
    rewind.resetAt(spawned.entityId, 16);
    spawned.rig.setTransform(99, 0, 0, 0);

    const rec = rewind.begin(shooter.entityId, 20, msForTicks(4));
    expect(rec.viewTick).toBe(16);
    expect(rec.missed).toBe(0);
    expect(spawned.rig.x).toBe(7);
  });

  it('ignores a resetAt for an entity it does not have', () => {
    const { rewind } = world(5);
    expect(() => rewind.resetAt(99, 5)).not.toThrow();
  });

  it('averages the applied milliseconds over the shots that were rewound', () => {
    const { rewind, shooter } = world(60);

    rewind.begin(shooter.entityId, 60, msForTicks(3));
    rewind.end();
    rewind.begin(shooter.entityId, 60, msForTicks(9));
    rewind.end();
    // The zero-rewind shot is not one of them.
    rewind.begin(shooter.entityId, 60, 0);
    rewind.end();

    expect(rewind.rewoundShots).toBe(2);
    expect(rewind.meanAppliedMs).toBeCloseTo((msForTicks(3) + msForTicks(9)) / 2, 10);
  });

  it('has no mean before any shot was rewound', () => {
    expect(new Rewind().meanAppliedMs).toBe(0);
  });

  it('registers an entity once, however often it is offered', () => {
    const { rewind, shooter, mover } = world(20);
    rewind.register({ entityId: mover.entityId, rig: new HitboxRig() });

    const rec = rewind.begin(shooter.entityId, 20, msForTicks(2));
    expect(rec.moved).toBe(1);
  });

  it('forgets an unregistered entity, history and all', () => {
    const { rewind, shooter, mover } = world(20);
    rewind.unregister(mover.entityId);

    const first = rewind.begin(shooter.entityId, 20, msForTicks(2));
    expect([first.moved, first.missed]).toEqual([0, 0]);
    rewind.end();

    // Re-registering gives a fresh, empty history rather than the one it had.
    rewind.register(mover);
    const second = rewind.begin(shooter.entityId, 20, msForTicks(2));
    expect([second.moved, second.missed]).toEqual([0, 1]);
  });

  it('reports where an entity really is while the rewind is in effect, and nothing after it', () => {
    const { rewind, shooter, mover } = world(20);

    rewind.begin(shooter.entityId, 20, msForTicks(6));
    const present = rewind.presentOf(mover.entityId);
    expect(present?.z).toBe(20);
    expect(mover.rig.z).toBe(14);
    expect(rewind.presentOf(shooter.entityId)).toBeUndefined();

    rewind.end();
    expect(rewind.presentOf(mover.entityId)).toBeUndefined();
  });

  it('carries the server tick and the requested lag into the record for the S7 panel', () => {
    const { rewind, shooter } = world(30);

    const rec = rewind.begin(shooter.entityId, 30, msForTicks(7));
    expect(rec.serverTick).toBe(30);
    expect(rec.viewTick).toBe(23);
    expect(rec).toBe(rewind.last);
  });
});
