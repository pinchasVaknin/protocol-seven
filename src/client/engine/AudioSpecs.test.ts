import { describe, expect, it } from 'vitest';
import { Rng } from '../../shared/core/Rng';
import {
  buildImpulseResponse,
  buildNoiseBuffer,
  DEFAULT_REVERB,
  makeNoiseSpec,
  makeOscSpec,
  NOISE_SECONDS,
  type ReverbSpec,
} from './AudioSpecs';

/**
 * The audio vocabulary and the two buffers it is built on, pinned before unit C3's refactor.
 *
 * These two builders look like they need Web Audio and do not: between them they touch exactly
 * `ctx.sampleRate` and `ctx.createBuffer`, so a nine-line fake runs them on `environment: 'node'`
 * and the samples that come out are real. With a seeded `Rng` the output is deterministic to the
 * last bit, which is what makes the checksums below worth having — `buildImpulseResponse` is the
 * one function in this unit whose refactor could change a number without changing a shape, and a
 * reassociated multiply inside the early-tap loop would move a sample without moving anything a
 * structural assertion could see.
 *
 * The expected values were taken off the unmodified code.
 */

// ========================================== the fake ==========================================

interface FakeBuffer {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(index: number): Float32Array;
}

const SAMPLE_RATE = 48000;

/** Everything `buildNoiseBuffer` and `buildImpulseResponse` ever ask of a context. */
function fakeContext(sampleRate = SAMPLE_RATE): AudioContext {
  return {
    sampleRate,
    createBuffer: (channels: number, length: number): FakeBuffer => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        length,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: (index: number): Float32Array => data[index] as Float32Array,
      };
    },
  } as unknown as AudioContext;
}

function seeded(): Rng {
  return new Rng(0x5eed_f007);
}

/** FNV-1a over the raw float32 bits of every channel. Any moved sample moves this. */
function checksum(buffer: AudioBuffer): number {
  const scratch = new Float32Array(1);
  const bits = new Uint32Array(scratch.buffer);
  let h = 0x811c_9dc5;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      scratch[0] = data[i] as number;
      h ^= bits[0] as number;
      h = Math.imul(h, 0x0100_0193) >>> 0;
    }
  }
  return h >>> 0;
}

const ROOM: ReverbSpec = {
  seconds: 0.25,
  decay: 2.6,
  brightness: 0.35,
  earlyTaps: [
    { delay: 0.011, gain: 0.5 },
    { delay: 0.023, gain: 0.3 },
  ],
};

// ======================================== the test cases ======================================

describe('makeNoiseSpec', () => {
  it('is the authored default, field for field', () => {
    expect(makeNoiseSpec()).toEqual({
      x: 0,
      y: 0,
      z: 0,
      positional: true,
      bus: 'sfx',
      filter: 'bandpass',
      freq: 1000,
      freqEnd: 1000,
      q: 1,
      level: 0.4,
      attack: 0.004,
      decay: 0.1,
      wet: 0.15,
      rate: 1,
      roll: 'world',
    });
  });

  it('hands out a fresh object each call, so one caller cannot poison another', () => {
    const a = makeNoiseSpec();
    const b = makeNoiseSpec();
    expect(a).not.toBe(b);
    a.freq = 1;
    expect(b.freq).toBe(1000);
  });

  it('starts positional, because most noise in this game happens somewhere', () => {
    expect(makeNoiseSpec().positional).toBe(true);
    expect(makeNoiseSpec().bus).toBe('sfx');
  });
});

describe('makeOscSpec', () => {
  it('is the authored default, field for field', () => {
    expect(makeOscSpec()).toEqual({
      x: 0,
      y: 0,
      z: 0,
      positional: false,
      bus: 'ui',
      type: 'sine',
      freq: 440,
      freqEnd: 440,
      level: 0.2,
      attack: 0.004,
      decay: 0.1,
      wet: 0,
      filterFreq: 8000,
      filterQ: 0.7,
      roll: 'world',
    });
  });

  it('hands out a fresh object each call', () => {
    const a = makeOscSpec();
    const b = makeOscSpec();
    expect(a).not.toBe(b);
  });

  it('starts flat on the ui bus, the opposite of the noise default', () => {
    expect(makeOscSpec().positional).toBe(false);
    expect(makeOscSpec().bus).toBe('ui');
    expect(makeOscSpec().wet).toBe(0);
  });
});

describe('buildNoiseBuffer', () => {
  it('is one channel of the requested length at the context rate', () => {
    const buffer = buildNoiseBuffer(fakeContext(), seeded(), NOISE_SECONDS);
    expect(buffer.numberOfChannels).toBe(1);
    expect(buffer.length).toBe(SAMPLE_RATE * NOISE_SECONDS);
    expect(buffer.sampleRate).toBe(SAMPLE_RATE);
  });

  it('floors a fractional length', () => {
    expect(buildNoiseBuffer(fakeContext(44100), seeded(), 0.0001).length).toBe(4);
  });

  it('fills every sample from the seeded stream, in [-1, 1)', () => {
    const data = buildNoiseBuffer(fakeContext(), seeded(), 0.01).getChannelData(0);
    expect(data.length).toBe(480);
    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
    expect([...data].every((v) => v === 0)).toBe(false);
  });

  it('is byte-identical for a given seed', () => {
    expect(checksum(buildNoiseBuffer(fakeContext(), seeded(), 0.05))).toBe(4148335233);
  });

  it('is a different buffer for a different seed', () => {
    const a = checksum(buildNoiseBuffer(fakeContext(), new Rng(1), 0.01));
    const b = checksum(buildNoiseBuffer(fakeContext(), new Rng(2), 0.01));
    expect(a).not.toBe(b);
  });

  it('declares the two seconds everything else reads from', () => {
    expect(NOISE_SECONDS).toBe(2);
  });
});

describe('buildImpulseResponse', () => {
  it('is two channels of the requested tail at the context rate', () => {
    const ir = buildImpulseResponse(fakeContext(), seeded(), ROOM);
    expect(ir.numberOfChannels).toBe(2);
    expect(ir.length).toBe(SAMPLE_RATE * 0.25);
  });

  it('never returns an empty buffer, however short the room', () => {
    expect(buildImpulseResponse(fakeContext(), seeded(), { ...ROOM, seconds: 0 }).length).toBe(1);
    expect(buildImpulseResponse(fakeContext(), seeded(), { ...ROOM, seconds: -1 }).length).toBe(1);
  });

  it('decays: the tail is quieter at the end than at the start', () => {
    const data = buildImpulseResponse(fakeContext(), seeded(), { ...ROOM, earlyTaps: [] }).getChannelData(0);
    const head = data.slice(0, 2000).reduce((s, v) => s + Math.abs(v), 0);
    const tail = data.slice(data.length - 2000).reduce((s, v) => s + Math.abs(v), 0);
    expect(tail).toBeLessThan(head * 0.05);
  });

  it('gives the two ears different rooms, so a wall is not heard twice in the same place', () => {
    const ir = buildImpulseResponse(fakeContext(), seeded(), ROOM);
    expect([...ir.getChannelData(0)]).not.toEqual([...ir.getChannelData(1)]);
  });

  it('lands each early tap at delay x skew x sampleRate, the right ear 14% later', () => {
    // One loud tap into a dark room. A tap is 57 samples of noise under a falling ramp rather
    // than a single spike, and it is *added* to the tail, so the position is asserted as the
    // energy of the window it occupies. The byte-exact checksum below is what pins the index.
    // A tap is added *after* the decay envelope is applied, so a very fast decay leaves the
    // taps standing alone in a silent buffer and the first non-silent sample is the tap index.
    const spec: ReverbSpec = { seconds: 0.25, decay: 400, brightness: 0, earlyTaps: [{ delay: 0.01, gain: 1 }] };
    const ir = buildImpulseResponse(fakeContext(), seeded(), spec);
    const firstLoud = (ch: number): number => {
      const data = ir.getChannelData(ch);
      for (let i = 200; i < data.length; i++) if (Math.abs(data[i] as number) > 0.01) return i;
      return -1;
    };
    expect(firstLoud(0)).toBe(Math.floor(0.01 * 1 * SAMPLE_RATE));
    expect(firstLoud(1)).toBe(Math.floor(0.01 * 1.14 * SAMPLE_RATE));
  });

  it('skips a tap that would land outside the buffer', () => {
    const inside: ReverbSpec = { seconds: 0.05, decay: 2.6, brightness: 0, earlyTaps: [{ delay: 0.01, gain: 1 }] };
    const outside: ReverbSpec = { ...inside, earlyTaps: [{ delay: 0.01, gain: 1 }, { delay: 9, gain: 1 }] };
    expect(checksum(buildImpulseResponse(fakeContext(), seeded(), inside))).toBe(
      checksum(buildImpulseResponse(fakeContext(), seeded(), outside)),
    );
  });

  it('is the bare tail when a room describes no early reflections', () => {
    const bare = buildImpulseResponse(fakeContext(), seeded(), { ...ROOM, earlyTaps: [] });
    const tapped = buildImpulseResponse(fakeContext(), seeded(), ROOM);
    expect(checksum(bare)).not.toBe(checksum(tapped));
  });

  it('brightness changes the tail rather than its length', () => {
    const dark = buildImpulseResponse(fakeContext(), seeded(), { ...ROOM, brightness: 0 });
    const bright = buildImpulseResponse(fakeContext(), seeded(), { ...ROOM, brightness: 1 });
    expect(dark.length).toBe(bright.length);
    expect(checksum(dark)).not.toBe(checksum(bright));
  });

  it('is byte-identical for a given seed and room', () => {
    expect(checksum(buildImpulseResponse(fakeContext(), seeded(), ROOM))).toBe(2743361495);
  });

  it('writes the samples the unmodified code wrote', () => {
    const ir = buildImpulseResponse(fakeContext(), seeded(), ROOM);
    expect([...ir.getChannelData(0).slice(0, 4)]).toEqual([
      0.29291418194770813, -0.02954377606511116, 0.15136270225048065, 0.007638923823833466,
    ]);
    expect([...ir.getChannelData(1).slice(0, 2)]).toEqual([
      -0.08769433945417404, 0.16336072981357574,
    ]);
  });
});

describe('DEFAULT_REVERB', () => {
  it('is the room M1 shipped with', () => {
    expect(DEFAULT_REVERB).toEqual({ seconds: 1.35, decay: 2.6, brightness: 0.35, earlyTaps: [] });
  });

  it('builds without a tap, which is what a map that describes no room gets', () => {
    // 48000 * 1.35 is 64800.00000000001 in a double, and the code floors it.
    expect(buildImpulseResponse(fakeContext(), seeded(), DEFAULT_REVERB).length).toBe(64800);
  });
});
