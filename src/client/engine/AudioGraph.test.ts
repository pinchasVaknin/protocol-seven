import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioGraph } from './AudioGraph';
import { DISTANCE_PROFILES } from './AudioMix';
import type { NoiseSpec, OscSpec } from './AudioSpecs';

/**
 * The Web Audio graph, pinned before unit C3's refactor.
 *
 * None of this is reachable on `environment: 'node'` as written, so the context is faked: every
 * factory method hands back a node that records what was done to it, and every `connect` is
 * written into one list. That makes the *shape of the graph* an assertion — which is the point,
 * because `start()` is the function being split and the only thing it produces is a shape.
 *
 * The fake is installed per case on `globalThis.window` and removed after it: the suite runs on
 * node and a stray global `window` would be read by someone else as a browser.
 *
 * What is asserted is what the renderer-equivalent was asked to do: which node connects to which,
 * how many of each kind exist, which `AudioParam` was scheduled with what, and the counters the
 * class publishes. `AudioParam.value` is updated by the fake's `setValueAtTime` so a scheduled
 * value can be read back; assertions prefer the recorded call list where the distinction matters.
 */

// ========================================== the fake ==========================================

interface ParamCall {
  readonly method: string;
  readonly args: readonly number[];
}

class FakeParam {
  value = 0;
  readonly calls: ParamCall[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setValueAtTime(v: number, t: number): void {
    this.calls.push({ method: 'setValueAtTime', args: [v, t] });
    this.value = v;
  }

  setTargetAtTime(v: number, t: number, c: number): void {
    this.calls.push({ method: 'setTargetAtTime', args: [v, t, c] });
    this.value = v;
  }

  exponentialRampToValueAtTime(v: number, t: number): void {
    this.calls.push({ method: 'exponentialRamp', args: [v, t] });
  }

  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push({ method: 'linearRamp', args: [v, t] });
  }

  cancelScheduledValues(t: number): void {
    this.calls.push({ method: 'cancel', args: [t] });
  }

  /** Every value this param was ever scheduled to, in order. */
  get scheduled(): number[] {
    return this.calls.filter((c) => c.method !== 'cancel').map((c) => c.args[0] as number);
  }
}

interface FakeNode {
  readonly kind: string;
  readonly id: number;
  connect(target: FakeNode): void;
  disconnect?(): void;
  [key: string]: unknown;
}

interface Wire {
  readonly from: string;
  readonly to: string;
}

class FakeContext {
  state: AudioContextState = 'suspended';
  currentTime = 10;
  readonly sampleRate = 48000;
  readonly destination: FakeNode;
  readonly listener = {
    positionX: new FakeParam(),
    positionY: new FakeParam(),
    positionZ: new FakeParam(),
    forwardX: new FakeParam(),
    forwardY: new FakeParam(),
    forwardZ: new FakeParam(),
    upX: new FakeParam(),
    upY: new FakeParam(),
    upZ: new FakeParam(),
  };

  readonly nodes: FakeNode[] = [];
  readonly wires: Wire[] = [];
  resumes = 0;
  suspends = 0;
  closes = 0;
  startedSources = 0;

  private nextId = 0;

  constructor() {
    this.destination = this.make('destination');
  }

  private make(kind: string, extra: Record<string, unknown> = {}): FakeNode {
    const id = this.nextId++;
    const node: FakeNode = {
      kind,
      id,
      connect: (target: FakeNode): void => void this.wires.push({ from: `${kind}#${id}`, to: `${target.kind}#${target.id}` }),
      disconnect: (): void => {},
      ...extra,
    };
    this.nodes.push(node);
    return node;
  }

  of(kind: string): FakeNode[] {
    return this.nodes.filter((n) => n.kind === kind);
  }

  /** Every edge, as "kind#id -> kind#id", with the ids stripped: just the shape. */
  get shape(): string[] {
    return this.wires.map((w) => `${w.from.split('#')[0]} -> ${w.to.split('#')[0]}`);
  }

  createGain(): FakeNode {
    return this.make('gain', { gain: new FakeParam(1) });
  }

  createBiquadFilter(): FakeNode {
    return this.make('biquad', { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1) });
  }

  createPanner(): FakeNode {
    return this.make('panner', {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 10000,
      rolloffFactor: 1,
      positionX: new FakeParam(),
      positionY: new FakeParam(),
      positionZ: new FakeParam(),
    });
  }

  createConvolver(): FakeNode {
    return this.make('convolver', { buffer: null });
  }

  createBufferSource(): FakeNode {
    const ctx = this;
    return this.make('bufferSource', {
      buffer: null,
      loop: false,
      playbackRate: new FakeParam(1),
      startCalls: [] as number[][],
      start(...args: number[]) {
        ctx.startedSources++;
        (this as unknown as { startCalls: number[][] }).startCalls.push(args);
      },
      stop(): void {},
    });
  }

  createOscillator(): FakeNode {
    const ctx = this;
    return this.make('oscillator', {
      type: 'sine',
      frequency: new FakeParam(440),
      start(): void {
        ctx.startedSources++;
      },
      stop(): void {},
    });
  }

  createBuffer(channels: number, length: number): unknown {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      numberOfChannels: channels,
      sampleRate: this.sampleRate,
      getChannelData: (i: number) => data[i],
    };
  }

  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closes++;
    return Promise.resolve();
  }
}

let ctx: FakeContext;
let warned: string[];

beforeEach(() => {
  ctx = new FakeContext();
  warned = [];
  const globals = globalThis as Record<string, unknown>;
  globals.window = { AudioContext: function (): FakeContext { return ctx; } };
  vi.spyOn(console, 'warn').mockImplementation((m: string) => void warned.push(String(m)));
});

afterEach(() => {
  const globals = globalThis as Record<string, unknown>;
  delete globals.window;
  vi.restoreAllMocks();
});

/** A started graph with a running context, which is what every sound needs. */
function started(): AudioGraph {
  const graph = new AudioGraph();
  graph.start();
  return graph;
}

function noise(over: Partial<NoiseSpec> = {}): NoiseSpec {
  const graph = { ...over };
  return {
    x: 0, y: 0, z: 0, positional: true, bus: 'sfx', filter: 'bandpass',
    freq: 1000, freqEnd: 1000, q: 1, level: 0.4, attack: 0.004, decay: 0.1,
    wet: 0.15, rate: 1, roll: 'world', ...graph,
  } as NoiseSpec;
}

function osc(over: Partial<OscSpec> = {}): OscSpec {
  return {
    x: 0, y: 0, z: 0, positional: false, bus: 'ui', type: 'sine',
    freq: 440, freqEnd: 440, level: 0.2, attack: 0.004, decay: 0.1,
    wet: 0, filterFreq: 8000, filterQ: 0.7, roll: 'world', ...over,
  } as OscSpec;
}

// ===================================== building the graph =====================================

describe('AudioGraph.start', () => {
  it('runs silent, and does not throw, where there is no Web Audio at all', () => {
    (globalThis as Record<string, unknown>).window = {};
    const graph = new AudioGraph();
    expect(() => graph.start()).not.toThrow();
    expect(graph.isRunning).toBe(false);
    expect(graph.poolSize).toBe(0);
    expect(warned.some((w) => w.includes('Web Audio unavailable'))).toBe(true);
  });

  it('builds the graph once and resumes the context', () => {
    const graph = started();
    expect(graph.isRunning).toBe(true);
    expect(ctx.resumes).toBe(1);
  });

  it('builds exactly one convolver in the whole process', () => {
    started();
    expect(ctx.of('convolver').length).toBe(1);
  });

  it('wires sfx through the world filter and the duck, and routes music and ui around both', () => {
    started();
    const [convolver] = ctx.of('convolver');
    const worldFilter = ctx.of('biquad').find((n) => (n.frequency as FakeParam).value === 20000);
    expect(worldFilter).toBeDefined();
    const to = (node: FakeNode | undefined): string[] =>
      ctx.wires.filter((w) => w.from === `${node?.kind}#${node?.id}`).map((w) => w.to.split('#')[0] as string);
    // The world low-pass feeds the duck, and the duck feeds the master.
    expect(to(worldFilter)).toEqual(['gain']);
    // The one convolver returns into the world filter, not into the master.
    expect(to(convolver)).toEqual(['gain']);
    // Three buses exist and the master reaches the destination.
    expect(ctx.shape).toContain('gain -> destination');
  });

  it('fills the pool to the authored size and no further', () => {
    const graph = started();
    expect(graph.poolSize).toBe(128);
    expect(graph.poolPeak).toBe(128);
    expect(graph.voiceCount).toBe(0);
  });

  it('starts the one sustained bed looping', () => {
    started();
    const loops = ctx.of('bufferSource').filter((n) => n.loop === true);
    expect(loops.length).toBe(1);
  });

  it('is safe to call again: one graph, one more resume', () => {
    const graph = started();
    const nodes = ctx.nodes.length;
    graph.start();
    expect(ctx.nodes.length).toBe(nodes);
    expect(ctx.resumes).toBe(2);
  });

  it('suspends and resumes the context it owns', () => {
    const graph = started();
    graph.suspend();
    expect(ctx.suspends).toBe(1);
    graph.resume();
    expect(ctx.resumes).toBe(2);
  });
});

// ======================================== the two voices ======================================

describe('AudioGraph: acquiring a voice', () => {
  it('plays nothing before the graph is built', () => {
    const graph = new AudioGraph();
    graph.noiseBurst(noise());
    graph.oscHit(osc());
    expect(graph.voiceCount).toBe(0);
    expect(graph.sourcesStarted).toBe(0);
  });

  it('plays nothing while the context is suspended, because nothing could recycle it', () => {
    const graph = started();
    ctx.state = 'suspended';
    graph.noiseBurst(noise());
    expect(graph.voiceCount).toBe(0);
    expect(graph.voicesDropped).toBe(0);
  });

  it('counts one source per noise burst and one per oscillator hit', () => {
    const graph = started();
    graph.noiseBurst(noise());
    expect(graph.sourcesStarted).toBe(1);
    graph.oscHit(osc());
    expect(graph.sourcesStarted).toBe(2);
    expect(graph.voiceCount).toBe(2);
  });

  it('drops a sound past the active ceiling rather than growing the pool', () => {
    const graph = started();
    for (let i = 0; i < 112; i++) graph.noiseBurst(noise());
    expect(graph.voiceCount).toBe(112);
    expect(graph.voicesDropped).toBe(0);
    graph.noiseBurst(noise());
    expect(graph.voiceCount).toBe(112);
    expect(graph.voicesDropped).toBe(1);
    graph.oscHit(osc());
    expect(graph.voicesDropped).toBe(2);
    // The pool never grew past what start() built.
    expect(graph.poolSize).toBe(128);
  });

  it('recycles every voice whose tail has passed, and nothing else', () => {
    const graph = started();
    graph.noiseBurst(noise({ decay: 0.1 }));
    graph.noiseBurst(noise({ decay: 5 }));
    expect(graph.voiceCount).toBe(2);
    ctx.currentTime += 1;
    graph.update();
    expect(graph.voiceCount).toBe(1);
    ctx.currentTime += 10;
    graph.update();
    expect(graph.voiceCount).toBe(0);
  });

  it('reads the noise buffer from a random offset that always leaves room for the tail', () => {
    const graph = started();
    graph.noiseBurst(noise({ decay: 0.2, rate: 1 }));
    const src = ctx.of('bufferSource').filter((n) => n.loop !== true).at(-1);
    const [, offset, span] = (src?.startCalls as number[][])[0] as number[];
    expect(span).toBeCloseTo(0.22, 10);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect((offset as number) + (span as number)).toBeLessThanOrEqual(2);
  });
});

// ========================================== routing ===========================================

describe('AudioGraph: routing a voice', () => {
  /** The panner of the voice the last sound used. */
  function lastPanner(): FakeNode {
    const panners = ctx.of('panner');
    return panners.find((p) => (p.positionX as FakeParam).calls.length > 0) ?? (panners[0] as FakeNode);
  }

  it('applies the distance profile the sound asked for', () => {
    const graph = started();
    graph.noiseBurst(noise({ roll: 'loud', positional: true, bus: 'sfx', x: 5 }));
    const panner = lastPanner();
    expect(panner.refDistance).toBe(DISTANCE_PROFILES.loud.refDistance);
    expect(panner.rolloffFactor).toBe(DISTANCE_PROFILES.loud.rolloff);
    expect(panner.maxDistance).toBe(DISTANCE_PROFILES.loud.maxDistance);
  });

  it('applies a different profile for a different sound', () => {
    const graph = started();
    graph.noiseBurst(noise({ roll: 'footstep', positional: true, bus: 'sfx', x: 5 }));
    const panner = lastPanner();
    expect(panner.refDistance).toBe(DISTANCE_PROFILES.footstep.refDistance);
    expect(panner.rolloffFactor).toBe(DISTANCE_PROFILES.footstep.rolloff);
  });

  it('puts the sound where it happened', () => {
    const graph = started();
    graph.noiseBurst(noise({ positional: true, bus: 'sfx', x: 3, y: -1, z: 7 }));
    const panner = lastPanner();
    expect((panner.positionX as FakeParam).value).toBe(3);
    expect((panner.positionY as FakeParam).value).toBe(-1);
    expect((panner.positionZ as FakeParam).value).toBe(7);
  });

  it('takes the flat route for a non-positional sound and never touches a panner', () => {
    const graph = started();
    const before = ctx.of('panner').filter((p) => (p.positionX as FakeParam).calls.length > 0).length;
    graph.oscHit(osc({ positional: false, bus: 'ui' }));
    const after = ctx.of('panner').filter((p) => (p.positionX as FakeParam).calls.length > 0).length;
    expect(after).toBe(before);
  });

  it('takes the flat route for a positional sound asking for a bus that has no voice path', () => {
    const graph = started();
    const before = ctx.of('panner').filter((p) => (p.positionX as FakeParam).calls.length > 0).length;
    graph.noiseBurst(noise({ positional: true, bus: 'music', x: 4 }));
    const after = ctx.of('panner').filter((p) => (p.positionX as FakeParam).calls.length > 0).length;
    expect(after).toBe(before);
  });

  it('closes the occlusion filter when the raycaster says something is in the way', () => {
    const graph = started();
    graph.setOccluder(() => true);
    graph.noiseBurst(noise({ positional: true, bus: 'sfx', x: 9 }));
    const closed = ctx.of('biquad').some((b) => (b.frequency as FakeParam).scheduled.includes(750));
    expect(closed).toBe(true);
  });

  it('leaves it open when nothing is in the way', () => {
    const graph = started();
    graph.setOccluder(() => false);
    graph.noiseBurst(noise({ positional: true, bus: 'sfx', x: 9 }));
    const closed = ctx.of('biquad').some((b) => (b.frequency as FakeParam).scheduled.includes(750));
    expect(closed).toBe(false);
  });

  it('forgets an occluder that is taken away again', () => {
    const graph = started();
    graph.setOccluder(() => true);
    graph.setOccluder(null);
    graph.noiseBurst(noise({ positional: true, bus: 'sfx', x: 9 }));
    const closed = ctx.of('biquad').some((b) => (b.frequency as FakeParam).scheduled.includes(750));
    expect(closed).toBe(false);
  });
});

// ===================================== the world controls =====================================

describe('AudioGraph: the muffle, which is one filter and three contributors', () => {
  it('follows the health muffle', () => {
    const graph = started();
    graph.setMuffle(0.4);
    expect(graph.muffleAmount).toBe(0.4);
  });

  it('takes the largest of the three rather than compounding them', () => {
    const graph = started();
    graph.setMuffle(0.4);
    graph.setFlashMuffle(0.5);
    // 0.5 past the flash's 1.2 overdrive is 0.6, which beats the health's 0.4.
    expect(graph.muffleAmount).toBeCloseTo(0.6, 10);
    graph.setConcussionMuffle(0.2);
    expect(graph.muffleAmount).toBeCloseTo(0.6, 10);
  });

  it('lets a flash reach a cutoff the health state never can', () => {
    const graph = started();
    graph.setMuffle(1);
    const health = graph.muffleAmount;
    graph.setFlashMuffle(1);
    expect(graph.muffleAmount).toBeGreaterThan(health);
    expect(graph.muffleAmount).toBeCloseTo(1.2, 10);
  });

  it('clamps each contributor into its own range', () => {
    const graph = started();
    graph.setMuffle(5);
    expect(graph.muffleAmount).toBe(1);
    graph.resetMatchState();
    graph.setConcussionMuffle(-3);
    expect(graph.muffleAmount).toBe(0);
  });

  it('ignores a change too small to hear', () => {
    const graph = started();
    graph.setMuffle(0.4);
    const at = graph.muffleAmount;
    graph.setMuffle(0.405);
    expect(graph.muffleAmount).toBe(at);
  });

  it('is cleared with the rest of the match state, filter and duck together', () => {
    const graph = started();
    graph.setMuffle(0.9);
    graph.duckWorld(2);
    graph.resetMatchState();
    expect(graph.muffleAmount).toBe(0);
    const worldFilter = ctx.of('biquad').find((b) => (b.frequency as FakeParam).scheduled.includes(20000));
    expect((worldFilter?.frequency as FakeParam).value).toBe(20000);
  });
});

describe('AudioGraph: the announcer duck', () => {
  /** The duck is the one gain that is scheduled down to the duck floor. */
  function duck(): FakeNode | undefined {
    return ctx.of('gain').find((g) => (g.gain as FakeParam).scheduled.includes(0.34));
  }

  it('pulls the world down and lets it back up', () => {
    const graph = started();
    graph.duckWorld(0.5);
    const scheduled = (duck()?.gain as FakeParam).scheduled;
    expect(scheduled).toContain(0.34);
    expect(scheduled).toContain(1);
  });

  it('extends an overlapping sting rather than restarting the ramp', () => {
    const graph = started();
    graph.duckWorld(1);
    const after = (duck()?.gain as FakeParam).calls.length;
    graph.duckWorld(0.2);
    expect((duck()?.gain as FakeParam).calls.length).toBe(after);
  });

  it('takes the longer of two stings', () => {
    const graph = started();
    graph.duckWorld(0.2);
    const after = (duck()?.gain as FakeParam).calls.length;
    graph.duckWorld(3);
    expect((duck()?.gain as FakeParam).calls.length).toBeGreaterThan(after);
  });
});

describe('AudioGraph: volumes, the room and the listener', () => {
  it('clamps the master volume into 0..1', () => {
    const graph = started();
    graph.setMasterVolume(3);
    const master = ctx.of('gain')[0];
    expect((master?.gain as FakeParam).value).toBe(1);
    graph.setMasterVolume(-1);
    expect((master?.gain as FakeParam).value).toBe(0);
  });

  it('clamps a bus volume and ignores a bus that does not exist', () => {
    const graph = started();
    expect(() => graph.setBusVolume('music', 9)).not.toThrow();
    expect(() => graph.setBusVolume('sfx', -2)).not.toThrow();
  });

  it('swaps the room by giving the one convolver a new buffer', () => {
    const graph = started();
    const [convolver] = ctx.of('convolver');
    const first = convolver?.buffer;
    graph.setReverb({ seconds: 0.5, decay: 2, brightness: 0.7, earlyTaps: [] });
    expect(convolver?.buffer).not.toBe(first);
    expect(ctx.of('convolver').length).toBe(1);
  });

  it('falls back to the default room for a map that describes none', () => {
    const graph = started();
    const [convolver] = ctx.of('convolver');
    const first = convolver?.buffer;
    graph.setReverb(null);
    expect(convolver?.buffer).not.toBe(first);
  });

  it('does nothing with a room before the graph exists', () => {
    const graph = new AudioGraph();
    expect(() => graph.setReverb(null)).not.toThrow();
  });

  it('moves all nine listener parameters together', () => {
    const graph = started();
    graph.setListener(1, 2, 3, 0, 0, -1, 0, 1, 0);
    expect(ctx.listener.positionX.value).toBe(1);
    expect(ctx.listener.positionY.value).toBe(2);
    expect(ctx.listener.positionZ.value).toBe(3);
    expect(ctx.listener.forwardZ.value).toBe(-1);
    expect(ctx.listener.upY.value).toBe(1);
  });
});

describe('AudioGraph: the sustained bed and teardown', () => {
  it('moves the bed and opens its gain when it goes active', () => {
    const graph = started();
    graph.setSustainedBed(true, 4, 0, -2, 0.3, 700);
    const bed = ctx.of('panner').find((p) => (p.positionX as FakeParam).value === 4);
    expect(bed).toBeDefined();
    expect((bed?.positionZ as FakeParam).value).toBe(-2);
  });

  it('closes the gain toward silence when it goes inactive', () => {
    const graph = started();
    graph.setSustainedBed(true, 0, 0, 0, 0.3, 700);
    graph.setSustainedBed(false, 0, 0, 0, 0.3, 700);
    const closing = ctx.of('gain').some((g) => (g.gain as FakeParam).scheduled.includes(0.0001));
    expect(closing).toBe(true);
  });

  it('closes the context and forgets the graph', () => {
    const graph = started();
    graph.dispose();
    expect(ctx.closes).toBe(1);
    expect(graph.isRunning).toBe(false);
    expect(graph.poolSize).toBe(0);
    expect(graph.voiceCount).toBe(0);
  });

  it('can be built again after it was disposed', () => {
    const graph = started();
    graph.dispose();
    ctx = new FakeContext();
    (globalThis as Record<string, unknown>).window = { AudioContext: function (): FakeContext { return ctx; } };
    graph.start();
    expect(graph.poolSize).toBe(128);
  });
});
