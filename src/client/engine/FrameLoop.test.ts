import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DT, MAX_STEPS_PER_FRAME } from '../../shared/core/Loop';
import { Loop, type FrameSample, type LoopHandlers } from './FrameLoop';

/**
 * The browser's frame driver, pinned before unit C2's refactor.
 *
 * Every rule in this file is reachable only through `requestAnimationFrame` and
 * `performance.now()`, so both are faked: a queue that hands back the callback the loop is
 * waiting on, and a clock the test moves by hand. That is also what makes the assertions worth
 * anything — the question this class answers is *how many fixed steps a stretch of wall clock
 * is worth*, and a real clock cannot be asked that question twice and get the same answer.
 *
 * The fakes are installed per case and removed after it: the suite runs on `environment: 'node'`
 * and a stray global `requestAnimationFrame` would be read by somebody else as a browser.
 *
 * What is asserted is only what crosses the public surface: the tick indices `sim` is given, the
 * `alpha` handed to `render`, the `FrameSample` published to `onFrame`, and the getters.
 */

// ========================================== the fakes =========================================

interface PendingFrame {
  readonly id: number;
  readonly callback: (nowMs: number) => void;
}

let clockMs = 0;
/** Added to the clock by every read. Only the busy-wait case needs it to move on its own. */
let clockStepMs = 0;
let pending: PendingFrame[] = [];
let cancelled: number[] = [];
let nextFrameId = 0;
let realNow: () => number;

function fakeNow(): number {
  const value = clockMs;
  clockMs += clockStepMs;
  return value;
}

beforeEach(() => {
  clockMs = 0;
  clockStepMs = 0;
  pending = [];
  cancelled = [];
  nextFrameId = 0;

  const globals = globalThis as Record<string, unknown>;
  globals.requestAnimationFrame = (callback: (nowMs: number) => void): number => {
    nextFrameId += 1;
    pending.push({ id: nextFrameId, callback });
    return nextFrameId;
  };
  globals.cancelAnimationFrame = (id: number): void => {
    cancelled.push(id);
    pending = pending.filter((frame) => frame.id !== id);
  };
  realNow = performance.now;
  performance.now = fakeNow;
});

afterEach(() => {
  performance.now = realNow;
  const globals = globalThis as Record<string, unknown>;
  delete globals.requestAnimationFrame;
  delete globals.cancelAnimationFrame;
});

/** Run the frame the loop is waiting on, with `atMs` as its `requestAnimationFrame` timestamp. */
function runFrame(atMs: number): void {
  const next = pending.shift();
  if (next === undefined) throw new Error('no frame was requested');
  clockMs = atMs;
  next.callback(atMs);
}

interface Recorder {
  readonly handlers: LoopHandlers;
  /** Every tick index handed to `sim`, in order. */
  readonly ticks: number[];
  /** Every alpha handed to `render`, in order. */
  readonly alphas: number[];
  /** The sample object as published — the same object every frame, on purpose. */
  readonly samples: FrameSample[];
  /** A copy per frame, so a later frame cannot rewrite what an earlier one reported. */
  readonly copies: FrameSample[];
}

/** Handlers that record what they are given, and may charge the clock for their own time. */
function recorder(cost: { simMs?: number; renderMs?: number } = {}): Recorder {
  const ticks: number[] = [];
  const alphas: number[] = [];
  const samples: FrameSample[] = [];
  const copies: FrameSample[] = [];
  return {
    ticks,
    alphas,
    samples,
    copies,
    handlers: {
      sim: (tickIndex: number): void => {
        ticks.push(tickIndex);
        clockMs += cost.simMs ?? 0;
      },
      render: (alpha: number): void => {
        alphas.push(alpha);
        clockMs += cost.renderMs ?? 0;
      },
      onFrame: (sample: FrameSample): void => {
        samples.push(sample);
        copies.push({ ...sample });
      },
    },
  };
}

function only<T>(list: readonly T[]): T {
  expect(list.length).toBe(1);
  const value = list[0];
  if (value === undefined) throw new Error('empty');
  return value;
}

// ======================================== the test cases ======================================

describe('Loop: starting and stopping', () => {
  it('requests one frame and reports itself running', () => {
    const loop = new Loop(recorder().handlers);
    loop.start();
    expect(loop.isRunning).toBe(true);
    expect(pending.length).toBe(1);
  });

  it('ignores a second start rather than driving two frame chains', () => {
    const loop = new Loop(recorder().handlers);
    loop.start();
    loop.start();
    expect(pending.length).toBe(1);
  });

  it('cancels the frame it was waiting on', () => {
    const loop = new Loop(recorder().handlers);
    loop.start();
    loop.stop();
    expect(cancelled).toEqual([1]);
    expect(loop.isRunning).toBe(false);
    expect(pending.length).toBe(0);
  });

  it('ignores a stop when it is not running', () => {
    const loop = new Loop(recorder().handlers);
    loop.stop();
    loop.start();
    loop.stop();
    loop.stop();
    expect(cancelled).toEqual([1]);
  });

  it('discards banked sub-tick time on a restart, and keeps the tick counter', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    loop.start();
    // 10 ms is less than a tick, so it is banked rather than stepped.
    runFrame(10);
    expect(rec.ticks).toEqual([]);
    loop.stop();
    loop.start();
    // Another 10 ms. Banked, the two would have made a step; reset, they do not.
    runFrame(20);
    expect(rec.ticks).toEqual([]);
    expect(loop.currentTick).toBe(0);
  });
});

describe('Loop: turning elapsed time into steps', () => {
  it('requests the next frame before it does any work', () => {
    const loop = new Loop(recorder().handlers);
    loop.start();
    runFrame(1000 / 60);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(2);
  });

  it('runs exactly one step for one 60 Hz frame', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    loop.start();
    runFrame(1000 / 60);
    expect(rec.ticks).toEqual([0]);
  });

  it('hands out monotonic tick indices across frames', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    loop.start();
    // 17 ms rather than an exact 1/60: three frames of exactly one tick's worth land on the
    // float boundary and the third owes nothing.
    runFrame(17);
    runFrame(34);
    runFrame(51);
    expect(rec.ticks).toEqual([0, 1, 2]);
  });

  it('runs three steps for a 50 ms frame and renders at the remainder', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    loop.start();
    runFrame(50);
    expect(rec.ticks).toEqual([0, 1, 2]);
    expect(only(rec.copies).steps).toBe(3);
    expect(only(rec.copies).starved).toBe(false);
    expect(only(rec.alphas)).toBeLessThan(1e-12);
  });

  it('caps a stalled frame at the step limit and reports it starved', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    loop.start();
    // A whole second: clamped to the stall limit, then capped at the step limit.
    runFrame(1000);
    expect(rec.ticks.length).toBe(MAX_STEPS_PER_FRAME);
    expect(only(rec.copies).steps).toBe(MAX_STEPS_PER_FRAME);
    expect(only(rec.copies).starved).toBe(true);
    // The whole-tick backlog is discarded, so the next frame is not owed it.
    expect(only(rec.alphas)).toBeLessThan(1);
  });

  it('runs more steps per frame when the cap is raised', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    expect(loop.maxStepsPerFrame).toBe(MAX_STEPS_PER_FRAME);
    loop.maxStepsPerFrame = 20;
    expect(loop.maxStepsPerFrame).toBe(20);
    loop.start();
    runFrame(1000);
    expect(rec.ticks.length).toBe(15);
    expect(only(rec.copies).starved).toBe(false);
  });

  it('scales the steps a frame is worth by simSpeed', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    expect(loop.simSpeed).toBe(1);
    loop.simSpeed = 4;
    expect(loop.simSpeed).toBe(4);
    loop.start();
    runFrame(1000 / 60);
    expect(rec.ticks).toEqual([0, 1, 2, 3]);
  });

  it('derives the tick count and the simulated time from the steps it ran', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    expect(loop.currentTick).toBe(0);
    expect(loop.simTime).toBe(0);
    loop.start();
    runFrame(50);
    expect(loop.currentTick).toBe(3);
    expect(loop.simTime).toBe(3 * DT);
  });
});

describe('Loop: the frame sample', () => {
  it('reports the frame, sim and render spans it measured', () => {
    const rec = recorder({ simMs: 3, renderMs: 7 });
    const loop = new Loop(rec.handlers);
    loop.start();
    runFrame(20);
    const sample = only(rec.copies);
    expect(sample.frameMs).toBe(20);
    expect(sample.simMs).toBe(3);
    expect(sample.renderMs).toBe(7);
    expect(sample.steps).toBe(1);
  });

  it('measures the frame against the previous frame, not against the clock', () => {
    const rec = recorder({ simMs: 5, renderMs: 5 });
    const loop = new Loop(rec.handlers);
    loop.start();
    runFrame(20);
    runFrame(36);
    expect(rec.copies[1]?.frameMs).toBe(16);
  });

  it('charges every step of a frame to the sim span', () => {
    const rec = recorder({ simMs: 2 });
    const loop = new Loop(rec.handlers);
    loop.start();
    runFrame(50);
    expect(only(rec.copies).simMs).toBe(6);
  });

  it('publishes the same sample object every frame', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    loop.start();
    runFrame(20);
    runFrame(40);
    expect(rec.samples.length).toBe(2);
    expect(rec.samples[0]).toBe(rec.samples[1]);
  });

  it('reports the alpha it handed to render', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    loop.start();
    runFrame(20);
    expect(only(rec.copies).alpha).toBe(only(rec.alphas));
  });

  it('runs a frame with no onFrame handler at all', () => {
    const ticks: number[] = [];
    const loop = new Loop({ sim: (t) => void ticks.push(t), render: () => {} });
    loop.start();
    expect(() => runFrame(20)).not.toThrow();
    expect(ticks).toEqual([0]);
  });
});

describe('Loop: syntheticLoadMs', () => {
  it('spins inside the render span once it is set', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    loop.syntheticLoadMs = 5;
    loop.start();
    // The busy-wait reads the clock until it has passed, so the clock has to move by itself.
    clockStepMs = 1;
    runFrame(20);
    expect(only(rec.copies).renderMs).toBeGreaterThanOrEqual(5);
  });

  it('costs nothing while it is zero', () => {
    const rec = recorder();
    const loop = new Loop(rec.handlers);
    expect(loop.syntheticLoadMs).toBe(0);
    loop.start();
    runFrame(20);
    expect(only(rec.copies).renderMs).toBe(0);
  });
});
