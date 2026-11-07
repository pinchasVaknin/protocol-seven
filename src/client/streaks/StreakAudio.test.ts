import { beforeEach, describe, expect, it } from 'vitest';
import type { ProceduralAudio } from '../engine/ProceduralAudio';
import { StreakAudio } from './StreakAudio';

/**
 * A recording graph, as `EquipmentAudio.test.ts` uses — but this class is the interesting half
 * of BACKLOG #60's pair: it holds **its own** `NoiseSpec` and `OscSpec` rather than writing the
 * graph's shared module-level scratches, so no streak sound can inherit another sound's
 * settings. The last two tests pin exactly that, because it is the property that makes this
 * file immune to the defect `EquipmentAudio` has.
 */

interface Fired {
  readonly method: string;
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
  const base: Record<string, unknown> = { fired, noiseScratch, oscScratch };
  return new Proxy(base, {
    get(target, key) {
      if (key in target) return target[String(key)];
      return (...args: unknown[]): undefined => {
        const spec = args.find((a) => a !== null && typeof a === 'object');
        fired.push({ method: String(key), spec: { ...((spec as Record<string, unknown>) ?? {}), __args: args.filter((a) => typeof a !== 'object') } });
        return undefined;
      };
    },
  }) as unknown as Graph;
}

let graph: Graph;
let audio: StreakAudio;

beforeEach(() => {
  graph = recordingGraph();
  audio = new StreakAudio(graph as unknown as ProceduralAudio);
});

const POSITIONAL: Array<[string, (a: StreakAudio) => void]> = [
  ['packageDrop', (a) => a.packageDrop(1, 2, 3)],
  ['packageLand', (a) => a.packageLand(1, 2, 3)],
  ['packageClaimed', (a) => a.packageClaimed(1, 2, 3)],
  ['mortarImpact', (a) => a.mortarImpact(1, 2, 3)],
  ['sentryDeploy', (a) => a.sentryDeploy(1, 2, 3)],
  ['sentryShot', (a) => a.sentryShot(1, 2, 3)],
  ['sentryDestroyed', (a) => a.sentryDestroyed(1, 2, 3)],
];

describe('every streak cue reaches the graph', () => {
  for (const [name, play] of POSITIONAL) {
    it(`${name} fires at least one layer, placed at the event`, () => {
      play(audio);
      expect(graph.fired.length).toBeGreaterThan(0);
      for (const layer of graph.fired) {
        if (layer.spec['positional'] !== true) continue;
        expect(layer.spec['x']).toBe(1);
        expect(layer.spec['y']).toBe(2);
        expect(layer.spec['z']).toBe(3);
      }
    });
  }

  it('whistles an inbound mortar from well above where it will land', () => {
    audio.mortarInbound(1, 2, 3);
    const placed = graph.fired.find((layer) => layer.spec['positional'] === true);
    expect(placed).toBeDefined();
    expect(placed?.spec['x']).toBe(1);
    // Eighteen metres up: the shell is falling, and the sound comes from where it is.
    expect(placed?.spec['y']).toBe(20);
    expect(placed?.spec['z']).toBe(3);
  });

  it('the UAV sweep and the counter-UAV fire', () => {
    audio.uavSweep(0.25);
    expect(graph.fired.length).toBeGreaterThan(0);
    graph.fired.length = 0;
    audio.counterUav();
    expect(graph.fired.length).toBeGreaterThan(0);
  });

  it('the chopper rotor and its gun fire', () => {
    audio.chopperSpin(0.6);
    expect(graph.fired.length).toBeGreaterThan(0);
    graph.fired.length = 0;
    audio.chopperShot();
    expect(graph.fired.length).toBeGreaterThan(0);
  });
});

describe('the cues that vary with their argument', () => {
  it('moves the UAV sweep with its phase', () => {
    audio.uavSweep(0);
    const low = JSON.stringify(graph.fired);
    graph.fired.length = 0;
    audio.uavSweep(0.9);
    expect(JSON.stringify(graph.fired)).not.toBe(low);
  });

  it('moves the chopper rotor with its spin', () => {
    audio.chopperSpin(0.1);
    const slow = JSON.stringify(graph.fired);
    graph.fired.length = 0;
    audio.chopperSpin(1);
    expect(JSON.stringify(graph.fired)).not.toBe(slow);
  });
});

describe('a different sound for each event', () => {
  it('does not play two streak cues the same way', () => {
    const shapes = new Map<string, string>();
    for (const [name, play] of POSITIONAL) {
      graph.fired.length = 0;
      play(audio);
      shapes.set(name, JSON.stringify(graph.fired));
    }
    expect(new Set(shapes.values()).size).toBe(shapes.size);
  });

  it('does not play the inbound whistle the way it plays the impact', () => {
    audio.mortarInbound(1, 2, 3);
    const inbound = JSON.stringify(graph.fired);
    graph.fired.length = 0;
    audio.mortarImpact(1, 2, 3);
    expect(JSON.stringify(graph.fired)).not.toBe(inbound);
  });
});

describe('the specs this class writes are its own (BACKLOG #60)', () => {
  it('never touches the graph’s shared noise scratch', () => {
    for (const [, play] of POSITIONAL) play(audio);
    audio.uavSweep(0.5);
    audio.counterUav();
    audio.chopperSpin(0.5);
    audio.chopperShot();
    expect(Object.keys(graph.noiseScratch)).toHaveLength(0);
  });

  it('never touches the graph’s shared oscillator scratch', () => {
    for (const [, play] of POSITIONAL) play(audio);
    audio.uavSweep(0.5);
    audio.counterUav();
    audio.chopperSpin(0.5);
    audio.chopperShot();
    expect(Object.keys(graph.oscScratch)).toHaveLength(0);
  });

  it('reuses one spec per instance, so two streak sounds cannot be in flight at once', () => {
    audio.sentryShot(1, 2, 3);
    const first = graph.fired[0]?.spec;
    graph.fired.length = 0;
    audio.sentryDeploy(4, 5, 6);
    const second = graph.fired[0]?.spec;
    // The copies differ because the fields were rewritten between the two calls.
    expect(second).not.toEqual(first);
  });

  it('gives two instances the same sound for the same cue', () => {
    const otherGraph = recordingGraph();
    const other = new StreakAudio(otherGraph as unknown as ProceduralAudio);
    audio.mortarImpact(1, 2, 3);
    other.mortarImpact(1, 2, 3);
    expect(JSON.stringify(otherGraph.fired)).toBe(JSON.stringify(graph.fired));
  });
});
