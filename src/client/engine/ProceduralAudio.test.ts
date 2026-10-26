import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnnouncerCue } from '../../shared/core/Events';
import { VotePhase } from '../../shared/net/Skirmish';
import type { NoiseSpec, OscSpec } from './AudioSpecs';
import { ProceduralAudio } from './ProceduralAudio';

/**
 * The game's own voices, pinned before unit C3's refactor.
 *
 * Every one of these methods is a handful of numbers poured into a shared scratch spec and handed
 * to `AudioGraph`'s two primitives, so what is worth holding is exactly that: **what each sound
 * asks the graph for**. The graph itself is pinned next door; here the primitives are wrapped so
 * the spec can be copied at the moment of the call — the specs are reused between sounds on
 * purpose, so anything that kept a reference would be reading the next sound's numbers.
 *
 * The context is faked only so that `start()` succeeds and `hasContext` opens; the original
 * primitives are still called underneath, so the counters stay honest.
 */

// ========================================== the fake ==========================================

class FakeParam {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(): void {}
  cancelScheduledValues(): void {}
}

function node(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { connect: (): void => {}, disconnect: (): void => {}, ...extra };
}

function fakeContext(): Record<string, unknown> {
  const listener: Record<string, FakeParam> = {};
  for (const k of ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']) {
    listener[k] = new FakeParam();
  }
  return {
    state: 'running',
    currentTime: 10,
    sampleRate: 48000,
    destination: node(),
    listener,
    createGain: () => node({ gain: new FakeParam() }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() }),
    createPanner: () =>
      node({ positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam() }),
    createConvolver: () => node({ buffer: null }),
    createBufferSource: () =>
      node({ buffer: null, loop: false, playbackRate: new FakeParam(), start: (): void => {}, stop: (): void => {} }),
    createOscillator: () => node({ type: 'sine', frequency: new FakeParam(), start: (): void => {}, stop: (): void => {} }),
    createBuffer: (channels: number, length: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, numberOfChannels: channels, sampleRate: 48000, getChannelData: (i: number) => data[i] };
    },
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = { AudioContext: function () { return fakeContext(); } };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

interface Recorder {
  readonly audio: ProceduralAudio;
  /** A copy of every noise spec, taken at the moment of the call. */
  readonly noises: Array<{ spec: NoiseSpec; delay: number }>;
  readonly oscs: Array<{ spec: OscSpec; delay: number }>;
  readonly ducks: number[];
  readonly beds: number[][];
}

/** A started instance whose two primitives record what they were handed. */
function recorder(start = true): Recorder {
  const audio = new ProceduralAudio();
  if (start) audio.start();
  const noises: Array<{ spec: NoiseSpec; delay: number }> = [];
  const oscs: Array<{ spec: OscSpec; delay: number }> = [];
  const ducks: number[] = [];
  const beds: number[][] = [];
  const self = audio as unknown as Record<string, unknown>;

  const origNoise = audio.noiseBurst.bind(audio);
  const origOsc = audio.oscHit.bind(audio);
  const origDuck = audio.duckWorld.bind(audio);
  const origBed = audio.setSustainedBed.bind(audio);

  self.noiseBurst = (spec: NoiseSpec, delay = 0): void => {
    noises.push({ spec: { ...spec }, delay });
    origNoise(spec, delay);
  };
  self.oscHit = (spec: OscSpec, delay = 0): void => {
    oscs.push({ spec: { ...spec }, delay });
    origOsc(spec, delay);
  };
  self.duckWorld = (seconds: number): void => {
    ducks.push(seconds);
    origDuck(seconds);
  };
  self.setSustainedBed = (active: boolean, x: number, y: number, z: number, level: number, freq: number): void => {
    beds.push([active ? 1 : 0, x, y, z, level, freq]);
    origBed(active, x, y, z, level, freq);
  };

  return { audio, noises, oscs, ducks, beds };
}

// ========================================== the world =========================================

describe('ProceduralAudio: footsteps', () => {
  it('is one band-passed burst on the footstep curve, where the foot landed', () => {
    const r = recorder();
    r.audio.playFootstep(3, 0, -4, 4, false, 0, 1);
    expect(r.noises.length).toBe(1);
    expect(r.oscs.length).toBe(0);
    const spec = r.noises[0]?.spec as NoiseSpec;
    expect(spec.roll).toBe('footstep');
    expect(spec.positional).toBe(true);
    expect(spec.bus).toBe('sfx');
    expect(spec.filter).toBe('bandpass');
    expect([spec.x, spec.y, spec.z]).toEqual([3, 0, -4]);
    expect(spec.freqEnd).toBeCloseTo(spec.freq * 0.7, 10);
  });

  it('adds the body thump that separates a sprint from a walk', () => {
    const r = recorder();
    r.audio.playFootstep(0, 0, 0, 7, true, 0, 1);
    expect(r.noises.length).toBe(1);
    expect(r.oscs.length).toBe(1);
    const thump = r.oscs[0]?.spec as OscSpec;
    expect(thump.roll).toBe('footstep');
    expect(thump.positional).toBe(true);
    expect(thump.type).toBe('sine');
    expect(thump.freq).toBeLessThan(160);
  });

  it('puts a heavy step lower than a light one', () => {
    const light = recorder();
    const heavy = recorder();
    light.audio.playFootstep(0, 0, 0, 5, false, 0, 1);
    heavy.audio.playFootstep(0, 0, 0, 5, true, 0, 1);
    // The 0.62 factor is a multiplier on the surface frequency, under the same jitter range.
    expect((heavy.noises[0]?.spec as NoiseSpec).freq).toBeLessThan((light.noises[0]?.spec as NoiseSpec).freq);
  });

  it('gets louder with speed and quieter with the caller’s gain', () => {
    const fast = recorder();
    const slow = recorder();
    const quiet = recorder();
    fast.audio.playFootstep(0, 0, 0, 9, false, 0, 1);
    slow.audio.playFootstep(0, 0, 0, 1, false, 0, 1);
    quiet.audio.playFootstep(0, 0, 0, 9, false, 0, 0.2);
    const level = (r: Recorder): number => (r.noises[0]?.spec as NoiseSpec).level;
    expect(level(fast)).toBeGreaterThan(level(slow));
    expect(level(quiet)).toBeLessThan(level(fast));
  });

  it('plays nothing at all before the graph is built', () => {
    const r = recorder(false);
    r.audio.playFootstep(0, 0, 0, 5, true, 0, 1);
    expect(r.noises.length).toBe(0);
    expect(r.oscs.length).toBe(0);
  });
});

describe('ProceduralAudio: landings', () => {
  it('is a burst and a body, fuller and lower than a step', () => {
    const r = recorder();
    r.audio.playLanding(1, 2, 3, 8, 0, 1);
    expect(r.noises.length).toBe(1);
    expect(r.oscs.length).toBe(1);
    expect((r.noises[0]?.spec as NoiseSpec).wet).toBeGreaterThan(0.2);
    expect((r.oscs[0]?.spec as OscSpec).freq).toBeLessThan(130);
  });

  it('ignores an impact too soft to be a landing', () => {
    const r = recorder();
    r.audio.playLanding(0, 0, 0, 0.5, 0, 1);
    expect(r.noises.length).toBe(0);
    expect(r.oscs.length).toBe(0);
  });

  it('leaves the landing thump on whatever distance curve the last oscillator used', () => {
    // Pins current behaviour; suspected bug: "The landing thump inherits its distance curve
    // from the previous sound" (BACKLOG #56). Every other positional sound in this file sets
    // `roll` on the shared scratch; the landing's body does not, and it is positional on the
    // sfx bus, so `routeVoice` reads whatever the last caller happened to leave there.
    const r = recorder();
    r.audio.playFootstep(0, 0, 0, 7, true, 0, 1); // its thump sets roll = 'footstep'
    r.audio.playLanding(0, 0, 0, 8, 0, 1);
    const thump = r.oscs[r.oscs.length - 1]?.spec as OscSpec;
    expect(thump.positional).toBe(true);
    expect(thump.bus).toBe('sfx');
    expect(thump.roll).toBe('footstep');
  });

  it('scales with the impact and saturates at the reference speed', () => {
    const soft = recorder();
    const hard = recorder();
    const beyond = recorder();
    soft.audio.playLanding(0, 0, 0, 3, 0, 1);
    hard.audio.playLanding(0, 0, 0, 11, 0, 1);
    beyond.audio.playLanding(0, 0, 0, 40, 0, 1);
    const level = (r: Recorder): number => (r.oscs[0]?.spec as OscSpec).level;
    expect(level(hard)).toBeGreaterThan(level(soft));
    expect(level(beyond)).toBe(level(hard));
  });
});

describe('ProceduralAudio: the slide', () => {
  it('opens the one sustained bed rather than a stream of bursts', () => {
    const r = recorder();
    r.audio.setSlide(true, 5, 0, 6, 7, 0);
    expect(r.noises.length).toBe(0);
    expect(r.beds.length).toBe(1);
    const [active, x, , z, level] = r.beds[0] as number[];
    expect(active).toBe(1);
    expect([x, z]).toEqual([5, 6]);
    expect(level).toBeGreaterThan(0);
  });

  it('closes it to silence when the slide ends', () => {
    const r = recorder();
    r.audio.setSlide(false, 0, 0, 0, 7, 0);
    expect((r.beds[0] as number[])[4]).toBe(0);
  });

  it('caps the bed level however fast the slide', () => {
    const r = recorder();
    r.audio.setSlide(true, 0, 0, 0, 100, 0);
    expect((r.beds[0] as number[])[4]).toBeLessThanOrEqual(0.42);
  });
});

// ======================================== the announcer =======================================

const CUES: AnnouncerCue[] = [
  'matchStart', 'fight', 'twoMinutes', 'oneMinute', 'thirtySeconds',
  'leadTaken', 'leadLost', 'victory', 'defeat', 'draw',
];

describe('ProceduralAudio: the announcer', () => {
  it('is one noise band per syllable and one low body under the phrase', () => {
    const r = recorder();
    r.audio.playAnnouncer('fight');
    // `fight` is the one-syllable call.
    expect(r.noises.length).toBe(1);
    expect(r.oscs.length).toBe(1);
    expect(r.audio.sourcesStarted).toBe(2);
  });

  it('sequences a multi-syllable call on the audio clock, not on timers', () => {
    const r = recorder();
    r.audio.playAnnouncer('thirtySeconds');
    expect(r.noises.length).toBe(3);
    expect(r.noises.map((n) => n.delay)).toEqual([0, 0.12, 0.24]);
  });

  it('puts every call on the ui bus, flat, so it survives the muffle and the duck', () => {
    for (const cue of CUES) {
      const r = recorder();
      r.audio.playAnnouncer(cue);
      for (const { spec } of r.noises) {
        expect(spec.bus, cue).toBe('ui');
        expect(spec.positional, cue).toBe(false);
        expect(spec.wet, cue).toBe(0);
      }
      expect((r.oscs[0]?.spec as OscSpec).bus, cue).toBe('ui');
      expect((r.oscs[0]?.spec as OscSpec).positional, cue).toBe(false);
    }
  });

  it('gives every cue in the phrase book a body and at least one syllable', () => {
    for (const cue of CUES) {
      const r = recorder();
      r.audio.playAnnouncer(cue);
      expect(r.noises.length, cue).toBeGreaterThanOrEqual(1);
      expect(r.oscs.length, cue).toBe(1);
    }
  });

  it('ducks the world for the length of the phrase plus a tail', () => {
    const r = recorder();
    r.audio.playAnnouncer('victory');
    // Longest syllable ends at 0.42 + 0.3; the duck is that plus 0.3.
    expect(r.ducks).toEqual([0.72 + 0.3]);
  });

  it('shapes a win as rising and a loss as falling', () => {
    const win = recorder();
    const loss = recorder();
    win.audio.playAnnouncer('victory');
    loss.audio.playAnnouncer('defeat');
    const last = (r: Recorder): NoiseSpec => r.noises[r.noises.length - 1]?.spec as NoiseSpec;
    expect(last(win).freqEnd).toBeGreaterThan(last(win).freq);
    expect(last(loss).freqEnd).toBeLessThan(last(loss).freq);
  });

  it('plays nothing before the graph is built', () => {
    const r = recorder(false);
    r.audio.playAnnouncer('fight');
    expect(r.noises.length).toBe(0);
    expect(r.ducks.length).toBe(0);
  });
});

// ====================================== inside the head =======================================

describe('ProceduralAudio: the heartbeat and the ring', () => {
  it('is lub then dub, the second quieter and close behind', () => {
    const r = recorder();
    r.audio.playHeartbeat(1);
    expect(r.oscs.length).toBe(2);
    const [lub, dub] = r.oscs;
    expect(dub?.delay).toBe(0.155);
    expect((dub?.spec as OscSpec).level).toBeLessThan((lub?.spec as OscSpec).level);
    expect((dub?.spec as OscSpec).freq).toBeLessThan((lub?.spec as OscSpec).freq);
  });

  it('gets louder as the player gets closer to dead', () => {
    const low = recorder();
    const high = recorder();
    low.audio.playHeartbeat(0);
    high.audio.playHeartbeat(1);
    expect((high.oscs[0]?.spec as OscSpec).level).toBeGreaterThan((low.oscs[0]?.spec as OscSpec).level);
  });

  it('clamps an intensity outside 0..1', () => {
    const over = recorder();
    const at = recorder();
    over.audio.playHeartbeat(5);
    at.audio.playHeartbeat(1);
    expect((over.oscs[0]?.spec as OscSpec).level).toBe((at.oscs[0]?.spec as OscSpec).level);
  });

  it('rings high, long and flat, so the flash cannot muffle its own effect', () => {
    const r = recorder();
    r.audio.playRing(1);
    const spec = r.oscs[0]?.spec as OscSpec;
    expect(spec.bus).toBe('ui');
    expect(spec.positional).toBe(false);
    expect(spec.freq).toBeGreaterThan(4000);
    expect(spec.decay).toBeGreaterThan(3);
  });
});

// ======================================== the interface =======================================

describe('ProceduralAudio: the UI vocabulary', () => {
  it('sweeps between the two frequencies it was given', () => {
    const r = recorder();
    r.audio.playUiSweep(300, 900, 0.3, 0.25);
    const spec = r.oscs[0]?.spec as OscSpec;
    expect(spec.freq).toBe(300);
    expect(spec.freqEnd).toBe(900);
    expect(spec.level).toBe(0.3);
    expect(spec.decay).toBe(0.25);
    expect(spec.bus).toBe('ui');
  });

  it('climbs the XP blip over the first eight rows and then holds', () => {
    const freqOf = (index: number): number => {
      const r = recorder();
      r.audio.playXpTick(index);
      return (r.oscs[0]?.spec as OscSpec).freq;
    };
    expect(freqOf(0)).toBeLessThan(freqOf(4));
    expect(freqOf(4)).toBeLessThan(freqOf(7));
    expect(freqOf(7)).toBe(freqOf(20));
  });

  it('asks a question with the ballot, a fourth higher for the map stage', () => {
    const mode = recorder();
    const map = recorder();
    mode.audio.playBallotOpen(VotePhase.MODE_VOTE);
    map.audio.playBallotOpen(VotePhase.MAP_VOTE);
    const first = (r: Recorder): OscSpec => r.oscs[0]?.spec as OscSpec;
    expect(first(mode).freq).toBe(440);
    expect(first(map).freq).toBe(587);
    // Both rise, and both are two notes.
    expect(first(mode).freqEnd).toBeGreaterThan(first(mode).freq);
    expect(mode.oscs.length).toBe(2);
    expect(mode.oscs[1]?.delay).toBe(0.12);
  });

  it('gives the level-up three layers, one of them low', () => {
    const r = recorder();
    r.audio.playLevelUp();
    expect(r.oscs.length).toBe(2);
    expect(r.noises.length).toBe(1);
    const body = r.oscs[1]?.spec as OscSpec;
    expect(body.freq).toBeLessThan(120);
  });
});

// ================================== the splash and the debrief ================================

describe('ProceduralAudio: the splash', () => {
  it('lands each of the three hits a little harder, and stops growing after the third', () => {
    const levelAt = (index: number): number => {
      const r = recorder();
      r.audio.playSplashHit(index);
      return (r.oscs[0]?.spec as OscSpec).level;
    };
    expect(levelAt(0)).toBeLessThan(levelAt(1));
    expect(levelAt(1)).toBeLessThan(levelAt(2));
    expect(levelAt(2)).toBe(levelAt(9));
  });

  it('is a dropping sine with a click of noise on its front', () => {
    const r = recorder();
    r.audio.playSplashHit(0);
    const body = r.oscs[0]?.spec as OscSpec;
    const click = r.noises[0]?.spec as NoiseSpec;
    expect(body.freqEnd).toBeLessThan(body.freq);
    expect(click.filter).toBe('lowpass');
    expect(click.decay).toBeLessThan(body.decay);
  });

  it('opens the shock bright and closes it low', () => {
    const r = recorder();
    r.audio.playSplashShock();
    const hiss = r.noises[0]?.spec as NoiseSpec;
    expect(hiss.freq).toBeGreaterThan(5000);
    expect(hiss.freqEnd).toBeLessThan(500);
    expect(hiss.decay).toBeGreaterThan(1);
  });

  it('ends on a chime with a partial under it and a band of air', () => {
    const r = recorder();
    r.audio.playSplashChime();
    expect(r.oscs.length).toBe(2);
    expect(r.noises.length).toBe(1);
    expect(r.oscs[1]?.delay).toBe(0.06);
  });
});

describe('ProceduralAudio: the debrief', () => {
  it('rings a win and lets a loss land alone, and lower', () => {
    const win = recorder();
    const loss = recorder();
    win.audio.playDebriefHit('WIN');
    loss.audio.playDebriefHit('LOSS');
    expect(win.oscs.length).toBe(2);
    expect(loss.oscs.length).toBe(1);
    expect((loss.oscs[0]?.spec as OscSpec).freq).toBeLessThan((win.oscs[0]?.spec as OscSpec).freq);
  });

  it('treats a draw as a loss rather than a win', () => {
    const r = recorder();
    r.audio.playDebriefHit('DRAW');
    expect(r.oscs.length).toBe(1);
  });

  it('moves the screen without playing a note over it', () => {
    const r = recorder();
    r.audio.playDebriefSweep();
    expect(r.oscs.length).toBe(1);
    expect(r.noises.length).toBe(1);
    const air = r.noises[0]?.spec as NoiseSpec;
    expect(air.freqEnd).toBeGreaterThan(air.freq);
  });

  it('gives gold, silver and bronze three descending notes', () => {
    const noteAt = (rank: number): number => {
      const r = recorder();
      r.audio.playDebriefMedal(rank);
      return (r.oscs[0]?.spec as OscSpec).freqEnd;
    };
    expect(noteAt(0)).toBe(784);
    expect(noteAt(1)).toBe(659);
    expect(noteAt(2)).toBe(523);
  });

  it('carries a second partial on the gold only', () => {
    const gold = recorder();
    const silver = recorder();
    gold.audio.playDebriefMedal(0);
    silver.audio.playDebriefMedal(1);
    expect((gold.oscs[1]?.spec as OscSpec).level).toBeGreaterThan((silver.oscs[1]?.spec as OscSpec).level);
  });
});
