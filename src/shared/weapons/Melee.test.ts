import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { createGameBus, EV } from '../core/Events';
import { DT } from '../core/Loop';
import { DamageSystem, type Damageable } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { PlayerSim } from '../player/PlayerState';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { Melee, MELEE_SWING_SECONDS, type MeleeDeps, type MeleePhase } from './Melee';

/**
 * The knife: a timed animation with exactly one tick that touches anything.
 *
 * The phase machine is the part worth pinning. `busy` gates the trigger in both runtimes —
 * `handsOffWeapon` reads it — and the swing has to resolve on the same tick on the client and
 * on the server, so when the strike happens inside the animation is a contract and not a
 * detail. The rest is the reach, the line of sight, and the rule that a knife which bounced
 * off a teammate is a miss as far as the swinger is concerned.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

function dummy(entityId: number, z: number, team?: 'A' | 'B', invulnerable = false): Damageable {
  const rig = new HitboxRig();
  rig.setTransform(0, 0, z, 0);
  return {
    entityId,
    displayName: `t${entityId}`,
    health: new Health({ ...DEFAULT_HEALTH_CONFIG }),
    rig,
    team,
    invulnerable,
  };
}

function harness(build: (set: ColliderSet) => void = () => {}) {
  const set = new ColliderSet(4);
  set.add({ x: 0, y: -1, z: 0 }, { x: 200, y: 2, z: 200 }, 0, 0, 0, 'concrete');
  build(set);
  const world = new CollisionWorld(set, { min: { x: -100, y: -8, z: -100 }, max: { x: 100, y: 24, z: 100 } }, 8);
  world.configure(46, 0.005);

  const bus = createGameBus();
  const swings: string[] = [];
  bus.on(EV.MeleeSwing, (p) => swings.push(`${p.hit ? 'h' : '-'}${p.lethal ? 'l' : '-'}`));
  const damage = new DamageSystem(bus);
  const deps: MeleeDeps = { world, damage, bus, sourceId: 1 };
  const melee = new Melee(deps);

  // Facing -z, which is a yaw of 0, standing on the floor.
  const sim = new PlayerSim();
  sim.eyeHeight = 1.65;

  /** Swing once and run the animation out, collecting the phase each tick. */
  const swing = (ticks = 40): MeleePhase[] => {
    const phases: MeleePhase[] = [];
    melee.step(true, sim, true);
    phases.push(melee.phase);
    for (let i = 0; i < ticks; i++) {
      melee.step(false, sim, true);
      phases.push(melee.phase);
    }
    return phases;
  };
  return { melee, damage, swings, sim, swing };
}

describe('the phase machine', () => {
  it('starts idle and not busy', () => {
    const h = harness();
    expect(h.melee.phase).toBe('IDLE');
    expect(h.melee.busy).toBe(false);
    expect(h.melee.fraction).toBe(0);
  });

  it('winds up, strikes on one tick, recovers, and comes back to idle', () => {
    const h = harness();
    const phases = h.swing();
    // The phases the caller can observe. STRIKE is never one of them: it is set and left
    // inside a single tick, which is the tick the swing resolves on.
    const distinct = phases.filter((p, i) => i === 0 || p !== phases[i - 1]);
    expect(distinct).toEqual(['WINDUP', 'RECOVER', 'IDLE']);
    expect(h.melee.phase).toBe('IDLE');
    expect(h.melee.busy).toBe(false);
  });

  it('is busy for the whole swing, which is what gates the trigger', () => {
    const h = harness();
    h.melee.step(true, h.sim, true);
    expect(h.melee.busy).toBe(true);
    const ticks = Math.round(MELEE_SWING_SECONDS / DT);
    for (let i = 0; i < ticks - 2; i++) {
      h.melee.step(false, h.sim, true);
      expect(h.melee.busy, `tick ${i}`).toBe(true);
    }
  });

  it('advances one fraction across both phases, so the animation is a single clip', () => {
    const h = harness();
    h.melee.step(true, h.sim, true);
    // The tick the swing begins is the clip's first frame, so the fraction is still zero.
    expect(h.melee.fraction).toBe(0);
    let last = 0;
    for (let i = 0; i < 20; i++) {
      h.melee.step(false, h.sim, true);
      if (h.melee.phase === 'IDLE') break;
      // Monotonic across the WINDUP/RECOVER seam.
      expect(h.melee.fraction).toBeGreaterThanOrEqual(last);
      last = h.melee.fraction;
    }
    expect(last).toBeGreaterThan(0.5);
  });

  it('refuses a second swing until the cooldown is out', () => {
    const h = harness();
    h.swing();
    expect(h.melee.phase).toBe('IDLE');
    // The swing is 0.54 s and the cooldown is 0.72 s, so there is a window where the knife is
    // idle and still will not go.
    h.melee.step(true, h.sim, true);
    expect(h.melee.phase).toBe('IDLE');
    for (let i = 0; i < 20; i++) h.melee.step(false, h.sim, true);
    h.melee.step(true, h.sim, true);
    expect(h.melee.phase).toBe('WINDUP');
  });

  it('drops everything when the body dies mid-swing', () => {
    const h = harness();
    h.melee.step(true, h.sim, true);
    expect(h.melee.busy).toBe(true);
    h.melee.step(false, h.sim, false);
    expect(h.melee.phase).toBe('IDLE');
    expect(h.melee.busy).toBe(false);
    expect(h.melee.fraction).toBe(0);
  });
});

describe('resolving the swing', () => {
  it('kills a body inside the reach, in one', () => {
    const h = harness();
    const victim = dummy(5, -1.2, 'B');
    h.damage.register(victim);
    h.swing();
    // 380 against 200: a knife is a knife.
    expect(victim.health.current).toBe(0);
    expect(victim.health.alive).toBe(false);
    expect(h.swings).toEqual(['hl']);
  });

  it('reports the hit and the kill on the tick it lands, and not after', () => {
    const h = harness();
    h.damage.register(dummy(5, -1.2, 'B'));
    let hitTicks = 0;
    let lethalTicks = 0;
    h.melee.step(true, h.sim, true);
    for (let i = 0; i < 40; i++) {
      h.melee.step(false, h.sim, true);
      if (h.melee.hitThisTick) hitTicks++;
      if (h.melee.lethalThisTick) lethalTicks++;
    }
    expect(hitTicks).toBe(1);
    expect(lethalTicks).toBe(1);
    // Cleared again by the next tick: the flags describe the tick they were set on.
    expect(h.melee.hitThisTick).toBe(false);
  });

  it('misses an empty swing, and still says so', () => {
    const h = harness();
    h.swing();
    expect(h.swings).toEqual(['--']);
  });

  it('cannot reach past two metres', () => {
    const h = harness();
    const far = dummy(6, -3, 'B');
    h.damage.register(far);
    h.swing();
    expect(far.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
    expect(h.swings).toEqual(['--']);
  });

  it('cannot reach through a wall', () => {
    // A wall between the eye and the target means the arm never got there.
    const h = harness((set) => set.add({ x: 0, y: 1.5, z: -0.6 }, { x: 4, y: 3, z: 0.2 }, 0, 0, 0, 'concrete'));
    const behind = dummy(8, -1.2, 'B');
    h.damage.register(behind);
    h.swing();
    expect(behind.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
    expect(h.swings).toEqual(['--']);
  });

  it('takes the nearest of two bodies in the reach', () => {
    const h = harness();
    const near = dummy(5, -0.9, 'B');
    const far = dummy(6, -1.8, 'B');
    h.damage.register(far);
    h.damage.register(near);
    h.swing();
    expect(near.health.alive).toBe(false);
    expect(far.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
  });

  it('never swings at the swinger, the dead or the invulnerable', () => {
    const h = harness();
    const corpse = dummy(5, -0.9, 'B');
    corpse.health.applyDamage(1000);
    const ghost = dummy(6, -1.1, 'B', true);
    h.damage.register(dummy(1, -0.5, 'A'));
    h.damage.register(corpse);
    h.damage.register(ghost);
    const real = dummy(7, -1.5, 'B');
    h.damage.register(real);
    h.swing();
    expect(real.health.alive).toBe(false);
    expect(ghost.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
  });

  it('counts a knife that bounced off a teammate as a miss', () => {
    // `apply` returns 0 for a friendly where friendly fire is off, and no hitmarker is the
    // honest answer to that.
    const h = harness();
    const mate = dummy(9, -1, 'A');
    h.damage.register(dummy(1, 0, 'A'));
    h.damage.register(mate);
    h.swing();
    expect(mate.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
    expect(h.swings).toEqual(['--']);
  });
});

describe('the swing duration', () => {
  it('is the windup plus the recovery, which is what the viewmodel clip is fitted to', () => {
    expect(MELEE_SWING_SECONDS).toBeCloseTo(0.12 + 0.42, 12);
  });
});
