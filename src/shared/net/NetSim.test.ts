import { beforeEach, describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import {
  describeConditions,
  findPreset,
  NetSim,
  NET_PERFECT,
  NET_PRESETS,
  parseConditions,
} from './NetSim';

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

/**
 * The rest of the simulated link (A23): the caps, the counters and the spec parser.
 *
 * Order was the only thing pinned here. These cover what the harness relies on to mean
 * anything — that loss is loss, that a frame too big is refused rather than truncated, and
 * that `?net=` spells the same conditions every time.
 */
describe('NetSim limits and counters', () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    installClock({ nowMs: () => now });
  });

  function frame(n: number): Uint8Array {
    return new Uint8Array([n & 0xff, n >> 8]);
  }

  it('is "idle" only when its conditions are a perfect link, whatever is in flight', () => {
    // The readers use this to bypass the simulator entirely (`BrowserLink`, `NodeLink`,
    // `WsServer`), so it describes the *conditions*, not the queue.
    expect(new NetSim(NET_PERFECT).idle).toBe(true);
    expect(new NetSim({ latencyMs: 1, jitterMs: 0, lossPct: 0 }).idle).toBe(false);
    expect(new NetSim({ latencyMs: 0, jitterMs: 1, lossPct: 0 }).idle).toBe(false);
    expect(new NetSim({ latencyMs: 0, jitterMs: 0, lossPct: 1 }).idle).toBe(false);
  });

  it('drops everything at total loss, and says it dropped it', () => {
    const sim = new NetSim({ latencyMs: 0, jitterMs: 0, lossPct: 100 });
    expect(sim.idle).toBe(false);
    let delivered = 0;
    for (let i = 0; i < 10; i++) expect(sim.send(frame(i))).toBe(false);
    for (let t = 0; t < 100; t++) {
      sim.pump(() => delivered++);
      now += 1;
    }
    expect(delivered).toBe(0);
    expect(sim.inFlight).toBe(0);
  });

  it('delivers everything at no loss', () => {
    const sim = new NetSim({ latencyMs: 20, jitterMs: 0, lossPct: 0 });
    for (let i = 0; i < 5; i++) expect(sim.send(frame(i))).toBe(true);
    expect(sim.inFlight).toBe(5);
    expect(sim.idle).toBe(false);

    let delivered = 0;
    for (let t = 0; t < 50; t++) {
      sim.pump(() => delivered++);
      now += 1;
    }
    expect(delivered).toBe(5);
    expect(sim.inFlight).toBe(0);
  });

  it('refuses a frame larger than it can hold rather than truncating it', () => {
    const sim = new NetSim({ latencyMs: 0, jitterMs: 0, lossPct: 0 });
    expect(sim.send(new Uint8Array(9000))).toBe(false);
    expect(sim.inFlight).toBe(0);
  });

  it('refuses a frame when nothing is left in flight, rather than growing', () => {
    const sim = new NetSim({ latencyMs: 1000, jitterMs: 0, lossPct: 0 });
    let accepted = 0;
    for (let i = 0; i < 400; i++) if (sim.send(frame(i))) accepted++;
    // MAX_IN_FLIGHT is 256: the pool is fixed, and a full one says no.
    expect(accepted).toBe(256);
    expect(sim.inFlight).toBe(256);
    expect(sim.send(frame(999))).toBe(false);
  });

  it('empties on clear, and keeps nothing to deliver afterwards', () => {
    const sim = new NetSim({ latencyMs: 50, jitterMs: 0, lossPct: 0 });
    sim.send(frame(1));
    sim.send(frame(2));
    sim.clear();
    expect(sim.inFlight).toBe(0);
    let delivered = 0;
    for (let t = 0; t < 100; t++) {
      sim.pump(() => delivered++);
      now += 1;
    }
    expect(delivered).toBe(0);
  });

  it('hands the frame over as the bytes that were sent', () => {
    const sim = new NetSim({ latencyMs: 10, jitterMs: 0, lossPct: 0 });
    sim.send(new Uint8Array([7, 8, 9]));
    const seen: number[][] = [];
    for (let t = 0; t < 40; t++) {
      sim.pump((bytes) => seen.push([...bytes]));
      now += 1;
    }
    expect(seen).toEqual([[7, 8, 9]]);
  });
});

describe('the ?net= spec', () => {
  it('reads every documented form', () => {
    expect(parseConditions('0')).toEqual(NET_PERFECT);
    expect(parseConditions('off')).toEqual(NET_PERFECT);
    expect(parseConditions('100')).toEqual({ latencyMs: 100, jitterMs: 0, lossPct: 0 });
    expect(parseConditions('bad')).toEqual(NET_PRESETS.bad);
    expect(parseConditions('250,40,5')).toEqual({ latencyMs: 250, jitterMs: 40, lossPct: 5 });
  });

  it('refuses what it cannot read, rather than guessing a link', () => {
    expect(parseConditions('wobbly')).toBe(null);
    expect(findPreset('wobbly')).toBe(null);
    expect(findPreset('bad')).toEqual(NET_PRESETS.bad);
  });

  it('describes conditions in the form it parses', () => {
    const text = describeConditions({ latencyMs: 250, jitterMs: 40, lossPct: 5 });
    expect(text).toContain('250');
    expect(parseConditions('250,40,5')).toEqual({ latencyMs: 250, jitterMs: 40, lossPct: 5 });
    void text;
  });
});
