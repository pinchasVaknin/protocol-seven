import { describe, expect, it } from 'vitest';
import { WeaponAudio } from './WeaponAudio';
import { makeNoiseSpec, makeOscSpec, type NoiseSpec, type OscSpec } from '../engine/AudioSpecs';
import type { ProceduralAudio } from '../engine/ProceduralAudio';
import type { ReloadStep } from '../../shared/core/Events';
import type { WeaponVoice } from '../../shared/weapons/WeaponDefs';

/**
 * Every weapon sound, recorded field for field off the spec the class hands the primitives.
 *
 * The double is the shape that matters: `ProceduralAudio` pours every sound into **one of two
 * module-level scratch specs** and hands it straight on, so a field a caller does not set keeps
 * whatever the previous sound left there. The fake below reproduces that exactly — two spec
 * objects, reused for the life of the instance, copied only at the moment a primitive is
 * called. Three of the tests at the bottom exist because that is a real effect and this file
 * is where it can be seen.
 *
 * Nothing here needs an AudioContext: the class builds no node graph, it fills records.
 */

type Call =
  | { readonly kind: 'noiseBurst'; readonly spec: NoiseSpec }
  | { readonly kind: 'oscHit'; readonly spec: OscSpec }
  | { readonly kind: 'playUiSweep'; readonly args: readonly number[] };

/** The two shared scratch specs and a log of what was handed to a primitive, in order. */
class RecordingAudio {
  readonly noiseScratch = makeNoiseSpec();
  readonly oscScratch = makeOscSpec();
  readonly calls: Call[] = [];

  noiseBurst(spec: NoiseSpec): void {
    this.calls.push({ kind: 'noiseBurst', spec: { ...spec } });
  }

  oscHit(spec: OscSpec): void {
    this.calls.push({ kind: 'oscHit', spec: { ...spec } });
  }

  playUiSweep(from: number, to: number, level: number, seconds: number): void {
    this.calls.push({ kind: 'playUiSweep', args: [from, to, level, seconds] });
  }
}

function harness(): { audio: RecordingAudio; weapons: WeaponAudio } {
  const audio = new RecordingAudio();
  return { audio, weapons: new WeaponAudio(audio as unknown as ProceduralAudio) };
}

const NOISE_FIELDS: ReadonlyArray<keyof NoiseSpec> = [
  'x',
  'y',
  'z',
  'positional',
  'bus',
  'roll',
  'filter',
  'freq',
  'freqEnd',
  'q',
  'level',
  'attack',
  'decay',
  'wet',
  'rate',
];

const OSC_FIELDS: ReadonlyArray<keyof OscSpec> = [
  'x',
  'y',
  'z',
  'positional',
  'bus',
  'roll',
  'type',
  'freq',
  'freqEnd',
  'level',
  'attack',
  'decay',
  'wet',
  'filterFreq',
  'filterQ',
];

/** One call as one line, in the spec's own field order. */
function line(call: Call): string {
  if (call.kind === 'playUiSweep') return `playUiSweep ${call.args.join(' ')}`;
  const fields = call.kind === 'noiseBurst' ? NOISE_FIELDS : OSC_FIELDS;
  const spec = call.spec as unknown as Record<string, unknown>;
  return `${call.kind} ${fields.map((f) => `${f}=${String(spec[f as string])}`).join(' ')}`;
}

function logOf(audio: RecordingAudio): string {
  return audio.calls.map(line).join('\n');
}

function callAt(audio: RecordingAudio, index: number): Call {
  const call = audio.calls[index];
  if (call === undefined) throw new Error(`no call at ${index}; there are ${audio.calls.length}`);
  return call;
}

function noiseAt(audio: RecordingAudio, index: number): NoiseSpec {
  const call = callAt(audio, index);
  if (call.kind !== 'noiseBurst') throw new Error(`call ${index} is a ${call.kind}, not a noise burst`);
  return call.spec;
}

function oscAt(audio: RecordingAudio, index: number): OscSpec {
  const call = callAt(audio, index);
  if (call.kind !== 'oscHit') throw new Error(`call ${index} is a ${call.kind}, not an oscillator hit`);
  return call.spec;
}

function lineAt(audio: RecordingAudio, index: number): string {
  return line(callAt(audio, index));
}

/** The carbine's voice, as `defs/assaultRifles.ts` writes it. */
const CARBINE: WeaponVoice = {
  level: 0.5,
  bodyFreq: 1500,
  bodyQ: 1.6,
  bodyDecay: 0.1,
  bodyRatio: 0.32,
  tailDecay: 0.42,
  tailLevel: 0.3,
  tailFreq: 2600,
  clickFreq: 4200,
  clickLevel: 0.46,
  thumpFreq: 95,
  thumpLevel: 0.44,
  wet: 0.35,
};

/** A second voice whose every number differs, so a layer reading the wrong field shows up. */
const HEAVY: WeaponVoice = {
  level: 0.8,
  bodyFreq: 700,
  bodyQ: 3.1,
  bodyDecay: 0.17,
  bodyRatio: 0.11,
  tailDecay: 0.73,
  tailLevel: 0.52,
  tailFreq: 1100,
  clickFreq: 2800,
  clickLevel: 0.21,
  thumpFreq: 62,
  thumpLevel: 0.61,
  wet: 0.64,
};

const RELOAD_STEPS: readonly ReloadStep[] = ['down', 'magOut', 'magIn', 'charge', 'raise'];

describe('the gunshot', () => {
  it('is four layers in one order, field for field', () => {
    const { audio, weapons } = harness();
    weapons.playGunshot(1.5, 2.25, -3.5, CARBINE, 1);
    expect(logOf(audio)).toMatchInlineSnapshot(`
      "noiseBurst x=1.5 y=2.25 z=-3.5 positional=true bus=sfx roll=loud filter=highpass freq=4200 freqEnd=3150 q=0.6 level=0.23 attack=0.001 decay=0.013 wet=0.05 rate=0.9937188500817865
      noiseBurst x=1.5 y=2.25 z=-3.5 positional=true bus=sfx roll=loud filter=bandpass freq=1525.472423359752 freqEnd=488.1511754751206 q=1.6 level=0.5 attack=0.0015 decay=0.1 wet=0.175 rate=1
      noiseBurst x=1.5 y=2.25 z=-3.5 positional=true bus=sfx roll=loud filter=lowpass freq=2600 freqEnd=420 q=0.8 level=0.15 attack=0.006 decay=0.42 wet=0.35 rate=0.85
      oscHit x=1.5 y=2.25 z=-3.5 positional=true bus=sfx roll=loud type=sine freq=93.33808241349179 freqEnd=39.20199461366655 level=0.22 attack=0.002 decay=0.115 wet=0.105 filterFreq=460 filterQ=0.7"
    `);
  });

  it('scales every layer by the mix trim and leaves the balance between them alone', () => {
    const full = harness();
    full.weapons.playGunshot(0, 0, 0, CARBINE, 1);
    const ducked = harness();
    ducked.weapons.playGunshot(0, 0, 0, CARBINE, 0.25);

    const levels = (h: { audio: RecordingAudio }) => h.audio.calls.map((c) => (c.kind === 'playUiSweep' ? 0 : c.spec.level));
    const a = levels(full);
    const b = levels(ducked);
    expect(b.map((v, i) => v / (a[i] ?? 0))).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('reads the voice for the click, the body, the tail and the thump', () => {
    const { audio, weapons } = harness();
    weapons.playGunshot(0, 0, 0, HEAVY, 1);
    const click = noiseAt(audio, 0);
    const body = noiseAt(audio, 1);
    const tail = noiseAt(audio, 2);
    const thump = oscAt(audio, 3);
    expect(click.freq).toBe(HEAVY.clickFreq);
    expect(click.freqEnd).toBe(HEAVY.clickFreq * 0.75);
    expect(click.level).toBe(HEAVY.clickLevel * HEAVY.level);
    expect(body.q).toBe(HEAVY.bodyQ);
    expect(body.decay).toBe(HEAVY.bodyDecay);
    expect(body.level).toBe(HEAVY.level);
    expect(tail.decay).toBe(HEAVY.tailDecay);
    expect(tail.level).toBe(HEAVY.tailLevel * HEAVY.level);
    expect(tail.wet).toBe(HEAVY.wet);
    expect(thump.level).toBe(HEAVY.thumpLevel * HEAVY.level);
  });

  // Pins current behaviour; suspected bug: BACKLOG #63. `WeaponVoice.bodyRatio` and
  // `WeaponVoice.tailFreq` were added in M5 so twelve weapons would stop converging on one
  // shape, and this file has never read either: the body sweeps to a fixed 0.32 of its centre
  // and every tail starts at a fixed 2600 Hz, whatever the def and the tuner say.
  it('ignores the voice for the body sweep target and the tail cutoff', () => {
    const { audio, weapons } = harness();
    weapons.playGunshot(0, 0, 0, HEAVY, 1);
    const body = noiseAt(audio, 1);
    const tail = noiseAt(audio, 2);
    expect(body.freqEnd).toBe(body.freq * 0.32);
    expect(body.freqEnd).not.toBe(body.freq * HEAVY.bodyRatio);
    expect(tail.freq).toBe(2600);
    expect(tail.freq).not.toBe(HEAVY.tailFreq);
    expect(tail.freqEnd).toBe(420);
  });

  it('jitters the click rate, the body centre and the thump off one seeded stream', () => {
    const first = harness();
    first.weapons.playGunshot(0, 0, 0, CARBINE, 1);
    const second = harness();
    second.weapons.playGunshot(0, 0, 0, CARBINE, 1);
    // A fresh instance is a fresh seed, so two instances fire identically.
    expect(logOf(first.audio)).toBe(logOf(second.audio));

    // A second shot on the same instance is not the first: the stream has moved on.
    first.weapons.playGunshot(0, 0, 0, CARBINE, 1);
    const shots = first.audio.calls.slice(0, 4).map(line).join('\n');
    const next = first.audio.calls.slice(4).map(line).join('\n');
    expect(next).not.toBe(shots);
  });

  it('keeps the jitter inside the ranges the layers were tuned against', () => {
    const { audio, weapons } = harness();
    for (let shot = 0; shot < 200; shot++) weapons.playGunshot(0, 0, 0, CARBINE, 1);
    for (const call of audio.calls) {
      if (call.kind === 'noiseBurst' && call.spec.filter === 'highpass') {
        expect(call.spec.rate).toBeGreaterThanOrEqual(0.96);
        expect(call.spec.rate).toBeLessThan(1.05);
      }
      if (call.kind === 'noiseBurst' && call.spec.filter === 'bandpass') {
        expect(call.spec.freq).toBeGreaterThanOrEqual(CARBINE.bodyFreq * 0.95);
        expect(call.spec.freq).toBeLessThan(CARBINE.bodyFreq * 1.06);
      }
      if (call.kind === 'oscHit') {
        expect(call.spec.freq).toBeGreaterThanOrEqual(CARBINE.thumpFreq * 0.94);
        expect(call.spec.freq).toBeLessThan(CARBINE.thumpFreq * 1.07);
      }
    }
  });

  it('puts all four layers at the shot, positional, on the sfx bus', () => {
    const { audio, weapons } = harness();
    weapons.playGunshot(4, -5, 6, CARBINE, 1);
    for (const call of audio.calls) {
      if (call.kind === 'playUiSweep') throw new Error('shape');
      expect([call.spec.x, call.spec.y, call.spec.z]).toEqual([4, -5, 6]);
      expect(call.spec.positional).toBe(true);
      expect(call.spec.bus).toBe('sfx');
      expect(call.spec.roll).toBe('loud');
    }
  });
});

describe('the reload', () => {
  it('is a different piece of metal per step, field for field', () => {
    const { audio, weapons } = harness();
    for (const step of RELOAD_STEPS) weapons.playReloadStep(1.5, 2, 3, step);
    expect(logOf(audio)).toMatchInlineSnapshot(`
      "noiseBurst x=1.5 y=2 z=3 positional=true bus=sfx roll=handling filter=lowpass freq=900 freqEnd=450 q=0.7 level=0.16 attack=0.001 decay=0.07 wet=0.1 rate=1
      noiseBurst x=1.5 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=3100 freqEnd=1800 q=4.5 level=0.32 attack=0.001 decay=0.035 wet=0.1 rate=1
      noiseBurst x=1.5 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=1500 freqEnd=600 q=2.2 level=0.4 attack=0.001 decay=0.075 wet=0.1 rate=1
      oscHit x=1.5 y=2 z=3 positional=true bus=sfx roll=world type=sine freq=190 freqEnd=90 level=0.24 attack=0.002 decay=0.08 wet=0.08 filterFreq=700 filterQ=0.7
      noiseBurst x=1.5 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=2300 freqEnd=3600 q=3 level=0.36 attack=0.001 decay=0.09 wet=0.1 rate=1
      noiseBurst x=1.5 y=2 z=3 positional=true bus=sfx roll=handling filter=lowpass freq=1400 freqEnd=700 q=0.8 level=0.14 attack=0.001 decay=0.06 wet=0.1 rate=1"
    `);
  });

  it('gives only the seated magazine a second, lower layer', () => {
    for (const step of RELOAD_STEPS) {
      const { audio, weapons } = harness();
      weapons.playReloadStep(0, 0, 0, step);
      expect(audio.calls.map((c) => c.kind)).toEqual(step === 'magIn' ? ['noiseBurst', 'oscHit'] : ['noiseBurst']);
    }
  });

  it('low-passes the quiet steps and band-passes the metal ones', () => {
    const filters = RELOAD_STEPS.map((step) => {
      const { audio, weapons } = harness();
      weapons.playReloadStep(0, 0, 0, step);
      return [step, noiseAt(audio, 0).filter] as const;
    });
    expect(filters).toEqual([
      ['down', 'lowpass'],
      ['magOut', 'bandpass'],
      ['magIn', 'bandpass'],
      ['charge', 'bandpass'],
      ['raise', 'lowpass'],
    ]);
  });

  it('makes seating the magazine the loudest step and charging the only rising sweep', () => {
    const noise = RELOAD_STEPS.map((step) => {
      const { audio, weapons } = harness();
      weapons.playReloadStep(0, 0, 0, step);
      const first = noiseAt(audio, 0);
      return { step, level: first.level, rising: first.freqEnd > first.freq };
    });
    expect(noise.filter((n) => n.rising).map((n) => n.step)).toEqual(['charge']);
    const loudest = noise.reduce((a, b) => (b.level > a.level ? b : a));
    expect(loudest.step).toBe('magIn');
  });

  it('takes no jitter from the stream, so two reloads are the same sound', () => {
    const { audio, weapons } = harness();
    weapons.playReloadStep(0, 0, 0, 'magIn');
    const first = logOf(audio);
    audio.calls.length = 0;
    weapons.playReloadStep(0, 0, 0, 'magIn');
    expect(logOf(audio)).toBe(first);
  });
});

describe('the handling sounds', () => {
  it('dry-fires one click on the handling curve', () => {
    const { audio, weapons } = harness();
    weapons.playDryFire(4, 5, 6);
    expect(logOf(audio)).toMatchInlineSnapshot(`"noiseBurst x=4 y=5 z=6 positional=true bus=sfx roll=handling filter=bandpass freq=2600 freqEnd=1400 q=3.2 level=0.3 attack=0.001 decay=0.03 wet=0.08 rate=1"`);
  });

  it('sweeps the knife down whether or not it connected, and lower when it did', () => {
    const hit = harness();
    hit.weapons.playMeleeSwing(7, 8, 9, true);
    const miss = harness();
    miss.weapons.playMeleeSwing(7, 8, 9, false);
    const spec = (h: { audio: RecordingAudio }) => noiseAt(h.audio, 0);
    expect(spec(hit).freq).toBeLessThan(spec(miss).freq);
    expect(spec(hit).freqEnd).toBeLessThan(spec(hit).freq);
    expect(spec(miss).freqEnd).toBeLessThan(spec(miss).freq);
    expect(spec(hit).level).toBeGreaterThan(spec(miss).level);
    expect(`${lineAt(hit.audio, 0)}\n${lineAt(miss.audio, 0)}`).toMatchInlineSnapshot(`
      "noiseBurst x=7 y=8 z=9 positional=true bus=sfx roll=handling filter=bandpass freq=2200 freqEnd=520 q=1.6 level=0.42 attack=0.002 decay=0.1 wet=0.12 rate=1
      noiseBurst x=7 y=8 z=9 positional=true bus=sfx roll=handling filter=bandpass freq=3000 freqEnd=900 q=0.9 level=0.24 attack=0.002 decay=0.13 wet=0.12 rate=1"
    `);
  });

  it('rustles brighter coming up to the eye than going back down', () => {
    const inward = harness();
    inward.weapons.playAdsRustle(1, 1, 1, true);
    const outward = harness();
    outward.weapons.playAdsRustle(1, 1, 1, false);
    expect(`${lineAt(inward.audio, 0)}\n${lineAt(outward.audio, 0)}`).toMatchInlineSnapshot(`
      "noiseBurst x=1 y=1 z=1 positional=true bus=sfx roll=handling filter=bandpass freq=2200 freqEnd=1100 q=1.1 level=0.09 attack=0.008 decay=0.075 wet=0.05 rate=1
      noiseBurst x=1 y=1 z=1 positional=true bus=sfx roll=handling filter=bandpass freq=1700 freqEnd=850 q=1.1 level=0.09 attack=0.008 decay=0.075 wet=0.05 rate=1"
    `);
  });
});

describe('the feedback sounds', () => {
  it('clicks a hit dry, non-positional, on the ui bus, with no send', () => {
    const { audio, weapons } = harness();
    weapons.playHitmarker(false);
    const call = noiseAt(audio, 0);
    expect(call.positional).toBe(false);
    expect(call.bus).toBe('ui');
    expect(call.wet).toBe(0);
    expect([call.x, call.y, call.z]).toEqual([0, 0, 0]);
    expect(audio.calls).toHaveLength(1);
  });

  it('adds a second, lower note to a kill and nothing to a hit', () => {
    const { audio, weapons } = harness();
    weapons.playHitmarker(true);
    expect(audio.calls.map((c) => c.kind)).toEqual(['noiseBurst', 'playUiSweep']);
    expect(logOf(audio)).toMatchInlineSnapshot(`
      "noiseBurst x=0 y=0 z=0 positional=false bus=ui roll=world filter=bandpass freq=1500 freqEnd=700 q=2.4 level=0.34 attack=0.0008 decay=0.055 wet=0 rate=1
      playUiSweep 720 300 0.2 0.13"
    `);
  });

  it('makes flesh the opposite shape to a surface: low, soft, and fast to go', () => {
    const body = harness();
    body.weapons.playFleshImpact(2, 3, 4, false);
    const head = harness();
    head.weapons.playFleshImpact(2, 3, 4, true);
    expect(`${logOf(body.audio)}\n${logOf(head.audio)}`).toMatchInlineSnapshot(`
      "noiseBurst x=2 y=3 z=4 positional=true bus=sfx roll=impact filter=lowpass freq=620 freqEnd=190 q=0.9 level=0.24 attack=0.001 decay=0.075 wet=0.16 rate=0.9836911612655967
      oscHit x=2 y=3 z=4 positional=true bus=sfx roll=world type=sine freq=150 freqEnd=67.5 level=0.18 attack=0.001 decay=0.06 wet=0.1 filterFreq=420 filterQ=0.7
      noiseBurst x=2 y=3 z=4 positional=true bus=sfx roll=impact filter=lowpass freq=1500 freqEnd=500 q=2.6 level=0.3 attack=0.001 decay=0.05 wet=0.16 rate=0.9836911612655967
      oscHit x=2 y=3 z=4 positional=true bus=sfx roll=world type=sine freq=260 freqEnd=117 level=0.18 attack=0.001 decay=0.06 wet=0.1 filterFreq=420 filterQ=0.7"
    `);
  });

  it('makes a headshot tighter, higher and shorter, so it is identifiable by ear', () => {
    const body = harness();
    body.weapons.playFleshImpact(0, 0, 0, false);
    const head = harness();
    head.weapons.playFleshImpact(0, 0, 0, true);
    const noise = (h: { audio: RecordingAudio }) => noiseAt(h.audio, 0);
    expect(noise(head).freq).toBeGreaterThan(noise(body).freq);
    expect(noise(head).q).toBeGreaterThan(noise(body).q);
    expect(noise(head).decay).toBeLessThan(noise(body).decay);
  });

  it('drops a body as an oscillator first and the gear going down after it', () => {
    const { audio, weapons } = harness();
    weapons.playDeath(5, 6, 7);
    expect(audio.calls.map((c) => c.kind)).toEqual(['oscHit', 'noiseBurst']);
    expect(logOf(audio)).toMatchInlineSnapshot(`
      "oscHit x=5 y=6 z=7 positional=true bus=sfx roll=world type=sine freq=118 freqEnd=48 level=0.4 attack=0.003 decay=0.2 wet=0.24 filterFreq=340 filterQ=0.7
      noiseBurst x=5 y=6 z=7 positional=true bus=sfx roll=world filter=lowpass freq=1250 freqEnd=300 q=0.8 level=0.22 attack=0.004 decay=0.26 wet=0.3 rate=0.9749307779595257"
    `);
  });

  it('colours an impact by the surface it hit and quietens one that went through', () => {
    const { audio, weapons } = harness();
    for (let material = 0; material < 8; material++) weapons.playImpact(1, 2, 3, material, false);
    const stopped = audio.calls.map((c) => (c.kind === 'noiseBurst' ? c.spec.level : -1));
    expect(new Set(stopped)).toEqual(new Set([0.26]));

    const through = harness();
    for (let material = 0; material < 8; material++) through.weapons.playImpact(1, 2, 3, material, true);
    const penetrated = through.audio.calls.map((c) => (c.kind === 'noiseBurst' ? c.spec.level : -1));
    expect(new Set(penetrated)).toEqual(new Set([0.16]));
    expect(logOf(through.audio)).toMatchInlineSnapshot(`
      "noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=1710.4675198579207 freqEnd=769.7103839360643 q=1.1 level=0.16 attack=0.001 decay=0.1 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=1619.7794843316076 freqEnd=728.9007679492235 q=1.1 level=0.16 attack=0.001 decay=0.11 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=1592.2702312055044 freqEnd=716.521604042477 q=1 level=0.16 attack=0.001 decay=0.1 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=3303.63052290678 freqEnd=1486.633735308051 q=5.5 level=0.16 attack=0.001 decay=0.16 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=2939.30305185169 freqEnd=1322.6863733332605 q=4 level=0.16 attack=0.001 decay=0.14 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=2139.9880107566714 freqEnd=962.9946048405021 q=2.4 level=0.16 attack=0.001 decay=0.12 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=794.2125592543742 freqEnd=357.3956516644684 q=0.7 level=0.16 attack=0.001 decay=0.07 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=1320.6768957497552 freqEnd=594.3046030873899 q=1.4 level=0.16 attack=0.001 decay=0.12 wet=0.22 rate=1"
    `);
  });

  it('falls back to one surface for a material index the map does not have', () => {
    const { audio, weapons } = harness();
    weapons.playImpact(0, 0, 0, 9999, false);
    weapons.playImpact(0, 0, 0, -1, false);
    const a = noiseAt(audio, 0);
    const b = noiseAt(audio, 1);
    expect(a.q).toBe(b.q);
    expect(a.decay).toBe(b.decay);
  });
});

describe('the fields a sound does not set, on a scratch it shares with every other sound', () => {
  // Pins current behaviour; suspected bug: BACKLOG #60. The three below are positional and on
  // the sfx bus, so `AudioGraph.routeVoice` genuinely reads the `roll` they did not set.
  it('leaves the seated magazine thump on whatever curve the last oscillator used', () => {
    const { audio, weapons } = harness();
    audio.oscScratch.roll = 'world';
    weapons.playReloadStep(0, 0, 0, 'magIn');
    const thump = oscAt(audio, 1);
    expect(thump.roll).toBe('world');
    expect(thump.positional).toBe(true);
    expect(thump.bus).toBe('sfx');

    // And after a gunshot, which does set it, the same call carries the gunshot's curve.
    const after = harness();
    after.weapons.playGunshot(0, 0, 0, CARBINE, 1);
    after.weapons.playReloadStep(0, 0, 0, 'magIn');
    expect(oscAt(after.audio, 5).roll).toBe('loud');
  });

  it('leaves the flesh thump on whatever curve the last oscillator used', () => {
    const { audio, weapons } = harness();
    audio.oscScratch.roll = 'footstep';
    weapons.playFleshImpact(0, 0, 0, false);
    expect(oscAt(audio, 1).roll).toBe('footstep');
    // Its own noise layer sets `impact`, one block above, which is what makes this a slip.
    expect(noiseAt(audio, 0).roll).toBe('impact');
  });

  it("leaves the death's gear layer on whatever curve the last noise burst used", () => {
    const { audio, weapons } = harness();
    audio.noiseScratch.roll = 'handling';
    weapons.playDeath(0, 0, 0);
    expect(noiseAt(audio, 1).roll).toBe('handling');
    // Its own oscillator sets `world`, one block above.
    expect(oscAt(audio, 0).roll).toBe('world');
  });

  it('is harmless for the hitmarker, which is not positional and never reaches a panner', () => {
    const { audio, weapons } = harness();
    audio.noiseScratch.roll = 'loud';
    weapons.playHitmarker(false);
    const call = noiseAt(audio, 0);
    expect(call.roll).toBe('loud');
    expect(call.positional).toBe(false);
  });
});

describe('the whole vocabulary', () => {
  it('is this, from one instance, in one order', () => {
    const { audio, weapons } = harness();
    weapons.playGunshot(1, 2, 3, CARBINE, 1);
    weapons.playGunshot(1, 2, 3, HEAVY, 0.4);
    for (const step of RELOAD_STEPS) weapons.playReloadStep(1, 2, 3, step);
    weapons.playDryFire(1, 2, 3);
    weapons.playMeleeSwing(1, 2, 3, true);
    weapons.playMeleeSwing(1, 2, 3, false);
    weapons.playAdsRustle(1, 2, 3, true);
    weapons.playAdsRustle(1, 2, 3, false);
    weapons.playHitmarker(false);
    weapons.playHitmarker(true);
    weapons.playFleshImpact(1, 2, 3, false);
    weapons.playFleshImpact(1, 2, 3, true);
    weapons.playDeath(1, 2, 3);
    for (let material = 0; material < 6; material++) weapons.playImpact(1, 2, 3, material, material % 2 === 0);
    expect(logOf(audio)).toMatchInlineSnapshot(`
      "noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=loud filter=highpass freq=4200 freqEnd=3150 q=0.6 level=0.23 attack=0.001 decay=0.013 wet=0.05 rate=0.9937188500817865
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=loud filter=bandpass freq=1525.472423359752 freqEnd=488.1511754751206 q=1.6 level=0.5 attack=0.0015 decay=0.1 wet=0.175 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=loud filter=lowpass freq=2600 freqEnd=420 q=0.8 level=0.15 attack=0.006 decay=0.42 wet=0.35 rate=0.85
      oscHit x=1 y=2 z=3 positional=true bus=sfx roll=loud type=sine freq=93.33808241349179 freqEnd=39.20199461366655 level=0.22 attack=0.002 decay=0.115 wet=0.105 filterFreq=460 filterQ=0.7
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=loud filter=highpass freq=2800 freqEnd=2100 q=0.6 level=0.06720000000000001 attack=0.001 decay=0.013 wet=0.05 rate=1.0127484940644353
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=loud filter=bandpass freq=704.5521684251726 freqEnd=225.4566938960552 q=3.1 level=0.32000000000000006 attack=0.0015 decay=0.17 wet=0.32 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=loud filter=lowpass freq=2600 freqEnd=420 q=0.8 level=0.16640000000000005 attack=0.006 decay=0.73 wet=0.64 rate=0.85
      oscHit x=1 y=2 z=3 positional=true bus=sfx roll=loud type=sine freq=58.641511805607 freqEnd=24.629434958354942 level=0.19520000000000004 attack=0.002 decay=0.115 wet=0.192 filterFreq=460 filterQ=0.7
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=lowpass freq=900 freqEnd=450 q=0.7 level=0.16 attack=0.001 decay=0.07 wet=0.1 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=3100 freqEnd=1800 q=4.5 level=0.32 attack=0.001 decay=0.035 wet=0.1 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=1500 freqEnd=600 q=2.2 level=0.4 attack=0.001 decay=0.075 wet=0.1 rate=1
      oscHit x=1 y=2 z=3 positional=true bus=sfx roll=loud type=sine freq=190 freqEnd=90 level=0.24 attack=0.002 decay=0.08 wet=0.08 filterFreq=700 filterQ=0.7
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=2300 freqEnd=3600 q=3 level=0.36 attack=0.001 decay=0.09 wet=0.1 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=lowpass freq=1400 freqEnd=700 q=0.8 level=0.14 attack=0.001 decay=0.06 wet=0.1 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=2600 freqEnd=1400 q=3.2 level=0.3 attack=0.001 decay=0.03 wet=0.08 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=2200 freqEnd=520 q=1.6 level=0.42 attack=0.002 decay=0.1 wet=0.12 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=3000 freqEnd=900 q=0.9 level=0.24 attack=0.002 decay=0.13 wet=0.12 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=2200 freqEnd=1100 q=1.1 level=0.09 attack=0.008 decay=0.075 wet=0.05 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=handling filter=bandpass freq=1700 freqEnd=850 q=1.1 level=0.09 attack=0.008 decay=0.075 wet=0.05 rate=1
      noiseBurst x=0 y=0 z=0 positional=false bus=ui roll=handling filter=bandpass freq=3400 freqEnd=2100 q=5 level=0.24 attack=0.0008 decay=0.022 wet=0 rate=1
      noiseBurst x=0 y=0 z=0 positional=false bus=ui roll=handling filter=bandpass freq=1500 freqEnd=700 q=2.4 level=0.34 attack=0.0008 decay=0.055 wet=0 rate=1
      playUiSweep 720 300 0.2 0.13
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=lowpass freq=620 freqEnd=190 q=0.9 level=0.24 attack=0.001 decay=0.075 wet=0.16 rate=1.086462280622218
      oscHit x=1 y=2 z=3 positional=true bus=sfx roll=loud type=sine freq=150 freqEnd=67.5 level=0.18 attack=0.001 decay=0.06 wet=0.1 filterFreq=420 filterQ=0.7
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=lowpass freq=1500 freqEnd=500 q=2.6 level=0.3 attack=0.001 decay=0.05 wet=0.16 rate=0.9614150337292813
      oscHit x=1 y=2 z=3 positional=true bus=sfx roll=loud type=sine freq=260 freqEnd=117 level=0.18 attack=0.001 decay=0.06 wet=0.1 filterFreq=420 filterQ=0.7
      oscHit x=1 y=2 z=3 positional=true bus=sfx roll=world type=sine freq=118 freqEnd=48 level=0.4 attack=0.003 decay=0.2 wet=0.24 filterFreq=340 filterQ=0.7
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=lowpass freq=1250 freqEnd=300 q=0.8 level=0.22 attack=0.004 decay=0.26 wet=0.3 rate=0.951150182262063
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=1798.5538841225205 freqEnd=809.3492478551342 q=1.1 level=0.16 attack=0.001 decay=0.1 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=1389.9194048602135 freqEnd=625.4637321870961 q=1.1 level=0.26 attack=0.001 decay=0.11 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=1816.7552696506025 freqEnd=817.5398713427711 q=1 level=0.16 attack=0.001 decay=0.1 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=3126.2391042113304 freqEnd=1406.8075968950986 q=5.5 level=0.26 attack=0.001 decay=0.16 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=2577.2846250622533 freqEnd=1159.778081278014 q=4 level=0.16 attack=0.001 decay=0.14 wet=0.22 rate=1
      noiseBurst x=1 y=2 z=3 positional=true bus=sfx roll=impact filter=bandpass freq=2391.869715090841 freqEnd=1076.3413717908786 q=2.4 level=0.26 attack=0.001 decay=0.12 wet=0.22 rate=1"
    `);
  });
});
