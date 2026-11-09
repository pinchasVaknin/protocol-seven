import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColorblindMode } from '../../shared/meta/SaveData';
import { cssHex, cssRgba, type GameplayPalette } from './Palette';

/**
 * Characterization tests for the gameplay palette (refactor unit C17, written before the
 * refactor).
 *
 * The module's whole observable surface is a **singleton**, so every test takes a fresh one
 * through `vi.resetModules()` and a dynamic import. That is not tidiness: `PaletteState.set`
 * early-outs on an unchanged mode *once something has been written*, so a test that ran after
 * another test's `set` would be testing a different function. One module per test makes the
 * boot path — the first call, which must write even for the default — a thing a test can
 * actually reach.
 *
 * `:root` is a double with one method. What is pinned is which custom properties are written,
 * with which values, and the one that is deliberately **not** written.
 */

// ---------------------------------------------------------------------------- the DOM double

/** `document.documentElement.style`, as the one method the palette uses. */
class FakeStyle {
    readonly written = new Map<string, string>();
    /** Every write in order, so "written twice" is distinguishable from "written once". */
    readonly log: string[] = [];

    setProperty(name: string, value: string): void {
        this.written.set(name, value);
        this.log.push(`${name}=${value}`);
    }
}

let style: FakeStyle;

beforeEach(() => {
    style = new FakeStyle();
    (globalThis as Record<string, unknown>)['document'] = { documentElement: { style } };
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)['document'];
});

// ---------------------------------------------------------------------------- the rig

interface PaletteModule {
    readonly palette: {
        readonly current: GameplayPalette;
        readonly currentMode: ColorblindMode;
        set: (mode: ColorblindMode) => void;
        onChange: (fn: (p: GameplayPalette) => void) => () => void;
    };
}

/** A module nobody has called `set` on yet, which is the state the game boots in. */
async function fresh(): Promise<PaletteModule['palette']> {
    vi.resetModules();
    const mod = (await import('./Palette')) as unknown as PaletteModule;
    return mod.palette;
}

const MODES: readonly ColorblindMode[] = ['off', 'deuteranopia', 'protanopia', 'tritanopia'];

const FIELDS: readonly (keyof GameplayPalette)[] = [
    'friendly',
    'hostile',
    'local',
    'neutral',
    'hitmarker',
    'hitmarkerKill',
    'hitmarkerAuto',
    'damage',
    'positive',
];

// ---------------------------------------------------------------------------- the tests

describe('the two encodings', () => {
    it('prints a colour as six padded hex digits', () => {
        expect(cssHex(0x57a9ff)).toBe('#57a9ff');
        expect(cssHex(0xe8604c)).toBe('#e8604c');
    });

    it('pads a colour whose leading channels are zero', () => {
        expect(cssHex(0x000000)).toBe('#000000');
        expect(cssHex(0x0000ff)).toBe('#0000ff');
        expect(cssHex(0x00ff00)).toBe('#00ff00');
    });

    it('prints white, and pads rather than truncates', () => {
        expect(cssHex(0xffffff)).toBe('#ffffff');
        // `>>> 0` makes it unsigned and `padStart` only ever adds, so a value wider than six
        // digits comes out wider. No colour in the table is, and nothing clamps it.
        expect(cssHex(-1)).toBe('#ffffffff');
    });

    it('splits a colour into three channels and an alpha', () => {
        expect(cssRgba(0x57a9ff, 0.55)).toBe('rgba(87, 169, 255, 0.55)');
        expect(cssRgba(0x000000, 1)).toBe('rgba(0, 0, 0, 1)');
        expect(cssRgba(0xffffff, 0)).toBe('rgba(255, 255, 255, 0)');
    });
});

describe('the four modes', () => {
    it('boots on the default palette, blue against red', async () => {
        const palette = await fresh();
        expect(palette.currentMode).toBe('off');
        expect(palette.current.friendly).toBe(0x57a9ff);
        expect(palette.current.hostile).toBe(0xe8604c);
        expect(palette.current.positive).toBe(0x6fd08c);
    });

    it('moves onto blue against orange for the two red-green modes', async () => {
        const palette = await fresh();
        palette.set('deuteranopia');
        expect(palette.current.friendly).toBe(0x4cc3ff);
        expect(palette.current.hostile).toBe(0xff9e2c);
    });

    it('hands deuteranopia and protanopia the very same record', async () => {
        const palette = await fresh();
        palette.set('deuteranopia');
        const deut = palette.current;
        palette.set('protanopia');
        expect(palette.current).toBe(deut);
    });

    it('moves onto teal against magenta for tritanopia', async () => {
        const palette = await fresh();
        palette.set('tritanopia');
        expect(palette.current.friendly).toBe(0x2fd6b0);
        expect(palette.current.hostile).toBe(0xff5c8a);
    });

    it('answers every field in every mode, and never the same hue twice for the pair', async () => {
        const palette = await fresh();
        for (const mode of MODES) {
            palette.set(mode);
            const p = palette.current;
            for (const field of FIELDS) expect(typeof p[field]).toBe('number');
            expect(p.friendly).not.toBe(p.hostile);
        }
    });

    it('keeps neutral off the hostile hue in the red-green palette', async () => {
        const palette = await fresh();
        palette.set('deuteranopia');
        // Amber and the new hostile orange are the same hue, so neutral goes cool-white.
        expect(palette.current.neutral).toBe(0xc9d6e2);
        palette.set('off');
        expect(palette.current.neutral).toBe(0xc89953);
    });

    it('gives the automatic hitmarker a hue that is neither the plain mark nor the kill', async () => {
        const palette = await fresh();
        for (const mode of MODES) {
            palette.set(mode);
            const p = palette.current;
            expect(p.hitmarkerAuto).not.toBe(p.hitmarker);
            expect(p.hitmarkerAuto).not.toBe(p.hitmarkerKill);
        }
    });

    it('reports the mode it was last set to', async () => {
        const palette = await fresh();
        for (const mode of MODES) {
            palette.set(mode);
            expect(palette.currentMode).toBe(mode);
        }
    });

    it('falls back to the default palette for a mode it does not know', async () => {
        const palette = await fresh();
        palette.set('nonesuch' as ColorblindMode);
        expect(palette.current.friendly).toBe(0x57a9ff);
        expect(palette.currentMode).toBe('nonesuch');
    });
});

describe('what it writes onto :root', () => {
    it('writes on the very first call, even for the mode it is already in', async () => {
        const palette = await fresh();
        expect(style.written.size).toBe(0);
        palette.set('off');
        expect(style.written.get('--c-friendly')).toBe('#57a9ff');
    });

    it('writes nothing on a second call with the same mode', async () => {
        const palette = await fresh();
        palette.set('off');
        const before = style.log.length;
        palette.set('off');
        expect(style.log.length).toBe(before);
    });

    it('writes again when the mode moves and moves back', async () => {
        const palette = await fresh();
        palette.set('off');
        const first = style.log.length;
        palette.set('tritanopia');
        expect(style.log.length).toBe(first * 2);
        expect(style.written.get('--c-friendly')).toBe('#2fd6b0');
        palette.set('off');
        expect(style.written.get('--c-friendly')).toBe('#57a9ff');
    });

    it('writes the nine palette colours under their own names', async () => {
        const palette = await fresh();
        palette.set('off');
        const p = palette.current;
        expect(style.written.get('--c-friendly')).toBe(cssHex(p.friendly));
        expect(style.written.get('--c-hostile')).toBe(cssHex(p.hostile));
        expect(style.written.get('--c-local')).toBe(cssHex(p.local));
        expect(style.written.get('--c-neutral')).toBe(cssHex(p.neutral));
        expect(style.written.get('--c-hit')).toBe(cssHex(p.hitmarker));
        expect(style.written.get('--c-hit-kill')).toBe(cssHex(p.hitmarkerKill));
        expect(style.written.get('--c-hit-auto')).toBe(cssHex(p.hitmarkerAuto));
        expect(style.written.get('--c-damage')).toBe(cssHex(p.damage));
        expect(style.written.get('--c-positive')).toBe(cssHex(p.positive));
    });

    it('generates the three soft variants rather than holding them by hand', async () => {
        const palette = await fresh();
        palette.set('tritanopia');
        const p = palette.current;
        expect(style.written.get('--c-damage-soft')).toBe(cssRgba(p.damage, 0.55));
        expect(style.written.get('--c-hostile-soft')).toBe(cssRgba(p.hostile, 0.55));
        expect(style.written.get('--c-friendly-soft')).toBe(cssRgba(p.friendly, 0.55));
    });

    it('points the two semantic tokens M1 shipped at the palette', async () => {
        const palette = await fresh();
        palette.set('deuteranopia');
        expect(style.written.get('--c-good')).toBe('#4cc3ff');
        expect(style.written.get('--c-bad')).toBe('#ff9e2c');
    });

    it('never touches the interface accent', async () => {
        const palette = await fresh();
        for (const mode of MODES) palette.set(mode);
        expect(style.written.has('--c-accent')).toBe(false);
    });

    it('writes exactly fourteen properties and no others', async () => {
        const palette = await fresh();
        palette.set('off');
        expect([...style.written.keys()].sort()).toEqual([
            '--c-bad',
            '--c-damage',
            '--c-damage-soft',
            '--c-friendly',
            '--c-friendly-soft',
            '--c-good',
            '--c-hit',
            '--c-hit-auto',
            '--c-hit-kill',
            '--c-hostile',
            '--c-hostile-soft',
            '--c-local',
            '--c-neutral',
            '--c-positive',
        ]);
    });
});

describe('subscribing to it', () => {
    it('calls a new subscriber immediately with the palette it has now', async () => {
        const palette = await fresh();
        palette.set('tritanopia');
        const seen: GameplayPalette[] = [];
        palette.onChange((p) => seen.push(p));
        expect(seen).toHaveLength(1);
        expect(seen[0]?.friendly).toBe(0x2fd6b0);
    });

    it('calls it again on every change', async () => {
        const palette = await fresh();
        const seen: number[] = [];
        palette.onChange((p) => seen.push(p.friendly));
        palette.set('deuteranopia');
        palette.set('tritanopia');
        expect(seen).toEqual([0x57a9ff, 0x4cc3ff, 0x2fd6b0]);
    });

    it('does not call it on a set that changed nothing', async () => {
        const palette = await fresh();
        palette.set('off');
        const seen: number[] = [];
        palette.onChange((p) => seen.push(p.friendly));
        palette.set('off');
        expect(seen).toHaveLength(1);
    });

    it('calls every subscriber, in the order they arrived', async () => {
        const palette = await fresh();
        const order: string[] = [];
        palette.onChange(() => order.push('a'));
        palette.onChange(() => order.push('b'));
        order.length = 0;
        palette.set('tritanopia');
        expect(order).toEqual(['a', 'b']);
    });

    it('stops calling one that unsubscribed, and leaves the rest', async () => {
        const palette = await fresh();
        const order: string[] = [];
        const off = palette.onChange(() => order.push('a'));
        palette.onChange(() => order.push('b'));
        off();
        order.length = 0;
        palette.set('tritanopia');
        expect(order).toEqual(['b']);
    });

    it('survives an unsubscribe called twice', async () => {
        const palette = await fresh();
        const off = palette.onChange(() => undefined);
        off();
        expect(() => off()).not.toThrow();
    });

    it('hands the subscriber the same record `current` holds', async () => {
        const palette = await fresh();
        let seen: GameplayPalette | null = null;
        palette.onChange((p) => {
            seen = p;
        });
        palette.set('deuteranopia');
        expect(seen).toBe(palette.current);
    });

    it('has already written :root by the time a subscriber runs', async () => {
        const palette = await fresh();
        palette.set('off');
        let written = '';
        palette.onChange(() => {
            written = style.written.get('--c-hostile') ?? '';
        });
        palette.set('tritanopia');
        expect(written).toBe('#ff5c8a');
    });
});
