import { describe, expect, it } from 'vitest';
import { createGameBus } from '../core/Events';
import type { InputCommand } from '../core/InputCommand';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import { PlayerController } from '../player/PlayerController';
import { makePlayerSimState, savePlayerSim, type PlayerSimState } from '../player/PlayerState';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import {
  CORRECTION_SMOOTHING_TICKS,
  MAX_SMOOTHED_DISTANCE,
  POSITION_EPSILON,
  Prediction,
} from './Prediction';

/**
 * Client prediction and reconciliation, pinned before A23 split `reconcile` (S4.11, S6.3).
 *
 * This file had no tests. Every rule below is one a refactor could break without any other
 * signal, because the symptom is what a player *sees*: a correction that should have been
 * silent, a respawn counted as a misprediction, or a camera that eases to somewhere a body is
 * not. The controller is the real one over a real `CollisionWorld`; only the authoritative
 * state is fabricated, which is what the server would have sent.
 */

interface Rig {
  readonly prediction: Prediction;
  readonly controller: PlayerController;
  /** Step and record one command. Returns its seq. */
  step(mutate?: (cmd: InputCommand) => void): number;
  /** The controller's current state, as an authoritative update would carry it. */
  state(): PlayerSimState;
}

function rig(): Rig {
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 80, y: 2, z: 80 }, 0, 0, 0, 'concrete');
  const world = new CollisionWorld(
    set,
    { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 24, z: 40 } },
    8,
  );
  const controller = new PlayerController(DEFAULT_MOVEMENT_CONFIG, world, createGameBus(), 1);
  controller.spawn(0, 0, 0, 0);
  const prediction = new Prediction();

  let seq = 0;
  let tick = 0;
  return {
    prediction,
    controller,
    step(mutate) {
      seq++;
      tick++;
      const cmd: InputCommand & { moveX: number } = {
        seq,
        tickIndex: tick,
        moveX: 0,
        moveZ: 0,
        yaw: 0,
        pitch: 0,
        buttons: 0,
        sampledAtMs: 0,
      } as InputCommand & { moveX: number };
      mutate?.(cmd);
      controller.step(cmd);
      prediction.record(cmd, controller);
      return seq;
    },
    state() {
      const s = makePlayerSimState();
      savePlayerSim(controller.sim, s);
      return s;
    },
  };
}

describe('reconcile, when the prediction was right', () => {
  it('does nothing at all — no load, no correction, one comparison', () => {
    const r = rig();
    const seq = r.step();
    const authoritative = r.state();
    r.controller.sim.x = 7;

    expect(r.prediction.reconcile(seq, authoritative, r.controller)).toBe(false);
    expect(r.prediction.stats.comparisons).toBe(1);
    expect(r.prediction.stats.mispredictions).toBe(0);
    // The authoritative state is older than what this client has already simulated, so a
    // matching update must not be loaded over it.
    expect(r.controller.sim.x).toBe(7);
  });

  it('forgives a divergence under a millimetre and refuses one over it', () => {
    const under = rig();
    const seqA = under.step();
    const close = under.state();
    close.x += POSITION_EPSILON / 2;
    expect(under.prediction.reconcile(seqA, close, under.controller)).toBe(false);
    expect(under.prediction.stats.mispredictions).toBe(0);

    const over = rig();
    const seqB = over.step();
    const off = over.state();
    off.x += POSITION_EPSILON * 2;
    expect(over.prediction.reconcile(seqB, off, over.controller)).toBe(true);
    expect(over.prediction.stats.mispredictions).toBe(1);
  });

  it('counts a velocity divergence even when the position agrees', () => {
    const r = rig();
    const seq = r.step();
    const off = r.state();
    off.vx += 0.02;
    expect(r.prediction.reconcile(seq, off, r.controller)).toBe(true);
    expect(r.prediction.stats.mispredictions).toBe(1);
  });

  it('counts a stance divergence even when position and velocity agree', () => {
    const r = rig();
    const seq = r.step();
    const off = r.state();
    off.stance = 'CROUCH';
    expect(r.prediction.reconcile(seq, off, r.controller)).toBe(true);
  });
});

describe('reconcile, on an ack it cannot use', () => {
  it('ignores a negative ack without counting it', () => {
    const r = rig();
    r.step();
    expect(r.prediction.reconcile(-1, r.state(), r.controller)).toBe(false);
    expect(r.prediction.stats.comparisons).toBe(0);
  });

  it('ignores an ack no newer than the last one applied', () => {
    const r = rig();
    const seq = r.step();
    r.prediction.reconcile(seq, r.state(), r.controller);
    expect(r.prediction.stats.comparisons).toBe(1);
    // A snapshot that overtook a newer one carries nothing this client has not acted on.
    expect(r.prediction.reconcile(seq, r.state(), r.controller)).toBe(false);
    expect(r.prediction.stats.comparisons).toBe(1);
  });

  it('takes the server’s word when it has no record of that command', () => {
    const r = rig();
    r.step();
    r.prediction.reset();
    const authoritative = r.state();
    authoritative.x = 12.5;

    expect(r.prediction.reconcile(99, authoritative, r.controller)).toBe(false);
    expect(r.prediction.stats.comparisons).toBe(1);
    // There was no prediction to be wrong, so nothing is counted — but the state is adopted.
    expect(r.prediction.stats.mispredictions).toBe(0);
    expect(r.controller.sim.x).toBe(12.5);
  });
});

describe('reconcile, when the server moved the player', () => {
  it('treats a relocation as a relocation rather than a misprediction', () => {
    const r = rig();
    const seq = r.step();
    const moved = r.state();
    // Past TELEPORT_DISTANCE: a spawn, a round reset, a gunship seat. No client predicts that.
    moved.x += 10;

    expect(r.prediction.reconcile(seq, moved, r.controller)).toBe(false);
    expect(r.prediction.stats.mispredictions).toBe(0);
    expect(r.controller.sim.x).toBeCloseTo(moved.x, 6);
    // Nothing to ease: the player is told where they are.
    expect(r.prediction.offsetX).toBe(0);
    expect(r.prediction.smoothingFraction).toBe(0);
  });

  it('cuts instead of easing a correction too large to hide', () => {
    const r = rig();
    const seq = r.step();
    const off = r.state();
    // Over MAX_SMOOTHED_DISTANCE and under the teleport distance.
    off.x += MAX_SMOOTHED_DISTANCE + 1;

    expect(r.prediction.reconcile(seq, off, r.controller)).toBe(true);
    expect(r.prediction.stats.mispredictions).toBe(1);
    expect(r.prediction.offsetX).toBe(0);
    expect(r.prediction.smoothingFraction).toBe(0);
  });
});

describe('the visual correction', () => {
  it('carries the difference as an offset and decays it to exactly zero', () => {
    const r = rig();
    const seq = r.step();
    const off = r.state();
    off.x += 0.5;

    r.prediction.reconcile(seq, off, r.controller);
    expect(Math.abs(r.prediction.offsetX)).toBeCloseTo(0.5, 6);
    expect(r.prediction.smoothingFraction).toBe(1);

    const seen: number[] = [];
    for (let i = 0; i < CORRECTION_SMOOTHING_TICKS; i++) {
      r.prediction.step();
      seen.push(Math.abs(r.prediction.offsetX));
    }
    // Linear, and it arrives: an exponential decay would leave a residual for the match.
    expect(seen[seen.length - 1]).toBe(0);
    expect(r.prediction.smoothingFraction).toBe(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThan(seen[i - 1] ?? 0);
  });

  it('keeps the drawn position continuous across back-to-back corrections', () => {
    const r = rig();
    const first = r.step();
    const offA = r.state();
    offA.x += 0.5;
    r.prediction.reconcile(first, offA, r.controller);
    r.prediction.step();

    const drawnBefore = r.controller.sim.x + r.prediction.offsetX;

    const second = r.step();
    const offB = r.state();
    offB.x += 0.4;
    r.prediction.reconcile(second, offB, r.controller);

    // Measured from where the player was being *drawn*, not from the raw sim position — which
    // is what stops a pop on every correction after the first.
    expect(r.controller.sim.x + r.prediction.offsetX).toBeCloseTo(drawnBefore, 6);
  });

  it('clears the offset when nothing is being smoothed', () => {
    const r = rig();
    r.prediction.step();
    expect(r.prediction.offsetX).toBe(0);
    expect(r.prediction.offsetY).toBe(0);
    expect(r.prediction.offsetZ).toBe(0);
  });
});

describe('the replay', () => {
  it('re-runs every command the server has not acked, and reports the depth', () => {
    const r = rig();
    const acked = r.step();
    const authoritative = r.state();
    authoritative.x += 0.5;
    r.step();
    r.step();
    r.step();

    expect(r.prediction.reconcile(acked, authoritative, r.controller)).toBe(true);
    expect(r.prediction.stats.lastReplayDepth).toBe(3);
    expect(r.prediction.stats.maxReplayDepth).toBe(3);
  });

  it('steps with the weapon speed the command was recorded with, not the live one', () => {
    const r = rig();
    const acked = r.step();
    const authoritative = r.state();

    // One command stepped while holding something slow.
    r.controller.weaponSpeedScale = 0.5;
    r.step((cmd) => {
      (cmd as { moveZ: number }).moveZ = -1;
    });
    const predictedZ = r.controller.sim.z;

    // The hands have changed since. The replay must use what it recorded, or a correction
    // would move the player at a speed they never ran at.
    r.controller.weaponSpeedScale = 2;
    authoritative.x += 0.01;
    r.prediction.reconcile(acked, authoritative, r.controller);

    expect(r.controller.sim.z).toBeCloseTo(predictedZ, 6);
    // And the live scale is put back, so the next real tick is unaffected.
    expect(r.controller.weaponSpeedScale).toBe(2);
    expect(r.prediction.replaying).toBe(false);
  });
});

describe('adopt', () => {
  it('takes the state without judging a prediction against it', () => {
    const r = rig();
    r.step();
    const authoritative = r.state();
    authoritative.x = 20;

    r.prediction.adopt(authoritative, r.controller);
    expect(r.controller.sim.x).toBe(20);
    expect(r.prediction.stats.comparisons).toBe(0);
    expect(r.prediction.stats.mispredictions).toBe(0);
    expect(r.prediction.offsetX).toBe(0);
    expect(r.prediction.smoothingFraction).toBe(0);
  });

  it('replays the commands the server has already seen when given an ack (M11)', () => {
    const r = rig();
    const acked = r.step();
    const authoritative = r.state();
    r.step();
    r.step();

    r.prediction.adopt(authoritative, r.controller, acked);
    // Without this a migration leaves the client two ticks behind its own input, and the next
    // reconcile counts a misprediction for it on every transition.
    expect(r.prediction.stats.lastReplayDepth).toBe(2);
    expect(r.prediction.stats.mispredictions).toBe(0);
  });
});

describe('the ring', () => {
  it('counts the commands predicted but not yet acknowledged', () => {
    const r = rig();
    r.step();
    r.step();
    const third = r.step();
    expect(r.prediction.unacked).toBe(3);

    r.prediction.reconcile(third, r.state(), r.controller);
    expect(r.prediction.unacked).toBe(0);
  });

  it('forgets everything on a reset', () => {
    const r = rig();
    r.step();
    r.step();
    r.prediction.reset();
    expect(r.prediction.unacked).toBe(0);
    expect(r.prediction.offsetX).toBe(0);
    expect(r.prediction.smoothingFraction).toBe(0);
  });

  it('reports percentiles over the corrections it has taken (S8.5)', () => {
    const r = rig();
    expect(r.prediction.percentiles()).toEqual({ p50: 0, p99: 0, count: 0 });

    for (let i = 0; i < 10; i++) {
      const seq = r.step();
      const off = r.state();
      off.x += 0.1 * (i + 1);
      r.prediction.reconcile(seq, off, r.controller);
      for (let t = 0; t < CORRECTION_SMOOTHING_TICKS; t++) r.prediction.step();
    }

    const p = r.prediction.percentiles();
    expect(p.count).toBe(10);
    expect(p.p50).toBeGreaterThan(0);
    expect(p.p99).toBeGreaterThanOrEqual(p.p50);
    expect(r.prediction.stats.lastErrorM).toBeGreaterThan(0);
  });
});
