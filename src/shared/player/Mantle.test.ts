import { describe, expect, it } from 'vitest';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { beginMantle, detectMantle, makeMantleTarget, stepMantle } from './Mantle';
import { DEFAULT_MOVEMENT_CONFIG } from './MovementConfig';
import { PlayerSim } from './PlayerState';

/**
 * Ledge detection and the vault.
 *
 * Detection is two raycasts and then a question the probes cannot answer: *does a body fit up
 * there?* That last step is the one acceptance criterion 3 is about — mantling into a low
 * ceiling has to finish crouched rather than clipping — and it is answered with the real capsule
 * against the real collision world, which is why these tests build geometry rather than stub it.
 *
 * The refusals matter as much as the acceptances. A ledge the detector accepts and the mover
 * cannot reach is a bot or a player stuck against a wall for the rest of a match, so "too low",
 * "too high", "that is a ramp" and "nothing fits at the top" each have a test.
 *
 * The bake's climb links lean on the same window (`NavGrid.climbFrom`), so these numbers are
 * also what the navmesh promises a bot it can cross.
 */

const CFG = DEFAULT_MOVEMENT_CONFIG;

/** Facing +x, which is what a yaw of -pi/2 means: `fx = -sin(yaw)`, `fz = -cos(yaw)`. */
const FACING_PLUS_X = -Math.PI / 2;

/**
 * A floor at y = 0 and a block `height` tall whose near face is at x = 1, plus an optional
 * soffit over the top of it.
 */
function ledgeWorld(height: number, soffitAbove = 0): CollisionWorld {
  const set = new ColliderSet(4);
  set.add({ x: 0, y: -1, z: 0 }, { x: 200, y: 2, z: 200 }, 0, 0, 0, 'concrete');
  set.add({ x: 3, y: height / 2, z: 0 }, { x: 4, y: height, z: 8 }, 0, 0, 0, 'concrete');
  if (soffitAbove > 0) {
    set.add({ x: 3, y: height + soffitAbove, z: 0 }, { x: 4, y: 0.4, z: 8 }, 0, 0, 0, 'concrete');
  }
  const world = new CollisionWorld(
    set,
    { min: { x: -100, y: -8, z: -100 }, max: { x: 100, y: 24, z: 100 } },
    8,
  );
  world.configure(CFG.maxSlopeDeg, CFG.collisionSkin);
  return world;
}

function body(over: Partial<PlayerSim> = {}): PlayerSim {
  const sim = new PlayerSim();
  sim.capsuleHeight = CFG.standHeight;
  sim.grounded = true;
  sim.wasGrounded = true;
  sim.groundNy = 1;
  sim.yaw = FACING_PLUS_X;
  Object.assign(sim, over);
  return sim;
}

describe('a fresh mantle target', () => {
  it('starts empty and standing', () => {
    expect(makeMantleTarget()).toEqual({
      toX: 0,
      toY: 0,
      toZ: 0,
      dirX: 0,
      dirZ: 0,
      ledgeHeight: 0,
      endStance: 'STAND',
    });
  });
});

describe('finding a ledge', () => {
  it('takes one inside the authored window, and reports where the body lands', () => {
    const target = makeMantleTarget();
    expect(detectMantle(body(), CFG, ledgeWorld(0.8), target)).toBe(true);
    // Past the face by a radius and a skin, two centimetres above the top surface.
    expect(target.toX).toBe(1.4700000000000002);
    // The collider stores its extents as Float32, so a ledge authored at 0.8 m is read back
    // as 0.800000011920929 — pinned as it is, because the bake's climb links read the same bits.
    expect(target.toY).toBe(0.820000011920929);
    // `simSin` of -pi/2 is not exactly -1, so the landing is a fraction of a nanometre off the
    // axis. That is the deterministic sine the whole simulation shares, so it is pinned, not hidden.
    expect(target.toZ).toBe(-9.001153973215378e-17);
    expect(target.ledgeHeight).toBe(0.800000011920929);
    expect(target.endStance).toBe('STAND');
    // The direction is the look direction, which is what the vault swings along.
    expect(target.dirX).toBe(1);
    expect(Math.abs(target.dirZ)).toBeLessThan(1e-15);
  });

  it('takes the tallest the window allows', () => {
    const target = makeMantleTarget();
    expect(detectMantle(body(), CFG, ledgeWorld(1.2), target)).toBe(true);
    expect(target.toY).toBe(1.2200000476837158);
    expect(target.ledgeHeight).toBe(1.2000000476837158);
    expect(target.ledgeHeight).toBeLessThanOrEqual(CFG.mantleMaxHeight);
  });

  it('refuses a step, because a step is not a vault', () => {
    // 0.3 m is under `mantleMinHeight` and over `stepHeight`'s job: the step-up takes it
    // silently, and offering a vault for it would be two systems for one obstacle.
    const target = makeMantleTarget();
    expect(detectMantle(body(), CFG, ledgeWorld(0.3), target)).toBe(false);
    expect(CFG.mantleMinHeight).toBeGreaterThan(CFG.stepHeight);
  });

  it('refuses a wall', () => {
    const target = makeMantleTarget();
    expect(detectMantle(body(), CFG, ledgeWorld(1.9), target)).toBe(false);
    expect(1.9).toBeGreaterThan(CFG.mantleMaxHeight);
  });

  it('refuses a ramp, whose face is not a ledge face', () => {
    // The `ny` gate: a ledge face is near-vertical, and a ramp is something you walk up.
    const set = new ColliderSet(2);
    set.add({ x: 0, y: -1, z: 0 }, { x: 200, y: 2, z: 200 }, 0, 0, 0, 'concrete');
    set.add({ x: 3, y: 0.5, z: 0 }, { x: 3, y: 1, z: 8 }, 0, 0, 0.5, 'concrete');
    const world = new CollisionWorld(
      set,
      { min: { x: -100, y: -8, z: -100 }, max: { x: 100, y: 24, z: 100 } },
      8,
    );
    world.configure(CFG.maxSlopeDeg, CFG.collisionSkin);
    expect(detectMantle(body(), CFG, world, makeMantleTarget())).toBe(false);
  });

  it('refuses thin air', () => {
    const set = new ColliderSet(1);
    set.add({ x: 0, y: -1, z: 0 }, { x: 200, y: 2, z: 200 }, 0, 0, 0, 'concrete');
    const world = new CollisionWorld(
      set,
      { min: { x: -100, y: -8, z: -100 }, max: { x: 100, y: 24, z: 100 } },
      8,
    );
    world.configure(CFG.maxSlopeDeg, CFG.collisionSkin);
    expect(detectMantle(body(), CFG, world, makeMantleTarget())).toBe(false);
  });

  it('refuses while the cooldown is running, so a vault cannot be chained', () => {
    expect(detectMantle(body({ mantleCooldown: 0.1 }), CFG, ledgeWorld(1.0), makeMantleTarget())).toBe(
      false,
    );
  });

  it('finishes crouched under a low ceiling rather than clipping into it', () => {
    // Acceptance criterion 3. A soffit 1.35 m over the ledge top leaves room for 1.1 m of body
    // and not for 1.8 m, and the detector says so by picking the stance rather than by refusing.
    const target = makeMantleTarget();
    expect(detectMantle(body(), CFG, ledgeWorld(1.0, 1.35), target)).toBe(true);
    expect(target.endStance).toBe('CROUCH');
  });

  it('refuses outright when nothing fits at the top', () => {
    // Half a metre of headroom is not a body in any stance. Refuse rather than push a player
    // into geometry.
    expect(detectMantle(body(), CFG, ledgeWorld(1.0, 0.75), makeMantleTarget())).toBe(false);
  });

  it('leaves the target alone when it refuses', () => {
    const target = makeMantleTarget();
    detectMantle(body(), CFG, ledgeWorld(0.8), target);
    const taken = { ...target };
    // A refusal must not half-write the record the caller is about to read.
    expect(detectMantle(body({ mantleCooldown: 1 }), CFG, ledgeWorld(0.8), target)).toBe(false);
    expect(target).toEqual(taken);
  });
});

describe('the vault itself', () => {
  it('poses the body from the pose it started in and stops its velocity', () => {
    const sim = body({ x: 0, y: 0, z: 0, vx: 5, vy: 2, vz: 1 });
    const target = makeMantleTarget();
    detectMantle(sim, CFG, ledgeWorld(1.0), target);
    beginMantle(sim, target);

    expect(sim.mantleActive).toBe(true);
    expect(sim.stance).toBe('MANTLE');
    expect(sim.mantleElapsed).toBe(0);
    expect([sim.mantleFromX, sim.mantleFromY, sim.mantleFromZ]).toEqual([0, 0, 0]);
    expect(sim.mantleToY).toBe(1.02);
    expect([sim.vx, sim.vy, sim.vz]).toEqual([0, 0, 0]);
    // A body being pulled up a ledge is not standing on anything.
    expect(sim.grounded).toBe(false);
  });

  it('rises first and swings forward as it clears the lip', () => {
    const sim = body({ x: 0, y: 0, z: 0 });
    const target = makeMantleTarget();
    detectMantle(sim, CFG, ledgeWorld(1.0), target);
    beginMantle(sim, target);

    const poses: string[] = [];
    let finished = false;
    let ticks = 0;
    while (!finished && ticks < 40) {
      finished = stepMantle(sim, CFG);
      poses.push(`${sim.x.toFixed(4)}/${sim.y.toFixed(4)}`);
      ticks++;
    }

    // `mantleDuration` is 0.4 s, which is 24 ticks, and the 25th is the one that completes.
    expect(ticks).toBe(25);
    // The two curves overlap deliberately: at a third of the way the body has risen a third of
    // a metre and has not moved forward at all; the forward swing is the back half.
    expect(poses.filter((_, i) => i % 4 === 0 || i === poses.length - 1)).toEqual([
      '0.0000/0.0167',
      '0.0000/0.3282',
      '0.0000/0.7759',
      '0.0289/1.0193',
      '0.5530/1.0200',
      '1.2403/1.0200',
      '1.4700/1.0200',
    ]);
  });

  it('lands on the ledge standing, with exit speed and a cooldown', () => {
    const sim = body({ x: 0, y: 0, z: 0 });
    const target = makeMantleTarget();
    detectMantle(sim, CFG, ledgeWorld(1.0), target);
    beginMantle(sim, target);
    while (!stepMantle(sim, CFG));

    expect(sim.mantleActive).toBe(false);
    expect(sim.stance).toBe('STAND');
    expect(sim.grounded).toBe(true);
    expect(sim.groundNy).toBe(1);
    expect(sim.x).toBe(1.4700000000000002);
    expect(sim.y).toBe(1.02);
    // Pushed off along the look direction, so a vault ends in motion and not in a stop.
    expect(sim.vx).toBe(CFG.mantleExitSpeed);
    expect(Math.abs(sim.vz)).toBeLessThan(1e-15);
    // And it cannot be chained straight into another one.
    expect(sim.mantleCooldown).toBe(0.25);
  });

  it('ends in the stance the detector chose', () => {
    const sim = body({ x: 0, y: 0, z: 0 });
    const target = makeMantleTarget();
    detectMantle(sim, CFG, ledgeWorld(1.0, 1.35), target);
    expect(target.endStance).toBe('CROUCH');
    beginMantle(sim, target);
    while (!stepMantle(sim, CFG));
    expect(sim.stance).toBe('CROUCH');
  });

  it('reports completion on exactly one tick', () => {
    const sim = body({ x: 0, y: 0, z: 0 });
    const target = makeMantleTarget();
    detectMantle(sim, CFG, ledgeWorld(1.0), target);
    beginMantle(sim, target);
    let completions = 0;
    for (let tick = 0; tick < 25; tick++) {
      if (stepMantle(sim, CFG)) completions++;
    }
    expect(completions).toBe(1);
  });
});
