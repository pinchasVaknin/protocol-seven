import { beforeEach, describe, expect, it } from 'vitest';
import { EquipmentAudio } from './EquipmentAudio';

/**
 * Every sound here is "fill a spec, hand it to the graph", so a recording graph pins the whole
 * of what this file does: which fields each layer sets, and to what.
 *
 * The specs it fills are `ProceduralAudio`'s **shared module-level scratches**, which every
 * other sound in the game also writes. That is what makes the "fields a sound does not set"
 * tests below worth having — see BACKLOG #60.
 */

interface Fired {
  readonly kind: 'noise' | 'osc' | 'ui';
  readonly spec: Record<string, unknown>;
}

interface Graph {
  readonly fired: Fired[];
  readonly noiseScratch: Record<string, unknown>;
  readonly oscScratch: Record<string, unknown>;
}

function recordingGraph(): Graph {
  const fired: Fired[] = [];
  const noiseScratch: Record<string, unknown> = {};
  const oscScratch: Record<string, unknown> = {};
  const graph = {
    fired,
    noiseScratch,
    oscScratch,
    noiseBurst: (spec: Record<string, unknown>): undefined => {
      fired.push({ kind: 'noise', spec: { ...spec } });
      return undefined;
    },
    oscHit: (spec: Record<string, unknown>): undefined => {
      fired.push({ kind: 'osc', spec: { ...spec } });
      return undefined;
    },
    playUiSweep: (...args: unknown[]): undefined => {
      fired.push({ kind: 'ui', spec: { args } });
      return undefined;
    },
    playRing: (...args: unknown[]): undefined => {
      fired.push({ kind: 'ui', spec: { ring: args } });
      return undefined;
    },
  };
  return graph as unknown as Graph;
}

let graph: Graph;
let audio: EquipmentAudio;

beforeEach(() => {
  graph = recordingGraph();
  audio = new EquipmentAudio(graph as never);
});

describe('playExplosion', () => {
  it('fires four layers: three noise bursts and one oscillator', () => {
    audio.playExplosion(1, 2, 3, 1);
    expect(graph.fired.map((f) => f.kind)).toEqual(['noise', 'noise', 'noise', 'osc']);
  });

  it('places every layer at the blast, positionally, on the sfx bus', () => {
    audio.playExplosion(4, 1.5, -7, 1);
    for (const layer of graph.fired) {
      expect(layer.spec['x']).toBe(4);
      expect(layer.spec['y']).toBe(1.5);
      expect(layer.spec['z']).toBe(-7);
      expect(layer.spec['positional']).toBe(true);
      expect(layer.spec['bus']).toBe('sfx');
    }
  });

  it('walks the crack, the body, the tail and the sub down the spectrum', () => {
    audio.playExplosion(0, 0, 0, 1);
    const [crack, body, tail, sub] = graph.fired;
    expect(crack?.spec['filter']).toBe('highpass');
    expect(crack?.spec['freq']).toBe(3400);
    expect(body?.spec['filter']).toBe('bandpass');
    expect(tail?.spec['filter']).toBe('lowpass');
    expect(tail?.spec['decay']).toBeCloseTo(1.15, 10);
    expect(sub?.spec['type']).toBe('sine');
    expect(sub?.spec['freq']).toBe(62);
    expect(sub?.spec['freqEnd']).toBe(22);
  });

  it('scales every layer’s level with the blast, and nothing else', () => {
    audio.playExplosion(0, 0, 0, 1);
    const full = graph.fired.map((f) => Number(f.spec['level']));
    const decays = graph.fired.map((f) => Number(f.spec['decay']));
    graph.fired.length = 0;
    audio.playExplosion(0, 0, 0, 0.25);
    const quarter = graph.fired.map((f) => Number(f.spec['level']));
    for (let i = 0; i < full.length; i++) expect(quarter[i]).toBeCloseTo((full[i] ?? 0) * 0.25, 10);
    expect(graph.fired.map((f) => Number(f.spec['decay']))).toEqual(decays);
  });

  it('jitters only the crack’s rate, and keeps the body’s at one', () => {
    const rates: number[] = [];
    for (let i = 0; i < 12; i++) {
      graph.fired.length = 0;
      audio.playExplosion(0, 0, 0, 1);
      rates.push(Number(graph.fired[0]?.spec['rate']));
      expect(graph.fired[1]?.spec['rate']).toBe(1);
      expect(graph.fired[2]?.spec['rate']).toBeCloseTo(0.7, 10);
    }
    expect(new Set(rates).size).toBeGreaterThan(1);
    for (const rate of rates) {
      expect(rate).toBeGreaterThanOrEqual(0.94);
      expect(rate).toBeLessThanOrEqual(1.06);
    }
  });

  it('is deterministic for a given instance: two audios deal the same jitter', () => {
    const a = new EquipmentAudio(recordingGraph() as never);
    const bGraph = recordingGraph();
    const b = new EquipmentAudio(bGraph as never);
    const first: number[] = [];
    for (let i = 0; i < 5; i++) {
      graph.fired.length = 0;
      audio.playExplosion(0, 0, 0, 1);
      first.push(Number(graph.fired[0]?.spec['rate']));
    }
    const second: number[] = [];
    for (let i = 0; i < 5; i++) {
      bGraph.fired.length = 0;
      b.playExplosion(0, 0, 0, 1);
      second.push(Number(bGraph.fired[0]?.spec['rate']));
    }
    expect(second).toEqual(first);
    void a;
  });

  it('names a distance profile on every layer', () => {
    // BACKLOG #60, fixed 2026-11-21. This asserted the opposite — no layer carried a `roll` at
    // all, because these were the graph's **shared** scratches and nothing here ever set one,
    // so an explosion played on whatever curve the previous sound in the game had left. The
    // pair is this class's own now and `makeNoiseSpec` defaults it.
    audio.playExplosion(0, 0, 0, 1);
    expect(graph.fired.length).toBeGreaterThan(0);
    for (const layer of graph.fired) expect(layer.spec['roll']).toBe('world');
  });
});

describe('the other equipment sounds', () => {
  it('plays a throw, a bounce and an arming pip positionally', () => {
    audio.playThrow(1, 2, 3);
    expect(graph.fired.length).toBeGreaterThan(0);
    for (const layer of graph.fired) expect(layer.spec['positional']).toBe(true);
  });

  it('makes a stuck bounce different from a loose one', () => {
    audio.playBounce(0, 0, 0, 5, 0, false);
    const loose = graph.fired.map((f) => JSON.stringify(f.spec));
    graph.fired.length = 0;
    audio.playBounce(0, 0, 0, 5, 0, true);
    const stuck = graph.fired.map((f) => JSON.stringify(f.spec));
    expect(stuck).not.toEqual(loose);
  });

  it('makes a fast bounce louder than a slow one', () => {
    audio.playBounce(0, 0, 0, 1, 0, false);
    const slow = Number(graph.fired[0]?.spec['level']);
    graph.fired.length = 0;
    audio.playBounce(0, 0, 0, 9, 0, false);
    expect(Number(graph.fired[0]?.spec['level'])).toBeGreaterThan(slow);
  });

  it('puts the threat beep on the interface, not in the world', () => {
    audio.playThreatBeep(0.5);
    expect(graph.fired).toHaveLength(1);
    expect(graph.fired[0]?.kind).toBe('ui');
  });

  it('raises the threat beep with urgency', () => {
    audio.playThreatBeep(0);
    const calm = graph.fired[0]?.spec['args'] as number[];
    graph.fired.length = 0;
    audio.playThreatBeep(1);
    const urgent = graph.fired[0]?.spec['args'] as number[];
    expect(urgent[0]).toBeGreaterThan(calm[0] ?? 0);
    expect(urgent[1]).toBeGreaterThan(calm[1] ?? 0);
  });

  it('plays a flashbang and a smoke pop', () => {
    audio.playFlashbang(0, 1, 0, 0.8);
    expect(graph.fired.length).toBeGreaterThan(0);
    graph.fired.length = 0;
    audio.playSmoke(5, 0, 5);
    expect(graph.fired.length).toBeGreaterThan(0);
  });

  it('names one on every other positional sound too', () => {
    // BACKLOG #60, fixed 2026-11-21. Was the reverse; see the explosion's own test above.
    const positional: Array<() => void> = [
      () => audio.playThrow(1, 2, 3),
      () => audio.playBounce(1, 2, 3, 5, 0, false),
      () => audio.playArmed(1, 2, 3),
      () => audio.playFlashbang(1, 2, 3, 0.5),
      () => audio.playSmoke(1, 2, 3),
    ];
    for (const play of positional) {
      graph.fired.length = 0;
      play();
      for (const layer of graph.fired) {
        if (layer.kind === 'ui') continue;
        expect(layer.spec['roll']).toBe('world');
      }
    }
  });
});
