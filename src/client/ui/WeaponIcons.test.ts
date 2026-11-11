
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_WEAPONS } from '../../shared/weapons/WeaponDefs';
import { weaponSilhouettePath } from '../weapons/WeaponSilhouette';
import { HEADSHOT_PATH, HEADSHOT_VIEWBOX, ICON_VIEWBOX, iconFor, makeIconSvg } from './WeaponIcons';

/**
 * Characterization tests for the killfeed icons (refactor unit C20, written before the
 * refactor).
 *
 * The property F15 bought is the one worth pinning: **the icon is the gun**. `iconFor` is
 * `weaponSilhouettePath` over the same `WeaponModelSpec` the viewmodel is built from, so a
 * test that compares the two is a test that the feed and the hands cannot drift -- and a test
 * that every shipped weapon has an outline is a test that nothing falls back to printing its
 * name, which eleven of the twelve used to do.
 *
 * `makeIconSvg` is the project's one SVG builder; every glyph in the game goes through it, so
 * its namespace and its `aria-hidden` are load-bearing far outside this file.
 */

// ---------------------------------------------------------------------------- the DOM double

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
    key?: string;
    code?: string;
    repeat?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
}

/** One move handed back by `element.animate`, with the hooks the splash uses on it. */
class FakeAnimation {
    onfinish: null | (() => void) = null;
    oncancel: null | (() => void) = null;
    playbackRate = 1;
    cancelled = false;
    finished = false;

    constructor(
        readonly el: FakeElement,
        readonly frames: readonly Record<string, unknown>[],
        readonly options: Record<string, unknown>,
    ) {}

    /** What `skip` does to a move already running: run it out, do not throw it away. */
    finish(): void {
        this.finished = true;
        this.onfinish?.();
    }

    cancel(): void {
        this.cancelled = true;
        this.oncancel?.();
    }
}

class FakeElement {
    readonly tokens = new Set<string>();
    readonly children: FakeElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, Listener[]>();
    readonly dataset: Record<string, string> = {};
    readonly anims: FakeAnimation[] = [];
    readonly style: Record<string, string> & { setProperty: (n: string, v: string) => void } = Object.assign(
        {} as Record<string, string>,
        {
            setProperty: (n: string, v: string): void => {
                this.style[n] = v;
            },
        },
    );

    textContent = '';
    hidden = false;
    disabled = false;
    type = '';
    value = '';
    title = '';
    src = '';
    alt = '';
    draggable = true;
    width = 0;
    height = 0;
    offsetWidth = 200;
    offsetHeight = 40;
    /** `Splash.skullShift` measures the box with this; 0 unless a test sets it. */
    clientWidth = 0;
    clientHeight = 0;
    parent: FakeElement | null = null;
    rect = { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 };

    constructor(readonly tag: string) {}

    get className(): string {
        return [...this.tokens].join(' ');
    }

    set className(value: string) {
        this.tokens.clear();
        for (const token of value.split(' ')) if (token !== '') this.tokens.add(token);
    }

    readonly classList = {
        add: (...tokens: string[]): void => {
            for (const token of tokens) this.tokens.add(token);
        },
        remove: (...tokens: string[]): void => {
            for (const token of tokens) this.tokens.delete(token);
        },
        toggle: (token: string, on?: boolean): void => {
            if (on ?? !this.tokens.has(token)) this.tokens.add(token);
            else this.tokens.delete(token);
        },
        contains: (token: string): boolean => this.tokens.has(token),
    };

    /** The Web Animations API. Every move the splash makes lands in `anims`, in order. */
    animate(frames: readonly Record<string, unknown>[], options: Record<string, unknown>): FakeAnimation {
        const anim = new FakeAnimation(this, frames, options);
        this.anims.push(anim);
        allAnimations.push(anim);
        return anim;
    }

    appendChild(child: FakeElement): FakeElement {
        child.parent = this;
        this.children.push(child);
        return child;
    }

    append(...nodes: FakeElement[]): void {
        for (const node of nodes) this.appendChild(node);
    }

    replaceChildren(...nodes: FakeElement[]): void {
        for (const child of this.children) child.parent = null;
        this.children.length = 0;
        this.append(...nodes);
    }

    remove(): void {
        const siblings = this.parent?.children;
        if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
        this.parent = null;
    }

    get childElementCount(): number {
        return this.children.length;
    }

    get firstElementChild(): FakeElement | null {
        return this.children[0] ?? null;
    }

    /**
     * `setAttribute('class', …)` writes the token set, as a real element's does.
     *
     * This is how `makeIconSvg` names its icons: an SVG element has no settable `className`,
     * so every glyph in the project is classed by attribute, and a double that did not
     * reflect it would hide every icon from `querySelector`.
     */
    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
        if (name === 'class') this.className = value;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    addEventListener(type: string, fn: Listener): void {
        const held = this.listeners.get(type);
        if (held === undefined) this.listeners.set(type, [fn]);
        else held.push(fn);
    }

    removeEventListener(type: string, fn: Listener): void {
        const held = this.listeners.get(type);
        if (held === undefined) return;
        const at = held.indexOf(fn);
        if (at >= 0) held.splice(at, 1);
    }

    /**
     * A 2D context that refuses nothing: the camo and weapon textures are drawn into one.
     *
     * The lesson from C18 -- `CharacterAssetService` throws *2D canvas context unavailable*
     * without it, and the throw happens deep inside a weapon build rather than at the call.
     */
    getContext(kind: string): unknown {
        if (kind !== '2d') return null;
        const target: Record<string, unknown> = {
            canvas: this,
            createLinearGradient: () => ({ addColorStop: (): void => undefined }),
            createRadialGradient: () => ({ addColorStop: (): void => undefined }),
            createPattern: () => null,
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
            getImageData: (_x: number, _y: number, w: number, h: number) => ({
                data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
                width: w,
                height: h,
            }),
            measureText: () => ({ width: 10 }),
        };
        return new Proxy(target, {
            get: (t, key) => (key in t ? t[key as string] : () => undefined),
            set: (t, key, value) => {
                t[key as string] = value;
                return true;
            },
        });
    }

    toDataURL(): string {
        return 'data:image/png;base64,x';
    }

    setPointerCapture(): void {}
    releasePointerCapture(): void {}

    getBoundingClientRect(): FakeElement['rect'] {
        return this.rect;
    }

    focus(): void {}
    blur(): void {}

    querySelector(selector: string): FakeElement | null {
        return this.queryAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        return this.queryAll(selector);
    }

    private queryAll(selector: string): FakeElement[] {
        const token = selector.replace(/^\./, '');
        const out: FakeElement[] = [];
        const walk = (el: FakeElement): void => {
            if (el.tokens.has(token)) out.push(el);
            for (const child of el.children) walk(child);
        };
        for (const child of this.children) walk(child);
        return out;
    }
}

// ---------------------------------------------------------------------------- the environment

let windowListeners: Map<string, Listener[]>;
let timers: { readonly at: number; readonly fn: () => void; cancelled: boolean }[];
let allAnimations: FakeAnimation[];
let nowMs = 0;
/** What `window.matchMedia('(prefers-reduced-motion: reduce)')` answers. */
let reducedMotion = false;

class FakeKeyboardEvent {}

beforeEach(() => {
    windowListeners = new Map();
    timers = [];
    allAnimations = [];
    nowMs = 100_000;
    const storage = new Map<string, string>();
    const store = {
        getItem: (k: string): string | null => storage.get(k) ?? null,
        setItem: (k: string, v: string): void => {
            storage.set(k, v);
        },
        removeItem: (k: string): void => {
            storage.delete(k);
        },
        clear: (): void => storage.clear(),
        key: (i: number): string | null => [...storage.keys()][i] ?? null,
        get length(): number {
            return storage.size;
        },
    };
    const setTimer = (fn: () => void, ms = 0): number => {
        timers.push({ at: nowMs + ms, fn, cancelled: false });
        return timers.length;
    };
    const clearTimer = (id: number): void => {
        const timer = timers[id - 1];
        if (timer !== undefined) timer.cancelled = true;
    };
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
        documentElement: new FakeElement('html'),
        activeElement: null,
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['KeyboardEvent'] = FakeKeyboardEvent;
    (globalThis as Record<string, unknown>)['localStorage'] = store;
    (globalThis as Record<string, unknown>)['setTimeout'] = setTimer;
    (globalThis as Record<string, unknown>)['clearTimeout'] = clearTimer;
    (globalThis as Record<string, unknown>)['window'] = {
        localStorage: store,
        setTimeout: setTimer,
        clearTimeout: clearTimer,
        matchMedia: (query: string) => ({ matches: reducedMotion, media: query }),
        addEventListener: (type: string, fn: Listener): void => {
            const held = windowListeners.get(type);
            if (held === undefined) windowListeners.set(type, [fn]);
            else held.push(fn);
        },
        removeEventListener: (type: string, fn: Listener): void => {
            const held = windowListeners.get(type);
            if (held === undefined) return;
            const at = held.indexOf(fn);
            if (at >= 0) held.splice(at, 1);
        },
    };
    (globalThis as Record<string, unknown>)['performance'] = { now: () => nowMs };
    (globalThis as Record<string, unknown>)['requestAnimationFrame'] = (): number => 1;
    (globalThis as Record<string, unknown>)['cancelAnimationFrame'] = (): void => undefined;
});

afterEach(() => {
    reducedMotion = false;
    for (const key of [
        'document',
        'HTMLElement',
        'KeyboardEvent',
        'localStorage',
        'setTimeout',
        'clearTimeout',
        'window',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
    ]) {
        delete (globalThis as Record<string, unknown>)[key];
    }
});

// ---------------------------------------------------------------------------- the rig

function svg(path: string, viewBox = ICON_VIEWBOX, className = 'kf-row__icon'): FakeElement {
    return makeIconSvg(path, viewBox, className) as unknown as FakeElement;
}

// ---------------------------------------------------------------------------- the outlines

describe('the weapon outlines', () => {
    it('gives every shipped weapon an outline, so none prints its name', () => {
        for (const def of ALL_WEAPONS) expect(iconFor(def.id).length).toBeGreaterThan(20);
    });

    /** The whole of F15: one source for what a weapon looks like. */
    it('is the silhouette of the model the viewmodel is built from', () => {
        for (const def of ALL_WEAPONS) expect(iconFor(def.id)).toBe(weaponSilhouettePath(def.id));
    });

    it('draws an SMG and an LMG as different shapes, which is what keying by id bought', () => {
        expect(iconFor('smg_wasp')).not.toBe(iconFor('lmg_bastion'));
        expect(iconFor('pistol_talon')).not.toBe(iconFor('sniper_kestrel'));
    });

    /** No null any more: an unknown id gets `AR_BASE`, which is what the hands would draw too. */
    it('answers for an id it has never heard of, rather than returning nothing', () => {
        const unknown = iconFor('not_a_weapon');
        expect(unknown.length).toBeGreaterThan(20);
        expect(unknown).toBe(weaponSilhouettePath('not_a_weapon'));
    });

    it('memoises, so a feed row costs a lookup', () => {
        expect(iconFor('ar_carbine')).toBe(iconFor('ar_carbine'));
    });

    it('draws in its own long box, barrel pointing right', () => {
        expect(ICON_VIEWBOX).toBe('0 0 48 16');
    });
});

// ---------------------------------------------------------------------------- the headshot

describe('the headshot badge', () => {
    it('has a box of its own, because it is a badge and not a silhouette', () => {
        expect(HEADSHOT_VIEWBOX).toBe('0 0 12 12');
        expect(HEADSHOT_VIEWBOX).not.toBe(ICON_VIEWBOX);
    });

    it('is a skull with two eyes: three subpaths', () => {
        expect((HEADSHOT_PATH.match(/M/g) ?? []).length).toBe(3);
    });

    it('stays inside its own twelve', () => {
        for (const m of HEADSHOT_PATH.matchAll(/-?\d+(?:\.\d+)?/g)) {
            expect(Number(m[0])).toBeLessThanOrEqual(12);
        }
    });
});

// ---------------------------------------------------------------------------- the builder

describe('makeIconSvg', () => {
    it('builds an svg with one path inside it', () => {
        const el = svg('M0 0 h1 v1 Z');
        expect(el.tag).toBe('svg');
        expect(el.children).toHaveLength(1);
        expect(el.children[0]!.tag).toBe('path');
    });

    it('puts the drawing on the path and the box on the svg', () => {
        const el = svg('M0 0 h1 v1 Z');
        expect(el.getAttribute('viewBox')).toBe('0 0 48 16');
        expect(el.children[0]!.getAttribute('d')).toBe('M0 0 h1 v1 Z');
    });

    it('classes the svg by attribute, which is the only way an SVG element can be classed', () => {
        expect(svg('M0 0', ICON_VIEWBOX, 'ps-opt__glyph').getAttribute('class')).toBe('ps-opt__glyph');
    });

    /** Every glyph in the game: none of them is read out, because each sits beside its name. */
    it('keeps every glyph out of the accessibility tree', () => {
        expect(svg('M0 0').getAttribute('aria-hidden')).toBe('true');
    });

    it('takes whatever box it is handed', () => {
        expect(svg(HEADSHOT_PATH, HEADSHOT_VIEWBOX, 'kf-row__head').getAttribute('viewBox')).toBe('0 0 12 12');
    });

    it('builds a fresh element every call', () => {
        expect(svg('M0 0')).not.toBe(svg('M0 0'));
    });
});
