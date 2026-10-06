import { describe, expect, it } from 'vitest';
import {
  copySnapshot,
  loadPlayerSim,
  makePlayerSimState,
  makeSnapshot,
  PlayerSim,
  savePlayerSim,
  type PlayerSimState,
} from './PlayerState';
import type { StanceId } from './Stance';

/**
 * The two views of a player, and the rule that keeps the simulation one complete.
 *
 * `PlayerSnapshot` is the render view — eleven fields, enough to draw a frame.
 * `PlayerSimState` is the simulation view, and it exists for reconciliation: S4.11 requires the
 * client to snap to the authoritative state and replay every unacked command, and a replay that
 * restored only the pose would resume with the wrong slide timer, the wrong coyote window and the
 * wrong `prevButtons` — so the first replayed tick would diverge and the correction would never
 * converge.
 *
 * The file states the rule for adding a field: **add it to the record too.** A field that is not
 * saved silently resets on every correction, and the symptom is a movement bug that appears only
 * under packet loss, on someone else's connection, once.
 *
 * So the test here is not a list of fields — a list would have to be maintained in step with the
 * one it is checking, and would be wrong in exactly the same way. It stamps every key of the
 * record with a distinctive value, runs it through the real `PlayerSim`, and reads it back. A
 * field missing from `savePlayerSim` or `loadPlayerSim` comes back as the default and fails by
 * name, whatever the field is called and whenever it was added.
 */

/** A value no default is, per field type, so a field that did not travel is visible. */
function stamp(state: PlayerSimState): PlayerSimState {
  const keys = Object.keys(state) as Array<keyof PlayerSimState>;
  let n = 1;
  for (const key of keys) {
    const current = state[key];
    if (typeof current === 'number') {
      // Distinct per field, and deliberately fractional: a field copied from the wrong source
      // would still be a number, but not this one.
      (state[key] as number) = n * 0.5 + 0.125;
    } else if (typeof current === 'boolean') {
      (state[key] as boolean) = true;
    } else {
      // The only other member is a stance id.
      (state[key] as StanceId) = 'SLIDE';
    }
    n++;
  }
  return state;
}

describe('the simulation state record', () => {
  it('has a field for every field the sim carries that step() reads or writes', () => {
    const record = makePlayerSimState();
    const sim = new PlayerSim();
    const keys = Object.keys(record) as Array<keyof PlayerSimState>;
    // 55 fields, and every one of them a field of the live sim. A record key the sim does not
    // have is a typo that `loadPlayerSim` would write into nothing.
    expect(keys.length).toBe(55);
    for (const key of keys) {
      expect(key in sim, String(key)).toBe(true);
    }
  });

  it('starts every field at the value a fresh sim has', () => {
    const record = makePlayerSimState();
    const sim = new PlayerSim();
    const saved = makePlayerSimState();
    savePlayerSim(sim, saved);
    // A fresh record and a fresh sim describe the same body, so a default that drifted apart
    // from the class is a correction that would teleport a brand new player.
    expect(record).toEqual(saved);
  });

  it('carries every field from a live sim and back, losing none', () => {
    const wanted = stamp(makePlayerSimState());
    const sim = new PlayerSim();

    loadPlayerSim(wanted, sim);
    const readBack = makePlayerSimState();
    savePlayerSim(sim, readBack);

    // One assertion, every field: the round trip is the contract, and `toEqual` names the
    // field that broke it.
    expect(readBack).toEqual(wanted);
  });

  it('copies record to record, which is what the prediction ring buffer does', () => {
    const wanted = stamp(makePlayerSimState());
    const copy = makePlayerSimState();
    // `PlayerSimState` rather than `PlayerSim` as the target on purpose: the same function
    // serves both, with no cast.
    loadPlayerSim(wanted, copy);
    expect(copy).toEqual(wanted);
    // And it is a copy, not an alias: writing the source afterwards must not move the copy.
    wanted.x = 999;
    expect(copy.x).not.toBe(999);
  });

  it('leaves the sim fields the record does not cover alone', () => {
    const sim = new PlayerSim();
    // `speed` is a getter over vx/vz, so it follows the record rather than being in it.
    loadPlayerSim(stamp(makePlayerSimState()), sim);
    expect(sim.speed).toBe(Math.hypot(sim.vx, sim.vz));
  });
});

describe('the render snapshot', () => {
  it('starts a body standing at the origin at eye height', () => {
    expect(makeSnapshot()).toEqual({
      x: 0,
      y: 0,
      z: 0,
      eyeHeight: 1.65,
      bobPhase: 0,
      speed: 0,
      vy: 0,
      stance: 'STAND',
      grounded: false,
      slideRoll: 0,
      strafe: 0,
    });
  });

  it('copies every field, so prev and curr can be interpolated between', () => {
    const src = makeSnapshot();
    src.x = 1.5;
    src.y = 2.5;
    src.z = -3.5;
    src.eyeHeight = 0.95;
    src.bobPhase = 1.25;
    src.speed = 6.9;
    src.vy = -4;
    src.stance = 'CROUCH';
    src.grounded = true;
    src.slideRoll = 1;
    src.strafe = -1;

    const dst = makeSnapshot();
    copySnapshot(src, dst);
    expect(dst).toEqual(src);
    // A copy and not an alias: `prev` must not move when `curr` is rewritten next tick.
    src.x = 99;
    expect(dst.x).toBe(1.5);
  });

  it('is written from the sim, with the derived fields derived', () => {
    const sim = new PlayerSim();
    sim.x = 3;
    sim.y = 4;
    sim.z = 5;
    sim.vx = 3;
    sim.vz = 4;
    sim.vy = -2;
    sim.eyeHeight = 1.1;
    sim.bobPhase = 0.75;
    sim.stance = 'CROUCH';
    sim.grounded = true;

    const out = makeSnapshot();
    sim.writeSnapshot(out, -0.5);
    expect(out.x).toBe(3);
    expect(out.y).toBe(4);
    expect(out.z).toBe(5);
    expect(out.eyeHeight).toBe(1.1);
    expect(out.bobPhase).toBe(0.75);
    // Horizontal speed, not the velocity: 3-4-5.
    expect(out.speed).toBe(5);
    expect(out.vy).toBe(-2);
    expect(out.stance).toBe('CROUCH');
    expect(out.grounded).toBe(true);
    // The lean authority is the slide flag, and the strafe roll is passed in by the controller.
    expect(out.slideRoll).toBe(0);
    expect(out.strafe).toBe(-0.5);

    sim.slideActive = true;
    sim.writeSnapshot(out, 1);
    expect(out.slideRoll).toBe(1);
    expect(out.strafe).toBe(1);
  });
});

describe('resetting a sim', () => {
  it('puts a body at a spawn with every timer and flag cleared', () => {
    const sim = new PlayerSim();
    loadPlayerSim(stamp(makePlayerSimState()), sim);

    sim.reset(10, 2, -4, 1.5, 1.8, 1.65);

    expect([sim.x, sim.y, sim.z, sim.yaw]).toEqual([10, 2, -4, 1.5]);
    expect([sim.vx, sim.vy, sim.vz, sim.pitch]).toEqual([0, 0, 0, 0]);
    expect(sim.stance).toBe('STAND');
    expect(sim.capsuleHeight).toBe(1.8);
    expect(sim.eyeHeight).toBe(1.65);
    expect(sim.grounded).toBe(false);
    expect(sim.groundNy).toBe(1);
    expect(sim.slideActive).toBe(false);
    expect(sim.mantleActive).toBe(false);
    expect(sim.sprintActive).toBe(false);
    expect(sim.tacSprintActive).toBe(false);
    expect(sim.airSpeedCap).toBe(0);
    expect(sim.prevButtons).toBe(0);
    // A spawn that remembered the last life's double-tap window would hand out a free
    // tactical sprint on the first press.
    expect(sim.lastSprintPressTick).toBe(-1000);
    expect(sim.slideDirZ).toBe(1);
  });

  /**
   * Pins current behaviour; suspected bug: `reset` does not clear the mantle pose fields
   * (`mantleFrom*`, `mantleTo*`, `mantleDir*`, `mantleEndStance`) or `tick`, although
   * `PlayerSimState` carries all of them. It clears `mantleActive`, so nothing reads the stale
   * pose — but a save taken right after a spawn still carries the previous life's vault, and a
   * correction compares against it.
   */
  it('leaves the mantle pose and the tick as they were', () => {
    const sim = new PlayerSim();
    const stamped = stamp(makePlayerSimState());
    loadPlayerSim(stamped, sim);
    sim.reset(0, 0, 0, 0, 1.8, 1.65);

    expect(sim.mantleActive).toBe(false);
    expect(sim.mantleElapsed).toBe(0);
    expect(sim.mantleCooldown).toBe(0);
    // Not cleared:
    expect(sim.mantleToY).toBe(stamped.mantleToY);
    expect(sim.mantleEndStance).toBe(stamped.mantleEndStance);
    expect(sim.tick).toBe(stamped.tick);
  });
});
