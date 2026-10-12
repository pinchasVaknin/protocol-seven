import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import type { ObjectiveDef } from '../world/maps/types';
import type { Combatant } from '../ai/Combatant';
import { ObjectiveZone, recountZones, stackRate } from './ObjectiveZone';

/**
 * A capturable point, pinned.
 *
 * The three rules that decide every flag in the game are all here, and each one is a decision
 * somebody could reasonably have made the other way:
 *
 *  - **Contested means nothing moves.** Both sides standing on it does not average out and does
 *    not favour the holder — the gunfight is the tie-breaker. A zone that ticked for whoever had
 *    more bodies would make Domination a counting game.
 *  - **Stacking helps, then stops helping.** `stackRate` is the geometric series 1 + f + f² …,
 *    so a second body is worth 0.6 of the first and the fifth is worth almost nothing. That is
 *    what stops a team taking a flag in a second by standing on it in a pile.
 *  - **A new attacker resets the bank.** Part-captured progress belongs to the side that banked
 *    it, so the other side starts from zero rather than inheriting it.
 *
 * The arithmetic is per-tick float accumulation (`progress += rate / seconds * DT`), which feeds
 * the per-tick state hash, so these tests use exact comparisons where they can.
 */

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

function def(over: Partial<ObjectiveDef> = {}): ObjectiveDef {
  return { id: 'flag-a', kind: 'flag', position: { x: 0, y: 0, z: 0 }, radius: 4, label: 'A', ...over };
}

function body(entityId: number, team: 'A' | 'B', x = 0, y = 0, z = 0): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(x, y, z, 0);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team,
    px: x,
    py: y,
    pz: z,
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

/** A zone with `a` bodies of team A and `b` of team B standing on it. */
function occupied(a: number, b: number): ObjectiveZone {
  const zone = new ObjectiveZone(def());
  zone.countA = a;
  zone.countB = b;
  return zone;
}

/** Step until the zone changes hands, or give up. Returns the ticks it took, or -1. */
function ticksToCapture(zone: ObjectiveZone, limit = 2000): number {
  for (let tick = 1; tick <= limit; tick++) {
    if (zone.step() !== null) return tick;
  }
  return -1;
}

describe('a fresh zone', () => {
  it('is neutral, empty and uncaptured', () => {
    const zone = new ObjectiveZone(def());
    expect(zone.owner).toBe('NONE');
    expect(zone.progress).toBe(0);
    expect(zone.capturingTeam).toBe('NONE');
    expect(zone.countA).toBe(0);
    expect(zone.countB).toBe(0);
    expect(zone.contested).toBe(false);
  });

  it('takes its id and label from the map, which is where objectives are authored', () => {
    const zone = new ObjectiveZone(def({ id: 'bomb-b', label: 'B' }));
    expect(zone.id).toBe('bomb-b');
    expect(zone.label).toBe('B');
  });
});

describe('who is standing on it', () => {
  it('counts a body inside the radius', () => {
    const zone = new ObjectiveZone(def({ radius: 4 }));
    expect(zone.contains(body(1, 'A', 0, 0, 0))).toBe(true);
    expect(zone.contains(body(1, 'A', 3.9, 0, 0))).toBe(true);
    expect(zone.contains(body(1, 'A', 4.1, 0, 0))).toBe(false);
  });

  it('measures the radius in plan, not in three dimensions', () => {
    const zone = new ObjectiveZone(def({ radius: 4 }));
    expect(zone.contains(body(1, 'A', 2.9, 0, 2.9))).toBe(false);
    expect(zone.contains(body(1, 'A', 2.8, 0, 2.8))).toBe(true);
  });

  it('refuses a body on another floor, within the authored tolerance', () => {
    // A flag under a catwalk is not captured by somebody standing on the catwalk.
    const zone = new ObjectiveZone(def());
    expect(zone.contains(body(1, 'A', 0, 2.5, 0))).toBe(true);
    expect(zone.contains(body(1, 'A', 0, 2.7, 0))).toBe(false);
    expect(zone.contains(body(1, 'A', 0, -2.7, 0))).toBe(false);
  });

  it('refuses a body that is not participating', () => {
    const zone = new ObjectiveZone(def());
    expect(zone.contains({ ...body(1, 'A'), participating: false })).toBe(false);
  });

  it('is contested only while both sides are on it', () => {
    expect(occupied(1, 1).contested).toBe(true);
    expect(occupied(3, 2).contested).toBe(true);
    expect(occupied(2, 0).contested).toBe(false);
    expect(occupied(0, 0).contested).toBe(false);
  });
});

describe('capturing', () => {
  it('moves nothing while the point is contested', () => {
    const zone = occupied(2, 1);
    for (let tick = 0; tick < 100; tick++) expect(zone.step()).toBe(null);
    expect(zone.progress).toBe(0);
    expect(zone.owner).toBe('NONE');
  });

  it('banks progress for the side standing on it alone', () => {
    const zone = occupied(1, 0);
    expect(zone.step()).toBe(null);
    expect(zone.capturingTeam).toBe('A');
    expect(zone.progress).toBeCloseTo(DT / 6, 12);
  });

  it('changes hands the tick progress completes, and reports the new owner once', () => {
    const zone = occupied(1, 0);
    const ticks = ticksToCapture(zone);
    // Six authored seconds at one body: 6 / DT ticks, and the capture lands on the tick it
    // crosses rather than the one after.
    // 361, not the 360 the arithmetic suggests: six seconds of `DT / 6` added one tick at a
    // time lands on 0.999999999999997, a hair under the 1 that completes a capture, so the
    // last increment falls in the tick after. Pinned because it is the real number — a flag
    // takes 6.017 s and every DOM match in the oracles was measured with it.
    expect(ticks).toBe(361);
    expect(Math.ceil(6 / DT)).toBe(360);
    expect(zone.owner).toBe('A');
    expect(zone.progress).toBe(0);
    expect(zone.capturingTeam).toBe('NONE');
    // And it does not report the capture a second time.
    expect(zone.step()).toBe(null);
  });

  it('is faster with two bodies, but not twice as fast', () => {
    const alone = ticksToCapture(occupied(1, 0));
    const pair = ticksToCapture(occupied(2, 0));
    const five = ticksToCapture(occupied(5, 0));
    expect(pair).toBeLessThan(alone);
    expect(pair).toBeGreaterThan(alone / 2);
    // The series converges, so the fifth body buys almost nothing over the fourth.
    expect(five).toBeGreaterThan(alone / 3);
  });

  it('bleeds a part-capture away once the attackers leave', () => {
    const zone = occupied(1, 0);
    for (let tick = 0; tick < 30; tick++) zone.step();
    const banked = zone.progress;
    expect(banked).toBeGreaterThan(0);

    zone.countA = 0;
    zone.step();
    expect(zone.progress).toBeLessThan(banked);
    // Decay is half the capture rate, so leaving costs twice what standing there earned.
    expect(zone.progress).toBeCloseTo(banked - (0.5 / 6) * DT, 12);
  });

  it('settles at zero rather than going negative, and clears the claim', () => {
    const zone = occupied(1, 0);
    zone.step();
    zone.countA = 0;
    for (let tick = 0; tick < 200; tick++) expect(zone.step()).toBe(null);
    expect(zone.progress).toBe(0);
    expect(zone.capturingTeam).toBe('NONE');
  });

  it('bleeds a part-capture away while the holder stands on it too', () => {
    const zone = occupied(1, 0);
    ticksToCapture(zone);
    expect(zone.owner).toBe('A');
    // B banks some progress, then A arrives alone: the bank drains.
    zone.countA = 0;
    zone.countB = 1;
    for (let tick = 0; tick < 30; tick++) zone.step();
    const banked = zone.progress;
    zone.countB = 0;
    zone.countA = 1;
    zone.step();
    expect(zone.progress).toBeLessThan(banked);
  });

  it('resets the bank when the other side takes over the capture', () => {
    const zone = occupied(1, 0);
    for (let tick = 0; tick < 30; tick++) zone.step();
    expect(zone.capturingTeam).toBe('A');

    zone.countA = 0;
    zone.countB = 1;
    zone.step();
    expect(zone.capturingTeam).toBe('B');
    // B starts from nothing rather than inheriting what A had banked.
    expect(zone.progress).toBeCloseTo(DT / 6, 12);
  });

  it('is put back where it started by reset, owner and all', () => {
    const zone = occupied(1, 0);
    for (let tick = 0; tick < 40; tick++) zone.step();
    zone.reset('B');
    expect(zone.owner).toBe('B');
    expect(zone.progress).toBe(0);
    expect(zone.capturingTeam).toBe('NONE');
    expect(zone.countA).toBe(0);
    expect(zone.countB).toBe(0);
  });
});

describe('the stacking series', () => {
  it('is the geometric sum, so the first body is worth one', () => {
    expect(stackRate(0, 0.6)).toBe(0);
    expect(stackRate(1, 0.6)).toBe(1);
    expect(stackRate(2, 0.6)).toBe(1.6);
    expect(stackRate(3, 0.6)).toBeCloseTo(1 + 0.6 + 0.36, 12);
  });

  it('converges, which is why stacking stops helping', () => {
    const ten = stackRate(10, 0.6);
    const twenty = stackRate(20, 0.6);
    expect(twenty - ten).toBeLessThan(0.02);
    expect(twenty).toBeLessThan(2.5);
  });

  it('with no falloff is simply the head-count', () => {
    expect(stackRate(4, 1)).toBe(4);
    // And with total falloff, only the first body counts at all.
    expect(stackRate(4, 0)).toBe(1);
  });
});

describe('recounting every zone from the roster', () => {
  it('counts each side into the zone it is standing on', () => {
    const left = new ObjectiveZone(def({ id: 'left', position: { x: -20, y: 0, z: 0 } }));
    const right = new ObjectiveZone(def({ id: 'right', position: { x: 20, y: 0, z: 0 } }));
    recountZones([left, right], [body(1, 'A', -20), body(2, 'A', -19), body(3, 'B', 20)]);
    expect([left.countA, left.countB]).toEqual([2, 0]);
    expect([right.countA, right.countB]).toEqual([0, 1]);
  });

  it('clears the previous count rather than adding to it', () => {
    const zone = new ObjectiveZone(def());
    recountZones([zone], [body(1, 'A')]);
    recountZones([zone], [body(1, 'A')]);
    expect(zone.countA).toBe(1);
  });

  it('ignores a body that is not participating', () => {
    const zone = new ObjectiveZone(def());
    recountZones([zone], [{ ...body(1, 'A'), participating: false }]);
    expect(zone.countA).toBe(0);
  });

  it('counts one body into every zone it is inside', () => {
    // Overlapping zones are map data's business, not this function's.
    const one = new ObjectiveZone(def({ id: 'one', radius: 10 }));
    const two = new ObjectiveZone(def({ id: 'two', radius: 10, position: { x: 2, y: 0, z: 0 } }));
    recountZones([one, two], [body(1, 'A', 1)]);
    expect(one.countA).toBe(1);
    expect(two.countA).toBe(1);
  });
});
