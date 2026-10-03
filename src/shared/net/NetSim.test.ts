import { beforeEach, describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { NetSim, NET_PRESETS } from './NetSim';

/**
 * The simulated link is a stream, as the real one is (2026-10-03).
 *
 * It used to draw every frame's delay independently, so jitter delivered frames out of order —
 * which a WebSocket never does — and the mode-state hash, sent last in its tick, overtook the
 * bomb frame sent just before it: 178 confirmed S&D divergences under `bad`, all of them this.
 */
describe('NetSim', () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    installClock({ nowMs: () => now });
  });

  function frame(n: number): Uint8Array {
    return new Uint8Array([n & 0xff, n >> 8]);
  }

  /** Send `count` frames `gapMs` apart, then run the clock out and collect what arrives. */
  function run(sim: NetSim, count: number, gapMs: number): number[] {
    const got: number[] = [];
    const take = (bytes: Uint8Array): void => {
      got.push((bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8));
    };
    for (let i = 0; i < count; i++) {
      sim.send(frame(i));
      sim.pump(take);
      now += gapMs;
    }
    for (let t = 0; t < 1000; t++) {
      sim.pump(take);
      now += 1;
    }
    return got;
  }

  it('delivers in send order under jitter wider than the gap between frames', () => {
    // ±30 ms against frames 1 ms apart: independent delays would reorder most of them.
    const sim = new NetSim({ latencyMs: 100, jitterMs: 30, lossPct: 0 }, 7);
    const got = run(sim, 400, 1);
    expect(got).toHaveLength(400);
    expect(got).toEqual([...got].sort((a, b) => a - b));
  });

  it('still loses frames under the bad preset, and never delivers the rest out of order', () => {
    const sim = new NetSim(NET_PRESETS['bad'], 11);
    const got = run(sim, 2000, 2);
    expect(sim.dropped).toBeGreaterThan(0);
    expect(got.length + sim.dropped).toBe(2000);
    expect(got).toEqual([...got].sort((a, b) => a - b));
  });

  it('holds a frame for half the added round trip', () => {
    const sim = new NetSim({ latencyMs: 100, jitterMs: 0, lossPct: 0 });
    const got: number[] = [];
    sim.send(frame(1));
    now = 49;
    sim.pump(() => got.push(1));
    expect(got).toEqual([]);
    now = 50;
    sim.pump(() => got.push(1));
    expect(got).toEqual([1]);
  });
});
