import { describe, expect, it } from 'vitest';
import { DT } from '../core/Loop';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import {
  accelerate,
  applyFriction,
  capsuleFits,
  clampHorizontalSpeed,
  integrateMotion,
  jumpVelocity,
  movementDebug,
} from './Movement';
import { DEFAULT_MOVEMENT_CONFIG } from './MovementConfig';
import { PlayerSim } from './PlayerState';

/**
 * Movement integration, against real collision geometry.
 *
 * This is the file three playtest rounds were spent in, and every number in it is the answer to
 * a report that took a round to diagnose:
 *
 *  - **friction is decomposed against the command** rather than scaling the whole velocity,
 *    because the obvious version has a terminal speed of `groundAccel / friction` — 5.0 m/s —
 *    which silently caps sprint at below walk-plus and makes the whole S5.1 speed table
 *    unreachable;
 *  - **the step-up probes forward by a radius, not by a tick**, because a capsule's bottom is a
 *    hemisphere and is only over a tread once its centre has passed the lip;
 *  - **and it is gated twice**, because a radius-long probe whose answer becomes the move is
 *    20.6 m/s against a flat wall, which is the "wall-strafing super speed" report;
 *  - **gravity does not press into ground already underfoot**, because it did, and that was a
 *    5 mm vertical limit cycle at twenty-odd hertz and a steady creep down every ramp.
 *
 * Every one of those is a specific wrong number that looked plausible, so the assertions here are
 * exact. Where a value is a long float it is the accumulation of sixty-hertz integration and is
 * deterministic to the bit — which is the property `npm run hashrun` depends on.
 */

const CFG = DEFAULT_MOVEMENT_CONFIG;

/** A world with a 200 m floor whose top is exactly y = 0, plus whatever the case adds. */
function world(build: (set: ColliderSet) => void = () => {}): CollisionWorld {
  const set = new ColliderSet(8);
  set.add({ x: 0, y: -1, z: 0 }, { x: 200, y: 2, z: 200 }, 0, 0, 0, 'concrete');
  build(set);
  const w = new CollisionWorld(set, { min: { x: -100, y: -8, z: -100 }, max: { x: 100, y: 24, z: 100 } }, 8);
  w.configure(CFG.maxSlopeDeg, CFG.collisionSkin);
  return w;
}

function body(over: Partial<PlayerSim> = {}): PlayerSim {
  const sim = new PlayerSim();
  sim.capsuleHeight = CFG.standHeight;
  sim.grounded = true;
  sim.wasGrounded = true;
  sim.groundNy = 1;
  Object.assign(sim, over);
  return sim;
}

describe('ground friction', () => {
  it('bleeds everything when nothing is commanded', () => {
    // 5 m/s less 5 * 12 * DT: with no command every component is "across".
    const sim = body({ vx: 5, vz: 0 });
    applyFriction(sim, CFG, 0, 0, 0);
    expect(sim.vx).toBe(4);
    expect(sim.vz).toBe(0);
  });

  it('goes linear below the stop speed so the player actually reaches zero', () => {
    // Below `stopSpeed` the drop uses `stopSpeed` as the control value — a fixed 0.24 m/s per
    // tick — which is what stops the asymptotic creep: three ticks from 0.5 to a hard zero,
    // rather than forever.
    const sim = body({ vx: 0.5, vz: 0 });
    applyFriction(sim, CFG, 0, 0, 0);
    expect(sim.vx).toBe(0.26);
    applyFriction(sim, CFG, 0, 0, 0);
    expect(sim.vx).toBe(0.020000000000000046);
    applyFriction(sim, CFG, 0, 0, 0);
    expect(sim.vx).toBe(0);
  });

  it('snaps a numerically dead velocity to a real zero', () => {
    const sim = body({ vx: 1e-6, vz: 0 });
    applyFriction(sim, CFG, 1, 0, CFG.walkSpeed);
    expect(sim.vx).toBe(0);
    expect(sim.vz).toBe(0);
  });

  it('takes only the excess from the component along the command', () => {
    // 8 m/s out of a slide, sprint commanded: the excess above 6.9 bleeds, the rest does not.
    // This is what lets a slide-jump's momentum decay to sprint speed instead of being cut.
    const sim = body({ vx: 8, vz: 0 });
    applyFriction(sim, CFG, 1, 0, CFG.sprintSpeed);
    expect(sim.vx).toBe(7.76);
  });

  it('leaves a component under the target completely alone', () => {
    // Ordinary running therefore reaches exactly the number in the config rather than
    // `groundAccel / friction`.
    const sim = body({ vx: 3, vz: 0 });
    applyFriction(sim, CFG, 1, 0, CFG.sprintSpeed);
    expect(sim.vx).toBe(3);
  });

  it('gives the component across the command full friction, which is what makes turning crisp', () => {
    const sim = body({ vx: 0, vz: 4 });
    applyFriction(sim, CFG, 1, 0, CFG.walkSpeed);
    expect(sim.vx).toBe(0);
    expect(sim.vz).toBe(3.2);
  });

  it('helps the turn when the body is running against the command', () => {
    const sim = body({ vx: -3, vz: 0 });
    applyFriction(sim, CFG, 1, 0, CFG.walkSpeed);
    expect(sim.vx).toBe(-2.4);
  });

  it('treats a command with no speed behind it as no command', () => {
    const commanded = body({ vx: 5, vz: 0 });
    applyFriction(commanded, CFG, 1, 0, 0);
    const silent = body({ vx: 5, vz: 0 });
    applyFriction(silent, CFG, 0, 0, 0);
    expect(commanded.vx).toBe(silent.vx);
  });
});

describe('acceleration', () => {
  it('adds the tick\'s worth toward the command', () => {
    const sim = body();
    accelerate(sim, 1, 0, CFG.walkSpeed, CFG.groundAccel);
    expect(sim.vx).toBe(1);
  });

  it('never compounds momentum already above the target', () => {
    // The whole movement system is bounded by this early-out: a player at 8 m/s out of a slide
    // gains nothing by holding forward in the air.
    const sim = body({ vx: 8, vz: 0 });
    accelerate(sim, 1, 0, CFG.sprintSpeed, CFG.groundAccel);
    expect(sim.vx).toBe(8);
  });

  it('adds only what is left when the target is within one tick', () => {
    const sim = body({ vx: 4.59, vz: 0 });
    accelerate(sim, 1, 0, CFG.walkSpeed, CFG.groundAccel);
    expect(sim.vx).toBe(4.6);
  });

  it('does nothing at all without a target speed', () => {
    const sim = body({ vx: 2, vz: 0 });
    accelerate(sim, 1, 0, 0, CFG.groundAccel);
    expect(sim.vx).toBe(2);
  });
});

describe('the hard speed limit', () => {
  it('scales the whole horizontal velocity down to the limit', () => {
    // 6-8-10 scaled to 5. Acceleration alone cannot bound this: sliding along a wall with the
    // stick held diagonally leaves the parallel velocity at `cap / cos(theta)`.
    const sim = body({ vx: 6, vz: 8 });
    clampHorizontalSpeed(sim, 5);
    expect(sim.vx).toBe(3);
    expect(sim.vz).toBe(4);
  });

  it('leaves anything already inside the limit untouched', () => {
    const sim = body({ vx: 3, vz: 4 });
    clampHorizontalSpeed(sim, 5);
    expect(sim.vx).toBe(3);
    expect(sim.vz).toBe(4);
  });

  it('leaves the vertical component out of it', () => {
    const sim = body({ vx: 10, vz: 0, vy: -20 });
    clampHorizontalSpeed(sim, 5);
    expect(sim.vy).toBe(-20);
  });
});

describe('the jump impulse', () => {
  it('is the velocity that reaches the configured height under the configured gravity', () => {
    expect(jumpVelocity(CFG)).toBe(5.848076606885378);
    expect(jumpVelocity(CFG)).toBe(Math.sqrt(2 * CFG.gravity * CFG.jumpHeight));
    // Apex height back out of it, which is the number S5.1 authored.
    expect(jumpVelocity(CFG) ** 2 / (2 * CFG.gravity)).toBeCloseTo(CFG.jumpHeight, 12);
  });
});

describe('the capsule fit test', () => {
  it('is true in the open and false inside geometry', () => {
    const w = world((set) => set.add({ x: 0, y: 1.5, z: 4 }, { x: 4, y: 3, z: 1 }, 0, 0, 0, 'concrete'));
    expect(capsuleFits(w, CFG, 0, 0.1, 0, CFG.standHeight)).toBe(true);
    expect(capsuleFits(w, CFG, 0, 0.1, 4, CFG.standHeight)).toBe(false);
  });

  it('is what makes a low ceiling refuse a standing body but accept a crouched one', () => {
    // A soffit from 1.4 m up: 1.8 m does not fit under it, 1.1 m does.
    const w = world((set) => set.add({ x: 0, y: 1.7, z: 0 }, { x: 4, y: 0.6, z: 4 }, 0, 0, 0, 'concrete'));
    expect(capsuleFits(w, CFG, 0, 0.05, 0, CFG.standHeight)).toBe(false);
    expect(capsuleFits(w, CFG, 0, 0.05, 0, CFG.crouchHeight)).toBe(true);
  });
});

describe('integrating one tick of motion', () => {
  it('walks across flat ground without drifting vertically', () => {
    // The round-4 finding: a grounded body is *supported*, not falling, so standing on the floor
    // has no vertical limit cycle in it. Ten ticks at the walk cap, and `y` is still floor level
    // to within one de-penetration residue.
    const sim = body({ x: 0, y: 0.1, z: 0, vx: CFG.walkSpeed, vz: 0 });
    for (let tick = 0; tick < 10; tick++) integrateMotion(sim, CFG, world());
    expect(sim.x).toBe(0.7666666666666666);
    expect(sim.y).toBe(1.0061396160665481e-16);
    expect(sim.vx).toBe(CFG.walkSpeed);
    expect(sim.grounded).toBe(true);
    expect(sim.steppedUp).toBe(false);
    expect(sim.blockedHorizontally).toBe(false);
    expect(sim.justLanded).toBe(false);
  });

  it('climbs a 0.3 m step, once, and keeps going', () => {
    const stepped = world((set) =>
      set.add({ x: 4, y: 0.15, z: 0 }, { x: 4, y: 0.3, z: 8 }, 0, 0, 0, 'concrete'),
    );
    const sim = body({ x: 0, y: 0.1, z: 0 });
    let steppedTicks = 0;
    for (let tick = 0; tick < 60; tick++) {
      sim.vx = CFG.walkSpeed;
      integrateMotion(sim, CFG, stepped);
      if (sim.steppedUp) steppedTicks++;
    }
    // Up onto the tread and away along it.
    expect(sim.y).toBe(0.3000000119209289);
    expect(sim.x).toBe(4.841101997980008);
    expect(sim.grounded).toBe(true);
    // **Once per obstacle, not once per tick.** The round-3 regression was this firing every
    // tick for as long as forward was held, which is where the 20 m/s came from.
    expect(steppedTicks).toBe(1);
  });

  it('is stopped by a wall, and gains no speed from trying to step it', () => {
    const walled = world((set) =>
      set.add({ x: 3, y: 1.5, z: 0 }, { x: 0.4, y: 3, z: 20 }, 0, 0, 0, 'concrete'),
    );
    const sim = body({ x: 0, y: 0.1, z: 0 });
    for (let tick = 0; tick < 60; tick++) {
      sim.vx = CFG.walkSpeed;
      integrateMotion(sim, CFG, walled);
    }
    // Pressed against the face and no further: radius plus skin short of the wall's near side.
    expect(sim.x).toBe(2.444999997019768);
    expect(sim.steppedUp).toBe(false);
    // The looser flag stays true — `PlayerController` reads it to decide an auto-vault, and that
    // is a question about touching something rather than about being stopped by it.
    expect(sim.blockedHorizontally).toBe(true);
  });

  it('slides along a wall at walking speed and not twenty metres a second', () => {
    // The wall-strafing super-speed report, pinned. Diagonally into the face, 120 ticks: the
    // tangential component is all that survives, and it is exactly the commanded 3.25 m/s.
    const walled = world((set) =>
      set.add({ x: 3, y: 1.5, z: 0 }, { x: 0.4, y: 3, z: 20 }, 0, 0, 0, 'concrete'),
    );
    const sim = body({ x: 0, y: 0.1, z: 0 });
    const diagonal = CFG.walkSpeed * 0.7071;
    for (let tick = 0; tick < 120; tick++) {
      sim.vx = diagonal;
      sim.vz = diagonal;
      integrateMotion(sim, CFG, walled);
    }
    expect(sim.x).toBe(2.444999997019768);
    expect(sim.z).toBe(6.50531999999998);
    // Per tick, which is the number the report was about: 0.054 m, i.e. 3.25 m/s.
    expect(sim.z / 120).toBe(0.05421099999999983);
    expect(sim.z / 120 / DT).toBeCloseTo(diagonal, 9);
  });

  it('stays glued walking off a 0.3 m ledge, so it is a step down and not a fall', () => {
    const ledge = world((set) =>
      set.add({ x: -4, y: 0.15, z: 0 }, { x: 8, y: 0.3, z: 8 }, 0, 0, 0, 'concrete'),
    );
    const sim = body({ x: -0.6, y: 0.3, z: 0 });
    const heights: number[] = [];
    for (let tick = 0; tick < 20; tick++) {
      sim.vx = CFG.walkSpeed;
      integrateMotion(sim, CFG, ledge);
      const settled = Number(sim.y.toFixed(5));
      // The de-penetration residue is signed, and a negative zero is still floor level.
      heights.push(settled === 0 ? 0 : settled);
    }
    // Walks the deck, eases down over three ticks as the capsule's hemisphere rolls off the
    // lip, and is on the floor — grounded the whole way.
    expect(heights).toEqual([
      0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.29975, 0.28835, 0.25823, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(sim.grounded).toBe(true);
    // Never airborne, so never a landing: `groundSnapDist` is what keeps the body attached.
    expect(sim.justLanded).toBe(false);
  });

  it('falls, lands once, and reports the impact speed it landed at', () => {
    const flat = world();
    const sim = body({ x: 0, y: 3, z: 0, grounded: false, wasGrounded: false });
    let landTick = -1;
    let landings = 0;
    for (let tick = 0; tick < 90; tick++) {
      sim.vy -= CFG.gravity * DT;
      integrateMotion(sim, CFG, flat);
      if (sim.justLanded) {
        landings++;
        if (landTick < 0) landTick = tick;
      }
    }
    // Three metres under 18 m/s², and the flag is true on exactly one tick.
    expect(landTick).toBe(34);
    expect(landings).toBe(1);
    expect(sim.landImpact).toBe(10.500000000000004);
    expect(sim.grounded).toBe(true);
    expect(sim.y).toBe(-2.5153490401663703e-17);
  });

  it('captures contacts only when the debug overlay asks', () => {
    const walled = world((set) =>
      set.add({ x: 3, y: 1.5, z: 0 }, { x: 0.4, y: 3, z: 20 }, 0, 0, 0, 'concrete'),
    );
    const sim = body({ x: 2.4, y: 0.1, z: 0, vx: CFG.walkSpeed });
    expect(movementDebug.capture).toBe(false);
    integrateMotion(sim, CFG, walled);
    expect(movementDebug.count).toBe(0);

    movementDebug.capture = true;
    try {
      integrateMotion(sim, CFG, walled);
      expect(movementDebug.count).toBeGreaterThan(0);
    } finally {
      // Off by default, costing one branch per pass: leave it as it was found.
      movementDebug.capture = false;
      movementDebug.count = 0;
    }
  });
});
