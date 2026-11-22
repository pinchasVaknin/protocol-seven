
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Splash, splashWanted } from './Splash';
import { FakeElement, installFakeDom, type FakeAnimation, type FakeDom } from './testing/dom';

/**
 * Characterization tests for the splash (refactor unit C19, written before the refactor).
 *
 * ## How a Web Animations timeline is assertable at all
 *
 * The four stages are `element.animate` calls on env.timers at absolute seconds from the gesture,
 * so the double gives every element an `animate` that records the keyframes and the options
 * and hands back a move with `finish`, `cancel`, `onfinish` and `oncancel` -- and
 * `window.setTimeout` is a list with its own clock. `env.runTo(2.1)` therefore means *the moment
 * the shockwave is due*, and what is asserted is which moves exist by then, on which element,
 * with which duration. Nothing is timed and nothing is waited for.
 *
 * `e instanceof KeyboardEvent` in the gesture handler is why the double registers a
 * `KeyboardEvent` globally: without it a synthetic press throws rather than branching, which
 * is the same lesson `HTMLElement` taught in C14.
 *
 * The timings themselves, the artwork's offsets and the audio calls are the product's own;
 * only the document, the clock and the animation host are doubles.
 */

// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class and the environment are shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 330 lines of hand-grown double. It is the same double -- the file it
 * moved to was written from this one -- so nothing this suite sees has changed.
 */

let env: FakeDom;

beforeEach(() => {
    env = installFakeDom();
});

afterEach(() => {
    env.restore();
});

// ---------------------------------------------------------------------------- the rig

/** Every sound the splash can ask for, and in what order it asked. */
interface Sounds {
    readonly calls: string[];
}

interface Rig {
    readonly splash: Splash;
    readonly host: FakeElement;
    readonly sounds: Sounds;
    readonly gestures: number[];
    readonly reveals: number[];
    readonly dones: number[];
}

function rig(): Rig {
    const host = new FakeElement('div');
    const calls: string[] = [];
    const gestures: number[] = [];
    const reveals: number[] = [];
    const dones: number[] = [];
    const audio = {
        playSplashHit: (n: number): void => {
            calls.push(`hit${n}`);
        },
        playSplashShock: (): void => {
            calls.push('shock');
        },
        playSplashChime: (): void => {
            calls.push('chime');
        },
    };
    const splash = new Splash({
        host: host as unknown as HTMLElement,
        audio: audio as never,
        onGesture: () => gestures.push(env.nowMs),
        onReveal: () => reveals.push(env.nowMs),
        onDone: () => dones.push(env.nowMs),
    });
    return { splash, host, sounds: { calls }, gestures, reveals, dones };
}

function layerOf(r: Rig): FakeElement {
    return r.host.children[0]!;
}

function boxOf(r: Rig): FakeElement {
    return layerOf(r).children[0]!;
}

function find(root: FakeElement, token: string): FakeElement {
    const hit = root.querySelector(`.${token}`);
    if (hit === null) throw new Error(`no .${token}`);
    return hit;
}

function findAll(root: FakeElement, token: string): FakeElement[] {
    return root.querySelectorAll(`.${token}`);
}

/** The gesture: a real `KeyboardEvent` press, which is what starts stage 2. */
function gesture(): void {
    env.fireKey('keydown', { key: 'x', code: 'KeyX' });
}

/** Every move made on `el`, newest last. */
function movesOn(el: FakeElement): FakeAnimation[] {
    return el.anims;
}

function durations(el: FakeElement): number[] {
    return el.anims.map((a) => a.options['duration'] as number);
}

// ---------------------------------------------------------------------------- the flag

describe('splashWanted', () => {
    it('plays by default', () => {
        expect(splashWanted('')).toBe(true);
    });

    it('does not play when asked not to', () => {
        expect(splashWanted('?nosplash')).toBe(false);
        expect(splashWanted('?nosplash=1')).toBe(false);
    });

    it('does not play for the bot harness', () => {
        expect(splashWanted('?harness=1')).toBe(false);
        expect(splashWanted('?harness')).toBe(false);
    });

    it('plays alongside an unrelated flag', () => {
        expect(splashWanted('?server=example.com')).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the screen

describe('the layer it builds', () => {
    it('mounts one layer on the host', () => {
        const r = rig();
        expect(r.host.children).toHaveLength(1);
        expect(layerOf(r).className).toBe('splash');
    });

    it('puts the box and the prompt in the layer, in that order', () => {
        const r = rig();
        const layer = layerOf(r);
        expect(layer.children).toHaveLength(2);
        expect(layer.children[0]!.className).toBe('splash__box');
        expect(layer.children[1]!.className).toBe('splash__prompt');
    });

    it('asks for a key by name', () => {
        const r = rig();
        expect(find(layerOf(r), 'splash__prompt').textContent).toBe('PRESS ANY KEY');
    });

    it('builds the four pieces of the logo', () => {
        const r = rig();
        const pieces = findAll(boxOf(r), 'splash__piece');
        expect(pieces).toHaveLength(4);
        expect(pieces.map((p) => p.className)).toEqual([
            'splash__piece splash__skull',
            'splash__piece splash__word',
            'splash__piece splash__rule',
            'splash__piece splash__word',
        ]);
    });

    it('cuts all four pieces out of the brand folder', () => {
        const r = rig();
        const srcs = findAll(boxOf(r), 'splash__img').map((i) => i.src);
        expect(srcs).toEqual([
            '/brand/mark.png',
            '/brand/mark-eyes.png',
            '/brand/splash-protocol.png',
            '/brand/splash-rule.png',
            '/brand/splash-seven.png',
        ]);
    });

    it('places each piece at the offset it was cut from, as a percentage of the logo', () => {
        const r = rig();
        const pieces = findAll(boxOf(r), 'splash__piece');
        // SKULL = (40, 208, 438x611) of a 1024 logo.
        expect(pieces[0]!.style['left']).toBe(`${(40 / 1024) * 100}%`);
        expect(pieces[0]!.style['top']).toBe(`${(208 / 1024) * 100}%`);
        expect(pieces[0]!.style['width']).toBe(`${(438 / 1024) * 100}%`);
        expect(pieces[0]!.style['height']).toBe(`${(611 / 1024) * 100}%`);
    });

    it('places the rule between the two words', () => {
        const r = rig();
        const pieces = findAll(boxOf(r), 'splash__piece');
        const top = (p: FakeElement): number => Number.parseFloat(p.style['top']!);
        expect(top(pieces[1]!)).toBeLessThan(top(pieces[2]!));
        expect(top(pieces[2]!)).toBeLessThan(top(pieces[3]!));
    });

    it('never lets the artwork be dragged off the screen', () => {
        const r = rig();
        for (const img of findAll(boxOf(r), 'splash__img')) expect(img.draggable).toBe(false);
    });

    it('leaves the artwork out of the accessibility tree', () => {
        const r = rig();
        for (const img of findAll(boxOf(r), 'splash__img')) expect(img.alt).toBe('');
    });

    it('builds the eyes as their own layer over the skull', () => {
        const r = rig();
        const eyes = find(boxOf(r), 'splash__eyes');
        expect(eyes.src).toBe('/brand/mark-eyes.png');
        expect(eyes.parent!.className).toBe('splash__piece splash__skull');
    });

    it('builds two rings and a halo', () => {
        const r = rig();
        const rings = findAll(boxOf(r), 'splash__ring');
        expect(rings).toHaveLength(3);
        expect(rings[1]!.className).toContain('splash__ring--second');
        expect(rings[2]!.className).toContain('splash__halo');
    });

    it('builds fourteen sparks', () => {
        const r = rig();
        expect(findAll(boxOf(r), 'splash__spark')).toHaveLength(14);
    });

    it('gives every spark its own angle and length', () => {
        const r = rig();
        const sparks = findAll(boxOf(r), 'splash__spark');
        const angles = sparks.map((s) => s.style['--angle']);
        const lengths = sparks.map((s) => s.style['--length']);
        expect(angles[0]).toBe('-5deg');
        expect(new Set(angles).size).toBe(14);
        // The irregularity is modular, so lengths repeat; what matters is that they vary.
        expect(new Set(lengths).size).toBeGreaterThan(1);
        for (const length of lengths) expect(length).toMatch(/^\d+vmin$/);
    });

    it('puts the rings behind the pieces and the sparks between them', () => {
        const r = rig();
        const classes = boxOf(r).children.map((c) => c.className);
        expect(classes.slice(0, 3).every((c) => c.startsWith('splash__ring'))).toBe(true);
        expect(classes.slice(3, 17).every((c) => c === 'splash__spark')).toBe(true);
        expect(classes).toHaveLength(21);
    });

    it('makes no move before it is played', () => {
        rig();
        expect(env.animations).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------- stage 1

describe('stage 1: black, and the skull', () => {
    it('fades the skull in over nine hundred milliseconds', () => {
        const r = rig();
        r.splash.play();
        const skull = findAll(boxOf(r), 'splash__piece')[0]!;
        expect(durations(skull)).toEqual([900]);
        const frames = movesOn(skull)[0]!.frames;
        expect(frames[0]!['opacity']).toBe(0);
        expect(frames[1]!['opacity']).toBe(1);
    });

    it('starts the skull at the screen centre, shifted by its offset in the logo', () => {
        const r = rig();
        boxOf(r).clientWidth = 1024;
        r.splash.play();
        // SKULL centre = 40 + 438/2 = 259; (512 - 259) / 1024 * 1024 = 253.
        expect(findAll(boxOf(r), 'splash__piece')[0]!.style['transform']).toBe('translateX(253px)');
    });

    it('brings the prompt up after a delay, and keeps it up', () => {
        const r = rig();
        r.splash.play();
        const prompt = find(layerOf(r), 'splash__prompt');
        const move = movesOn(prompt)[0]!;
        expect(move.options['duration']).toBe(1400);
        expect(move.options['delay']).toBe(400);
        expect(move.options['fill']).toBe('forwards');
    });

    it('makes exactly two moves and plays no sound', () => {
        const r = rig();
        r.splash.play();
        expect(env.animations).toHaveLength(2);
        expect(r.sounds.calls).toEqual([]);
    });

    it('listens on keydown and pointerdown once played', () => {
        const r = rig();
        expect(env.windowListeners.get('keydown')).toBeUndefined();
        r.splash.play();
        expect(env.windowListeners.get('keydown')).toHaveLength(1);
        expect(env.windowListeners.get('pointerdown')).toHaveLength(1);
    });

    it('listens once however often it is played', () => {
        const r = rig();
        r.splash.play();
        r.splash.play();
        expect(env.windowListeners.get('keydown')).toHaveLength(1);
    });

    it('waits: nothing is scheduled before the gesture', () => {
        const r = rig();
        r.splash.play();
        expect(env.pendingTimers()).toBe(0);
        expect(r.gestures).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------- the gesture

describe('the gesture', () => {
    it('starts the audio graph before stage 2 makes a sound', () => {
        const r = rig();
        r.splash.play();
        gesture();
        expect(r.gestures).toHaveLength(1);
        expect(r.sounds.calls).toEqual([]);
    });

    it('is a click as well as a key', () => {
        const r = rig();
        r.splash.play();
        env.fireWindow('pointerdown');
        expect(r.gestures).toHaveLength(1);
    });

    it('is not a lone modifier', () => {
        const r = rig();
        r.splash.play();
        for (const key of ['Shift', 'Control', 'Alt', 'Meta']) env.fireKey('keydown', { key });
        expect(r.gestures).toHaveLength(0);
        gesture();
        expect(r.gestures).toHaveLength(1);
    });

    it('takes the gesture once; the next press is the skip', () => {
        const r = rig();
        r.splash.play();
        gesture();
        expect(r.gestures).toHaveLength(1);
        gesture();
        expect(r.gestures).toHaveLength(1);
        expect(r.reveals).toHaveLength(1);
    });

    it('fades the prompt out as stage 2 begins', () => {
        const r = rig();
        r.splash.play();
        gesture();
        const prompt = find(layerOf(r), 'splash__prompt');
        expect(durations(prompt)).toEqual([1400, 200]);
        expect(movesOn(prompt)[1]!.frames[1]!['opacity']).toBe(0);
    });

    it('schedules the whole timeline from the gesture', () => {
        const r = rig();
        r.splash.play();
        gesture();
        // Nine steps: two flies, three flashes, three shakes, three hits, the rule, the
        // shock, the light, the reveal and the fade -- fourteen env.timers in all.
        expect(env.pendingTimers()).toBe(14);
    });
});

// ---------------------------------------------------------------------------- stage 2

describe('stage 2: the collision', () => {
    it('throws PROTOCOL in from the right at 0.30 s', () => {
        const r = rig();
        r.splash.play();
        gesture();
        const protocol = findAll(boxOf(r), 'splash__piece')[1]!;
        env.runTo(0.29);
        expect(movesOn(protocol)).toHaveLength(0);
        env.runTo(0.3);
        expect(movesOn(protocol)).toHaveLength(1);
        expect(movesOn(protocol)[0]!.frames[0]!['transform']).toBe('translateX(140vw)');
        expect(movesOn(protocol)[0]!.options['duration']).toBe(320);
    });

    it('makes the word visible only when it flies', () => {
        const r = rig();
        r.splash.play();
        gesture();
        const protocol = findAll(boxOf(r), 'splash__piece')[1]!;
        expect(protocol.style['visibility']).toBeUndefined();
        env.runTo(0.3);
        expect(protocol.style['visibility']).toBe('visible');
    });

    it('lands the first hit at 0.62 s: a sound, a push, a flash and a shake', () => {
        const r = rig();
        boxOf(r).clientWidth = 1024;
        r.splash.play();
        gesture();
        env.runTo(0.62);
        expect(r.sounds.calls).toEqual(['hit0']);
        const [skull, protocol] = findAll(boxOf(r), 'splash__piece');
        // The push: from the shift, a little past the mark, and back.
        const push = movesOn(skull!)[1]!;
        expect(push.options['duration']).toBe(260);
        expect(push.frames[0]!['transform']).toBe('translateX(253px)');
        expect(push.frames[1]!['offset']).toBe(0.7);
        expect(push.frames[2]!['transform']).toBe('translateX(0)');
        // The flash on the word, and the shake on the box.
        expect(movesOn(protocol!)[1]!.frames[0]!['filter']).toBe('brightness(2.2)');
        expect(durations(boxOf(r))).toEqual([240]);
    });

    it('throws SEVEN in at 1.10 s and lands its hit at 1.42 s', () => {
        const r = rig();
        r.splash.play();
        gesture();
        const seven = findAll(boxOf(r), 'splash__piece')[3]!;
        env.runTo(1.1);
        expect(movesOn(seven)).toHaveLength(1);
        env.runTo(1.42);
        expect(r.sounds.calls).toEqual(['hit0', 'hit1']);
        expect(movesOn(seven)).toHaveLength(2);
    });

    it('does not move the skull on the second hit', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(0.62);
        const after = movesOn(findAll(boxOf(r), 'splash__piece')[0]!).length;
        env.runTo(1.42);
        expect(movesOn(findAll(boxOf(r), 'splash__piece')[0]!)).toHaveLength(after);
    });

    it('shakes the box harder for the second hit than the first', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(0.62);
        const first = movesOn(boxOf(r))[0]!.frames[1]!['transform'] as string;
        env.runTo(1.42);
        const second = movesOn(boxOf(r))[1]!.frames[1]!['transform'] as string;
        expect(first).toBe('translate(7px, -4.2px)');
        expect(second).toBe('translate(9px, -5.3999999999999995px)');
    });

    it('snaps the rule in at 1.70 s with the third hit, and flares the eyes', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(1.7);
        expect(r.sounds.calls).toEqual(['hit0', 'hit1', 'hit2']);
        const rule = findAll(boxOf(r), 'splash__piece')[2]!;
        expect(rule.style['visibility']).toBe('visible');
        expect(movesOn(rule)[0]!.frames[0]!['transform']).toBe('scaleX(0)');
        expect(durations(rule)).toEqual([180]);
        expect(durations(find(boxOf(r), 'splash__eyes'))).toEqual([420]);
    });

    it('shakes the box three times in all, the third the softest', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(1.7);
        const shakes = movesOn(boxOf(r));
        expect(shakes).toHaveLength(3);
        expect(shakes[2]!.frames[1]!['transform']).toBe('translate(5px, -3px)');
    });
});

// ---------------------------------------------------------------------------- stage 3

describe('stage 3: the shockwave', () => {
    it('sends two rings out of the logo at 2.10 s, the second delayed', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(2.1);
        expect(r.sounds.calls).toContain('shock');
        const rings = findAll(boxOf(r), 'splash__ring');
        expect(rings[0]!.anims).toHaveLength(1);
        expect(rings[1]!.anims).toHaveLength(1);
        expect(rings[0]!.anims[0]!.options['delay']).toBe(0);
        expect(rings[1]!.anims[0]!.options['delay']).toBe(140);
        expect(rings[0]!.anims[0]!.options['duration']).toBe(1300);
    });

    it('expands each ring from almost nothing to well off the logo, fading out', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(2.1);
        const frames = findAll(boxOf(r), 'splash__ring')[0]!.anims[0]!.frames;
        expect(frames[0]!['transform']).toBe('translate(-50%, -50%) scale(0.12)');
        expect(frames[1]!['transform']).toBe('translate(-50%, -50%) scale(3.4)');
        expect(frames[1]!['opacity']).toBe(0);
    });

    it('leaves the halo alone until the light', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(2.1);
        expect(find(boxOf(r), 'splash__halo').anims).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------- stage 4

describe('stage 4: the light', () => {
    it('chimes and swells the glow on all four pieces at 3.50 s', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(3.5);
        expect(r.sounds.calls).toEqual(['hit0', 'hit1', 'hit2', 'shock', 'chime']);
        for (const piece of findAll(boxOf(r), 'splash__piece')) {
            const glow = piece.anims[piece.anims.length - 1]!;
            expect(glow.options['duration']).toBe(1300);
            expect(glow.frames[1]!['offset']).toBe(0.35);
        }
    });

    it('flares the eyes a second time, brighter', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(1.7);
        const first = find(boxOf(r), 'splash__eyes').anims.length;
        env.runTo(3.5);
        const eyes = find(boxOf(r), 'splash__eyes');
        expect(eyes.anims).toHaveLength(first + 1);
        expect(eyes.anims[first]!.options['duration']).toBe(1200);
    });

    it('sends the halo out with every spark', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(3.5);
        expect(durations(find(boxOf(r), 'splash__halo'))).toEqual([1100]);
        const sparks = findAll(boxOf(r), 'splash__spark');
        for (const spark of sparks) expect(spark.anims).toHaveLength(1);
    });

    it('staggers the sparks by their own index', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(3.5);
        const sparks = findAll(boxOf(r), 'splash__spark');
        expect(sparks[0]!.anims[0]!.options['delay']).toBe(0);
        expect(sparks[1]!.anims[0]!.options['delay']).toBe(23);
        expect(sparks[0]!.anims[0]!.options['duration']).toBe(900);
        expect(sparks[1]!.anims[0]!.options['duration']).toBe(990);
    });

    it('draws each spark along its own angle', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(3.5);
        const frames = findAll(boxOf(r), 'splash__spark')[0]!.anims[0]!.frames;
        expect(frames[0]!['transform']).toContain('rotate(var(--angle))');
        expect(frames[1]!['offset']).toBe(0.25);
        expect(frames[2]!['opacity']).toBe(0);
    });
});

// ---------------------------------------------------------------------------- the ending

describe('the reveal and the fade', () => {
    it('puts the menu up at 4.20 s', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(4.19);
        expect(r.reveals).toHaveLength(0);
        env.runTo(4.2);
        expect(r.reveals).toHaveLength(1);
    });

    it('fades the layer out a tenth of a second after the reveal', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(4.3);
        const fades = movesOn(layerOf(r));
        expect(fades).toHaveLength(1);
        // fadeEnd 5.2 - reveal 4.2 - 0.1 = 0.9 s.
        expect(fades[0]!.options['duration']).toBeCloseTo(900, 6);
        expect(fades[0]!.frames[1]!['opacity']).toBe(0);
    });

    it('takes the layer off the host and says it is done when the fade finishes', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(4.3);
        expect(r.host.children).toHaveLength(1);
        movesOn(layerOf(r))[0]!.finish();
        expect(r.host.children).toHaveLength(0);
        expect(r.dones).toHaveLength(1);
    });

    it('finishes on a cancelled fade too', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(4.3);
        movesOn(layerOf(r))[0]!.cancel();
        expect(r.dones).toHaveLength(1);
    });

    it('stops listening once it has finished', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(4.3);
        expect(env.windowListeners.get('keydown')).toHaveLength(0);
    });

    it('reveals once, however often it is asked', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(4.2);
        r.splash.skip();
        expect(r.reveals).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------- the skip

describe('the skip', () => {
    it('drops every step still to come', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(0.62);
        expect(env.pendingTimers()).toBeGreaterThan(0);
        r.splash.skip();
        expect(env.pendingTimers()).toBe(0);
    });

    it('finishes the moves already running rather than cancelling them', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(0.62);
        const tracked = env.animations.filter((a) => a.el !== layerOf(r));
        r.splash.skip();
        expect(tracked.some((a) => a.finished)).toBe(true);
        expect(tracked.every((a) => !a.cancelled)).toBe(true);
    });

    it('reveals the menu and fades out over 450 ms', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(0.62);
        r.splash.skip();
        expect(r.reveals).toHaveLength(1);
        expect(durations(layerOf(r))).toEqual([450]);
    });

    it('plays no further sound after it', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(0.62);
        r.splash.skip();
        const before = [...r.sounds.calls];
        env.runTo(5);
        expect(r.sounds.calls).toEqual(before);
    });

    it('is the second press', () => {
        const r = rig();
        r.splash.play();
        gesture();
        gesture();
        expect(r.reveals).toHaveLength(1);
        expect(durations(layerOf(r))).toEqual([450]);
    });

    it('does nothing once the splash has finished', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(4.3);
        const moves = movesOn(layerOf(r)).length;
        r.splash.skip();
        expect(movesOn(layerOf(r))).toHaveLength(moves);
    });
});

// ---------------------------------------------------------------------------- reduced motion

describe('prefers-reduced-motion', () => {
    it('goes from the gesture to the fade with the chime alone', () => {
        env.reducedMotion = true;
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(0.5);
        expect(r.sounds.calls).toEqual(['chime']);
        expect(r.reveals).toHaveLength(1);
        expect(durations(layerOf(r))).toEqual([900]);
    });

    it('schedules three steps, not fourteen', () => {
        env.reducedMotion = true;
        const r = rig();
        r.splash.play();
        gesture();
        expect(env.pendingTimers()).toBe(3);
    });

    it('moves none of the four pieces', () => {
        env.reducedMotion = true;
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(5);
        const pieces = findAll(boxOf(r), 'splash__piece');
        // Only the skull's own fade-in from stage 1, which runs either way.
        expect(pieces[0]!.anims).toHaveLength(1);
        expect(pieces[1]!.anims).toHaveLength(0);
        expect(pieces[2]!.anims).toHaveLength(0);
        expect(pieces[3]!.anims).toHaveLength(0);
    });

    it('still fades the prompt out', () => {
        env.reducedMotion = true;
        const r = rig();
        r.splash.play();
        gesture();
        expect(durations(find(layerOf(r), 'splash__prompt'))).toEqual([1400, 200]);
    });
});

// ---------------------------------------------------------------------------- disposal

describe('disposal', () => {
    it('takes the layer off the host', () => {
        const r = rig();
        r.splash.play();
        r.splash.dispose();
        expect(r.host.children).toHaveLength(0);
    });

    it('drops every step still to come', () => {
        const r = rig();
        r.splash.play();
        gesture();
        r.splash.dispose();
        expect(env.pendingTimers()).toBe(0);
    });

    it('cancels the moves rather than finishing them', () => {
        const r = rig();
        r.splash.play();
        gesture();
        env.runTo(0.62);
        const tracked = env.animations.filter((a) => a.el !== layerOf(r));
        r.splash.dispose();
        expect(tracked.some((a) => a.cancelled)).toBe(true);
        expect(tracked.every((a) => !a.finished)).toBe(true);
    });

    it('stops listening', () => {
        const r = rig();
        r.splash.play();
        r.splash.dispose();
        expect(env.windowListeners.get('keydown')).toHaveLength(0);
    });

    it('does not say it is done: nobody revealed anything', () => {
        const r = rig();
        r.splash.play();
        r.splash.dispose();
        expect(r.dones).toHaveLength(0);
        expect(r.reveals).toHaveLength(0);
    });

    it('is safe twice', () => {
        const r = rig();
        r.splash.play();
        r.splash.dispose();
        r.splash.dispose();
        expect(r.host.children).toHaveLength(0);
    });
});
