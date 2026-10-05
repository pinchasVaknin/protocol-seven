import { describe, expect, it } from 'vitest';
import { DT, MAX_STEPS_PER_FRAME, SIM_HZ, TickAccumulator } from './Loop';

/**
 * Characterization of the fixed-timestep rule (S4.1).
 *
 * Both runtimes convert elapsed wall clock into ticks through this one class, so every number
 * here is pinned with exact `toBe` — including the floating-point residue left in the
 * accumulator, since that residue is the next frame's `alpha` and a client that computed a
 * different one would interpolate differently from the server.
 */

describe('constants', () => {
  it('are 60 Hz, 1/60 and a five-step catch-up cap', () => {
    expect(SIM_HZ).toBe(60);
    expect(DT).toBe(1 / 60);
    expect(DT).toBe(0.016666666666666666);
    expect(MAX_STEPS_PER_FRAME).toBe(5);
  });
});

describe('a fresh accumulator', () => {
  it('starts at tick zero with no banked time and no starvation', () => {
    const acc = new TickAccumulator();

    expect(acc.currentTick).toBe(0);
    expect(acc.simTime).toBe(0);
    expect(acc.alpha).toBe(0);
    expect(acc.starved).toBe(false);
    expect(acc.simSpeed).toBe(1);
    expect(acc.maxStepsPerFrame).toBe(MAX_STEPS_PER_FRAME);
  });
});

describe('take', () => {
  it('one timestep of elapsed time is worth exactly one step and banks nothing', () => {
    const acc = new TickAccumulator();

    expect(acc.take(DT)).toBe(1);
    expect(acc.alpha).toBe(0);
    expect(acc.starved).toBe(false);
  });

  it('half a timestep is worth no step and shows up as alpha', () => {
    const acc = new TickAccumulator();

    expect(acc.take(DT / 2)).toBe(0);
    expect(acc.alpha).toBe(0.5);
  });

  it('banks sub-tick time across frames', () => {
    const acc = new TickAccumulator();

    expect(acc.take(DT * 0.6)).toBe(0);
    expect(acc.alpha).toBe(0.6);
    expect(acc.take(DT * 0.6)).toBe(1);
    expect(acc.alpha).toBe(0.20000000000000004);
  });

  it('clamps a stall to a quarter second: the wall-clock gap is not owed to the sim', () => {
    const acc = new TickAccumulator();

    // 0.25 s is exactly fifteen timesteps; the cap allows five and the rest is discarded.
    expect(acc.take(10)).toBe(5);
    expect(acc.starved).toBe(true);
    expect(acc.alpha).toBe(1.2490009027033011e-15);
  });

  it('takes the same path at exactly the stall threshold', () => {
    const acc = new TickAccumulator();

    expect(acc.take(0.25)).toBe(5);
    expect(acc.starved).toBe(true);
    expect(acc.alpha).toBe(1.2490009027033011e-15);
  });

  it('treats negative elapsed time as zero', () => {
    const acc = new TickAccumulator();

    expect(acc.take(-1)).toBe(0);
    expect(acc.alpha).toBe(0);
    expect(acc.starved).toBe(false);
  });

  it('hitting the cap with no whole-tick backlog left is not starvation', () => {
    const acc = new TickAccumulator();

    expect(acc.take(DT * 5)).toBe(5);
    expect(acc.starved).toBe(false);
    expect(acc.alpha).toBe(4.163336342344337e-16);
  });

  it('keeps the sub-tick fraction when the cap is hit without a backlog', () => {
    const acc = new TickAccumulator();

    expect(acc.take(DT * 5.5)).toBe(5);
    expect(acc.starved).toBe(false);
    expect(acc.alpha).toBe(0.5000000000000003);
  });

  it('starvation clears on the next unstalled frame', () => {
    const acc = new TickAccumulator();
    acc.take(10);
    expect(acc.starved).toBe(true);

    expect(acc.take(DT)).toBe(1);
    expect(acc.starved).toBe(false);
  });
});

describe('simSpeed', () => {
  it('scales the number of steps a frame is worth, not DT', () => {
    const acc = new TickAccumulator();
    acc.simSpeed = 2;

    expect(acc.take(DT)).toBe(2);
    expect(acc.alpha).toBe(0);
  });

  it('needs maxStepsPerFrame raised with it or the extra ticks are discarded', () => {
    const capped = new TickAccumulator();
    capped.simSpeed = 8;
    expect(capped.take(DT)).toBe(5);
    expect(capped.starved).toBe(true);

    const raised = new TickAccumulator();
    raised.simSpeed = 8;
    raised.maxStepsPerFrame = 10;
    expect(raised.take(DT)).toBe(8);
    expect(raised.starved).toBe(false);
  });
});

describe('nextTick and simTime', () => {
  it('nextTick returns the index it is about to consume, then advances', () => {
    const acc = new TickAccumulator();

    expect(acc.nextTick()).toBe(0);
    expect(acc.nextTick()).toBe(1);
    expect(acc.currentTick).toBe(2);
  });

  it('simTime is derived from the tick count, never from wall clock', () => {
    const acc = new TickAccumulator();
    for (let i = 0; i < 7; i++) acc.nextTick();

    expect(acc.currentTick).toBe(7);
    expect(acc.simTime).toBe(0.11666666666666667);
    expect(acc.simTime).toBe(7 * DT);
  });

  it('taking time does not advance the tick counter on its own', () => {
    const acc = new TickAccumulator();
    acc.take(DT * 3);

    expect(acc.currentTick).toBe(0);
  });
});

describe('reset', () => {
  it('drops banked time and starvation but keeps the tick counter', () => {
    const acc = new TickAccumulator();
    acc.take(10);
    acc.nextTick();
    acc.nextTick();

    acc.reset();

    expect(acc.alpha).toBe(0);
    expect(acc.starved).toBe(false);
    expect(acc.currentTick).toBe(2);
    expect(acc.simTime).toBe(2 * DT);
  });
});
